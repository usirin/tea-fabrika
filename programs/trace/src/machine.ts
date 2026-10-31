import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {JobTrace, TraceId} from "@kampus/fabrika";
import {Schema} from "effect";
import {findOf, groupsOf, JOB, treeOf} from "./tree.ts";

// The trace's machine: one job's record as last read, which of its rows are open, and which one
// is chosen. Elm's debugger and Redux DevTools hold the same: the history, and where you look in
// it. Pure: the record is followed through its one Sub, whose runner is in ./index.ts.
//
//   look     follow the job's record (`follow`): its own line's job at the start, or the flag's,
//            then each id told on `id`. A newer id replaces the record shown, its open rows and
//            its detail; the same id again changes nothing, unless it could not be read
//   got      the record, read again: the first shows the job's row open, a later one keeps the
//            rows open and the detail chosen. One for an id it no longer follows is dropped
//   lost     the record could not be read: before the first read it says why, after it the last
//            record read stays shown
//   toggle   open a row that groups others, or close it: a job, a run, a machine run, a round,
//            an agent's turns. A row that groups nothing, or is not in the record, changes nothing
//   choose   show one row's detail: a span's tags and events, or a step's Msg, the state before
//            and after, and its Cmds. `null` closes the detail
//   tick     the time, while the record shown says its job has not ended. Anything else lets it go
//
//   replay(trace, {ctx: undefined, msgs: [{type: "look", id: TALLY_ID}]})
//   // state.read {at: "reading", id}; subs [follow {id}]
//   // then got: state.read {at: "read", trace, now: null}, open ["job"]: the job's row shows its runs
//   // then got again, with one more span: the same rows open, the new span in its place
//   // a job not ended: subs [follow {id}, tick {id}]; tick {now: 5000}: state.read.now 5000
//   // then got, its job ended: subs [follow {id}], state.read.now null
//
// Elm's answer for a value that changes on its own is a Sub, not a Cmd asked again: `Time.every`,
// a websocket. The record changes while its job runs, so the machine follows it for as long as
// it shows one; the runner reads it again each time it changes. The time changes too, so while
// the job runs the machine holds it, and the view stays a pure function of the state.
//
// Open rows are state, as Elm keeps them in the Model: a reload, a second window or another
// client of the same run shows the same rows open.

/**
 * A job's record as the machine holds it: `JobTrace` with one type on both sides, since it never
 * leaves the process as the record's wire writes it. The record's reader has decoded it already.
 */
export const Kept = Schema.toType(JobTrace);
type Kept = typeof Kept.Type;

/** Follow one job's record, by its trace id: each read of it comes back as `got`. */
export type FollowSub = Sub<"follow", {readonly id: string}>;

/** The time, as Elm's `Time.every`, while the job of the record shown runs: each comes as `tick`. */
export type TickSub = Sub<"tick", {readonly id: string}>;

/** A row of the tree, by its key (./tree.ts): what `toggle` and `choose` name. */
export const RowKey = Schema.String.check(Schema.isMaxLength(512));

/** Where the record stands: not asked yet, asked, read, or it could not be read. */
export const Read = Schema.Union([
	Schema.Struct({at: Schema.Literal("waiting")}),
	Schema.Struct({at: Schema.Literal("reading"), id: TraceId}),
	Schema.Struct({
		at: Schema.Literal("read"),
		trace: Kept,
		/** Unix ms, from the last tick. `null`: its job ended or names no job, or no tick came yet. */
		now: Schema.NullOr(Schema.Number),
	}),
	Schema.Struct({at: Schema.Literal("unread"), id: TraceId, why: Schema.String}),
]);
export type Read = typeof Read.Type;

export const Model = Schema.Struct({
	read: Read,
	/** The rows open, each one that groups others in the record read. */
	open: Schema.Array(RowKey),
	/** The row whose detail shows. `null`: none. */
	chosen: Schema.NullOr(RowKey),
});
export type Model = typeof Model.Type;

export type TraceMsg =
	| {readonly type: "look"; readonly id: string}
	| {readonly type: "got"; readonly trace: Kept}
	| {readonly type: "lost"; readonly id: string; readonly why: string}
	| {readonly type: "toggle"; readonly row: string}
	| {readonly type: "choose"; readonly row: string | null}
	| {readonly type: "tick"; readonly now: number};

type Step = readonly [Model, readonly never[]];

const start: Model = {read: {at: "waiting"}, open: [], chosen: null};

