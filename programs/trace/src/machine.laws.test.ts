import {applyCell} from "@demlik/tea";
import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {firstOpen, followed, idOf, isRunning, type Model, ticking, trace} from "./machine.ts";
import {TALLY_ID, TALLY_TRACE} from "./tally.ts";
import {findOf, groupsOf, JOB, nodesOf, treeOf} from "./tree.ts";

// The trace machine's laws, on tea's pbt: after every step of any list of Msgs, from the real
// init. The record's reads are drawn too, so one can come for a trace that is not followed, come
// twice, come smaller than the one before, or never come.

type Machine = typeof trace;
type Msg = MsgOf<Machine>;
type TraceStep = Step<Model, Msg, never>;

const OTHER = "f".repeat(32);
const id = fc.constantFrom(TALLY_ID, OTHER);
/** Every row of the tally record, and two it does not hold. */
const row = fc.constantFrom(
	...nodesOf(treeOf(TALLY_TRACE)).map((n) => n.key),
	"span:ffffffffffffffff",
	"",
);
const runningJob = TALLY_TRACE.job === null ? null : {...TALLY_TRACE.job, ended: null};
/**
 * The whole record, the record before tally's machine ran, or the job just begun with nothing
 * under it: a read can hold fewer rows, or none. Two say the job has not ended, so a job can run,
 * end and seem to run again.
 */
const record = fc.constantFrom(
	TALLY_TRACE,
	{...TALLY_TRACE, spans: TALLY_TRACE.spans.slice(0, 2), steps: []},
	{...TALLY_TRACE, runs: [], spans: [], steps: []},
	{...TALLY_TRACE, job: runningJob, runs: [], spans: [], steps: []},
	{...TALLY_TRACE, job: runningJob, steps: TALLY_TRACE.steps.slice(0, 1)},
);

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	look: arbRecordMsg("look", {id}),
	got: fc.tuple(id, record).map(([i, r]) => ({type: "got" as const, trace: {...r, trace: i}})),
	lost: arbRecordMsg("lost", {id, why: fc.constant("gone")}),
	toggle: arbRecordMsg("toggle", {row}),
	choose: arbRecordMsg("choose", {row: fc.option(row, {nil: null})}),
	tick: arbRecordMsg("tick", {now: fc.nat()}),
};
const lists = fc.array(arbMsg(table), {maxLength: 30, size: "max"});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: TraceStep, machine: Machine) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, (step) => law(step, machine), OPTS),
});

/** What one Sub asks for in a state. */
const depsOf = (machine: Machine, type: "follow" | "tick", state: Model) =>
	machine.subs?.find((sub) => sub.type === type)?.deps(state) ?? null;

const openAreGroups = every(
	"only a row that groups others is ever open, and only in a record that was read",
	({next}) => {
		if (next.read.at !== "read") return next.open.length === 0;
		const groups = groupsOf(treeOf(next.read.trace));
		return next.open.every((k) => groups.has(k)) && new Set(next.open).size === next.open.length;
	},
);

const chosenIsARow = every(
	"the chosen row is none, or a row of the record that was read",
	({next}) =>
		next.chosen === null ||
		(next.read.at === "read" && findOf(treeOf(next.read.trace), next.chosen) !== undefined),
);

const followsWhatItHolds = every(
	"it asks for nothing by Cmd, and follows the id it holds while it reads or shows it, and nothing else",
	({next, cmds}, machine) => {
		const want =
			next.read.at === "reading" || next.read.at === "read" ? {id: idOf(next.read)} : null;
		const subs = (machine.subs ?? []).map((sub) => sub.type).toSorted();
		return (
			cmds.length === 0 &&
			JSON.stringify(subs) === JSON.stringify(["follow", "tick"]) &&
			JSON.stringify(depsOf(machine, "follow", next)) === JSON.stringify(want)
		);
	},
);

const ticksWhileItRuns = every(
	"the clock is on while the record read says its job has not ended, and off otherwise",
	({next}, machine) => {
		const want =
			next.read.at === "read" && isRunning(next.read.trace) ? {id: idOf(next.read)} : null;
		return JSON.stringify(depsOf(machine, "tick", next)) === JSON.stringify(want);
	},
);

const holdsTimeWhileItRuns = every(
	"it holds the time only while the job runs, and a tick moves it to the later time, never back",
	({prev, msg, next}) => {
		if (next.read.at !== "read") return true;
		if (!isRunning(next.read.trace)) return next.read.now === null;
		if (msg.type !== "tick") return true;
		const before = prev.read.at === "read" ? prev.read.now : null;
		return next.read.now === Math.max(before ?? msg.now, msg.now);
	},
);

