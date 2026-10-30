// An agent as a child program on tea-host (experiment 104). A stage does not run its agent in its
// own fiber: it starts a child under its name (`<stage>:agent`, OTP's `supervisor:start_child`)
// with `limits` on the child spec, and asks it by message. The ledger counts the child's spend and
// ends it `limit:usd` when it crosses its cap (experiment 102), and a limit's end is final.
//
//   the stage   sends one ask into the child's inbox under an id it can make again (its own name
//               and the ask's place in it, never a model's tool id), then reads `<child>/answers`
//               for that id. Before it sends, it records the ask in `<stage>/asking` under its own
//               fence. A takeover of the stage asks again what it still wants: an ask that was
//               answered is answered from the ledger, and the agent does not run again.
//   the child   for each ask in its inbox with no answer row, once the stage still wants it: hold
//               the turn's upper bound, run the agent, charge what it cost, then write the answer
//               row, fenced. A child taken over mid-turn runs the turn again: agent work is
//               at-least-once, so a takeover wastes at most the one turn that was in flight
//               (experiment 101).
//
// Which asks the stage still wants. A stage asks one thing at a time, and a stage taken over may not
// want what its dead holder asked (plan starts its drafts over under a new conversation). So the
// child runs an ask only once the stage's current holder is seen alive (its lease renewed while the
// child watched, or newly taken) and has recorded that ask under its own fence. When that holder
// has asked for something else still unanswered, the old ask is withdrawn and never run: Temporal's
// cancel of an activity a reset workflow no longer waits on.
//
// The child traps nothing: when a limit ends it, the stage (which traps exits) hears an EXIT, and
// reads the `limit` record in `<child>/dead`.
import {defineMachine} from "@demlik/tea";
import {type Cost, defineProgram, envelope, input, Ledger, Self, streams} from "@kampus/fabrika";
import {Duration, Effect, Exit, Schedule, Schema} from "effect";
import {steady} from "../asks/ledger.ts";
import {Faults} from "./idempotency.ts";

/** One ask: its id (the same on every resend) and what the agent is handed. */
export const AgentAsk = Schema.Struct({id: Schema.String, brief: Schema.Unknown});
export type AgentAsk = typeof AgentAsk.Type;

/** What one turn left: the agent's answer, what it cost, and whether a model ran (`real`) or a script (`stub`). */
export interface Turn {
	readonly answer: unknown;
	readonly cost: Cost;
	readonly agent: "real" | "stub";
}

const CHILD = ":agent";
/** The child's name under a stage. A `:`, not a `/`: a name may not sit inside another. */
export const agentOf = (stage: string) => `${stage}${CHILD}`;
/** The stage a child serves. */
const stageOf = (child: string) => child.slice(0, -CHILD.length);
/** The stream a child keeps its answers in, one row per ask id. */
export const answersOf = (child: string) => `${child}/answers`;
/**
 * The stream a stage records its asks in, under the fence it asked with: `on` when it asks, `off`
 * when it stops waiting with no answer (its Sub was cut). The last row of an ask at a fence counts.
 */
export const askingOf = (stage: string) => `${stage}/asking`;

const Asking = Schema.Struct({id: Schema.String, fence: Schema.Number, on: Schema.Boolean});
const readAsking = Schema.decodeUnknownExit(Schema.fromJsonString(Asking));

/** How the stage's holder at one fence stands on an ask: asked it, took it back, or not yet said. */
type Standing = "wanted" | "withdrawn" | "unsaid";

/** What the child says on each turn, for the harness: the provider's bill. */
export type AgentNote = {
	readonly ev: "agent";
	readonly name: string;
	readonly fence: number;
	readonly id: string;
	readonly step: "hold" | "turn" | "answered" | "limit" | "skipped" | "withdrawn";
	readonly agent?: "real" | "stub";
	readonly usd?: number;
};

const ASK = Schema.decodeUnknownExit(AgentAsk);
const EVERY_100_MS = Schedule.spaced(Duration.millis(100));

/** The child keeps nothing but its answers: a machine with one Msg that changes nothing. */
export const quiet = defineMachine({
	types: {model: {} as {readonly n: number}, msg: {} as {readonly type: "noop"}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0}, []],
	update: {noop: (s) => [s, []]},
});
const Quiet = Schema.Struct({n: Schema.Number});

/**
 * The child program. `turn` runs the agent on one ask; `hold` is a turn's upper bound, held before
 * it starts. `turnFaultMs`: when, into a turn, the `agent-turn` fault point is passed.
 */
