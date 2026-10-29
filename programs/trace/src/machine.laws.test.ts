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
import {type Model, read, trace} from "./machine.ts";
import {TALLY_ID, TALLY_TRACE} from "./tally.ts";
import {findOf, groupsOf, nodesOf, treeOf} from "./tree.ts";

// The trace machine's laws, on tea's pbt: after every step of any list of Msgs, from the real
// init. The record's answers are drawn too, so one can come for a trace that was not asked for,
// come twice, or never come.

type Machine = typeof trace;
type Msg = MsgOf<Machine>;
type ReadCmd = ReturnType<typeof read>;
type TraceStep = Step<Model, Msg, ReadCmd>;

const OTHER = "f".repeat(32);
const id = fc.constantFrom(TALLY_ID, OTHER);
/** Every row of the tally record, and two it does not hold. */
const row = fc.constantFrom(
	...nodesOf(treeOf(TALLY_TRACE)).map((n) => n.key),
	"span:ffffffffffffffff",
	"",
);

/** One entry per Msg type, the Cmd's answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	look: arbRecordMsg("look", {id}),
	toggle: arbRecordMsg("toggle", {row}),
	choose: arbRecordMsg("choose", {row: fc.option(row, {nil: null})}),
	read_ok: id.map((i) => read.ok(read({id: i}), {...TALLY_TRACE, trace: i}, 0)),
	read_err: id.map((i) => read.err(read({id: i}), {_tag: "unread"}, 0)),
};
const lists = fc.array(arbMsg(table), {maxLength: 30, size: "max"});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: TraceStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law, OPTS),
});

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

const oneRead = every(
	"the record is asked for once, by the first look, for the id it named",
	({prev, msg, cmds}) =>
		cmds.length === 0 ||
		(cmds.length === 1 &&
			msg.type === "look" &&
			prev.read.at === "waiting" &&
			cmds[0]?.id === msg.id),
);

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
				const [again] = applyCell<Model, Msg, ReadCmd>(machine, last, step.msg);
				const was = new Set(step.prev.open);
				return again.open.length === was.size && again.open.every((k) => was.has(k));
			},
			OPTS,
		),
};

const LAWS = [openAreGroups, chosenIsARow, oneRead, twiceIsNothing];

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

// Planted mistakes: the real machine with one cell changed.
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
	/** Every look reads the record again. */
	readsEveryLook: plant({
		look: (s, m) => [{...s, read: {at: "reading", id: m.id}}, [read({id: m.id})]],
	}),
	/** A toggle only ever opens. */
	neverCloses: plant({
		toggle: (s, m) =>
			s.read.at === "read" && groupsOf(treeOf(s.read.trace)).has(m.row) && !s.open.includes(m.row)
				? [{...s, open: [...s.open, m.row]}, []]
				: [s, []],
	}),
};

describe("the trace machine's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(trace);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(PLANTS.opensAnything)).toContain(openAreGroups.name);
		expect(broken(PLANTS.choosesAnything)).toEqual([chosenIsARow.name]);
		// A look that reads again also drops the record it read, so the rows open in it are left over.
		expect(broken(PLANTS.readsEveryLook)).toContain(oneRead.name);
		expect(broken(PLANTS.neverCloses)).toEqual([twiceIsNothing.name]);
	});
});
