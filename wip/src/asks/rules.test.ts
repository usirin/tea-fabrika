import {describe, expect, it} from "vitest";
import {changedLines} from "../stages/plan/lines.ts";
import type {AnswerBody, Ask} from "./ask.ts";
import {changed, numberOf, plans86b, RULINGS} from "./cases.ts";
import type {Entry, Fact} from "./ledger.ts";
import {foldLedger, nextOf, openAsks, problemWith} from "./rules.ts";

// The core's rules for what waits on the owner, on realistic cases: the six
// plans experiment 86b wrote, a stuck task told to keep going, and four
// tickets experiment 88 sent to a ruling. Pure: a ledger is a list of facts.

const ledger = (facts: readonly Fact[]): Entry[] => facts.map((fact, i) => ({seq: i + 1, fact}));

/** A ledger that takes answers the way the program does: only those the rules take are kept. */
function book(facts: readonly Fact[] = []) {
	const entries = ledger(facts);
	const add = (fact: Fact) => entries.push({seq: entries.length + 1, fact});
	return {
		add,
		answer: (id: string, answer: AnswerBody) => {
			const state = foldLedger(entries);
			const problem = problemWith(state, {id, answer});
			const ask = state.asks.get(id);
			if (problem !== null || ask === undefined) return {problem};
			add({type: "answered", id, answer});
			return {problem, next: nextOf(ask, answer)};
		},
		open: () => openAsks(foldLedger(entries)),
		entries,
	};
}

const planned = (): Fact[] =>
	plans86b().flatMap((p): Fact[] =>
		p.plan === null
			? []
			: [
					{
						type: "planned",
						plan: p.ticket,
						tickets: [p.ticket],
						data: p.plan,
						problems: p.outcome.kind === "stuck" ? p.problems : [],
					},
				],
	);

const only = <A extends Ask["for"]>(asks: readonly Ask[], kind: A) =>
	asks.filter((ask): ask is Extract<Ask, {for: A}> => ask.for === kind);

