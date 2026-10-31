import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {JobTrace, MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Model, trace} from "./machine.ts";
import {TALLY_AT, TALLY_ID, TALLY_TRACE} from "./tally.ts";
import {nodesOf, treeOf} from "./tree.ts";
import {type Shown, shownOf} from "./view.ts";

// Laws for a running job, written from the owner's five promises by an agent that did not build
// this. On tea's pbt: the real reducer, from its real init, and the real `shownOf` as the view.
//
//   1  a job not ended says it is running, and its time grows
//   2  once it ends the time stops, the final time shows, and nothing still ticks
//   3  an empty record draws no fake axis or bar, and says it is running with one plain line
//   4  an ended job never goes back to looking like it runs, and a late tick changes nothing
//   5  a good thing happens: a running job's time does move forward when ticks come
//
// What needs a window. Promises 1 and 3 end in ./window.tsx: the word `running`, the plain line, and
// the choice to draw no axis are in the component, not in pure code. These laws reach as far as
// `shownOf`, the facts that choice reads. A window that ignores those facts passes here.
//
// Each law below has a planted break it must catch. The plants of `endStays`, `tickNeverBack` and
// `finalCoversJob` are written out by hand, not built on the real cells, so they keep the behavior
// those laws forbid however the real code changes.

type Machine = typeof trace;
type Msg = MsgOf<Machine>;
type TraceStep = Step<Model, Msg, never>;

/** What a law runs on: the machine and the view, either of which a plant may change. */
interface World {
	readonly machine: Machine;
	readonly show: (s: Model) => Shown;
}

const REAL: World = {machine: trace, show: shownOf};

const OTHER = "f".repeat(32);
const LATER = 10_000;

const job = {n: 1, text: "seq --to 3 | tally", by: "user:owner", host: "laptop", started: TALLY_AT};
const running = {...job, ended: null};
const done = {...job, ended: {how: "done" as const, at: TALLY_AT + 14}};
const nothing = {runs: [], spans: [], steps: []};
const lineOnly = {runs: [], spans: TALLY_TRACE.spans.slice(0, 1), steps: []};

/** Reads of a job not ended. A span comes in once it ends, so the line's own usually comes last. */
const RUNNING: readonly JobTrace[] = [
	{...TALLY_TRACE, ...nothing, job: running},
	{...TALLY_TRACE, job: running, spans: TALLY_TRACE.spans.slice(1, 2), steps: []},
	{...TALLY_TRACE, job: running, spans: TALLY_TRACE.spans.slice(1)},
	// `tally &`: tsh's prompt is back, so the line's span is over and the job runs on.
	{...TALLY_TRACE, ...lineOnly, job: running},
];

/** Reads of a job over, and a read that names no job, which a host writes before it knows one. */
const OVER: readonly JobTrace[] = [
	TALLY_TRACE,
	{...TALLY_TRACE, ...nothing, job: done},
	{...TALLY_TRACE, job: done, spans: TALLY_TRACE.spans.slice(1, 2), steps: []},
	// `tally &`, ended later, and its runs' spans never came: a job dropped after tsh went away.
	{...TALLY_TRACE, ...lineOnly, job: {...job, ended: {how: "stopped", at: TALLY_AT + LATER}}},
	{...TALLY_TRACE, ...nothing, job: null},
	{...TALLY_TRACE, job: null, spans: TALLY_TRACE.spans.slice(1, 2), steps: []},
];

/** Mostly the id already held, so a read of the same record, or a tick after it, comes often. */
const id = fc.oneof(
	{arbitrary: fc.constant(TALLY_ID), weight: 5},
	{arbitrary: fc.constant(OTHER), weight: 1},
);
const record = fc.constantFrom(...RUNNING, ...OVER);
const row = fc.constantFrom(...nodesOf(treeOf(TALLY_TRACE)).map((n) => n.key), "");
const moment = fc.integer({min: TALLY_AT - 1000, max: TALLY_AT + 2 * LATER});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	look: arbRecordMsg("look", {id}),
	got: fc.tuple(id, record).map(([i, r]) => ({type: "got" as const, trace: {...r, trace: i}})),
	lost: arbRecordMsg("lost", {id, why: fc.constant("gone")}),
	toggle: arbRecordMsg("toggle", {row}),
	choose: arbRecordMsg("choose", {row: fc.option(row, {nil: null})}),
	tick: arbRecordMsg("tick", {now: moment}),
};
const anything = fc.array(arbMsg(table), {maxLength: 30, size: "max"});
/** Half start with a record read at once, since a look and its read seldom land together by luck. */
const lists = fc.oneof(
	anything,
	fc
		.tuple(record, anything)
		.map(([first, rest]): readonly Msg[] => [
			{type: "look", id: first.trace},
			{type: "got", trace: first},
			...rest,
		]),
);
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

