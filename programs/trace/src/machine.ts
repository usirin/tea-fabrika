import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {JobTrace, TraceId} from "@kampus/fabrika";
import {Schema} from "effect";
import {findOf, groupsOf, JOB, treeOf} from "./tree.ts";

// The trace's machine: one job's record as last read, which of its rows are open, and which one
// is chosen. Elm's debugger and Redux DevTools hold the same: the history, and where you look in
// it. Pure: the record is reached through its one Cmd, whose cell is in ./index.ts.
//
//   look     read the job's record (`read`), from the flag, once at the start
//   toggle   open a row that groups others, or close it: a job, a run, a machine run, a round,
//            an agent's turns. A row that groups nothing, or is not in the record, changes nothing
//   choose   show one row's detail: a span's tags and events, or a step's Msg, the state before
//            and after, and its Cmds. `null` closes the detail
//
//   replay(trace, {ctx: undefined, msgs: [{type: "look", id: TALLY_ID}]})
//   // state.read {at: "reading", id}, cmds [read {id}]
//   // then read_ok: state.read {at: "read", trace}, open ["job"]: the job's row shows its runs
//
// Open rows are state, as Elm keeps them in the Model: a reload, a second window or another
// client of the same run shows the same rows open.

/**
 * A job's record as the machine holds it: `JobTrace` with one type on both sides, since it never
 * leaves the process as the record's wire writes it. The record's reader has decoded it already.
 */
export const Kept = Schema.toType(JobTrace);

/** Read one job's record, by its trace id. */
export const read = Cmd.define("read", {
	input: Schema.Struct({id: TraceId}),
	ok: Kept,
	err: ["unread"],
});
type ReadCmd = ReturnType<typeof read>;

/** A row of the tree, by its key (./tree.ts): what `toggle` and `choose` name. */
export const RowKey = Schema.String.check(Schema.isMaxLength(512));

/** Where the record stands: not asked yet, asked, read, or it could not be read. */
export const Read = Schema.Union([
	Schema.Struct({at: Schema.Literal("waiting")}),
	Schema.Struct({at: Schema.Literal("reading"), id: TraceId}),
	Schema.Struct({at: Schema.Literal("read"), trace: Kept}),
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
	| {readonly type: "toggle"; readonly row: string}
	| {readonly type: "choose"; readonly row: string | null};

type Step = readonly [Model, readonly ReadCmd[]];

const start: Model = {read: {at: "waiting"}, open: [], chosen: null};

const why = (error: {readonly _tag: string; readonly [detail: string]: unknown}) =>
	typeof error.why === "string" ? error.why : error._tag;

export const trace = defineMachine({
	types: {model: {} as Model, msg: {} as TraceMsg, ctx: undefined},
	cmds: [read],
	init: (): Step => [start, []],
	update: {
		look: (s, m): Step =>
			s.read.at === "waiting"
				? [{...s, read: {at: "reading", id: m.id}}, [read({id: m.id})]]
				: [s, []],
		read_ok: (s, m): Step =>
			s.read.at === "reading" && s.read.id === m.cmd.id
				? [{read: {at: "read", trace: m.value}, open: [JOB], chosen: null}, []]
				: [s, []],
		read_err: (s, m): Step =>
			s.read.at === "reading" && s.read.id === m.cmd.id
				? [{...s, read: {at: "unread", id: m.cmd.id, why: why(m.error)}}, []]
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
	},
});

/** Its status line, for a host's list of runs. */
export const statusOf = (s: Model): string => {
	switch (s.read.at) {
		case "waiting":
			return "waiting for a trace id";
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