const lookAgainIsNothing = every(
	"a look at the id it holds changes nothing, unless that record could not be read",
	({prev, msg, next}) =>
		msg.type !== "look" || idOf(prev.read) !== msg.id || prev.read.at === "unread" || next === prev,
);

const againKeepsRows = every(
	"a newer read of the record shown keeps the rows open and the detail chosen, where they still are",
	({prev, msg, next}) => {
		if (msg.type !== "got" || prev.read.at !== "read" || idOf(prev.read) !== msg.trace.trace)
			return true;
		const tree = treeOf(msg.trace);
		const groups = groupsOf(tree);
		// A record with nothing under its job had no row to keep: the next opens as a first read.
		const shown = groupsOf(treeOf(prev.read.trace)).has(JOB);
		const open = shown ? prev.open.filter((k) => groups.has(k)) : firstOpen(msg.trace);
		const chosen =
			prev.chosen !== null && findOf(tree, prev.chosen) !== undefined ? prev.chosen : null;
		return JSON.stringify(next.open) === JSON.stringify(open) && next.chosen === chosen;
	},
);

const newestWins: Law = {
	name: "the id held is the last one looked at, and a record read is that id's",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) => {
				const looked = steps.findLast((s) => s.msg.type === "look")?.msg;
				const held = idOf(last.read);
				if (looked?.type !== "look") return held === null;
				return held === looked.id;
			},
			OPTS,
		),
};

const twiceIsNothing: Law = {
	name: "a row toggled twice is open as it was",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			fc.tuple(lists, row).map(([msgs, r]): Msg[] => [...msgs, {type: "toggle", row: r}]),
			(steps, last) => {
				const step = steps.at(-1);
				if (step?.msg.type !== "toggle") return true;
				const [again] = applyCell<Model, Msg, never>(machine, last, step.msg);
				const was = new Set(step.prev.open);
				return again.open.length === was.size && again.open.every((k) => was.has(k));
			},
			OPTS,
		),
};

const LAWS = [
	openAreGroups,
	chosenIsARow,
	followsWhatItHolds,
	ticksWhileItRuns,
	holdsTimeWhileItRuns,
	lookAgainIsNothing,
	againKeepsRows,
	newestWins,
	twiceIsNothing,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// Planted mistakes: the real machine with one cell, or its Sub, changed.
const real = trace.update;
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...trace,
	update: {...real, ...update},
});