/** The record shown, or `null` while there is none. */
const shown = (s: Model): JobTrace | null => (s.read.at === "read" ? s.read.trace : null);

/** Read from the record itself, with none of the machine's helpers: its job has not ended. */
const runs = (s: Model): boolean => {
	const told = shown(s)?.job ?? null;
	return told !== null && told.ended === null;
};

const lastTick = (s: Model): number | null => (s.read.at === "read" ? s.read.now : null);

/** The state a record alone gives: no tick was ever told. */
const fresh = (trace: JobTrace): Model => ({
	read: {at: "read", trace, now: null},
	open: [],
	chosen: null,
});

interface Law {
	readonly name: string;
	/** Throws when this world breaks the law, with the shortest list that does. */
	readonly check: (world: World) => void;
}

const every = (name: string, law: (step: TraceStep, world: World) => boolean): Law => ({
	name,
	check: (world) => propertyInvariant(world.machine, ctx, lists, (step) => law(step, world), OPTS),
});

// Promise 1

const saysRunning = every(
	"the view says running exactly while the record says the job has not ended",
	({next}, {show}) => (show(next).running !== null) === runs(next),
);

const timeOnceTold = every(
	"a running job says its time from the first tick on, and not before",
	({next}, {show}) => {
		const said = show(next).running;
		return said === null || (said.took === null) === (lastTick(next) === null);
	},
);

const readKeepsTime = every(
	"a newer read of a running job keeps the time told, so it does not blink",
	({prev, msg, next}) =>
		msg.type !== "got" ||
		!runs(prev) ||
		!runs(next) ||
		shown(prev)?.trace !== msg.trace.trace ||
		lastTick(next) === lastTick(prev),
);

const tickOnlyMovesTime = every(
	"a tick to a running job moves its time and nothing else",
	({prev, msg, next}) =>
		msg.type !== "tick" ||
		!runs(prev) ||
		(shown(next) === shown(prev) && next.open === prev.open && next.chosen === prev.chosen),
);

/** Shortest run on 9ebb87c: look A, got A not ended, a tick, an earlier tick. A clock can step back. */
const tickNeverBack = every(
	"a tick never moves a running job's time back",
	({prev, msg, next}, {show}) => {
		const before = show(prev).running?.took ?? null;
		const after = show(next).running?.took ?? null;
		return msg.type !== "tick" || before === null || after === null || after >= before;
	},
);

// Promise 2

const clockOnlyWhileRunning = every(
	"the clock Sub is on while the job runs, keyed by its id, and off at every other time",
	({next}, {machine}) => {
		const clock = machine.subs?.find((sub) => sub.type === "tick");
		const want = runs(next) ? {id: shown(next)?.trace} : null;
		return JSON.stringify(clock?.deps(next) ?? null) === JSON.stringify(want);
	},
);

/** Nothing else can keep ticking. */
const onlyTwoSubs = every(
	"the machine holds one follow Sub and one clock Sub, and no other",
	(_, {machine}) =>
		JSON.stringify((machine.subs ?? []).map((sub) => sub.type).toSorted()) ===
		JSON.stringify(["follow", "tick"]),
);

const overHoldsNoTime = every(
	"a record read whose job is not running holds no time",
	({next}) => next.read.at !== "read" || runs(next) || next.read.now === null,
);

const finalFromRecord = every(
	"an ended job's final time comes from its record alone: no tick and no clock is in it",
	({next}, {show}) => {
		const record = shown(next);
		if (record === null || record.job?.ended == null) return true;
		const final = show(next);
		return final.running === null && final.length === show(fresh(record)).length;
	},
);

/**
 * Shortest run on 9ebb87c: look A, got A, whose job ended 10 s in but whose only span is the line's,
 * over at 14 ms: the head says 14 ms and the job's detail says 10 s. A background job lands here if
 * its runs' spans never came.
 */
const finalCoversJob = every(
	"an ended job's final time is never shorter than its job's own time",
	({next}, {show}) => {
		const ended = shown(next)?.job ?? null;
		return (
			ended === null || ended.ended === null || show(next).length >= ended.ended.at - ended.started
		);
	},
);

