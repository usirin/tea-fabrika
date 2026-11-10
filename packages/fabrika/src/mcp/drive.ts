import {Clock, Deferred, Duration, Effect, Option, Scope, Semaphore} from "effect";
import type {AnyRunning} from "../program/listed.ts";
import type {AnyRun} from "../program/program.ts";
import {viewOf} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import type {ProgramList} from "../shell/programs.ts";
import {JOB_TOOL, type JobAnswer, LAST_MAX, lastLines} from "./job.ts";
import {LINE_TOOL, type LineAnswer, type LineAsk, type LineRefused} from "./line.ts";
import {
	RESTART,
	RESTART_TOOL,
	type RestartAnswer,
	type RestartAsk,
	type RestartRefused,
} from "./restart.ts";
import {STOP_TOOL, type StopAnswer, type StopAsk, type StopRefused} from "./stop.ts";
import {type Call, callOf, RUNS, type Tool, toolNamesOf, toolsOf} from "./tools.ts";

// One agent's runs, as its MCP tools drive them: a tool call on an input goes to the agent's own
// run of that program, started on its first call, as `post.ts` starts one tracker for a post.
// What runs in the person's tiles is listed, never driven: a run in a tile writes as the person,
// and an agent never does. The agent's writes reach the tile through the ledger they share, as
// any other writer's do.
//
//   const drive = yield* driveFor({list, tiles: () => [{run: "tracker:1a2b", program: "tracker"}]});
//   yield* drive.call("tracker_file", {value: {title: "Login fails", body: ""}})
//   // {kind: "done", data: {program: "tracker", run: "tracker:agent:5c1e", word: "queued", view: {...}}}
//   yield* drive.call("runs", {})
//   // {kind: "done", data: {programs: [...], yours: [{program, run, view}], tiles: [{run, program}]}}
//
// The runs live in the scope it is made in: the connection's. Closing it stops them, as a
// terminal closing hangs up its shell. Their state is what their program keeps; the tracker's is
// on the ledger, so nothing is lost.
//
// Calls go one at a time, so two first calls never start two runs.
//
// The host may hand its jobs too (`job`): then the `job` tool is listed beside `runs` (./job.ts),
// and it answers job n as the host knows it, its lines cut to what was asked.
//
//   yield* drive.call("job", {n: 1, last: 2})
//   // {kind: "done", data: {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"}, lines: ["4", "5"]}}
//
// And its stop (`stop`): then the `stop` tool is listed after `job` (./stop.ts), and a call that
// fits is handed to the host, which stops job n for this agent, or says why not.
//
//   yield* drive.call("stop", {n: 1, why: "wrong ticket"})
//   // {kind: "done", data: {_tag: "stopped", job: {n: 1, ..., state: {_tag: "ended", how: "stopped"}, lines: [...]}}}
//   yield* drive.call("stop", {n: 1})
//   // {kind: "refused", why: "stop does not fit: ... [\"why\"]"}: the host is never asked
//
// And its restart (`restart`): then the `restart` tool is listed after `stop` (./restart.ts), and a
// call that fits hands the host only its why. The host answers, then ends, or says why not.
//
//   yield* drive.call("restart", {why: "pick up the new build"})
//   // {kind: "done", data: {_tag: "restarting", detached: [2]}}
//
// And its line (`line`): then the `line` tool is listed after `restart` (./line.ts), and a line
// that fits is handed to the host, which runs it in this agent's own tile, or says why not.
//
//   yield* drive.call("line", {line: "tally &"})
//   // {kind: "done", data: {_tag: "job", job: {n: 1, text: "tally &", tile: "t2", state: {_tag: "running"}, lines: []}}}
//
// A read-only door (`readOnly`) lists only the tools that write nothing (MCP's `readOnlyHint`). A
// call is read against the tools listed, so a write tool called anyway is refused as any tool that
// is not there, before a run starts: an agent whose own session could not be made, on a home
// connected to a ledger server, where the only session left is the person's (apps/fabrika,
// host/agents.ts). Its why, when given, is in `runs`.
//
//   const {drive, tools} = yield* driveFor({list, tiles, readOnly: {why: "the key ...: not a key"}});
//   yield* drive.call("tracker_file", {value: {title: "x", body: ""}})
//   // {kind: "refused", why: "there is no tool tracker_file"}
//   yield* drive.call("runs", {})
//   // {kind: "done", data: {programs, yours, tiles, readOnly: {why: "the key ...: not a key"}}}

/** A run in a tile: listed for the agent to see, never driven. */
export interface InTile {
	readonly run: string;
	readonly program: string;
}

/** What a call came to: done, with what to show the agent, or refused, with why in words. */
export type Answer =
	| {readonly kind: "done"; readonly data: unknown}
	| {readonly kind: "refused"; readonly why: string};