export const agentProgram = <R>(o: {
	readonly turn: (ask: AgentAsk, at: {readonly name: string}) => Effect.Effect<Turn, never, R>;
	readonly hold: Cost;
	readonly say: (n: AgentNote) => void;
	readonly turnFaultMs?: number;
}) =>
	defineProgram({
		name: "agent",
		description:
			"One agent under a stage: answers each ask in its inbox once, holding and charging its spend on the ledger.",
		inputs: {inbox: input(envelope(Schema.Unknown), "Asks from its stage, and nothing else.")},
		outputs: {},
		main: ({serve}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const ledger = yield* Ledger;
				const faults = yield* Faults;
				const {name, fence} = self;
				const say = (step: AgentNote["step"], id: string, more: Partial<AgentNote> = {}) =>
					Effect.sync(() => o.say({ev: "agent", name, fence, id, step, ...more}));
				const answers = answersOf(name);
				// Nothing is kept but the answers: every ask is fed again, and an answered one is skipped.
				const handle = yield* self.run(quiet, {schema: Quiet, cursor: () => 0}, {ctx: undefined});
				yield* handle.ready;
				const answered = (id: string) =>
					steady("read the answers", ledger.readStream(answers)).pipe(
						Effect.map((rows) => rows.some((r) => r.id === id)),
					);
				const stage = stageOf(name);
				// The last word of the stage's holder at `fence` on this ask. Waiting on another ask
				// with no answer yet is a withdrawal too: a stage asks one thing at a time.
				const standing = (fence: number, id: string): Effect.Effect<Standing> =>
					Effect.gen(function* () {
						const rows = yield* ledger
							.readStream(askingOf(stage))
							.pipe(Effect.orElseSucceed(() => []));
						const said = new Map<string, boolean>();
						for (const r of rows) {
							const a = readAsking(r.data);
							if (Exit.isSuccess(a) && a.value.fence === fence) said.set(a.value.id, a.value.on);
						}
						const mine = said.get(id);
						if (mine !== undefined) return mine ? "wanted" : "withdrawn";
						const done = yield* ledger.readStream(answers).pipe(Effect.orElseSucceed(() => []));
						const waiting = [...said].some(
							([other, on]) => on && !done.some((r) => r.id === other),
						);
						return waiting ? "withdrawn" : "unsaid";
					});
				// Before a turn: wait for a holder of the stage seen alive (its lease renewed while
				// watched, or newly taken), so a dead holder's ask is not run on its word.
				const wanted = (id: string) =>
					Effect.gen(function* () {
						let first: {readonly fence: number; readonly expires_at: number} | null = null;
						for (;;) {
							const lease = yield* ledger.lease(stage).pipe(Effect.orElseSucceed(() => null));
							if (lease !== null) {
								first ??= lease;
								if (lease.fence !== first.fence || lease.expires_at > first.expires_at) {
									const now = yield* standing(lease.fence, id);
									if (now !== "unsaid") return now;
								}
							}
							yield* Effect.sleep(Duration.millis(100));
						}
					});
				// During a turn: it ends early once the stage's holder takes the ask back.
				const takenBack = (id: string) =>
					Effect.gen(function* () {
						for (;;) {
							yield* Effect.sleep(Duration.millis(250));
							const lease = yield* ledger.lease(stage).pipe(Effect.orElseSucceed(() => null));
							if (lease !== null && (yield* standing(lease.fence, id)) === "withdrawn") return;
						}
					});
				const one = (ask: AgentAsk) =>
					Effect.gen(function* () {
						if (yield* answered(ask.id)) return yield* say("skipped", ask.id);
						if ((yield* wanted(ask.id)) === "withdrawn") return yield* say("withdrawn", ask.id);
						const held = yield* self.hold(ask.id, o.hold);
						if (held.how !== "ok") {
							yield* say("limit", ask.id);
							return yield* Effect.never;
						}
						yield* say("hold", ask.id);
						const ran = yield* Effect.gen(function* () {
							yield* Effect.sleep(Duration.millis(o.turnFaultMs ?? 100)).pipe(
								Effect.andThen(faults.at("agent-turn")),
								Effect.forkScoped,
							);
							return yield* o.turn(ask, {name});
						}).pipe(
							Effect.scoped,
							Effect.map((turn) => ({turn})),
							Effect.raceFirst(takenBack(ask.id).pipe(Effect.as(null))),
						);
						// Cut short: what it spent stays counted at its hold.
						if (ran === null) return yield* say("withdrawn", ask.id);
						const {turn} = ran;
						yield* say("turn", ask.id, {agent: turn.agent, usd: turn.cost.usd ?? 0});
						yield* faults.at("agent-answered");
						// The money is spent whatever comes next: the charge goes first.
						const charged = yield* self.charge(ask.id, turn.cost);
						if (charged.how === "ok" && charged.over !== null) {
							yield* say("limit", ask.id);
							return yield* Effect.never;
						}
						// 151: sent again with no limit while the ledger does not answer; the ask's id makes
						// that safe.
						const wrote = yield* steady(
							"write an answer",
							ledger.append(
								answers,
								"any",
								{kind: "answer", writer: self.holder, id: ask.id, data: {answer: turn.answer}},
								fence,
							),
						).pipe(Effect.result);
						// A lost lease: the next holder answers it.
						if (wrote._tag === "Failure") return yield* Effect.never;
						yield* say("answered", ask.id, {agent: turn.agent});
					});
				return yield* serve({
					inbox: (env) => {
						const ask = ASK(env.body);
						return Exit.isSuccess(ask) ? one(ask.value) : Effect.void;
					},
				});
			}).pipe(Effect.scoped),
	});