// Promise 3

const emptyDrawsNothing = every(
	"a running job with nothing in its record has one row, its own, with nothing to open or mark",
	({next}, {show}) => {
		const record = shown(next);
		if (
			record === null ||
			!runs(next) ||
			record.runs.length + record.spans.length + record.steps.length > 0
		)
			return true;
		const view = show(next);
		const [only] = view.rows;
		return (
			view.running !== null &&
			view.spans === 0 &&
			view.steps === 0 &&
			view.rows.length === 1 &&
			only?.kind === "job" &&
			!only.opens &&
			only.dots.length === 0
		);
	},
);

// Promise 4

const lateTickIsNothing = every(
	"a tick when no job is running changes nothing",
	({prev, msg, next}) => msg.type !== "tick" || runs(prev) || next === prev,
);

/**
 * Shortest run on 9ebb87c: look A, got A ended, got A not ended: it looks like it runs again, and
 * the clock Sub comes back on. The host writes an end once (`WHERE how IS NULL`) and reads come in
 * order, so only a stale read can do this.
 */
const endStays = every(
	"once the record shown says its job ended, a read of that record cannot make it run again",
	({prev, msg, next}) =>
		msg.type !== "got" ||
		shown(prev)?.trace !== msg.trace.trace ||
		shown(prev)?.job?.ended == null ||
		!runs(next),
);

// Promise 5

/** A job read as running, then ticks moving forward, past all the record's times, with noise. */
const ticksForward = fc
	.tuple(
		fc.constantFrom(...RUNNING),
		fc.array(
			fc.tuple(
				fc.integer({min: 1, max: 5000}),
				fc.oneof(
					fc.constant<readonly Msg[]>([]),
					fc.constantFrom(...RUNNING).map((r): readonly Msg[] => [{type: "got", trace: r}]),
					row.map((r): readonly Msg[] => [{type: "toggle", row: r}]),
					row.map((r): readonly Msg[] => [{type: "choose", row: r}]),
				),
			),
			{minLength: 2, maxLength: 10},
		),
	)
	.map(([first, later]): readonly Msg[] => {
		const start: readonly Msg[] = [
			{type: "look", id: first.trace},
			{type: "got", trace: first},
		];
		let at = TALLY_AT + 100;
		return [
			...start,
			...later.flatMap(([gap, noise]): readonly Msg[] => {
				at += gap;
				return [...noise, {type: "tick", now: at}];
			}),
		];
	});

const timeMoves: Law = {
	name: "a running job's time moves forward with each later tick, to the time since it started",
	check: ({machine, show}) =>
		propertyTrace(
			machine,
			ctx,
			ticksForward,
			(steps) => {
				const told = steps.flatMap((s) =>
					s.msg.type === "tick" ? [[s.msg.now, show(s.next).running?.took] as const] : [],
				);
				return (
					told.length >= 2 &&
					told.every(([now, took]) => took === now - TALLY_AT) &&
					told.every(([, took], i) => i === 0 || (took ?? 0) > (told[i - 1]?.[1] ?? 0))
				);
			},
			OPTS,
		),
};

const LAWS: readonly Law[] = [
	saysRunning,
	timeOnceTold,
	readKeepsTime,
	tickOnlyMovesTime,
	tickNeverBack,
	clockOnlyWhileRunning,
	onlyTwoSubs,
	overHoldsNoTime,
	finalFromRecord,
	finalCoversJob,
	emptyDrawsNothing,
	lateTickIsNothing,
	endStays,
	timeMoves,
];

const breaks = (law: Law, world: World): boolean => {
	try {
		law.check(world);
		return false;
	} catch {
		return true;
	}
};

// Planted mistakes: the real machine with one cell or Sub changed, or the real view with one fact.

const real = trace.update;
const inMachine = (update: Partial<Machine["update"]>): World => ({
	...REAL,
	machine: {...trace, update: {...real, ...update}},
});
const inClock = (deps: (s: Model) => {readonly id: string} | null): World => ({
	...REAL,
	machine: {
		...trace,
		subs: (trace.subs ?? []).map((sub) => (sub.type === "tick" ? {...sub, deps} : sub)),
	} as Machine,
});
const inView = (change: (s: Model, view: Shown) => Shown): World => ({
	...REAL,
	show: (s) => change(s, shownOf(s)),
});

/** A clock left in the view: each look at it says a later time. */
const viewWithClock = (): World => {
	let clock = 0;
	return inView((_, view) => ({...view, length: view.length + ++clock}));
};