/** The trace id the machine reads or shows. `null`: none told yet. */
export const idOf = (r: Read): string | null => {
	switch (r.at) {
		case "waiting":
			return null;
		case "read":
			return r.trace.trace;
		default:
			return r.id;
	}
};

/** The record it follows: the one it reads or shows. None while waiting, or once it is lost. */
export const followed = (s: Model): {readonly id: string} | null =>
	s.read.at === "reading"
		? {id: s.read.id}
		: s.read.at === "read"
			? {id: s.read.trace.trace}
			: null;

/** Its job has not ended, as the record says it. A record with no job says nothing of the kind. */
export const isRunning = (trace: Kept): boolean => trace.job !== null && trace.job.ended === null;

/** The clock's Sub: on while the record shown says its job has not ended, off once it says so. */
export const ticking = (s: Model): {readonly id: string} | null =>
	s.read.at === "read" && isRunning(s.read.trace) ? {id: s.read.trace.trace} : null;

/** The rows a record first shows open: the job's, when anything is under it. */
export const firstOpen = (trace: Kept): readonly string[] =>
	groupsOf(treeOf(trace)).has(JOB) ? [JOB] : [];

/**
 * A newer read of the record shown: the rows open stay open, and the detail stays, where they
 * still are. A record that had nothing under its job yet (a job just begun, its spans not in)
 * showed no row to open or close, so the first read with something in it opens the job's row,
 * as a first read does.
 */
const again = (s: Model, trace: Kept): Model => {
	const tree = treeOf(trace);
	const groups = groupsOf(tree);
	const shown = s.read.at === "read" && groupsOf(treeOf(s.read.trace)).has(JOB);
	return {
		read: {at: "read", trace, now: s.read.at === "read" && isRunning(trace) ? s.read.now : null},
		open: shown ? s.open.filter((k) => groups.has(k)) : firstOpen(trace),
		chosen: s.chosen !== null && findOf(tree, s.chosen) !== undefined ? s.chosen : null,
	};
};

export const trace = defineMachine({
	types: {model: {} as Model, msg: {} as TraceMsg, sub: {} as FollowSub | TickSub, ctx: undefined},
	cmds: [],
	init: (): Step => [start, []],
	update: {
		// A newer id replaces the record shown, with its rows and its detail. The same id again
		// changes nothing, unless its record could not be read: then it is followed again.
		look: (s, m): Step =>
			idOf(s.read) === m.id && s.read.at !== "unread"
				? [s, []]
				: [{read: {at: "reading", id: m.id}, open: [], chosen: null}, []],
		got: (s, m): Step => {
			if (idOf(s.read) !== m.trace.trace) return [s, []];
			if (s.read.at === "reading")
				return [
					{read: {at: "read", trace: m.trace, now: null}, open: firstOpen(m.trace), chosen: null},
					[],
				];
			return s.read.at === "read" ? [again(s, m.trace), []] : [s, []];
		},
		lost: (s, m): Step =>
			s.read.at === "reading" && s.read.id === m.id
				? [{...s, read: {at: "unread", id: m.id, why: m.why}}, []]
				: [s, []],
		toggle: (s, m): Step => {
			if (s.read.at !== "read" || !groupsOf(treeOf(s.read.trace)).has(m.row)) return [s, []];
			const open = s.open.includes(m.row) ? s.open.filter((k) => k !== m.row) : [...s.open, m.row];
			return [{...s, open}, []];
		},
		choose: (s, m): Step => {
			if (m.row === null) return [{...s, chosen: null}, []];
			if (s.read.at !== "read" || findOf(treeOf(s.read.trace), m.row) === undefined) return [s, []];
			return [{...s, chosen: m.row}, []];
		},
		// A tick that was on its way when the job's end was read, or a newer id, is let go.
		tick: (s, m): Step =>
			s.read.at === "read" && isRunning(s.read.trace)
				? [{...s, read: {...s.read, now: m.now}}, []]
				: [s, []],
	},
	subs: [
		{type: "follow", deps: followed} satisfies DepKeyedSub<Model, FollowSub>,
		{type: "tick", deps: ticking} satisfies DepKeyedSub<Model, TickSub>,
	],
});

/** Its status line, for a host's list of runs. */
export const statusOf = (s: Model): string => {
	switch (s.read.at) {
		case "waiting":
			return "waiting for a run to be picked";
		case "reading":
			return "reading the record";
		case "unread":
			return `cannot read the record: ${s.read.why}`;
		case "read": {
			const t = s.read.trace;
			return `${t.spans.length} spans, ${t.steps.length} steps, ${s.open.length} open`;
		}
	}
};
