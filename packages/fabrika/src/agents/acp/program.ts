import type * as acp from "@agentclientprotocol/sdk";
import type {AgentEvent} from "@demlik/tea/agent";
import type {AgentSpans} from "@demlik/tea/otel";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Clock, Deferred, Effect, FileSystem, Path, Queue, Schema, Stream} from "effect";
import {type Entry, listed} from "../../program/listed.ts";
import {defineProgram, kind} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {runTraced} from "../../program/trace.ts";
import {agentTrace} from "../trace/agent.ts";
import {connect, type Heard, type Opened, type PendingAsk} from "./client.ts";
import {AGENTS, harnessOf} from "./harness.ts";
import {Session, session, type Waiting} from "./session.ts";
import {type AcpEvents, acpEvents} from "./spans.ts";
import {
	type Answer,
	type Ask,
	countsOf,
	type Ended,
	type How,
	type Seen,
	saidIn,
	seenOf,
	statusLine,
	Transcript,
	transcript,
	type Usage,
} from "./transcript.ts";

// `acp`: a tea program that is an ACP client. It starts one harness (an
// agent behind the Agent Client Protocol), opens one session in a scratch
// folder, and sends it each prompt it is told, one turn after another.
//
//   acp --agent claude --folder /tmp/s --model haiku prompt="read a.txt" &
//   tell %1 prompt "and b.txt?"
//   tell %1 allow ask-1        an ask it showed, allowed once; `refuse ask-1` refuses it
//   tell %1 cancel now         the running turn, cancelled
//
// Swapping the harness is `--agent` and nothing else (./harness.ts).
//
// Two machines. `session` is kept: the harness, the ACP session id, and the
// prompts told and not answered yet (./session.ts). `transcript` is not: it
// is folded from the harness's updates at each start (./transcript.ts). A
// start after a kill opens the same session again, with `session/load` (the
// harness replays it, and the transcript comes back) or `session/resume`
// (nothing comes back), and sends the prompt whose turn was cut off again:
// nobody types it twice.
//
// Every permission ask is shown on `ask`. By default it is refused at once;
// with `--permissions ask` it waits for `allow` or `refuse`. An allow picks
// the harness's allow-once option, never an always-allow one.

const STOPS = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const OpenedOut = Schema.Struct({
	session: Schema.String,
	agent: Schema.String,
	how: Schema.Literals(["new", "load", "resume"]),
	ms: Count,
	mode: Schema.NullOr(Schema.String),
	model: Schema.NullOr(Schema.String),
	/** Updates the harness replayed on `session/load`. */
	replayed: Count,
	/** Turns ended at earlier starts. */
	earlier: Count,
	/** Prompts told at an earlier start and not answered: sent again now. */
	resent: Count,
});

const Result = Schema.Struct({
	turn: Count,
	stop: Schema.Literals(STOPS),
	ms: Count,
	input: Count,
	output: Count,
	cached: Count,
	tools: Count,
	/** The session's cost so far in dollars, when the harness says it. */
	cost: Schema.NullOr(Schema.Finite),
});

const AskOut = Schema.Struct({
	ask: Schema.String,
	tool: Schema.String,
	kind: Schema.String,
	title: Schema.String,
	options: Schema.Array(Schema.String),
	answer: Schema.Literals(["waiting", "allowed", "refused", "cancelled"]),
});

/** Why the program would not go on. */
export interface AcpRefused {
	readonly _tag: "acp_refused";
	readonly message: string;
}
const refused = (message: string) => Effect.fail<AcpRefused>({_tag: "acp_refused", message});

/** What the pump reads: the harness's own sends, and a mark to wait until all before it is folded. */
type Item = Heard | {readonly kind: "sync"; readonly done: Deferred.Deferred<void>};

/** The scratch folder, by its real path: absolute, there, and in no git repository. */
const scratchFolder = (given: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!path.isAbsolute(given)) return yield* refused(`--folder must be an absolute path`);
		const real = yield* fs.realPath(given).pipe(Effect.orElseSucceed(() => null));
		if (real === null) return yield* refused(`--folder ${given} is not there`);
		let at = real;
		for (;;) {
			const git = yield* fs.exists(path.join(at, ".git")).pipe(Effect.orElseSucceed(() => false));
			if (git) return yield* refused(`--folder ${given} is inside a git repository`);
			const up = path.dirname(at);
			if (up === at) return real;
			at = up;
		}
	});