/** Each law, the break it must catch, and that break. */
const PLANTS: readonly (readonly [Law, string, World])[] = [
	[saysRunning, "the view never says running", inView((_, view) => ({...view, running: null}))],
	[
		saysRunning,
		"the view says running for any record read",
		inView((s, view) => (shown(s) === null ? view : {...view, running: {took: null}})),
	],
	[
		timeOnceTold,
		"the view never says the time",
		inView((_, view) => (view.running === null ? view : {...view, running: {took: null}})),
	],
	[
		readKeepsTime,
		"each newer read forgets the time",
		inMachine({
			got: (s, m) => {
				const [next, cmds] = real.got(s, m);
				return next.read.at === "read"
					? [{...next, read: {...next.read, now: null}}, cmds]
					: [next, cmds];
			},
		}),
	],
	[
		tickOnlyMovesTime,
		"a tick closes the rows",
		inMachine({
			tick: (s, m) => {
				const [next, cmds] = real.tick(s, m);
				return next === s ? [next, cmds] : [{...next, open: []}, cmds];
			},
		}),
	],
	[
		tickNeverBack,
		"a tick takes any time, later or earlier",
		inMachine({
			tick: (s, m) =>
				s.read.at === "read" && runs(s) ? [{...s, read: {...s.read, now: m.now}}, []] : [s, []],
		}),
	],
	[clockOnlyWhileRunning, "the clock is never on, so no tick ever comes", inClock(() => null)],
	[
		clockOnlyWhileRunning,
		"the clock stays on for an ended job",
		inClock((s) => (s.read.at === "read" ? {id: s.read.trace.trace} : null)),
	],
	[
		onlyTwoSubs,
		"a second clock runs beside the first, on another id",
		{
			...REAL,
			machine: {
				...trace,
				subs: [...(trace.subs ?? []), {type: "tick", deps: () => ({id: OTHER})}],
			} as Machine,
		},
	],
	[
		overHoldsNoTime,
		"a read that says the job ended keeps the last tick",
		inMachine({
			got: (s, m) => {
				const [next, cmds] = real.got(s, m);
				return next.read.at === "read" && s.read.at === "read"
					? [{...next, read: {...next.read, now: s.read.now}}, cmds]
					: [next, cmds];
			},
		}),
	],
	[finalFromRecord, "the view reads a clock after the end", viewWithClock()],
	[
		finalCoversJob,
		"an ended job's final time comes from its spans alone",
		inView((s, view) => {
			const record = shown(s);
			if (record?.job?.ended == null || record.spans.length === 0) return view;
			const from = Math.min(...record.spans.map((span) => span.start));
			const to = Math.max(...record.spans.map((span) => span.end));
			return {...view, length: Math.max(1, to - from)};
		}),
	],
	[
		emptyDrawsNothing,
		"an empty record's view holds a made-up row under the job",
		inView((_, view) => {
			const [first] = view.rows;
			return view.running === null || view.spans > 0 || first === undefined
				? view
				: {
						...view,
						rows: [
							{...first, opens: true},
							{...first, key: "bar", depth: 1},
						],
					};
		}),
	],
	[
		lateTickIsNothing,
		"a tick lands on any record read, its job ended or not",
		inMachine({
			tick: (s, m) =>
				s.read.at === "read" ? [{...s, read: {...s.read, now: m.now}}, []] : [s, []],
		}),
	],
	[
		endStays,
		"each read of the id held replaces the record, whatever it says",
		inMachine({
			got: (s, m) =>
				(s.read.at === "reading" ? s.read.id : shown(s)?.trace) === m.trace.trace
					? [fresh(m.trace), []]
					: [s, []],
		}),
	],
	[
		timeMoves,
		"a tick does nothing: the machine that passes by never doing anything",
		inMachine({tick: (s) => [s, []]}),
	],
	[
		timeMoves,
		"the time stops at the first tick",
		inMachine({
			tick: (s, m) =>
				s.read.at === "read" && runs(s) && s.read.now === null
					? [{...s, read: {...s.read, now: m.now}}, []]
					: [s, []],
		}),
	],
];

describe("a running job's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(REAL);
	});

	it.each(PLANTS.map(([law, what, world]) => [law.name, what, law, world] as const))(
		"%s: seen to fail when %s",
		(_, __, law, world) => {
			expect(breaks(law, world)).toBe(true);
		},
	);
});
