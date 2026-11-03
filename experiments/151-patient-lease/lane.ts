// Experiment 151's scripted lane: experiment 149's (149-wifi-blips/lane.ts), on the real code only.
// A program under a registered name, served by `serve`, with no agent and no model:
//
//   every PERIOD   one step: a `reviewed` fact into the plan's inbox (a stream with many writers),
//                  fenced on the lane's lease, under the id `note:<k>`. Every 4th step, one comment
//                  on the fake code host, through the pipeline's idempotency gate (`<name>/writes`)
//   its inbox      the owner's answers, each taken once: the state keeps the inbox rev it read to
//   its journal    tea saves the state on `<name>/state` before each step's Cmd runs
//
// 149 ran two copies of each write: today's, and patient ones in 149-wifi-blips/patient/. Here
// there is one: the pipeline's own `sendFact` and gate, which wait out a ledger that does not
// answer since 151.
import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {defineProgram, envelope, input, Self} from "@kampus/fabrika-old";
import {sendFact} from "@kampus/pipeline/asks/ledger";
import {gate, noFaults, useKey} from "@kampus/pipeline/hosted/idempotency";
import {planOf, taskId, ticketId} from "@kampus/pipeline/ids";
import {Duration, Effect, Option, Schema, Stream} from "effect";

// ---------------------------------------------------------------- the machine

export const LaneState = Schema.Struct({
	/** The last step done. */
	k: Schema.Int,
	/** The inbox rev of the last answer taken. */
	cursor: Schema.Int,
	/** The answers taken, by message id, in the order taken. */
	answers: Schema.Array(Schema.String),
	/** A step is out. */
	busy: Schema.Boolean,
});
export type LaneState = typeof LaneState.Type;
const ZERO: LaneState = {k: 0, cursor: 0, answers: [], busy: false};

export const step = Cmd.define("step", {
	input: Schema.Struct({k: Schema.Int}),
	ok: Schema.Struct({k: Schema.Int}),
	err: ["unreachable"],
});

type LaneMsg =
	| {readonly type: "tick"}
	| {readonly type: "answer"; readonly id: string; readonly rev: number};

export const laneMachine = defineMachine({
	types: {model: {} as LaneState, msg: {} as LaneMsg, ctx: undefined},
	cmds: [step],
	// A run started again (a restart, a takeover) has no step out: the one that was is sent again.
	init: (loaded) => [loaded === null || loaded === undefined ? ZERO : {...loaded, busy: false}, []],
	update: {
		tick: (s) => (s.busy ? [s, []] : [{...s, busy: true}, [step({k: s.k + 1})]]),
		answer: (s, m) =>
			m.rev <= s.cursor ? [s, []] : [{...s, cursor: m.rev, answers: [...s.answers, m.id]}, []],
		step_ok: (s, m) => [{...s, k: Math.max(s.k, m.value.k), busy: false}, []],
		step_err: (s) => [{...s, busy: false}, []],
	},
});

// ---------------------------------------------------------------- the fake code host

/** The fake code host's two calls, through the same link as the ledger. */
const world = (url: string) => {
	const call = (path: string, body: unknown) =>
		Effect.tryPromise({
			try: async (signal) => {
				const res = await fetch(`${url}${path}`, {
					method: "POST",
					body: JSON.stringify(body),
					signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
				});
				if (!res.ok) throw new Error(`world ${res.status}`);
				return (await res.json()) as {readonly id: number | null};
			},
			catch: () => ({_tag: "unknown" as const}),
		});
	return {
		post: (key: string, run: string) => call("/comment", {key, run}),
		find: (key: string) => call("/find", {key}),
	};
};

const Commented = Schema.Struct({id: Schema.Number});

// ---------------------------------------------------------------- the program

/** What the lane tells the harness: each step as it lands, and each outside write's steps. */
export type LaneNote =
	| {
			readonly ev: "step";
			readonly k: number;
			readonly fence: number;
			readonly from: number;
			readonly at: number;
	  }
	| {readonly ev: "fenced"; readonly k: number; readonly fence: number}
	| {readonly ev: "gate"; readonly step: string; readonly key: string; readonly fence: number};

export interface LaneOptions {
	readonly run: string;
	/** The ticket the lane's plan is made from: `o/r#<n>`. */
	readonly ticket: string;
	readonly world: string;
	readonly periodMs: number;
	readonly say: (n: LaneNote) => void;
}

const Asked = Schema.Struct({ask: Schema.String});

export const laneProgram = (o: LaneOptions) =>
	defineProgram({
		name: "lane",
		description:
			"A scripted lane: a fenced fact each step, an outside write every 4th, the owner's answers taken once.",
		inputs: {inbox: input(envelope(Asked), "One answer from the owner.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const {fence, holder, name} = self;
				const plan = planOf(ticketId(o.ticket));
				const sayGate = (n: {readonly step: string; readonly key: string}) =>
					o.say({ev: "gate", step: n.step, key: n.key, fence});
				const {once} = yield* gate({name, fence, holder, say: sayGate}).pipe(
					Effect.provide(noFaults),
				);
				const w = world(o.world);

				const note = (k: number) =>
					sendFact(
						{type: "reviewed", plan, task: taskId(`t${k}`), open: k},
						{id: `note:${k}`, by: holder, hold: {name, fence}},
					);
				const comment = (k: number) =>
					once({
						op: "comment",
						subject: `k${k}`,
						answer: Commented,
						look: (key) =>
							w
								.find(key)
								.pipe(Effect.map((r) => (r.id === null ? Option.none() : Option.some({id: r.id})))),
						send: (key) =>
							useKey(key).pipe(
								Effect.flatMap((text) => w.post(text, o.run)),
								Effect.flatMap((r) =>
									r.id === null
										? Effect.fail({_tag: "unknown" as const})
										: Effect.succeed({id: r.id}),
								),
								Effect.mapError(() => ({_tag: "unknown" as const})),
							),
					});

				const stepCell = (cmd: ReturnType<typeof step>) =>
					Effect.gen(function* () {
						const from = Date.now();
						const sent = yield* note(cmd.k).pipe(Effect.result);
						if (sent._tag === "Failure") {
							// Fenced: someone newer claimed. The host stops this run; nothing more is written.
							o.say({ev: "fenced", k: cmd.k, fence});
							return yield* Effect.never;
						}
						if (cmd.k % 4 === 0) yield* comment(cmd.k);
						o.say({ev: "step", k: cmd.k, fence, from, at: Date.now()});
						return {k: cmd.k};
					}).pipe(Effect.mapError(() => ({_tag: "unreachable" as const})));

				const handle = yield* self.run(
					laneMachine,
					{schema: LaneState, cursor: (s) => s.cursor},
					{ctx: undefined, interpret: {step: stepCell}},
				);
				const machine = yield* handle.ready;
				const ticks = Effect.sleep(Duration.millis(o.periodMs)).pipe(
					Effect.andThen(machine.dispatch({type: "tick"})),
					Effect.forever,
				);
				const answers = inputs.inbox.pipe(
					Stream.runForEach((e) => machine.dispatch({type: "answer", id: e.id, rev: e.rev})),
				);
				yield* Effect.all([ticks, answers], {concurrency: "unbounded", discard: true});
			}).pipe(Effect.scoped),
	});
