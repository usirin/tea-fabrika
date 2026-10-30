import {Duration, Effect, Option, Scope, Semaphore, Stream} from "effect";
import type {AnyRunning} from "../program/listed.ts";
import type {AnyRun} from "../program/program.ts";
import {viewOf} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import type {ProgramList} from "../shell/programs.ts";
import {type Call, callOf, toolNamesOf, toolsOf} from "./tools.ts";

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

/** How long a fresh run is given to show its first state. */
const FIRST_STATE = Duration.seconds(5);

/** What a run's window shows now: its view of its machine, or `null` (no view, or no state yet). */
const viewNow = (run: AnyRun): unknown => {
	const declared = viewOf(run.program);
	const state = declared === undefined ? null : run.machines[declared.machine]?.state();
	return declared === undefined || state === null || state === undefined
		? null
		: declared.of(state);
};

/** Done once the run's window has something to show, or a few seconds on. A run with no view is ready at once. */
const shown = (run: AnyRun) => {
	const declared = viewOf(run.program);
	const machine = declared === undefined ? undefined : run.machines[declared.machine];
	if (machine === undefined) return Effect.void;
	return machine.changes.pipe(
		Stream.filter((s) => s !== null),
		Stream.runHead,
		Effect.timeoutOption(FIRST_STATE),
		Effect.asVoid,
	);
};

export const driveFor = (options: {
	/** The programs the agent drives, each packed with the agent's own services. */
	readonly list: ProgramList;
	readonly tiles: () => readonly InTile[];
}) =>
	Effect.gen(function* () {
		const {list, tiles} = options;
		const scope = yield* Effect.scope;
		const one = yield* Semaphore.make(1);
		const mine = new Map<string, AnyRunning>();

		/** The agent's run of `program`: the one that runs, or a fresh one. */
		const runOf = (program: string) =>
			Effect.gen(function* () {
				const running = mine.get(program);
				if (running !== undefined) return Option.some(running);
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
				yield* shown(started.run);
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
		});

		const call = (c: Call): Effect.Effect<Answer> => {
			switch (c.kind) {
				case "refused":
					return Effect.succeed(c);
				case "runs":
					return Effect.sync(() => ({kind: "done", data: runs()}));
				case "input":
					return Effect.gen(function* () {
						const running = yield* runOf(c.program);
						if (Option.isNone(running))
							return {
								kind: "refused",
								why: `${c.program} did not start with no flags: start it in a tile instead`,
							} as const;
						const {run} = running.value;
						const word = yield* run.offer(c.input, c.value);
						if (word !== "queued")
							return {
								kind: "refused",
								why: `${c.program}'s ${c.input} took nothing: ${word}`,
							} as const;
						return {
							kind: "done",
							data: {program: c.program, run: run.id, word, view: viewNow(run)},
						} as const;
					});
			}
		};

		const drive: Drive = {call: (name, args) => one.withPermit(call(callOf(list, name, args)))};
		return {drive, tools: toolsOf(list)};
	});
