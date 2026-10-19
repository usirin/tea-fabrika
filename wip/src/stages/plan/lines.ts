import {criteriaOf, type Plan, storyText, textOf} from "./plan.ts";

// A plan as lines: one per thing an owner can approve, change or name. Each
// line has a key, so an answer can point at it ("change t1.c2"), and a text,
// so two versions can be compared line by line.
//
//   summary            the summary
//   s1, s2, ...        a story, by its own id
//   t1                 task 1's title
//   t1.job             task 1's whole job, its fixture included
//   t1.c1, t1.c2, ...  task 1's single criteria, in order
//   q1, q2, ...        an open question, with its options and lean
//   p1, p2, ...        a pointer (it binds nobody)
//
// Criteria have no ids of their own, so their keys are places: `t1.c2` is the
// second one. A criterion put in before it moves every key after it. The
// change between two versions is found by text, not by key, so a moved line
// that says the same thing is not counted as changed.

export interface Line {
	readonly key: string;
	readonly text: string;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Every line of a plan, in reading order. Pure. */
export function linesOf(plan: Plan): readonly Line[] {
	return [
		{key: "summary", text: flat(plan.summary)},
		...plan.stories.map((s) => ({key: s.id, text: flat(storyText(s))})),
		...plan.tasks.flatMap((task, t) => {
			const at = `t${t + 1}`;
			const [job, ...rest] = criteriaOf(task);
			const said = (c: NonNullable<typeof job>) =>
				`${flat(textOf(c))}. (serves ${c.serves.join(", ")}; check, ${c.check.how}: ${flat(c.check.what)})`;
			return [
				{key: at, text: `${flat(task.title)} (ends in ${task.ends})`},
				...(job === undefined
					? []
					: [{key: `${at}.job`, text: `${said(job)} Fixture: ${flat(task.job.fixture)}`}]),
				...rest.map((c, i) => ({key: `${at}.c${i + 1}`, text: said(c)})),
			];
		}),
		...plan.questions.map((q, i) => ({
			key: `q${i + 1}`,
			text: `${flat(q.ask)} Options: ${q.options.map(flat).join(" / ") || "none"}. Lean: ${flat(q.lean)}`,
		})),
		...plan.pointers.map((p, i) => ({key: `p${i + 1}`, text: `${flat(p.at)}: ${flat(p.why)}`})),
	];
}

/** Whether `key` names a line of the plan. */
export const hasLine = (plan: Plan, key: string): boolean =>
	linesOf(plan).some((line) => line.key === key);

/** Whether `key` names a criterion (a job or a single one) of the plan. */
export const isCriterion = (plan: Plan, key: string): boolean =>
	/^t\d+\.(job|c\d+)$/.test(key) && hasLine(plan, key);

/** What changed from `before` to `after`: lines whose text is new, and lines whose text is gone. */
export interface Changed {
	readonly added: readonly Line[];
	readonly removed: readonly Line[];
	/** How many lines stayed as they were. */
	readonly same: number;
}

/** The change from one version of a plan to the next, by text. Pure. */
export function changedLines(before: Plan, after: Plan): Changed {
	const old = linesOf(before);
	const now = linesOf(after);
	const oldTexts = new Set(old.map((line) => line.text));
	const nowTexts = new Set(now.map((line) => line.text));
	return {
		added: now.filter((line) => !oldTexts.has(line.text)),
		removed: old.filter((line) => !nowTexts.has(line.text)),
		same: now.filter((line) => oldTexts.has(line.text)).length,
	};
}