describe("plan approvals: the six 86b plans", () => {
	it("each plan waits on the owner, oldest first, with its questions and what the Check still found", () => {
		const desk = book(planned());
		const asks = only(desk.open(), "plan");
		expect(asks.map((a) => numberOf(a.plan))).toEqual(["367", "393", "490", "504", "565", "579"]);
		expect(asks.map((a) => a.data.questions.length)).toEqual([1, 3, 0, 2, 1, 1]);
		expect(asks.map((a) => a.problems.length > 0)).toEqual([
			false,
			false,
			false,
			true,
			false,
			false,
		]);
		expect(asks.every((a) => a.version === 1 && a.since === null)).toBe(true);
		expect(asks.map((a) => a.at)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("approve, change a line, and no each take their next step, and leave the inbox", () => {
		const desk = book(planned());
		const [a367, a393, a490, a504, a565, a579] = only(desk.open(), "plan");
		expect(desk.answer(a367!.id, {kind: "approve"}).next).toEqual({do: "build", version: 1});
		expect(
			desk.answer(a393!.id, {
				kind: "change",
				line: "q1",
				to: "Opt-in: B4 does not count by default.",
			}).next,
		).toEqual({do: "replan", line: "q1", to: "Opt-in: B4 does not count by default."});
		expect(
			desk.answer(a504!.id, {kind: "no", why: "not now: the Check could not pass it"}).next,
		).toEqual({do: "close", why: "not now: the Check could not pass it"});
		for (const a of [a490, a565, a579]) desk.answer(a!.id, {kind: "approve"});
		expect(desk.open()).toEqual([]);
		expect(desk.entries.filter((e) => e.fact.type === "answered")).toHaveLength(6);
	});

	it("a plan changed after its approval waits again, shown against the version approved", () => {
		const desk = book(planned());
		const a565 = only(desk.open(), "plan").find((a) => numberOf(a.plan) === "565")!;
		desk.answer(a565.id, {kind: "approve"});
		const v2 = changed(a565.data);
		desk.add({type: "planned", plan: a565.plan, tickets: [a565.plan], data: v2, problems: []});
		const [again] = only(desk.open(), "plan").filter((a) => a.plan === a565.plan);
		expect(again).toMatchObject({version: 2, since: {version: 1}});
		const change = changedLines(again!.since!.data, again!.data);
		// One criterion said again, one added, the question gone: three lines of 27.
		expect(change.added.map((l) => l.key)).toEqual(["t1.c1", "t1.c11"]);
		expect(change.removed.map((l) => l.key)).toEqual(["t1.c1", "q1"]);
		expect(change.same).toBeGreaterThan(20);
	});

	it("a new version replaces the one not yet answered; an answer to the old one is refused", () => {
		const desk = book(planned());
		const a393 = only(desk.open(), "plan").find((a) => numberOf(a.plan) === "393")!;
		desk.add({
			type: "planned",
			plan: a393.plan,
			tickets: [a393.plan],
			data: a393.data,
			problems: [],
		});
		expect(
			only(desk.open(), "plan")
				.filter((a) => a.plan === a393.plan)
				.map((a) => a.version),
		).toEqual([2]);
		expect(desk.answer(a393.id, {kind: "approve"}).problem).toBe(
			"a newer version of this plan is waiting instead",
		);
	});
});

describe("a stuck task", () => {
	const approved = () => {
		const desk = book(planned());
		const plans = only(desk.open(), "plan");
		for (const a of plans) desk.answer(a.id, {kind: "approve"});
		const a367 = plans[0]!;
		const review = (open: number) => desk.add({type: "reviewed", plan: a367.plan, task: 1, open});
		return {desk, plan: a367.plan, review};
	};

	it("two rounds in a row that leave the list no shorter ask the owner; one earns one more round", () => {
		const {desk, review} = approved();
		review(4);
		review(3);
		review(3);
		expect(desk.open()).toEqual([]);
		review(3);
		const [stuck] = only(desk.open(), "stuck");
		expect(stuck).toMatchObject({task: 1, why: "no_progress", time: 1, open: [4, 3, 3, 3]});
		expect(stuck!.criteria.map((c) => c.key)).toEqual(["t1.job", "t1.c1", "t1.c2", "t1.c3"]);
	});

	it("keep going 3: counted from review facts after the answer; out of rounds and no shorter, it asks again", () => {
		const {desk, review} = approved();
		for (const open of [4, 3, 3, 3]) review(open);
		const [first] = only(desk.open(), "stuck");
		// Rounds while the ask waits are kept, and not counted.
		review(3);
		review(3);
		expect(desk.answer(first!.id, {kind: "keep_going", rounds: 3}).next).toEqual({
			do: "keep_going",
			task: 1,
			rounds: 3,
		});
		review(3);
		review(3);
		expect(desk.open()).toEqual([]);
		review(3);
		const [again] = only(desk.open(), "stuck");
		expect(again).toMatchObject({why: "ran_out", time: 2, open: [4, 3, 3, 3, 3, 3, 3, 3, 3]});
		expect(again!.id).not.toBe(first!.id);
	});

	it("keep going 3 on a list that gets shorter needs no answer, to the end", () => {
		const {desk, review} = approved();
		for (const open of [4, 3, 3, 3]) review(open);
		desk.answer(only(desk.open(), "stuck")[0]!.id, {kind: "keep_going", rounds: 3});
		for (const open of [3, 2, 2, 1, 0]) review(open);
		expect(desk.open()).toEqual([]);
	});

	it("remove takes the task out; its later rounds raise nothing", () => {
		const {desk, review} = approved();
		for (const open of [4, 3, 3, 3]) review(open);
		const [stuck] = only(desk.open(), "stuck");
		expect(desk.answer(stuck!.id, {kind: "remove"}).next).toEqual({do: "remove_task", task: 1});
		for (const open of [3, 3, 3, 3]) review(open);
		expect(desk.open()).toEqual([]);
	});

	it("reword a criterion: it is open again, the count starts over, and the next ask shows the new words", () => {
		const {desk, review} = approved();
		for (const open of [4, 3, 3, 3]) review(open);
		const [stuck] = only(desk.open(), "stuck");
		const reword = {
			kind: "reword",
			line: "t1.c2",
			when: "the suite runs twice",
			result: "both runs pass",
		} as const;
		expect(desk.answer(stuck!.id, reword).next).toEqual({
			do: "reopen",
			task: 1,
			line: "t1.c2",
			text: "When the suite runs twice, both runs pass",
		});
		review(4);
		review(4);
		expect(desk.open()).toEqual([]);
		review(4);
		const [again] = only(desk.open(), "stuck");
		expect(again!.criteria.find((c) => c.key === "t1.c2")?.text).toBe(
			"When the suite runs twice, both runs pass",
		);
	});
});

describe("rulings: four tickets experiment 88 sent to the owner", () => {
	const ruled = () => {
		const desk = book(RULINGS.map(({ruling}): Fact => ({type: "ruling_needed", ...ruling})));
		return desk;
	};

	it("each waits, oldest first, with its options", () => {
		const asks = only(ruled().open(), "ruling");
		expect(asks.map((a) => numberOf(a.ticket))).toEqual(["68", "163", "182", "640"]);
		expect(asks[0]!.options).toHaveLength(3);
	});

	it("each is answered with what really happened, and takes its branch", () => {
		const desk = ruled();
		const asks = only(desk.open(), "ruling");
		const nexts = RULINGS.map(({truth}, i) =>
			desk.answer(asks[i]!.id, {
				kind: "rule",
				answer: truth.said,
				rule: truth.rule,
				build: truth.build,
			}),
		).map((r) => r.next);
		expect(nexts).toEqual([
			{do: "ruled", record: false, plan: true},
			{do: "ruled", record: true, plan: false},
			{do: "ruled", record: false, plan: false},
			{do: "ruled", record: true, plan: true},
		]);
		expect(desk.open()).toEqual([]);
	});

	it.each([
		["lasting", false, {record: true, plan: false}],
		["one_off", false, {record: false, plan: false}],
		["one_off", true, {record: false, plan: true}],
		["lasting", true, {record: true, plan: true}],
	] as const)("demlik #68 ruled %s, build %s", (rule, build, want) => {
		const desk = ruled();
		const [a68] = only(desk.open(), "ruling");
		expect(desk.answer(a68!.id, {kind: "rule", answer: "(b)", rule, build}).next).toEqual({
			do: "ruled",
			...want,
		});
	});
});

describe("answers the core refuses, keeping nothing", () => {
	it.each([
		["an id no ask has", "plan:nowhere@1", {kind: "approve"}, "no ask has this id"],
		[
			"a stuck answer to a plan",
			"plan",
			{kind: "keep_going", rounds: 3},
			"a plan ask takes approve, change, no, not keep_going",
		],
		[
			"a change to a line the plan does not have",
			"plan",
			{kind: "change", line: "t9.c9", to: "x"},
			"the plan has no line t9.c9",
		],
		[
			"a ruling to a plan",
			"plan",
			{kind: "rule", answer: "x", rule: "one_off", build: false},
			"a plan ask takes approve, change, no, not rule",
		],
	] as const)("%s", (_, which, answer, why) => {
		const desk = book(planned());
		const id = which === "plan" ? desk.open()[0]!.id : which;
		const before = desk.entries.length;
		expect(desk.answer(id, answer).problem).toBe(why);
		expect(desk.entries).toHaveLength(before);
	});

	it("a second answer to the same ask", () => {
		const desk = book(planned());
		const [first] = desk.open();
		desk.answer(first!.id, {kind: "approve"});
		expect(desk.answer(first!.id, {kind: "no", why: "changed my mind"}).problem).toBe(
			"this ask is already answered",
		);
	});
});
