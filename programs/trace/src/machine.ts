import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {JobTrace, TraceId} from "@kampus/fabrika-old";
import {Entry, TicketNumber} from "@kampus/pipeline/tickets/ticket";
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
//            rows open and the detail chosen, and an end already read: a stale read that says the
//            job runs keeps that end, and the rest of it applies. One for an id it no longer
//            follows is dropped
//   lost     the record could not be read: before the first read it says why, after it the last
//            record read stays shown
//   toggle   open a row that groups others, or close it: a job, a run, a machine run, a round,
//            an agent's turns. A row that groups nothing, or is not in the record, changes nothing
//   choose   show one row's detail: a span's tags and events, or a step's Msg, the state before
//            and after, and its Cmds. `null` closes the detail
//   tick     the time, while the record shown says its job has not ended: an earlier tick keeps
//            the later time, as a clock can step back. Anything else lets it go
//
//   replay(trace, {ctx: undefined, msgs: [{type: "look", id: TALLY_ID}]})
//   // state.shows {kind: "job", read: {at: "reading", id}}; subs [follow {id}]
//   // then got: state.shows.read {at: "read", trace, now: null}, open ["job"]: the job's row shows its runs
//   // then got again, with one more span: the same rows open, the new span in its place
//   // a job not ended: subs [follow {id}, tick {id}]; tick {now: 5000}: state.shows.read.now 5000
//   // then tick {now: 4000}: state.shows.read.now still 5000
//   // then got, its job ended: subs [follow {id}], state.shows.read.now null
//   // then got, stale, its job not ended: its spans and steps show, and the job's end stays
//
// Elm's answer for a value that changes on its own is a Sub, not a Cmd asked again: `Time.every`,
// a websocket. The record changes while its job runs, so the machine follows it for as long as
// it shows one; the runner reads it again each time it changes. The time changes too, so while
// the job runs the machine holds it, and the view stays a pure function of the state.
//
// Open rows are state, as Elm keeps them in the Model: a reload, a second window or another
// client of the same run shows the same rows open.
//
// Ticket 141: the ticket view's types are here (`Shows`, `Facts`, the Msgs `ticket`, `facts`,
// `unread`, `seek` and `step`, the `facts` Sub). Its cells are not built yet: they throw, and the
// job view's cells read `shows.read` where they read `read`, and do what they did.

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
		/** Unix ms, the latest tick told. `null`: its job ended or names no job, or no tick came yet. */
		now: Schema.NullOr(Schema.Number),
	}),
	Schema.Struct({at: Schema.Literal("unread"), id: TraceId, why: Schema.String}),
]);
export type Read = typeof Read.Type;

/** A ticket's facts, as the `facts` Sub last read them. */
export const Facts = Schema.Union([
	Schema.Struct({at: Schema.Literal("reading"), number: TicketNumber}),
	Schema.Struct({at: Schema.Literal("read"), number: TicketNumber, timeline: Schema.Array(Entry)}),
	Schema.Struct({at: Schema.Literal("unread"), number: TicketNumber, why: Schema.String}),
]);
export type Facts = typeof Facts.Type;

/**
 * What the tile shows: one job's record, or one ticket's lanes. One or the other, so a ticket view
 * never holds a stray `read`, and a job view never holds a playhead.
 */
export const Shows = Schema.Union([
	Schema.Struct({kind: Schema.Literal("job"), read: Read}),
	Schema.Struct({
		kind: Schema.Literal("ticket"),
		facts: Facts,
		/** Each lane's record, by its trace id, as the `follow` Sub last read it. */
		records: Schema.Array(Schema.Struct({id: TraceId, read: Read})),
		/** The playhead. `null`: live, at now. A time: the ticket replayed up to it. */
		at: Schema.NullOr(Schema.Number),
	}),
]);
export type Shows = typeof Shows.Type;

