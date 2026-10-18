import {type Plan, sizeOf, textOf} from "./plan.ts";

// The markdown view of a plan, for people. Made from the data and never read
// back (docs/direction/data-first-markdown-is-a-view.md). A person marks what
// they would change on the view; a change they want is made to the data.

const ENDS = {pr: "ends in a pull request", answer: "ends in written findings"} as const;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Text as inline code, in a fence longer than any run of backticks inside it. */
const code = (text: string) => {
	const fence = "`".repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((r) => r[0].length)) + 1);
	const pad = fence.length > 1 ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
};

/** The plan as markdown. `title`: what the heading calls the ticket. Pure. */
export function planMarkdown(plan: Plan, title: string): string {
	const size = sizeOf(plan);
	const tasks = plan.tasks.flatMap((task, t) => [
		`## Task ${t + 1}: ${flat(task.title)}`,
		"",
		`It ${ENDS[task.ends]}.`,
		"",
		...task.criteria.map(
			(c) => `- [ ] ${flat(textOf(c))}.  \n  _Check (${c.check.how}): ${flat(c.check.what)}_`,
		),
		"",
	]);
	const questions =
		plan.questions.length === 0
			? ["None."]
			: plan.questions.flatMap((q, i) => [
					`${i + 1}. ${flat(q.ask)}`,
					...(q.options.length === 0 ? [] : [`   - Options: ${q.options.map(flat).join(" / ")}`]),
					`   - Lean: ${flat(q.lean)}`,
					`   - Why: ${flat(q.why)}`,
				]);
	const pointers =
		plan.pointers.length === 0
			? ["None."]
			: plan.pointers.map((p) => `- ${code(flat(p.at))}: ${flat(p.why)}`);
	return [
		`# Plan: ${flat(title)}`,
		"",
		flat(plan.summary),
		"",
		`Size: ${size.tasks} task${size.tasks === 1 ? "" : "s"}, ${size.criteria} criteri${size.criteria === 1 ? "on" : "a"}, ${size.words} words.`,
		"",
		...tasks,
		"## Open questions",
		"",
		...questions,
		"",
		"## Pointers (they bind nobody)",
		"",
		...pointers,
		"",
	].join("\n");
}
