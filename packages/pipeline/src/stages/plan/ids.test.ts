import {describe, expect, it} from "vitest";
import {EMPTY} from "../../criteria/book.ts";
import {
	type CriterionId,
	criterionId,
	questionId,
	storyId,
	type TaskId,
	taskId,
} from "../../ids.ts";
import {keptFrom, numbered, revisionOf, withIds} from "./ids.ts";
import {changedLines, linesOf} from "./lines.ts";
import type {Plan, RevisedTask, Revision} from "./plan.ts";
import {planMarkdown} from "./render.ts";

const S1 = storyId("s1");
const claim = (when: string): RevisedTask["criteria"][number] => ({
	when,
	result: `${when} shows`,
	check: {how: "test", what: "a test reads it"},
	serves: [S1],
});
const job = (when: string) => ({...claim(when), fixture: "three runs, each twice"});

/** A first version with tasks of `n` single claims each, after its job, and no ids. */
const draft = (...tasks: readonly (readonly string[])[]): Revision => ({
	summary: "s",
	stories: [{id: S1, who: "a host", want: "it", why: "it helps"}],
	tasks: tasks.map((claims, t) => ({
		title: `task ${t + 1}`,
		ends: "pr",
		job: job(`job ${t + 1}`),
		criteria: claims.map(claim),
	})),
	pointers: [],
	questions: [],
});

/** A plan's next version, with `edit` applied to each task. */
const nextOf = (plan: Plan, edit: (task: RevisedTask) => RevisedTask): Revision => {
	const revision = revisionOf(plan);
	return {...revision, tasks: revision.tasks.map(edit)};
};

const idsOf = (plan: Plan) =>
	plan.tasks.flatMap((t) => [t.job, ...t.criteria].map((c) => `${c.id} v${c.version} ${c.when}`));

describe("a plan's criterion ids", () => {
	it("come from the book in reading order, the same on every run", () => {
		const plan = numbered(draft(["a", "b", "c"], ["d"]));
		expect(idsOf(plan)).toEqual([
			"c1 v1 job 1",
			"c2 v1 a",
			"c3 v1 b",
			"c4 v1 c",
			"c5 v1 job 2",
			"c6 v1 d",
		]);
		expect(numbered(draft(["a", "b", "c"], ["d"]))).toEqual(plan);
	});

	it("stay with their criteria when a next version puts new ones before them", () => {
		const first = withIds(EMPTY, draft(["a", "b", "c"]));
		const [task] = first.plan.tasks;
		if (task === undefined) throw new Error("no task");
		// A next version: a new claim at the top, one reworded, the rest as they were, ids kept.
		const next = nextOf(first.plan, (t) => ({
			...t,
			criteria: [
				claim("new"),
				...t.criteria.map((c) => (c.when === "b" ? {...c, result: "b says more"} : c)),
			],
		}));
		const again = withIds(first.book, next);
		expect(idsOf(again.plan)).toEqual([
			`${task.job.id} v1 job 1`,
			"c5 v1 new",
			`${task.criteria[0]?.id} v1 a`,
			`${task.criteria[1]?.id} v2 b`,
			`${task.criteria[2]?.id} v1 c`,
		]);
		expect(again.events.map((e) => e.type)).toEqual(["added", "reworded"]);
	});

	it("never come from a place: a draft's criteria are new, however alike their words", () => {
		const first = numbered(draft(["a", "b"]));
		const book = withIds(EMPTY, first).book;
		// The same words, written again with no ids: every one is added, none takes an old id.
		const again = withIds(book, draft(["a", "b"]));
		expect(idsOf(again.plan)).toEqual(["c4 v1 job 1", "c5 v1 a", "c6 v1 b"]);
		// An id the task does not hold is not kept either.
		const stray = withIds(
			book,
			nextOf(first, (t) => ({...t, criteria: [{...claim("a"), keeps: criterionId("c99")}]})),
		);
		expect(idsOf(stray.plan).at(-1)).toBe("c4 v1 a");
	});
});