export interface Drive {
	/** One tool call, by the tool's name and its arguments, read by the list's own schemas. */
	readonly call: (name: string, args: unknown) => Effect.Effect<Answer>;
}

/**
 * How long a call on a program input waits, from the call on: for the connection, the run's start,
 * room in its mailbox and its handler, all on one deadline. OTP's `gen_server:call` default.
 */
const CAP = Duration.seconds(5);

/** What a run's window shows now: its view of its machine, or `null` (no view, or no state yet). */
const viewNow = (run: AnyRun): unknown => {
	const declared = viewOf(run.program);
	const state = declared === undefined ? null : run.machines[declared.machine]?.state();
	return declared === undefined || state === null || state === undefined
		? null
		: declared.of(state);
};

export const driveFor = (options: {
	/** The programs the agent drives, each packed with the agent's own services. */
	readonly list: ProgramList;
	readonly tiles: () => readonly InTile[];
	/** Job n of the host's table now, with every line kept of it; `null`: the host knows none. */
	readonly job?: ((n: number) => JobAnswer | null) | undefined;
	/** Stop job n of the host's table, for this agent and why (./stop.ts); or why the host would not. */
	readonly stop?: ((ask: StopAsk) => Effect.Effect<StopAnswer, StopRefused>) | undefined;
	/** Restart the host, for this agent and why (./restart.ts); or why the host would not. */
	readonly restart?:
		| ((ask: RestartAsk) => Effect.Effect<RestartAnswer, RestartRefused>)
		| undefined;
	/** Run one line in this agent's own tile (./line.ts); or why the host would not. */
	readonly line?: ((ask: LineAsk) => Effect.Effect<LineAnswer, LineRefused>) | undefined;
	/**
	 * Only the tools that write nothing are listed, and only a listed tool is called. With a why,
	 * `runs` says it, so the agent knows why it cannot write.
	 */
	readonly readOnly?: boolean | {readonly why: string} | undefined;
}) =>
	Effect.gen(function* () {
		const {list, tiles, job, stop, restart, line} = options;
		const readOnly = options.readOnly ?? false;
		/** The host's own tools, after `runs`: each one the host hands. */
		const host: readonly Tool[] = [
			...(job === undefined ? [] : [JOB_TOOL]),
			...(stop === undefined ? [] : [STOP_TOOL]),
			...(restart === undefined ? [] : [RESTART_TOOL]),
			...(line === undefined ? [] : [LINE_TOOL]),
		];
		const tools = toolsOf(list)
			.flatMap((tool) => (tool.name === RUNS ? [tool, ...host] : [tool]))
			.filter((tool) => readOnly === false || tool.annotations?.readOnlyHint === true);
		const listed = new Set(tools.map((tool) => tool.name));
		const scope = yield* Effect.scope;
		const one = yield* Semaphore.make(1);
		const mine = new Map<string, AnyRunning>();
		/** A start still going on, kept past a call's deadline so the next call waits on the same one. */
		const starting = new Map<string, Deferred.Deferred<Option.Option<AnyRunning>>>();

		/**
		 * The agent's run of `program`, waited on for at most `within`: the one that runs, a start
		 * still going on, or a fresh one. `None` outside: the deadline came first. The start goes on in
		 * the connection's scope, and the run it makes is kept for the next call.
		 */
		const runOf = (program: string, within: Duration.Duration) =>
			Effect.gen(function* () {
				const running = mine.get(program);
				if (running !== undefined) return Option.some(Option.some(running));
				const going = starting.get(program);
				const started = going ?? (yield* Deferred.make<Option.Option<AnyRunning>>());
				if (going === undefined) {
					// Set before the fork, so a start that ends at once never leaves a stale entry behind.
					starting.set(program, started);
					yield* begin(program).pipe(
						Deferred.into(started),
						Effect.ensuring(Effect.sync(() => starting.delete(program))),
						Effect.forkIn(scope),
					);
				}
				return yield* Deferred.await(started).pipe(Effect.timeoutOption(within));
			});

		/** A fresh run of `program`, or `None`: no such program, or it did not start with no flags. */
		const begin = (program: string) =>
			Effect.gen(function* () {
				const entry = list.get(program);
				if (entry === undefined) return Option.none();
				const id = `${program}:agent:${crypto.randomUUID().slice(0, 8)}`;
				const started = yield* entry
					.start({}, {}, {id, storage: memoryStorage()})
					.pipe(Scope.provide(scope));
				if (started.kind !== "running") return Option.none();
				mine.set(program, started);
				// It ended: its program quit, or its input was closed. The next call starts a fresh one.
				yield* started.run.ended.pipe(
					Effect.andThen(Effect.sync(() => mine.delete(program))),
					Effect.forkIn(scope),
				);
				return Option.some(started);
			});

		const runs = (): unknown => ({
			programs: [...list].map(([name, entry]) => ({
				name,
				description: entry.program.description,
				tools: toolNamesOf(name, entry.program.inputs),
			})),
			yours: [...mine].map(([program, r]) => ({program, run: r.run.id, view: viewNow(r.run)})),
			tiles: tiles(),
			...(typeof readOnly === "object" ? {readOnly} : {}),
		});

		const call = (c: Call): Effect.Effect<Answer> => {
			switch (c.kind) {
				case "refused":
					return Effect.succeed(c);
				case "runs":
					return Effect.sync(() => ({kind: "done", data: runs()}));
				case "job":
					return Effect.sync((): Answer => {
						const found = job?.(c.ask.n) ?? null;
						if (found === null)
							return {
								kind: "refused",
								why: `there is no job ${c.ask.n}: the host's table does not hold it, and no end of it is kept`,
							};
						return {
							kind: "done",
							data: {...found, lines: lastLines(found.lines, c.ask.last ?? LAST_MAX)},
						};
					});
				case "stop":
					// Listed only when the host hands its stop, and only a listed tool is read.
					if (stop === undefined)
						return Effect.succeed({kind: "refused", why: "there is no tool stop"});
					return stop(c.ask).pipe(
						Effect.map((answer): Answer => ({
							kind: "done",
							data:
								answer._tag === "stopped"
									? {...answer, job: {...answer.job, lines: lastLines(answer.job.lines, LAST_MAX)}}
									: answer,
						})),
						Effect.catchTag("StopRefused", ({why}) =>
							Effect.succeed<Answer>({kind: "refused", why}),
						),
					);
				case "restart":
					// Listed only when the host hands its restart, and only a listed tool is read.
					if (restart === undefined)
						return Effect.succeed({kind: "refused", why: `there is no tool ${RESTART}`});
					return restart(c.ask).pipe(
						Effect.map((data): Answer => ({kind: "done", data})),
						Effect.catchTag("RestartRefused", ({why}) =>
							Effect.succeed<Answer>({kind: "refused", why}),
						),
					);
				case "line":
					// Listed only when the host hands its line, and only a listed tool is read.
					if (line === undefined)
						return Effect.succeed({kind: "refused", why: "there is no tool line"});
					return line(c.ask).pipe(
						Effect.map((answer): Answer => ({kind: "done", data: answer})),
						Effect.catchTag("LineRefused", ({why}) =>
							Effect.succeed<Answer>({kind: "refused", why}),
						),
					);
				case "input":
					return input(c);
			}
		};

		/**
		 * A call on a program input: the agent's run of it asks, and the answer shows the view once
		 * that input's own handler has returned. Waiting for the connection, the run's start, room and
		 * the handler spend one {@link CAP} from the call on. Past it, a value that went in answers
		 * queued with the view as it is, its work going on; one that did not is refused, and nothing of
		 * it is sent later. The connection is held until the view is read.
		 */
		const input = (c: Extract<Call, {readonly kind: "input"}>): Effect.Effect<Answer> =>
			Effect.gen(function* () {
				const began = yield* Clock.currentTimeMillis;
				const left = Clock.currentTimeMillis.pipe(
					Effect.map((now) => Duration.millis(Math.max(0, Duration.toMillis(CAP) - (now - began)))),
				);
				const notQueued: Answer = {
					kind: "refused",
					why: `${c.program}'s ${c.input} took nothing: not queued in ${Duration.toMillis(CAP) / 1000} seconds`,
				};
				// The permit is the scope's from the moment it is taken, so a deadline at that instant leaks none.
				const permit = yield* one.takeScoped(1).pipe(Effect.timeoutOption(CAP));
				if (Option.isNone(permit)) return notQueued;
				const started = yield* runOf(c.program, yield* left);
				if (Option.isNone(started)) return notQueued;
				const running = started.value;
				if (Option.isNone(running))
					return {
						kind: "refused",
						why: `${c.program} did not start with no flags: start it in a tile instead`,
					} as const;
				const {run} = running.value;
				const word = yield* run
					.ask(c.input, c.value, yield* left)
					.pipe(Effect.catchTag("TimeoutError", () => Effect.succeed(null)));
				if (word === null) return notQueued;
				if (word !== "queued")
					return {
						kind: "refused",
						why: `${c.program}'s ${c.input} took nothing: ${word}`,
					} as const;
				return {
					kind: "done",
					data: {program: c.program, run: run.id, word, view: viewNow(run)},
				} as const;
			}).pipe(Effect.scoped);

		const drive: Drive = {
			call: (name, args) => {
				const c: Call = listed.has(name)
					? callOf(list, name, args)
					: {kind: "refused", why: `there is no tool ${name}`};
				return c.kind === "input" ? input(c) : one.withPermit(call(c));
			},
		};
		return {drive, tools};
	});
