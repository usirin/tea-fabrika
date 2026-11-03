import {ATTR, type JobTrace, runTraceId} from "@kampus/fabrika-old";

// The record `seq --to 3 | tally` leaves, in the record's own read shape
// (packages/fabrika/src/host/traces.ts): the example of
// docs/direction/a-job-record-holds-its-trace.md, "Every step is kept, and the tile opens it".
// Both programs are in packages/fabrika/src/shell/small.ts. Made by hand, as the host would
// write it, until a host writes real ones: for the tests and the app's shots.
//
//   job    seq --to 3 | tally, typed at tsh on the laptop, done in 14 ms
//   spans  the line (tsh), seq's run, tally's run, and tally's machine `count`
//   steps  count total: add 1 → {total: 1}, add 2 → {total: 3}, add 3 → {total: 6}, no Cmds

/** The job's first run: its key gives the trace id. */
export const SEQ_RUN = "seq-3f9a1c02";
export const TALLY_RUN = "tally-5d02c7a1";

/** The record's key: the trace id of the job's first run. */
export const TALLY_ID = runTraceId(SEQ_RUN);

/** When the line was typed: 2026-10-28, 10:00 UTC. */
export const TALLY_AT = Date.UTC(2026, 9, 28, 10, 0, 0);

const at = (ms: number) => TALLY_AT + ms;
const by = "user:owner";

const LINE = "a1b2c3d4e5f60708";
const SEQ = "1a2b3c4d5e6f7081";
const TALLY = "2b3c4d5e6f708192";
const COUNT = "3c4d5e6f708192a3";

const event = (name: string, ms: number, tags: Record<string, string> = {}) => ({
	name,
	at: at(ms),
	tags,
});

export const TALLY_TRACE: JobTrace = {
	trace: TALLY_ID,
	job: {
		n: 1,
		text: "seq --to 3 | tally",
		by,
		host: "laptop",
		started: at(0),
		ended: {how: "done", at: at(14)},
	},
	runs: [
		{run: SEQ_RUN, status: "ended", flags: {to: 3}, closed: [], machines: [], deadLetters: []},
		{
			run: TALLY_RUN,
			status: "ended",
			flags: {},
			closed: [],
			machines: [{machine: "count", id: "total"}],
			deadLetters: [],
		},
	],
	spans: [
		{
			span: LINE,
			parent: null,
			name: "seq --to 3 | tally",
			service: "tsh",
			start: at(0),
			end: at(14),
			status: "ok",
			tags: {[ATTR.line]: "seq --to 3 | tally"},
			events: [],
			by,
		},
		{
			span: SEQ,
			parent: LINE,
			name: "run",
			service: "seq",
			start: at(1),
			end: at(9),
			status: "ok",
			tags: {[ATTR.program]: "seq", [ATTR.run]: SEQ_RUN},
			events: [3, 5, 7].map((ms) => event("sent n", ms, {[ATTR.output]: "n"})),
			by,
		},
		{
			span: TALLY,
			parent: LINE,
			name: "run",
			service: "tally",
			start: at(1),
			end: at(13),
			status: "ok",
			tags: {[ATTR.program]: "tally", [ATTR.run]: TALLY_RUN},
			events: [3.4, 4.2, 5.4, 6.2, 7.4, 8.2].map((ms, i) =>
				i % 2 === 0
					? event("told add", ms, {[ATTR.input]: "add"})
					: event("sent total", ms, {[ATTR.output]: "total"}),
			),
			by,
		},
		{
			span: COUNT,
			parent: TALLY,
			name: "count",
			service: "tally",
			start: at(1.5),
			end: at(13),
			status: "ok",
			tags: {[ATTR.machine]: "count", [ATTR.status]: "total 6"},
			events: [4, 6, 8].map((ms) => event("msg add", ms, {[ATTR.msg]: "add"})),
			by,
		},
	],
	steps: [
		{n: 1, ms: 4, add: 1, total: 1},
		{n: 2, ms: 6, add: 2, total: 3},
		{n: 3, ms: 8, add: 3, total: 6},
	].map((s) => ({
		run: TALLY_RUN,
		machine: "count",
		id: "total",
		n: s.n,
		at: at(s.ms),
		msg: {type: "add", n: s.add},
		state: {total: s.total},
		cmds: [],
		by,
	})),
	// No span kept open for a child run to nest under: neither run starts another.
	opened: [],
};
