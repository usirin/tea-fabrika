import {describe, expect, it} from "vitest";
import {criterionId, EMPTY} from "../../criteria/book.ts";
import {numbered, withIds} from "./ids.ts";
import {changedLines, linesOf} from "./lines.ts";
import type {Criterion, Plan, PlanDraft, Revision} from "./plan.ts";
import {planMarkdown} from "./render.ts";

const claim = (when: string): Criterion => ({
	when,
	result: `${when} shows`,
	check: {how: "test", what: "a test reads it"},
	serves: ["s1"],
});
const job = (when: string) => ({...claim(when), fixture: "three runs, each twice"});

/** A draft with tasks of `n` single claims each, after its job. */
const draft = (...tasks: readonly (readonly string[])[]): PlanDraft => ({
	summary: "s",
	stories: [{id: "s1", who: "a host", want: "it", why: "it helps"}],
	tasks: tasks.map((claims, t) => ({
		title: `task ${t + 1}`,
		ends: "pr",
		job: job(`job ${t + 1}`),
		criteria: claims.map(claim),
	})),
	pointers: [],
	questions: [],
});

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
		const plan = first.plan;
		const [task] = plan.tasks;
		if (task === undefined) throw new Error("no task");
		// A next version: a new claim at the top, one reworded, the rest as they were, ids kept.
		const next: Revision = {
			...plan,
			tasks: [
				{
					...task,
					criteria: [
						claim("new"),
						...task.criteria.map((c) => (c.when === "b" ? {...c, result: "b says more"} : c)),
					],
				},
			],
		};
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
		const [task] = first.tasks;
		const book = withIds(EMPTY, first).book;
		// The same words, written again with no ids: every one is added, none takes an old id.
		const again = withIds(book, draft(["a", "b"]));
		expect(idsOf(again.plan)).toEqual(["c4 v1 job 1", "c5 v1 a", "c6 v1 b"]);
		// An id the task does not hold is not kept either.
		const stray = withIds(book, {
			...first,
			tasks: [{...task!, criteria: [{...claim("a"), id: criterionId("c99")}]}],
		});
		expect(idsOf(stray.plan).at(-1)).toBe("c4 v1 a");
	});
});

describe("a plan's lines", () => {
	const plan = numbered(draft(["a", "b"]));

	it("name a criterion by its id, and a task by its place", () => {
		expect(linesOf(plan).map((l) => l.key)).toEqual(["summary", "s1", "t1", "c1", "c2", "c3"]);
	});

	it("tell a reworded criterion from a new one by id, not by where it stands", () => {
		const [task] = plan.tasks;
		const book = withIds(EMPTY, plan).book;
		const next = withIds(book, {
			...plan,
			tasks: [
				{
					...task!,
					criteria: [
						claim("z"),
						...task!.criteria.map((c) => (c.when === "b" ? {...c, result: "b2"} : c)),
					],
				},
			],
		}).plan;
		const change = changedLines(plan, next);
		expect(change.added.map((l) => l.key)).toEqual(["c4"]);
		expect(change.reworded.map((l) => l.key)).toEqual(["c3"]);
		expect(change.removed).toEqual([]);
	});

	it("render each criterion's box with its id and version", () => {
		const view = planMarkdown(plan, "x");
		expect(view).toContain("- [ ] `c1 v1` When job 1, job 1 shows");
		expect(view).toContain("- [ ] `c3 v1` When b, b shows");
		// @ts-expect-error a draft has no ids, so it cannot be rendered as a ticket's criteria
		planMarkdown(draft(["a"]), "x");
	});
});
