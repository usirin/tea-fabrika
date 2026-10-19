import {
	apply,
	type Book,
	type CriteriaMsg,
	type CriterionId,
	currentOf,
	EMPTY,
	nextId,
} from "../../criteria/book.ts";
import {type Plan, type PlanCriterion, type Revision, textOf} from "./plan.ts";

// Where a plan's criteria get their ids: the criteria book, and nothing else.
//
//   withIds(EMPTY, draft)        // a first plan: c1, c2, ... in reading order
//   withIds(book, revision)      // a next version: a criterion that names a
//                                // live id of its task keeps it (reworded when
//                                // its words changed); every other one is new
//
// A place in the plan is never read as an id. A criterion with no id, or one
// the book does not hold for that task, is added and gets the next id, however
// alike its words are to one before. Removing is not done here: a criterion a
// version leaves out leaves the book only when that version is approved
// (../../asks/rules.ts), so an unapproved plan can only make a merge harder.

/** A plan under ids, the book after it, and the events that made the one from the other. */
export interface Numbered {
	readonly plan: Plan;
	readonly book: Book;
	readonly events: readonly CriteriaMsg[];
}

/** Give a revision's criteria their ids from `book`. Pure: the same book and revision give the same ids. */
export function withIds(book: Book, revision: Revision): Numbered {
	let b = book;
	const events: CriteriaMsg[] = [];
	const used = new Set<CriterionId>();
	const step = (msg: CriteriaMsg) => {
		if (msg.type === "reworded" && currentOf(b).some((x) => x.id === msg.id && x.text === msg.text))
			return;
		events.push(msg);
		b = apply(b, msg);
	};
	const place = <C extends Revision["tasks"][number]["criteria"][number]>(
		task: number,
		c: C,
	): Omit<C, "id"> & Pick<PlanCriterion, "id" | "version"> => {
		const text = textOf(c);
		const kept =
			c.id !== undefined && !used.has(c.id) && b.live.some((e) => e.id === c.id && e.task === task)
				? c.id
				: null;
		const id = kept ?? nextId(b);
		step(
			kept === null
				? {type: "added", task, text, by: "plan"}
				: {type: "reworded", id: kept, text, by: "plan"},
		);
		used.add(id);
		const version = currentOf(b).find((x) => x.id === id)?.version ?? 1;
		const {id: _hint, ...words} = c;
		return {...words, id, version};
	};
	const tasks = revision.tasks.map((task, t) => {
		const job = place(t + 1, task.job);
		const criteria = task.criteria.map((c) => place(t + 1, c));
		return {...task, job, criteria};
	});
	return {plan: {...revision, tasks}, book: b, events};
}

/**
 * A plan as the start of its next version: every criterion keeps its id, and
 * drops its version, which only the book gives. Pure.
 */
export function revisionOf(plan: Plan): Revision {
	const bare = <C extends {readonly version: number}>({version: _v, ...rest}: C) => rest;
	return {
		...plan,
		tasks: plan.tasks.map((task) => ({
			...task,
			job: bare(task.job),
			criteria: task.criteria.map(bare),
		})),
	};
}

/** A first plan's ids: c1, c2, ... in reading order, as an empty book gives them. Pure. */
export const numbered = (draft: Revision): Plan => withIds(EMPTY, draft).plan;
