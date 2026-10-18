import type {Check} from "../../primitives.ts";
import {type Criterion, type Plan, textOf} from "./plan.ts";

// The plan's Check: pure, the same plan gives the same problems. Each problem
// is a sentence the planner can act on, and goes back to it in the same
// conversation (the refine combo). An empty list passes.
//
// What it holds a plan to:
//   - at least one task, and every task has at least one criterion
//   - every criterion is one claim: one sentence, one result
//   - no file path and no code identifier inside a criterion's text
//   - every check says what it does
//   - every open question carries a lean
//
// It reads words, not meaning: it cannot tell an outcome from a recipe
// written in plain words, nor whether a question is a real one. Experiment 86
// measures those by reading.

/** Names in a criterion that are a user's words, though they look like code. */
const PLAIN = new Set([
	"TypeScript",
	"JavaScript",
	"GitHub",
	"OpenTelemetry",
	"GraphQL",
	"PowerShell",
]);

/** A token with a slash in it that is not a path: a package (`@demlik/tea`), or two plain words (`read/write`). */
const notAPath = (token: string): boolean =>
	/^@[\w-]+\/[\w.-]+$/.test(token) || /^[a-z]+\/[a-z]+$/i.test(token);

const FILE = /\b[\w-]+\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|ya?ml|toml|css|html|sh)\b/g;

const SHAPES: readonly (readonly [RegExp, string])[] = [
	[/\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g, "a camelCase name"],
	[/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g, "a PascalCase name"],
	[/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, "a snake_case name"],
	[/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, "a CONSTANT name"],
	// `name(` is a call; `result(s)` is a plural.
	[/[A-Za-z_$][\w$]*\((?!s\))/g, "a call"],
	[/\b[a-z][\w$]+\.[a-z][\w$]+\b/g, "a member access"],
];

/**
 * The paths and code identifiers a text names, each with what it looks like.
 * A command-line flag (`--env-keys`) and a package name (`@demlik/tea`) are
 * how a user meets the tool, and are left alone.
 */
export function identifiersIn(text: string): readonly string[] {
	const found: string[] = [];
	for (const m of text.matchAll(/`[^`]*`/g)) found.push(`${m[0]} (code in backticks)`);
	const bare = text.replace(/`[^`]*`/g, " ");
	for (const raw of bare.split(/\s+/)) {
		const token = raw.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, "");
		if (token.includes("/") && !notAPath(token)) found.push(`${token} (a path)`);
	}
	const files = [...bare.matchAll(FILE)].map((m) => m[0]);
	for (const file of files) found.push(`${file} (a file name)`);
	const rest = files.reduce((text, file) => text.replaceAll(file, " "), bare);
	for (const [pattern, what] of SHAPES) {
		for (const m of rest.matchAll(pattern)) {
			if (!PLAIN.has(m[0])) found.push(`${m[0]} (${what})`);
		}
	}
	return [...new Set(found)];
}

/** A result that opens with an order to the builder is a step, not something anyone sees. */
const STEP =
	/^(?:add|change|rename|update|refactor|move|remove|delete|implement|use|replace|introduce|create|write|export)\b/i;

/** Why a criterion is not one claim. Empty: it is. */
export function claimProblems(c: Criterion): readonly string[] {
	const problems: string[] = [];
	const when = c.when.trim();
	const result = c.result.trim();
	if (when === "") problems.push("its `when` is empty: say what someone does, or what happens");
	if (result === "") problems.push("its `result` is empty: say what someone can observe");
	if (/^when\b/i.test(when))
		problems.push("its `when` starts with the word When; the sentence adds it, so leave it out");
	if (/[.!?]\s+\S/.test(when) || /[.!?]\s+\S/.test(result))
		problems.push("it is more than one sentence: one criterion is one claim");
	if (result.includes(";"))
		problems.push("its `result` joins two results with ';': split it in two");
	if (/,\s+and\s|\band also\b|\bas well as\b|\band then\b/i.test(result))
		problems.push("its `result` joins two results: split it into two criteria");
	if (STEP.test(result))
		problems.push(
			"its `result` reads as a step to take, not a result someone sees: say what is true after",
		);
	return problems;
}

const dodge = /^(?:none|n\/a|unsure|unknown|tbd|no lean|undecided|either)\.?$/i;

/** Everything wrong with a plan, as sentences the planner can act on. None: it passes. */
export const planProblems: Check<Plan, unknown> = (plan) => {
	const problems: string[] = [];
	if (plan.summary.trim() === "") problems.push("The summary is empty.");
	if (plan.tasks.length === 0)
		problems.push("The plan has no task. Every ticket has at least one.");
	plan.tasks.forEach((task, t) => {
		const at = `Task ${t + 1} ("${task.title}")`;
		if (task.title.trim() === "") problems.push(`Task ${t + 1} has no title.`);
		if (task.criteria.length === 0)
			problems.push(`${at} has no criterion. Every task has at least one.`);
		task.criteria.forEach((c, i) => {
			const which = `${at}, criterion ${i + 1} ("${textOf(c)}")`;
			for (const p of claimProblems(c)) problems.push(`${which}: ${p}.`);
			const names = identifiersIn(`${c.when} ${c.result}`);
			if (names.length > 0)
				problems.push(
					`${which} names code: ${names.join(", ")}. Say it in the words a user of the package meets it in, and put the file or name in pointers.`,
				);
			if (c.check.what.trim() === "")
				problems.push(`${which}: its check does not say what it does.`);
		});
	});
	plan.questions.forEach((q, i) => {
		const at = `Open question ${i + 1} ("${q.ask}")`;
		if (q.ask.trim() === "") problems.push(`Open question ${i + 1} asks nothing.`);
		if (q.lean.trim() === "" || dodge.test(q.lean.trim()))
			problems.push(`${at} has no lean. Say which way you lean, and why.`);
	});
	return problems;
};