describe("a plan's task ids", () => {
	it("are t1, t2, ... in reading order, from the same book, the same on every run", () => {
		const plan = numbered(draft(["a"], ["b"], []));
		expect(plan.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
		expect(numbered(draft(["a"], ["b"], []))).toEqual(plan);
	});

	it("stay with their tasks when a next version puts a new task before them", () => {
		const first = withIds(EMPTY, draft(["a"], ["b"]));
		const revision = revisionOf(first.plan);
		const added = draft(["new"]).tasks[0];
		if (added === undefined) throw new Error("no task");
		const again = withIds(first.book, {...revision, tasks: [added, ...revision.tasks]});
		expect(again.plan.tasks.map((t) => `${t.id} ${t.title}`)).toEqual([
			"t3 task 1",
			"t1 task 1",
			"t2 task 2",
		]);
		// Each kept task keeps its criteria too.
		expect(again.plan.tasks[1]?.criteria.map((c) => c.id)).toEqual(
			first.plan.tasks[0]?.criteria.map((c) => c.id),
		);
	});

	it("are never kept for a task the book holds nothing under, or twice in one version", () => {
		const first = withIds(EMPTY, draft(["a"]));
		const revision = revisionOf(first.plan);
		const [task] = revision.tasks;
		if (task === undefined) throw new Error("no task");
		const stray = withIds(first.book, {...revision, tasks: [{...task, keeps: taskId("t9")}]});
		expect(stray.plan.tasks.map((t) => t.id)).toEqual(["t2"]);
		const twice = withIds(first.book, {...revision, tasks: [task, task]});
		expect(twice.plan.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
	});

	it("are not criterion ids, though both are text", () => {
		const [task] = numbered(draft(["a"])).tasks;
		// @ts-expect-error a task's id is not a criterion's
		const wrong: CriterionId | undefined = task?.id;
		const right: TaskId | undefined = task?.id;
		expect([wrong, right]).toEqual(["t1", "t1"]);
	});
});

describe("a plan's question ids", () => {
	const ask = (text: string) => ({ask: text, options: ["yes", "no"], lean: "no", why: "smaller"});
	const asking = (...asks: readonly string[]): Revision => ({
		...draft(["a"]),
		questions: asks.map(ask),
	});
	const said = (plan: Plan) => plan.questions.map((q) => `${q.id} ${q.ask}`);

	it("are q1, q2, ... in reading order, kept by a next version, and never given twice", () => {
		// Version 1 asks three; version 2 puts a new one first, settles q3, and keeps q1 and q2.
		const v1 = withIds(EMPTY, asking("a new export?", "a new flag?", "rename it?"));
		expect(said(v1.plan)).toEqual(["q1 a new export?", "q2 a new flag?", "q3 rename it?"]);
		const [q1, q2] = revisionOf(v1.plan).questions;
		const v2 = withIds(
			v1.book,
			{...revisionOf(v1.plan), questions: [ask("a second run?"), q2!, q1!]},
			[v1.plan],
		);
		expect(said(v2.plan)).toEqual(["q4 a second run?", "q2 a new flag?", "q1 a new export?"]);
		// Version 3 asks the settled one again, keeping its old id: it is new, under q5.
		const v3 = withIds(
			v2.book,
			{
				...revisionOf(v2.plan),
				questions: [
					...revisionOf(v2.plan).questions,
					{...ask("rename it?"), keeps: questionId("q3")},
				],
			},
			[v1.plan, v2.plan],
		);
		expect(said(v3.plan).at(-1)).toBe("q5 rename it?");
		// The same versions give the same ids.
		expect(withIds(EMPTY, asking("a new export?", "a new flag?", "rename it?")).plan).toEqual(
			v1.plan,
		);
	});

	it("name a question's line, so a question put in first moves no key", () => {
		const v1 = numbered(asking("a new export?", "a new flag?"));
		const v2 = withIds(
			withIds(EMPTY, v1).book,
			{...revisionOf(v1), questions: [ask("a second run?"), ...revisionOf(v1).questions]},
			[v1],
		).plan;
		const change = changedLines(v1, v2);
		expect(change.added.map((l) => l.key)).toEqual(["q3"]);
		expect(change.removed).toEqual([]);
	});
});

describe("a plan's lines", () => {
	const plan = numbered(draft(["a", "b"]));

	it("name a criterion and a task by its id", () => {
		expect(linesOf(plan).map((l) => l.key)).toEqual(["summary", "s1", "t1", "c1", "c2", "c3"]);
	});

	it("tell a reworded criterion from a new one by id, not by where it stands", () => {
		const book = withIds(EMPTY, plan).book;
		const next = withIds(
			book,
			nextOf(plan, (t) => ({
				...t,
				criteria: [
					claim("z"),
					...t.criteria.map((c) => (c.when === "b" ? {...c, result: "b2"} : c)),
				],
			})),
		).plan;
		const change = changedLines(plan, next);
		expect(change.added.map((l) => l.key)).toEqual(["c4"]);
		expect(change.reworded.map((l) => l.key)).toEqual(["c3"]);
		expect(change.removed).toEqual([]);
	});

	it("render each criterion's box with its id and version", () => {
		const view = planMarkdown(plan, "x");
		expect(view).toContain("- [ ] `c1 v1` When job 1, job 1 shows");
		expect(view).toContain("- [ ] `c3 v1` When b, b shows");
		// @ts-expect-error a revision has no ids, so it cannot be rendered as a ticket's criteria
		planMarkdown(draft(["a"]), "x");
	});
});

describe("a plan's own criteria (its goal)", () => {
	const two = (): Revision => ({
		...draft(["a"], ["b"]),
		goal: {job: job("whole"), criteria: [claim("all in")]},
	});

	it("sit in the book under the plan, after every task's, from the same counter", () => {
		const {plan, book} = withIds(EMPTY, two());
		expect(plan.goal?.job.id).toBe(criterionId("c5"));
		expect(plan.goal?.criteria.map((c) => c.id)).toEqual([criterionId("c6")]);
		expect(book.live.filter((e) => e.task === "plan").map((e) => e.id)).toEqual(["c5", "c6"]);
	});

	it("never move a task id: the next task after a goal is still one more than the last task", () => {
		const {plan, book} = withIds(EMPTY, two());
		const revision = revisionOf(plan);
		const [third] = draft(["c"]).tasks;
		if (third === undefined) throw new Error("no task");
		const next = withIds(
			book,
			{...revision, tasks: [...revision.tasks, {...third, title: "three"}]},
			[plan],
		).plan;
		expect(next.tasks.map((t) => t.id)).toEqual([taskId("t1"), taskId("t2"), taskId("t3")]);
		expect(next.goal?.job.id).toBe(criterionId("c5"));
	});

	it("are kept and reworded by id across versions, like a task's", () => {
		const {plan, book} = withIds(EMPTY, two());
		const revision = revisionOf(plan);
		const goal = revision.goal;
		if (goal === undefined) throw new Error("no goal");
		const next = withIds(
			book,
			{...revision, goal: {...goal, criteria: goal.criteria.map((c) => ({...c, result: "new"}))}},
			[plan],
		).plan;
		expect(next.goal?.criteria.map((c) => `${c.id} v${c.version}`)).toEqual(["c6 v2"]);
	});

	it("are lines of the plan, and rendered under the whole plan", () => {
		const {plan} = withIds(EMPTY, two());
		expect(linesOf(plan).map((l) => l.key)).toContain("c5");
		expect(planMarkdown(plan, "x")).toContain("## The whole plan");
	});
});

describe("a draft planned again, read against the version before it", () => {
	it("keeps what it kept, by title and words; the rest is new, and the ids follow", () => {
		const v1 = draft(["a", "b"], ["c"]);
		const {plan, book} = withIds(EMPTY, {
			...v1,
			goal: {job: job("whole"), criteria: [claim("all")]},
		});
		// The planner, asked again with a ticket folded in: no ids. Task 1's title and one claim
		// differ only in case (kept; the claim reworded), task 2 gained a claim, a third task is new,
		// and the goal's job says more (kept, reworded).
		const v2 = draft(["A", "b"], ["c", "e"], ["f"]);
		const again = keptFrom(plan, {
			...v2,
			tasks: v2.tasks.map((t, i) => (i === 0 ? {...t, title: "Task 1"} : t)),
			goal: {job: {...job("whole"), result: "all ships"}, criteria: [claim("all")]},
		});
		const next = withIds(book, again, [plan]).plan;
		expect(next.tasks.map((t) => t.id)).toEqual([taskId("t1"), taskId("t2"), taskId("t3")]);
		expect(idsOf(next)).toEqual([
			"c1 v1 job 1",
			"c2 v2 A",
			"c3 v1 b",
			"c4 v1 job 2",
			"c5 v1 c",
			"c8 v1 e",
			"c9 v1 job 3",
			"c10 v1 f",
		]);
		expect(next.goal?.job).toMatchObject({id: criterionId("c6"), version: 2});
		expect(next.goal?.criteria.map((c) => c.id)).toEqual([criterionId("c7")]);
	});
});