const usageOf = (usage: acp.Usage | null | undefined): Usage | null =>
	usage === null || usage === undefined
		? null
		: {
				input: usage.inputTokens,
				output: usage.outputTokens,
				cached: usage.cachedReadTokens ?? 0,
				total: usage.totalTokens,
			};

const currentOf = (opened: Opened, category: string): string | null => {
	const option = opened.config.find((o) => o.category === category);
	return option?.type === "select" ? option.currentValue : null;
};

const askOf = (ask: PendingAsk): Ask => ({
	id: ask.id,
	tool: ask.request.toolCall.name ?? ask.request.toolCall.kind ?? "other",
	title: ask.request.toolCall.title ?? "",
	kind: ask.request.toolCall.kind ?? "other",
	options: ask.request.options.map((o) => o.kind),
});

/** An ask as the `ask` output shows it. */
const shown = (pending: PendingAsk, answer: Answer | "waiting") => {
	const {id, ...ask} = askOf(pending);
	return {ask: id, ...ask, answer};
};

export const acpProgram = defineProgram({
	name: "acp",
	description:
		"An ACP client: starts one agent harness over the Agent Client Protocol, opens one session in a scratch folder, and runs each prompt it is told as a turn. Started again under the same run, it opens the same session and sends the prompt a kill cut off.",
	flags: {
		agent: flag(Schema.Literals(AGENTS), "The harness: claude, or fake (scripted, no model)."),
		folder: flag(
			Schema.String,
			"The scratch folder the harness works in: an absolute path, in no git repository.",
		),
		model: flag(Schema.UndefinedOr(Schema.String), "The model, by the harness's own value."),
		effort: flag(
			Schema.UndefinedOr(Schema.String),
			"How hard it thinks, by the harness's own value. Not every model has one.",
		),
		mode: flag(
			Schema.UndefinedOr(Schema.String),
			"The harness's permission mode. Left out: the harness's default.",
		),
		permissions: flag(
			Schema.UndefinedOr(Schema.Literals(["refuse", "ask"])),
			"refuse (the default): every permission ask is refused at once. ask: each waits for allow or refuse.",
		),
		reopen: flag(
			Schema.UndefinedOr(Schema.Literals(["load", "resume"])),
			"How a session is opened again after a restart: load (the default; the harness replays it) or resume (it does not).",
		),
		budget: flag(
			Schema.UndefinedOr(Schema.Finite.check(Schema.isGreaterThan(0))),
			"The dollars one session may cost, where the harness can stop at a cap (claude).",
		),
	},
	inputs: {
		prompt: input(Schema.String, "A prompt: one turn, after the turns before it."),
		allow: input(Schema.String, "The id of an ask waiting: allow it, once."),
		refuse: input(Schema.String, "The id of an ask waiting: refuse it."),
		cancel: input(Schema.String, "Anything: cancel the turn running now."),
	},
	outputs: {
		opened: output(
			OpenedOut,
			"Once per start: the session, how it was opened, and how long that took.",
		),
		said: output(Schema.String, "What the agent said in a turn, once the turn ended."),
		result: output(Result, "Each turn's end: why it stopped, its tokens, its tool calls."),
		ask: output(AskOut, "A permission ask, as it comes and as it is answered."),
	},
	machines: {
		// Kept until the run is forgotten. No `recovered`: main reads what is waiting at every start
		// and sends it again itself, once the session is open.
		session: kind({
			machine: session,
			state: Session,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: ({kept}) => ({
				name: "acp session",
				steps: {},
				tags: (s) => ({"acp.turns": s.turns, "acp.waiting": s.waiting.length}),
				attributes: {"acp.agent": kept?.agent ?? "none yet"},
			}),
			status: (s) =>
				`${s.agent ?? "no session yet"} · ${s.turns} turns · ${s.waiting.length} waiting`,
		}),
		// Not kept: folded again from the harness at every start, and only shown.
		transcript: kind({
			machine: transcript,
			state: Transcript,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "acp transcript", steps: {}, tags: countsOf}),
			status: statusLine,
		}),
	},
	main: ({flags, inputs, send, watch, machines}) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = yield* scratchFolder(flags.folder);
			const harness = harnessOf(flags.agent, folder, flags.budget ?? null);
			if (!(yield* fs.exists(harness.script).pipe(Effect.orElseSucceed(() => false))))
				return yield* refused(
					`${flags.agent} is not installed: pnpm --dir adapters install --ignore-workspace --frozen-lockfile`,
				);

			// One session per run, started with no Msg: a new one begins empty, a kept one as it was left.
			const kept = yield* machines.session.get("session").start();
			const was = kept.getState();
			if (was.agent !== null && was.agent !== flags.agent)
				return yield* refused(
					`this run's session is on ${was.agent}: it cannot move to ${flags.agent}`,
				);

			const booting = yield* runTraced(
				"transcript",
				transcript,
				{ctx: undefined},
				{name: "acp transcript", steps: {}, tags: countsOf, attributes: {"acp.agent": flags.agent}},
			);
			const view = yield* booting.ready;
			yield* watch("transcript", "transcript", view);
			const fold = <M extends Parameters<typeof view.dispatch>[0]>(msg: M) =>
				view.dispatch(msg).pipe(Effect.orDie);

			// ---------------------------------------------------------------- what the harness sends
			const items = yield* Queue.unbounded<Item>();
			const c = yield* connect(harness, folder, (heard) => {
				Queue.offerUnsafe(items, heard);
			});
			/** Wait until everything the harness sent before now is folded. */
			const sync = Effect.gen(function* () {
				const done = yield* Deferred.make<void>();
				yield* Queue.offer(items, {kind: "sync", done});
				yield* Deferred.await(done);
			});

			let turn: {readonly events: AcpEvents; readonly spans: AgentSpans<null> | null} | null = null;
			const draw = (events: readonly AgentEvent<null>[]) => {
				for (const event of events) turn?.spans?.onEvent(event);
			};
			let loading = false;
			let replayed = 0;
			const pending = new Map<string, PendingAsk>();

			const answer = (ask: PendingAsk, allow: boolean) =>
				Effect.gen(function* () {
					pending.delete(ask.id);
					const option =
						ask.request.options.find((o) => allow && o.kind === "allow_once") ??
						ask.request.options.find((o) => o.kind === "reject_once");
					const given: Answer =
						option === undefined
							? "cancelled"
							: option.kind === "allow_once"
								? "allowed"
								: "refused";
					ask.answer(
						option === undefined
							? {outcome: {outcome: "cancelled"}}
							: {outcome: {outcome: "selected", optionId: option.optionId}},
					);
					yield* fold({type: "answered", ask: ask.id, answer: given});
					yield* send("ask", shown(ask, given));
				});

			const asked = (ask: PendingAsk) =>
				Effect.gen(function* () {
					yield* fold({type: "asked", ask: askOf(ask)});
					if (flags.permissions !== "ask") return yield* answer(ask, false);
					pending.set(ask.id, ask);
					yield* send("ask", shown(ask, "waiting"));
				});

			const pump = Effect.gen(function* () {
				const batch = yield* Queue.takeAll(items);
				const now = yield* Clock.currentTimeMillis;
				let seen: Seen[] = [];
				const flush = Effect.suspend(() => {
					if (seen.length === 0) return Effect.void;
					const events = seen;
					seen = [];
					return fold({type: "seen", events});
				});
				for (const item of batch) {
					if (item.kind === "update") {
						const event = seenOf(item.update);
						seen.push(event);
						if (loading) replayed += 1;
						if (turn !== null) draw(turn.events.seen(event, now));
						continue;
					}
					yield* flush;
					if (item.kind === "ask") yield* asked(item.ask);
					else yield* Deferred.succeed(item.done, undefined);
				}
				yield* flush;
			});
			yield* Effect.forkScoped(Effect.forever(pump));

			// ---------------------------------------------------------------- open the session
			const how: How =
				was.id === null
					? "new"
					: c.can(flags.reopen ?? "load")
						? (flags.reopen ?? "load")
						: c.can("load")
							? "load"
							: c.can("resume")
								? "resume"
								: yield* refused(
										`${flags.agent} can neither load nor resume a session: ${was.id} cannot be opened again`,
									);
			loading = true;
			yield* fold({type: "opening", how, earlier: was.turns});
			const t0 = yield* Clock.currentTimeMillis;
			let opened = yield* c.open(how, was.id, folder, harness.meta);
			const ms = (yield* Clock.currentTimeMillis) - t0;
			yield* sync;
			loading = false;
			if (how === "new") yield* kept.dispatch({type: "opened", agent: flags.agent, id: opened.id});
			// Set again at every start: a harness may not keep them with the session.
			if (flags.model !== undefined) opened = yield* c.configure(opened, "model", flags.model);
			if (flags.effort !== undefined)
				opened = yield* c.configure(opened, "thought_level", flags.effort);
			if (flags.mode !== undefined) opened = yield* c.configure(opened, "mode", flags.mode);
			const mode = currentOf(opened, "mode") ?? opened.mode;
			yield* fold({type: "opened", mode});
			yield* send("opened", {
				session: opened.id,
				agent: flags.agent,
				how,
				ms,
				mode,
				model: currentOf(opened, "model"),
				replayed,
				earlier: was.turns,
				resent: was.waiting.length,
			});
			const id = opened.id;
			const model = currentOf(opened, "model");

			// ---------------------------------------------------------------- answers and cancels
			const byId = (ask: string) => pending.get(ask);
			yield* Effect.forkScoped(
				inputs.allow.pipe(
					Stream.runForEach((ask) => {
						const found = byId(ask);
						return found === undefined ? Effect.void : answer(found, true);
					}),
				),
			);
			yield* Effect.forkScoped(
				inputs.refuse.pipe(
					Stream.runForEach((ask) => {
						const found = byId(ask);
						return found === undefined ? Effect.void : answer(found, false);
					}),
				),
			);
			yield* Effect.forkScoped(
				inputs.cancel.pipe(
					Stream.runForEach(() =>
						Effect.gen(function* () {
							if (turn === null) return;
							yield* fold({type: "cancelling"});
							// ACP: a client that cancels answers every ask still open with `cancelled`.
							for (const ask of [...pending.values()]) {
								pending.delete(ask.id);
								ask.answer({outcome: {outcome: "cancelled"}});
								yield* fold({type: "answered", ask: ask.id, answer: "cancelled"});
								yield* send("ask", shown(ask, "cancelled"));
							}
							yield* c.cancel(id).pipe(Effect.ignore);
						}),
					),
				),
			);

			// ---------------------------------------------------------------- the turns, one after another
			const todo = yield* Queue.unbounded<Waiting | null>();
			for (const waiting of was.waiting) Queue.offerUnsafe(todo, waiting);
			yield* Effect.forkScoped(
				inputs.prompt.pipe(
					Stream.runForEach((prompt) =>
						Effect.gen(function* () {
							yield* kept.dispatch({type: "told", prompt});
							Queue.offerUnsafe(todo, {n: kept.getState().told, prompt});
						}),
					),
					Effect.andThen(Queue.offer(todo, null)),
				),
			);

			const runTurn = (w: Waiting) =>
				Effect.gen(function* () {
					const start = yield* Clock.currentTimeMillis;
					turn = {
						events: acpEvents(`${id}#${w.n}`),
						spans: yield* agentTrace<null>(`acp ${flags.agent}`),
					};
					draw(turn.events.start(start, model));
					yield* fold({type: "turn", n: w.n, prompt: w.prompt});
					const response = yield* c.prompt(id, w.prompt);
					yield* sync;
					const ended: Ended = {n: w.n, stop: response.stopReason, usage: usageOf(response.usage)};
					yield* fold({type: "ended", ended});
					const end = yield* Clock.currentTimeMillis;
					draw(turn.events.end(ended, end));
					turn.spans?.end();
					turn = null;
					// The asks of a turn that ended are over: the harness no longer waits on them.
					pending.clear();
					yield* kept.dispatch({type: "ended", n: w.n});
					const s = view.getState();
					const said = saidIn(s, w.n);
					if (said !== "") yield* send("said", said);
					yield* send("result", {
						turn: w.n,
						stop: ended.stop,
						ms: end - start,
						input: ended.usage?.input ?? 0,
						output: ended.usage?.output ?? 0,
						cached: ended.usage?.cached ?? 0,
						tools: s.tools.filter((t) => t.turn === w.n).length,
						cost: s.context?.cost ?? null,
					});
				}).pipe(Effect.withSpan("acp turn", {attributes: {"acp.turn": w.n}}));

			for (;;) {
				const next = yield* Queue.take(todo);
				if (next === null) return;
				yield* runTurn(next);
			}
		}).pipe(Effect.scoped),
});

/** `acp`, listed for tsh: Node's process spawner and file system under Effect's. */
export const acpEntry: Entry = listed(acpProgram, nodeServices);
