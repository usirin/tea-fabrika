// An agent as a child program on tea-host (experiment 104). A stage does not run its agent in its
// own fiber: it starts a child under its name (`<stage>:agent`, OTP's `supervisor:start_child`)
// with `limits` on the child spec, and asks it by message. The ledger counts the child's spend and
// ends it `limit:usd` when it crosses its cap (experiment 102), and a limit's end is final.
//
//   the stage   sends one ask into the child's inbox under an id it can make again (its own name
//               and the ask's place in it, never a model's tool id), then reads `<child>/answers`
//               for that id. A takeover of the stage asks again under the same id: an ask that
//               was answered is answered from the ledger, and the agent does not run again.
//   the child   for each ask in its inbox with no answer row: hold the turn's upper bound, run the
//               agent, charge what it cost, then write the answer row, fenced. A child taken over
//               mid-turn runs the turn again: agent work is at-least-once, so a takeover wastes at
//               most the one turn that was in flight (experiment 101).
//
// The child traps nothing: when a limit ends it, the stage (which traps exits) hears an EXIT, and
// reads the `limit` record in `<child>/dead`.
import {defineMachine} from "@demlik/tea";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {envelope, Self} from "../../host/host.ts";
import {Ledger, streams} from "../../host/ledger.ts";
import type {Cost} from "../../host/rules.ts";
import {defineProgram} from "../../program/program.ts";
import {input} from "../../program/shape.ts";
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

/** The child's name under a stage. A `:`, not a `/`: a name may not sit inside another. */
export const agentOf = (stage: string) => `${stage}:agent`;
/** The stream a child keeps its answers in, one row per ask id. */
export const answersOf = (child: string) => `${child}/answers`;

/** What the child says on each turn, for the harness: the provider's bill. */
export type AgentNote = {
	readonly ev: "agent";
	readonly name: string;
	readonly fence: number;
	readonly id: string;
	readonly step: "hold" | "turn" | "answered" | "limit" | "skipped";
	readonly agent?: "real" | "stub";
	readonly usd?: number;
};

const ASK = Schema.decodeUnknownExit(AgentAsk);
const EVERY_100_MS = Schedule.spaced(Duration.millis(100));

const quiet = defineMachine({
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
		main: ({inputs}) =>
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
					ledger.readStream(answers).pipe(
						Effect.retry({times: 40, schedule: EVERY_100_MS}),
						Effect.orDie,
						Effect.map((rows) => rows.some((r) => r.id === id)),
					);
				const one = (ask: AgentAsk) =>
					Effect.gen(function* () {
						if (yield* answered(ask.id)) return yield* say("skipped", ask.id);
						const held = yield* self.hold(ask.id, o.hold);
						if (held.how !== "ok") {
							yield* say("limit", ask.id);
							return yield* Effect.never;
						}
						yield* say("hold", ask.id);
						const turn = yield* Effect.gen(function* () {
							yield* Effect.sleep(Duration.millis(o.turnFaultMs ?? 100)).pipe(
								Effect.andThen(faults.at("agent-turn")),
								Effect.forkScoped,
							);
							return yield* o.turn(ask, {name});
						}).pipe(Effect.scoped);
						yield* say("turn", ask.id, {agent: turn.agent, usd: turn.cost.usd ?? 0});
						yield* faults.at("agent-answered");
						// The money is spent whatever comes next: the charge goes first.
						const charged = yield* self.charge(ask.id, turn.cost);
						if (charged.how === "ok" && charged.over !== null) {
							yield* say("limit", ask.id);
							return yield* Effect.never;
						}
						const wrote = yield* ledger
							.append(
								answers,
								"any",
								{kind: "answer", writer: self.holder, id: ask.id, data: {answer: turn.answer}},
								fence,
							)
							.pipe(
								Effect.retry({
									while: (e) => e._tag === "LedgerUnreachable",
									times: 40,
									schedule: EVERY_100_MS,
								}),
								Effect.result,
							);
						// A lost lease: the next holder answers it.
						if (wrote._tag === "Failure") return yield* Effect.never;
						yield* say("answered", ask.id, {agent: turn.agent});
					});
				return yield* inputs.inbox.pipe(
					Stream.runForEach((env) => {
						const ask = ASK(env.body);
						return Exit.isSuccess(ask) ? one(ask.value) : Effect.void;
					}),
				);
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