/**
 * A codec that takes the child's answer as it is: the child is this stage's own program, and the
 * stage's handlers read each part they trust against its schema (a form, a plan) on the way in.
 */
export const asWritten = <A>(): Schema.Codec<A, unknown> =>
	Schema.Unknown as Schema.Codec<A, unknown>;

/** FNV-1a of a text, as 8 hex digits: an ask's id from what it asks, the same on every host. */
export const digest = (text: string): string => {
	let h = 0x811c9dc5;
	for (let k = 0; k < text.length; k++) {
		h ^= text.charCodeAt(k);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
};

/** How an ask ended, as the stage reads it. `limit`: the child's limit ended it, and no answer comes. */
export type Asked<A> = {readonly how: "answered"; readonly answer: A} | {readonly how: "limit"};

const AnswerRow = Schema.fromJsonString(Schema.Struct({answer: Schema.Unknown}));
const decodeRow = Schema.decodeUnknownExit(AnswerRow);

/**
 * The stage's side: ask its child under `id`, and wait for the answer row, or for the child's
 * limit record. An answer that does not read as `answer` is a defect: the child wrote it.
 */
export const askAgent = <A>(
	child: string,
	id: string,
	brief: unknown,
	answer: Schema.Codec<A, unknown>,
): Effect.Effect<Asked<A>, never, Self | Ledger> =>
	Effect.gen(function* () {
		const self = yield* Self;
		const ledger = yield* Ledger;
		// No row id: the same ask may be asked, taken back and asked again under one fence. A row
		// sent twice after a lost answer says the same word twice; only the last word counts.
		const say = (on: boolean) =>
			steady(
				"say an ask",
				ledger.append(
					askingOf(self.name),
					"any",
					{kind: "asking", writer: self.holder, data: {id, fence: self.fence, on}},
					self.fence,
				),
			).pipe(Effect.result);
		// Recorded before it is sent, so a child that reads the ask finds it wanted.
		const noted = yield* say(true);
		if (noted._tag === "Failure") {
			// A lost lease: the program is about to be stopped.
			if (noted.failure._tag === "Fenced") return yield* Effect.never;
			return yield* Effect.die(
				`${self.name} could not record its ask ${id}: ${noted.failure._tag}`,
			);
		}
		return yield* answerOf(child, id, answer, brief).pipe(
			// Cut while waiting (its Sub ended, or the stage stops): taken back, so the child does not
			// run it for nobody. A lost lease refuses the row, and the next holder speaks for itself.
			Effect.onInterrupt(() => say(false)),
		);
	});

/** Send the ask, then wait for its answer row or the child's limit record. */
const answerOf = <A>(
	child: string,
	id: string,
	answer: Schema.Codec<A, unknown>,
	brief: unknown,
): Effect.Effect<Asked<A>, never, Self | Ledger> =>
	Effect.gen(function* () {
		const self = yield* Self;
		const ledger = yield* Ledger;
		const decode = Schema.decodeUnknownExit(answer);
		const sent = yield* self
			.send(streams(child).inbox, id, {id, brief})
			.pipe(Effect.repeat({until: (d) => d.how !== "unknown", schedule: EVERY_100_MS}));
		// A lost lease: the program is about to be stopped.
		if (sent.how === "fenced") return yield* Effect.never;
		for (;;) {
			const rows = yield* ledger.readStream(answersOf(child)).pipe(Effect.orElseSucceed(() => []));
			const row = rows.find((r) => r.id === id);
			if (row !== undefined) {
				const data = decodeRow(row.data);
				const value = Exit.isSuccess(data) ? decode(data.value.answer) : null;
				if (value === null || Exit.isFailure(value))
					return yield* Effect.die(`${child} answered ${id} with a shape that does not read`);
				return {how: "answered", answer: value.value} as const;
			}
			const dead = yield* ledger
				.readStream(streams(child).dead)
				.pipe(Effect.orElseSucceed(() => []));
			if (dead.some((r) => r.kind === "limit")) return {how: "limit"} as const;
			yield* Effect.sleep(Duration.millis(100));
		}
	});