export const Model = Schema.Struct({
	shows: Shows,
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
	| {readonly type: "tick"; readonly now: number}
	/** Show this ticket; the playhead goes back to live. */
	| {readonly type: "ticket"; readonly number: number}
	/** Its facts, read again. */
	| {readonly type: "facts"; readonly number: number; readonly timeline: readonly Entry[]}
	/** They could not be read. */
	| {readonly type: "unread"; readonly number: number; readonly why: string}
	/** A drag on the replay: a time, or back to now. */
	| {readonly type: "seek"; readonly at: number | null}
	/** ← and →: the fact before or after. */
	| {readonly type: "step"; readonly by: -1 | 1};

/** Read a ticket's facts again, while the tile shows that ticket: each read comes as `facts`. */
export type FactsSub = Sub<"facts", {readonly number: number}>;

type Step = readonly [Model, readonly never[]];

const start: Model = {shows: {kind: "job", read: {at: "waiting"}}, open: [], chosen: null};

/** The ticket view is not built yet (ticket 141): its cells, for the tests to run red. */
const notBuilt = (): never => {
	throw new Error("not built: ticket 141");
};

/** A job view's record. A ticket view's is not built yet. */
const readOf = (s: Model): Read => (s.shows.kind === "job" ? s.shows.read : notBuilt());

/** A job view with this record. */
const showing = (s: Model, read: Read): Model => ({...s, shows: {kind: "job", read}});

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

/**
 * The record it follows: the one it reads or shows. None while waiting, or once it is lost. A ticket
 * view's lanes are not built yet.
 */
export const followed = (s: Model): {readonly id: string} | null => {
	const read = readOf(s);
	return read.at === "reading" ? {id: read.id} : read.at === "read" ? {id: read.trace.trace} : null;
};

/** Its job has not ended, as the record says it. A record with no job says nothing of the kind. */
export const isRunning = (trace: Kept): boolean => trace.job !== null && trace.job.ended === null;

/** The clock's Sub: on while the record shown says its job has not ended, off once it says so. */
export const ticking = (s: Model): {readonly id: string} | null => {
	const read = readOf(s);
	return read.at === "read" && isRunning(read.trace) ? {id: read.trace.trace} : null;
};

/** The rows a record first shows open: the job's, when anything is under it. */
export const firstOpen = (trace: Kept): readonly string[] =>
	groupsOf(treeOf(trace)).has(JOB) ? [JOB] : [];

/**
 * A newer read of the record shown, with the end the record shown already says. The host writes an
 * end once and reads come in order, so only a stale read can say otherwise; the rest of it applies.
 */
const keepingEnd = (shown: Kept, read: Kept): Kept => {
	const ended = shown.job?.ended ?? null;
	const job = read.job ?? shown.job;
	return ended === null || job === null ? read : {...read, job: {...job, ended}};
};

/**
 * A newer read of the record shown: the rows open stay open, and the detail stays, where they
 * still are. A record that had nothing under its job yet (a job just begun, its spans not in)
 * showed no row to open or close, so the first read with something in it opens the job's row,
 * as a first read does.
 */
const again = (s: Model, trace: Kept): Model => {
	const tree = treeOf(trace);
	const groups = groupsOf(tree);
	const read = readOf(s);
	const shown = read.at === "read" && groupsOf(treeOf(read.trace)).has(JOB);
	return {
		shows: {
			kind: "job",
			read: {at: "read", trace, now: read.at === "read" && isRunning(trace) ? read.now : null},
		},
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
		look: (s, m): Step => {
			const read = readOf(s);
			return idOf(read) === m.id && read.at !== "unread"
				? [s, []]
				: [{shows: {kind: "job", read: {at: "reading", id: m.id}}, open: [], chosen: null}, []];
		},
		got: (s, m): Step => {
			const read = readOf(s);
			if (idOf(read) !== m.trace.trace) return [s, []];
			if (read.at === "reading")
				return [
					{
						shows: {kind: "job", read: {at: "read", trace: m.trace, now: null}},
						open: firstOpen(m.trace),
						chosen: null,
					},
					[],
				];
			return read.at === "read" ? [again(s, keepingEnd(read.trace, m.trace)), []] : [s, []];
		},
		lost: (s, m): Step => {
			const read = readOf(s);
			return read.at === "reading" && read.id === m.id
				? [showing(s, {at: "unread", id: m.id, why: m.why}), []]
				: [s, []];
		},
		toggle: (s, m): Step => {
			const read = readOf(s);
			if (read.at !== "read" || !groupsOf(treeOf(read.trace)).has(m.row)) return [s, []];
			const open = s.open.includes(m.row) ? s.open.filter((k) => k !== m.row) : [...s.open, m.row];
			return [{...s, open}, []];
		},
		choose: (s, m): Step => {
			if (m.row === null) return [{...s, chosen: null}, []];
			const read = readOf(s);
			if (read.at !== "read" || findOf(treeOf(read.trace), m.row) === undefined) return [s, []];
			return [{...s, chosen: m.row}, []];
		},
		// A tick that was on its way when the job's end was read, or a newer id, is let go.
		tick: (s, m): Step => {
			const read = readOf(s);
			return read.at === "read" && isRunning(read.trace)
				? [showing(s, {...read, now: Math.max(read.now ?? m.now, m.now)}), []]
				: [s, []];
		},
		ticket: (): Step => notBuilt(),
		facts: (): Step => notBuilt(),
		unread: (): Step => notBuilt(),
		seek: (): Step => notBuilt(),
		step: (): Step => notBuilt(),
	},
	subs: [
		{type: "follow", deps: followed} satisfies DepKeyedSub<Model, FollowSub>,
		{type: "tick", deps: ticking} satisfies DepKeyedSub<Model, TickSub>,
	],
});

/** Its status line, for a host's list of runs. */
export const statusOf = (s: Model): string => {
	if (s.shows.kind === "ticket") return notBuilt();
	const read = s.shows.read;
	switch (read.at) {
		case "waiting":
			return "waiting for a run to be picked";
		case "reading":
			return "reading the record";
		case "unread":
			return `cannot read the record: ${read.why}`;
		case "read": {
			const t = read.trace;
			return `${t.spans.length} spans, ${t.steps.length} steps, ${s.open.length} open`;
		}
	}
};