const PLANTS = {
	/** A toggle takes any row, a step or one the record does not hold. */
	opensAnything: plant({toggle: (s, m) => [{...s, open: [...s.open, m.row]}, []]}),
	/** A choose takes any row. */
	choosesAnything: plant({choose: (s, m) => [{...s, chosen: m.row}, []]}),
	/** Every look starts over, on the record held too. */
	readsEveryLook: plant({
		look: (_, m) => [{read: {at: "reading", id: m.id}, open: [], chosen: null}, []],
	}),
	/** The first look wins: a later id is never followed. */
	firstLookWins: plant({
		look: (s, m) =>
			s.read.at === "waiting" ? [{...s, read: {at: "reading", id: m.id}}, []] : [s, []],
	}),
	/** A read for an id it no longer follows still shows. */
	takesLateAnswers: plant({
		got: (s, m) =>
			s.read.at === "reading"
				? [
						{read: {at: "read", trace: m.trace, now: null}, open: firstOpen(m.trace), chosen: null},
						[],
					]
				: real.got(s, m),
	}),
	/** A newer id keeps the old record's open rows. */
	keepsOldRows: plant({
		look: (s, m) =>
			idOf(s.read) === m.id && s.read.at !== "unread"
				? [s, []]
				: [{...s, read: {at: "reading", id: m.id}}, []],
	}),
	/** A newer read of the record shown starts its rows over. */
	resetsOnEachRead: plant({
		got: (s, m) =>
			idOf(s.read) === m.trace.trace && (s.read.at === "reading" || s.read.at === "read")
				? [
						{read: {at: "read", trace: m.trace, now: null}, open: firstOpen(m.trace), chosen: null},
						[],
					]
				: [s, []],
	}),
	/** A job read first with nothing under it stays closed once its runs come in. */
	staysClosed: plant({
		got: (s, m) => {
			const [next, cmds] = real.got(s, m);
			if (s.read.at !== "read" || idOf(s.read) !== m.trace.trace) return [next, cmds];
			const groups = groupsOf(treeOf(m.trace));
			return [{...next, open: s.open.filter((k) => groups.has(k))}, cmds];
		},
	}),
	/** A toggle only ever opens. */
	neverCloses: plant({
		toggle: (s, m) =>
			s.read.at === "read" && groupsOf(treeOf(s.read.trace)).has(m.row) && !s.open.includes(m.row)
				? [{...s, open: [...s.open, m.row]}, []]
				: [s, []],
	}),
	/** It goes on following a record it could not read, and asks again and again. */
	followsWhatIsLost: {
		...trace,
		subs: [
			{
				type: "follow",
				deps: (s: Model) => (s.read.at === "waiting" ? null : {id: idOf(s.read) ?? ""}),
			},
			{type: "tick", deps: ticking},
		],
	} as Machine,
	/** The clock stays on after the job's end. */
	ticksForever: {
		...trace,
		subs: [
			{type: "follow", deps: followed},
			{type: "tick", deps: (s: Model) => (s.read.at === "read" ? {id: s.read.trace.trace} : null)},
		],
	} as Machine,
	/** A tick that comes after the job's end still sets the time. */
	takesLateTicks: plant({
		tick: (s, m) => (s.read.at === "read" ? [{...s, read: {...s.read, now: m.now}}, []] : [s, []]),
	}),
	/** A tick takes any time, later or earlier, written out so it stays this way. */
	takesAnyTime: plant({
		tick: (s, m) =>
			s.read.at === "read" && isRunning(s.read.trace)
				? [{...s, read: {...s.read, now: m.now}}, []]
				: [s, []],
	}),
	/** A tick does nothing, so the time never moves. */
	frozenClock: plant({tick: (s) => [s, []]}),
	/** A second follow, on another id. */
	secondFollow: {
		...trace,
		subs: [...(trace.subs ?? []), {type: "follow", deps: () => ({id: OTHER})}],
	} as Machine,
	/** A second clock, on another id. */
	secondClock: {
		...trace,
		subs: [...(trace.subs ?? []), {type: "tick", deps: () => ({id: OTHER})}],
	} as Machine,
	/** The time held before the job's end stays after it. */
	keepsTimeAfterEnd: plant({
		got: (s, m) => {
			const [next, cmds] = real.got(s, m);
			return s.read.at === "read" && next.read.at === "read"
				? [{...next, read: {...next.read, now: s.read.now}}, cmds]
				: [next, cmds];
		},
	}),
};

describe("the trace machine's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(trace);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(PLANTS.opensAnything)).toContain(openAreGroups.name);
		expect(broken(PLANTS.choosesAnything)).toEqual([chosenIsARow.name]);
		expect(broken(PLANTS.readsEveryLook)).toEqual([lookAgainIsNothing.name]);
		expect(broken(PLANTS.firstLookWins)).toEqual([newestWins.name]);
		expect(broken(PLANTS.takesLateAnswers)).toEqual([newestWins.name]);
		// The old rows are left over while the new record is read.
		expect(broken(PLANTS.keepsOldRows)).toContain(openAreGroups.name);
		expect(broken(PLANTS.resetsOnEachRead)).toEqual([againKeepsRows.name]);
		expect(broken(PLANTS.staysClosed)).toEqual([againKeepsRows.name]);
		expect(broken(PLANTS.neverCloses)).toEqual([twiceIsNothing.name]);
		expect(broken(PLANTS.followsWhatIsLost)).toEqual([followsWhatItHolds.name]);
		expect(broken(PLANTS.ticksForever)).toEqual([ticksWhileItRuns.name]);
		expect(broken(PLANTS.takesLateTicks)).toEqual([holdsTimeWhileItRuns.name]);
		expect(broken(PLANTS.keepsTimeAfterEnd)).toEqual([holdsTimeWhileItRuns.name]);
		expect(broken(PLANTS.takesAnyTime)).toEqual([holdsTimeWhileItRuns.name]);
		expect(broken(PLANTS.frozenClock)).toEqual([holdsTimeWhileItRuns.name]);
	});

	it("the follow law fails on any Sub beyond the two it names", () => {
		expect(broken(PLANTS.secondFollow)).toContain(followsWhatItHolds.name);
		expect(broken(PLANTS.secondClock)).toContain(followsWhatItHolds.name);
	});
});
