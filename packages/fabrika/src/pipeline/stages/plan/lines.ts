import type {CriterionId} from "../../ids.ts";
import {criteriaOf, type Plan, type PlanCriterion, storyText, textOf} from "./plan.ts";

// A plan as lines: one per thing an owner can approve, change or name. Each
// line has a key, so an answer can point at it ("change c3"), and a text,
// so two versions can be compared line by line.
//
//   summary            the summary
//   s1, s2, ...        a story, by its own id
//   t1, t2, ...        a task's title, by the id the criteria book gave it
//   c1, c2, ...        a criterion, its job first, by the id the criteria book
//                      gave it (../../criteria/book.ts)
//   q1, q2, ...        an open question, with its options and lean, by its id
//   p1, p2, ...        a pointer (it binds nobody)
//
// A story's, task's, criterion's and question's key is its id, so one put in
// before another moves no key, and a reworded one keeps its key. Pointers are
// values with no ids: their keys are places, and a change to them is found by
// text.

export interface Line {
	readonly key: string;
	readonly text: string;
	/** The criterion the line is, or `null`: it is not one. */
	readonly criterion: CriterionId | null;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const said = (c: PlanCriterion) =>
	`${flat(textOf(c))}. (serves ${c.serves.join(", ")}; check, ${c.check.how}: ${flat(c.check.what)})`;

const other = (key: string, text: string): Line => ({key, text, criterion: null});

/** Every line of a plan, in reading order. Pure. */
export function linesOf(plan: Plan): readonly Line[] {
	return [
		other("summary", flat(plan.summary)),
		...plan.stories.map((s) => other(s.id, flat(storyText(s)))),
		...plan.tasks.flatMap((task) => [
			other(task.id, `${flat(task.title)} (ends in ${task.ends})`),
			{
				key: task.job.id,
				text: `${said(task.job)} Fixture: ${flat(task.job.fixture)}`,
				criterion: task.job.id,
			},
			...task.criteria.map((c) => ({key: c.id, text: said(c), criterion: c.id})),
		]),
		...(plan.goal === undefined
			? []
			: [
					{
						key: plan.goal.job.id,
						text: `The whole plan: ${said(plan.goal.job)} Fixture: ${flat(plan.goal.job.fixture)}`,
						criterion: plan.goal.job.id,
					},
					...plan.goal.criteria.map((c) => ({
						key: c.id,
						text: `The whole plan: ${said(c)}`,
						criterion: c.id,
					})),
				]),
		...plan.questions.map((q) =>
			other(
				q.id,
				`${flat(q.ask)} Options: ${q.options.map(flat).join(" / ") || "none"}. Lean: ${flat(q.lean)}`,
			),
		),
		...plan.pointers.map((p, i) => other(`p${i + 1}`, `${flat(p.at)}: ${flat(p.why)}`)),
	];
}

/** Whether `key` names a line of the plan. */
export const hasLine = (plan: Plan, key: string): boolean =>
	linesOf(plan).some((line) => line.key === key);

/** Every criterion of a plan, its jobs among them, the plan's own last. */
export const criteriaIn = (plan: Plan): readonly PlanCriterion[] => [
	...plan.tasks.flatMap((task) => criteriaOf<PlanCriterion>(task)),
	...(plan.goal === undefined ? [] : criteriaOf<PlanCriterion>(plan.goal)),
];

/** A criterion's line in two versions: the same id, other words. */
export interface Reworded {
	readonly key: string;
	readonly was: string;
	readonly now: string;
}

/** What changed from `before` to `after`. */
export interface Changed {
	readonly added: readonly Line[];
	readonly removed: readonly Line[];
	/** Criteria in both, by id, whose words changed. */
	readonly reworded: readonly Reworded[];
	/** How many lines stayed as they were. */
	readonly same: number;
}

/**
 * The change from one version of a plan to the next. Pure. A criterion is
 * matched by its id: in both and said otherwise, it is reworded; in one only,
 * it is added or removed. Every other line is matched by its text.
 */
export function changedLines(before: Plan, after: Plan): Changed {
	const old = linesOf(before);
	const now = linesOf(after);
	const was = new Map(old.flatMap((l) => (l.criterion === null ? [] : [[l.criterion, l.text]])));
	const is = new Set(now.flatMap((l) => (l.criterion === null ? [] : [l.criterion])));
	const oldTexts = new Set(old.filter((l) => l.criterion === null).map((l) => l.text));
	const nowTexts = new Set(now.filter((l) => l.criterion === null).map((l) => l.text));
	const kept = (l: Line): boolean =>
		l.criterion === null ? oldTexts.has(l.text) : was.get(l.criterion) === l.text;
	return {
		added: now.filter((l) =>
			l.criterion === null ? !oldTexts.has(l.text) : !was.has(l.criterion),
		),
		removed: old.filter((l) =>
			l.criterion === null ? !nowTexts.has(l.text) : !is.has(l.criterion),
		),
		reworded: now.flatMap((l) => {
			const before = l.criterion === null ? undefined : was.get(l.criterion);
			return before === undefined || before === l.text
				? []
				: [{key: l.key, was: before, now: l.text}];
		}),
		same: now.filter(kept).length,
	};
}
