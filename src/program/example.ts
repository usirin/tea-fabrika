import {Cmd, type Sub} from "@demlik/tea";
import {Schema} from "effect";
import {defineCmd} from "../schema.ts";
import {defineProgram, output} from "./program.ts";
import {input} from "./shape.ts";

// Three programs that talk only through inputs and outputs:
//
//   operator --handoff--> ship          one-way, wired by the host
//   ship --deliver Cmd--> operator      must arrive: ship's own Cmd, its handler tells
//   ship --announced--> log, log, ...   one-way, zero or many listeners
//
// `ship` is the ship stage (src/stages/ship/machine.ts) cut down to four
// states: idle, enqueueing, queued, over. One Act (enqueue), one Listen (the
// merge queue). It takes pull requests one after another.

/** A pull request at one head. The patterns make a shape that types alone cannot tell apart. */
export const PR = Schema.Struct({
	pr: Schema.String.check(Schema.isPattern(/^#\d+$/)),
	head: Schema.String.check(Schema.isPattern(/^[0-9a-f]{7}$/)),
});
export type PR = typeof PR.Type;

/** What ship says about one pull request, in the five-verb shape (docs/direction/outcome-names.md), cut down. */
export const Outcome = Schema.Struct({
	pr: Schema.String,
	kind: Schema.Literals(["done", "send", "stuck"]),
	why: Schema.Literals(["landed", "conflicts", "ejected", "enqueue_failed"]),
});
export type Outcome = typeof Outcome.Type;

const Words = Schema.Literals(["queued", "stopped", "bad_shape", "no_cell"]);

// ---- ship -------------------------------------------------------------------

/** Put this head in the merge queue. */
export const enqueue = defineCmd("ship_enqueue", {
	input: PR,
	ok: Schema.Literals(["queued", "conflicts"]),
	err: ["unknown"],
});
/** Hand one outcome to whoever handed the pull request. Must arrive: the host's handler answers what `tell` said. */
export const deliver = defineCmd("ship_deliver", {
	input: Schema.Struct({outcome: Outcome}),
	ok: Schema.Literal("queued"),
	err: ["stopped", "bad_shape", "no_cell"],
});
/** Every outcome, one-way. */
export const announced = output(
	"ship_announced",
	Outcome,
	"Every outcome ship reaches, for anyone who listens. Nothing comes back.",
);

/** What became of each delivery: the word `tell` answered for it. */
type Delivered = {readonly pr: string; readonly word: typeof Words.Type};
type Ship =
	| {readonly type: "idle"; readonly delivered: readonly Delivered[]}
	| {readonly type: "enqueueing"; readonly at: PR; readonly delivered: readonly Delivered[]}
	| {readonly type: "queued"; readonly at: PR; readonly delivered: readonly Delivered[]}
	| {readonly type: "over"; readonly outcome: Outcome; readonly delivered: readonly Delivered[]};
/** The merge queue's Listen says how the pull request left it. */
type ShipMsg = {
	readonly type: "ship_queue";
	readonly pr: string;
	readonly head: string;
	readonly reading: "landed" | "ejected";
};
export type QueueSub = Sub<"ship_queue", PR>;

const finish = (s: {readonly delivered: readonly Delivered[]}, outcome: Outcome) =>
	[
		{type: "over", outcome, delivered: s.delivered},
		[deliver({outcome}), announced(outcome)],
	] as const;
const noted = <S extends Ship>(s: S, d: Delivered): readonly [S, readonly never[]] => [
	{...s, delivered: [...s.delivered, d]},
	Cmd.none,
];
/** A delivery can come back in any state: ship has moved on by then. */
const deliveries = {
	ship_deliver_ok: <S extends Ship>(s: S, m: {readonly cmd: {readonly outcome: Outcome}}) =>
		noted(s, {pr: m.cmd.outcome.pr, word: "queued"}),
	ship_deliver_err: <S extends Ship>(
		s: S,
		m: {readonly cmd: {readonly outcome: Outcome}; readonly error: {readonly _tag: string}},
	) => noted(s, {pr: m.cmd.outcome.pr, word: wordOf(m.error._tag)}),
};
const wordOf = (tag: string): Delivered["word"] =>
	tag === "stopped" || tag === "bad_shape" || tag === "no_cell" ? tag : "stopped";

export const ship = defineProgram({
	name: "ship",
	description: "Puts one pull request at a time in the merge queue and says how it went.",
	inputs: {hand: input(PR, "A pull request to put in the merge queue. Taken when ship is free.")},
	outputs: [announced],
	types: {model: {} as Ship, msg: {} as ShipMsg, sub: {} as QueueSub},
	cmds: [enqueue, deliver],
	init: (loaded) => [loaded ?? {type: "idle", delivered: []}, []],
	update: {
		idle: {
			hand: (s, m) => [
				{type: "enqueueing", at: m.payload, delivered: s.delivered},
				[enqueue(m.payload)],
			],
			...deliveries,
		},
		enqueueing: {
			ship_enqueue_ok: (s, m) =>
				m.value === "queued"
					? [{type: "queued", at: s.at, delivered: s.delivered}, []]
					: finish(s, {pr: s.at.pr, kind: "send", why: "conflicts"}),
			ship_enqueue_err: (s) => finish(s, {pr: s.at.pr, kind: "stuck", why: "enqueue_failed"}),
			...deliveries,
		},
		queued: {
			ship_queue: (s, m) =>
				m.pr !== s.at.pr
					? [s, []]
					: finish(
							s,
							m.reading === "landed"
								? {pr: s.at.pr, kind: "done", why: "landed"}
								: {pr: s.at.pr, kind: "send", why: "ejected"},
						),
			...deliveries,
		},
		over: {
			hand: (s, m) => [
				{type: "enqueueing", at: m.payload, delivered: s.delivered},
				[enqueue(m.payload)],
			],
			...deliveries,
		},
	},
	subs: [{type: "ship_queue", deps: (s) => (s.type === "queued" ? s.at : null)}],
});

// ---- operator ---------------------------------------------------------------

/** The next pull request to ship. One-way: the operator hears back through its `outcome` input. */
export const handoff = output("operator_handoff", PR, "The next pull request to ship.");

type Operator =
	| {readonly type: "idle"}
	| {readonly type: "working"; readonly todo: readonly PR[]; readonly outcomes: readonly Outcome[]}
	| {readonly type: "done"; readonly outcomes: readonly Outcome[]};

const next = (todo: readonly PR[], outcomes: readonly Outcome[]) => {
	const [first, ...rest] = todo;
	return first === undefined
		? ([{type: "done", outcomes}, []] as const)
		: ([{type: "working", todo: rest, outcomes}, [handoff(first)]] as const);
};

export const operator = defineProgram({
	name: "operator",
	description: "Hands pull requests to ship one at a time and keeps every outcome.",
	inputs: {
		work: input(Schema.Array(PR), "The pull requests to ship, in order. Taken once."),
		outcome: input(Outcome, "How one pull request it handed went."),
	},
	outputs: [handoff],
	types: {model: {} as Operator, msg: {} as never},
	cmds: [],
	init: (loaded) => [loaded ?? {type: "idle"}, []],
	update: {
		idle: {work: (_s, m) => next(m.payload, [])},
		working: {outcome: (s, m) => next(s.todo, [...s.outcomes, m.payload])},
		done: {},
	},
});

// ---- log --------------------------------------------------------------------

type Log = {readonly type: "listening"; readonly lines: readonly Outcome[]};

export const log = defineProgram({
	name: "log",
	description: "Writes down every outcome it hears.",
	inputs: {heard: input(Outcome, "An outcome to write down.")},
	outputs: [],
	types: {model: {} as Log, msg: {} as never},
	cmds: [],
	init: (loaded) => [loaded ?? {type: "listening", lines: []}, []],
	update: {listening: {heard: (s, m) => [{type: "listening", lines: [...s.lines, m.payload]}, []]}},
});
