import {apply, type Book, type CriteriaMsg, currentOf, EMPTY, nextId} from "../../criteria/book.ts";
import {
	type CriterionId,
	type Owner,
	PLAN,
	type QuestionId,
	questionId,
	type TaskId,
	taskId,
} from "../../ids.ts";
import {
	type Plan,
	type PlanCriterion,
	type PlanQuestion,
	type RevisedQuestion,
	type RevisedTask,
	type Revision,
	textOf,
} from "./plan.ts";

// Where a plan's tasks and criteria get their ids: the criteria book, and
// nothing else. Its questions get theirs from the plan's earlier versions.
//
//   withIds(EMPTY, draft)        // a first plan: t1, t2, ... and c1, c2, ...
//                                // and q1, q2, ... in reading order
//   withIds(book, revision, vs)  // a next version: a task that keeps a task
//                                // id the book has live criteria under keeps
//                                // it; a criterion that keeps a live id of
//                                // its task keeps it (reworded when its words
//                                // changed); a question that keeps an id the
//                                // last version `vs` asked keeps it; every
//                                // other one is new
//
// A question's id is never given twice in one plan: the next one is one more
// than the highest any earlier version gave, so a question a version settled
// does not come back under its id.
//
// A place in the plan is never read as an id. A task or criterion with no id,
// or one the book does not hold, is new and gets the next id, however alike
// its words are to one before. A task's id comes from the book too: every
// task has a job, so every task id ever given is the task of some criterion
// the book keeps, and the next one is one more than the highest. Removing is
// not done here: a criterion a version leaves out leaves the book only when
// that version is approved (../../asks/rules.ts), so an unapproved plan can
// only make a merge harder.

/** A plan under ids, the book after it, and the events that made the one from the other. */
export interface Numbered {
	readonly plan: Plan;
	readonly book: Book;
	readonly events: readonly CriteriaMsg[];
}

/** The number of the next task id: one more than any task a criterion of the book was ever under. The plan's own criteria are under no task. */
const nextTaskOf = (b: Book): number =>
	Math.max(
		0,
		...[...b.live, ...b.retired].flatMap((e) => (e.task === PLAN ? [] : [Number(e.task.slice(1))])),
	) + 1;

type RevisedClaim = RevisedTask["job"] | RevisedTask["criteria"][number];

/** The number of a question id: `q3` is 3. */
const numberOfQuestion = (id: QuestionId): number => Number(id.slice(1));

/**
 * A revision's questions under ids: one that keeps an id the last of
 * `versions` asked keeps it, once; every other one gets one more than the
 * highest any version gave. Pure.
 */
function questionsOf(
	questions: readonly RevisedQuestion[],
	versions: readonly Plan[],
): readonly PlanQuestion[] {
	const live = new Set(versions.at(-1)?.questions.map((q) => q.id) ?? []);
	const asked = versions.flatMap((v) => v.questions.map((q) => numberOfQuestion(q.id)));
	let next = Math.max(0, ...asked) + 1;
	const used = new Set<QuestionId>();
	return questions.map(({keeps, ...words}) => {
		const kept = keeps !== undefined && live.has(keeps) && !used.has(keeps) ? keeps : null;
		const id = kept ?? questionId(`q${next++}`);
		used.add(id);
		return {id, ...words};
	});
}

/**
 * Give a revision's tasks and criteria their ids from `book`, and its
 * questions theirs from the plan's earlier `versions`, oldest first. Pure: the
 * same book, versions and revision give the same ids.
 */
export function withIds(book: Book, revision: Revision, versions: readonly Plan[] = []): Numbered {
	let b = book;
	let nextTask = nextTaskOf(book);
	const events: CriteriaMsg[] = [];
	const used = new Set<CriterionId>();
	const usedTasks = new Set<TaskId>();
	const step = (msg: CriteriaMsg) => {
		if (msg.type === "reworded" && currentOf(b).some((x) => x.id === msg.id && x.text === msg.text))
			return;
		events.push(msg);
		b = apply(b, msg);
	};
	const placeTask = (keeps: TaskId | undefined): TaskId => {
		const kept =
			keeps !== undefined && !usedTasks.has(keeps) && b.live.some((e) => e.task === keeps)
				? keeps
				: null;
		const id = kept ?? taskId(`t${nextTask++}`);
		usedTasks.add(id);
		return id;
	};
	const place = <C extends RevisedClaim>(
		task: Owner,
		c: C,
	): Omit<C, "keeps"> & Pick<PlanCriterion, "id" | "version"> => {
		const text = textOf(c);
		const kept =
			c.keeps !== undefined &&
			!used.has(c.keeps) &&
			b.live.some((e) => e.id === c.keeps && e.task === task)
				? c.keeps
				: null;
		const id = kept ?? nextId(b);
		step(
			kept === null
				? {type: "added", task, text, by: "plan"}
				: {type: "reworded", id: kept, text, by: "plan"},
		);
		used.add(id);
		const version = currentOf(b).find((x) => x.id === id)?.version ?? 1;
		const {keeps: _hint, ...words} = c;
		return {...words, id, version};
	};
	const tasks = revision.tasks.map(({keeps, ...task}) => {
		const id = placeTask(keeps);
		const job = place(id, task.job);
		const criteria = task.criteria.map((c) => place(id, c));
		return {id, ...task, job, criteria};
	});
	// The plan's own criteria come after every task's, under `plan`: the book gives their ids
	// from the same counter, so a goal put in later moves no task's ids.
	const {goal: revisedGoal, ...rest} = revision;
	const goal =
		revisedGoal === undefined
			? {}
			: {
					goal: {
						job: place(PLAN, revisedGoal.job),
						criteria: revisedGoal.criteria.map((c) => place(PLAN, c)),
					},
				};
	const questions = questionsOf(revision.questions, versions);
	return {plan: {...rest, tasks, ...goal, questions}, book: b, events};
}

/**
 * A plan as the start of its next version: every task, criterion and
 * question keeps its id, and each criterion drops its version, which only the
 * book gives. Pure.
 */
export function revisionOf(plan: Plan): Revision {
	const bare = <C extends {readonly id: CriterionId; readonly version: number}>({
		id,
		version: _v,
		...rest
	}: C) => ({keeps: id, ...rest});
	const {goal, ...rest} = plan;
	return {
		...rest,
		tasks: plan.tasks.map(({id, job, criteria, ...task}) => ({
			keeps: id,
			...task,
			job: bare(job),
			criteria: criteria.map(bare),
		})),
		...(goal === undefined ? {} : {goal: {job: bare(goal.job), criteria: goal.criteria.map(bare)}}),
		questions: plan.questions.map(({id, ...words}) => ({keeps: id, ...words})),
	};
}

/** A first plan's ids: t1, t2, ..., c1, c2, ... and q1, q2, ... in reading order, as an empty book gives them. Pure. */
export const numbered = (draft: Revision): Plan => withIds(EMPTY, draft).plan;
