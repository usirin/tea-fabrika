import type {Check} from "../../primitives.ts";
import {type Criterion, criteriaOf, type Job, type PlanDraft, textOf} from "./plan.ts";

// The plan's Check: pure, the same plan gives the same problems. Each problem
// is a sentence the planner can act on, and goes back to it in the same
// conversation (the refine combo). An empty list passes.
//
// What it holds a plan to:
//   - every story says who, what and why, under an id of its own
//   - every story is served by a criterion, and every criterion serves a
//     story the plan has (that it serves at least one, the schema holds)
//   - at least one task, and each opens with the user's whole job on a
//     realistic fixture: more than two items, a second run, or a large input
//   - every criterion after the job is one claim: one sentence, one result
//   - no internal name in a criterion: no source path, no private function,
//     no internal type. A name a user meets is fine: a flag, a glob, a
//     package, and every name the published packages show their users
//     (./names.ts, handed over with the facts)
//   - every check says what it does
//   - every open question carries a lean
//
// It reads words, not meaning: it cannot tell an outcome from a recipe
// written in plain words, nor whether a question or a story is a real one.
// Experiment 86 measures those by reading.

/** Names in a criterion that are a user's words, though they look like code. */
const PLAIN = new Set([
	"TypeScript",
	"JavaScript",
	"GitHub",
	"OpenTelemetry",
	"GraphQL",
	"PowerShell",
	// Files every user of a package meets.
	"README.md",
	"CHANGELOG.md",
	"package.json",
]);

/** A token with a slash in it that is not a path: two plain words (`read/write`), or numbers (`2/6`). */
const notAPath = (token: string): boolean =>
	/^[a-z]+\/[a-z]+$/i.test(token) || !/[a-z]/i.test(token);

/**
 * A token whose shape is a user's whatever the names: a command-line flag
 * (`--layer-rules`), a glob a user writes (`**` and `*` in a path), a package
 * or one of its subpaths (`@demlik/tea/otel`).
 */
const userShaped = (token: string): boolean =>
	/^--?[a-z][\w-]*(?:=\S*)?$/i.test(token) ||
	token.includes("*") ||
	/^@[\w-]+\/[\w.-]+(?:\/[\w.-]+)*$/.test(token);

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

const strip = (raw: string) => raw.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, "");

/**
 * The internal names a text names: source paths and code identifiers a user
 * never meets, each with what it looks like. `names`: the names the published
 * packages show their users; those are left alone, as is anything shaped like
 * a flag, a glob or a package.
 */
export function identifiersIn(
	text: string,
	names: ReadonlySet<string> = new Set(),
): readonly string[] {
	// A folder is named the same with or without its slashes at either end.
	const users = (name: string) =>
		PLAIN.has(name) || names.has(name.replace(/^\/+|\/+$/g, "")) || userShaped(name);
	const found: string[] = [];
	// A single plain word in backticks is a code name; one a user meets is fine.
	for (const m of text.matchAll(/`([^`]*)`/g)) {
		const inner = (m[1] ?? "").trim();
		if (/^[a-z][a-z0-9-]*$/.test(inner) && !users(inner)) found.push(`${m[0]} (code in backticks)`);
	}
	const kept: string[] = [];
	for (const raw of text.replace(/`([^`]*)`/g, " $1 ").split(/\s+/)) {
		const token = strip(raw);
		if (token === "" || users(token)) continue;
		// Kept as written: `file(s)` stays a plural, not a call.
		kept.push(raw);
		if (token.includes("/") && !notAPath(token)) found.push(`${token} (a path)`);
	}
	const rest = kept.join(" ");
	const files = [...rest.matchAll(FILE)].map((m) => m[0]).filter((file) => !users(file));
	for (const file of files) found.push(`${file} (a file name)`);
	const left = files.reduce((text, file) => text.replaceAll(file, " "), rest);
	for (const [pattern, what] of SHAPES) {
		for (const m of left.matchAll(pattern)) {
			if (!users(m[0].replace(/\($/, ""))) found.push(`${m[0]} (${what})`);
		}
	}
	return [...new Set(found)];
}

/** A result that opens with an order to the builder is a step, not something anyone sees. */
const STEP =
	/^(?:add|change|rename|update|refactor|move|remove|delete|implement|use|replace|introduce|create|write|export)\b/i;

/** Why a criterion's parts do not read as a trigger and something seen. Empty: they do. */
function shapeProblems(c: Criterion): readonly string[] {
	const problems: string[] = [];
	const when = c.when.trim();
	const result = c.result.trim();
	if (when === "") problems.push("its `when` is empty: say what someone does, or what happens");
	if (result === "") problems.push("its `result` is empty: say what someone can observe");
	if (/^when\b/i.test(when))
		problems.push("its `when` starts with the word When; the sentence adds it, so leave it out");
	if (STEP.test(result))
		problems.push(
			"its `result` reads as a step to take, not a result someone sees: say what is true after",
		);
	return problems;
}

/** Why a criterion is not one claim, or not one someone sees. Empty: it is. */
export function claimProblems(c: Criterion): readonly string[] {
	const problems = [...shapeProblems(c)];
	const result = c.result.trim();
	if (/[.!?]\s+\S/.test(c.when.trim()) || /[.!?]\s+\S/.test(result))
		problems.push("it is more than one sentence: one criterion is one claim");
	if (result.includes(";"))
		problems.push("its `result` joins two results with ';': split it in two");
	if (/,\s+and\s|\band also\b|\bas well as\b|\band then\b/i.test(result))
		problems.push("its `result` joins two results: split it into two criteria");
	return problems;
}

/** A count above two, in digits or words. */
const MANY =
	/\b(?:[3-9]|[1-9]\d+|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?|several|many)\b/i;
/** A second run, or a large input. */
const AGAIN =
	/\b(?:again|twice|second|repeat(?:ed|s)?|re-?runs?|every run|each run|large|big|long|whole repo|real repo)\b/i;

/**
 * Why a job is not the user's whole job on a realistic fixture. Empty: it is.
 * A job may say more than one thing: only its shape is held, not one claim.
 */
export function jobProblems(job: Job): readonly string[] {
	const problems = [...shapeProblems(job)];
	const fixture = job.fixture.trim();
	const said = `${job.when} ${fixture}`;
	if (fixture === "")
		problems.push(
			"its `fixture` is empty: say the realistic case the whole job runs on: more than two items, a second run, or a large input",
		);
	else if (!MANY.test(said) && !AGAIN.test(said))
		problems.push(
			"its fixture is the smallest case: make it realistic, with more than two items, a second run, or a large input",
		);
	return problems;
}

const dodge = /^(?:none|n\/a|unsure|unknown|tbd|no lean|undecided|either)\.?$/i;

/** What the Check is handed besides the plan: the names a user meets. `null`: none were gathered. */
export type Known = {readonly names: readonly string[]} | null;

/** Each story's own problems, and the ids the plan has. */
function storyProblems(plan: PlanDraft): {readonly problems: string[]; readonly ids: Set<string>} {
	const problems: string[] = [];
	const ids = new Set<string>();
	plan.stories.forEach((story, i) => {
		const at = `Story ${i + 1} (${story.id === "" ? "no id" : `"${story.id}"`})`;
		if (!/^[a-z0-9][\w-]*$/i.test(story.id))
			problems.push(`${at} needs a short id with no spaces, like s${i + 1}.`);
		else if (ids.has(story.id)) problems.push(`${at} has the same id as an earlier story.`);
		ids.add(story.id);
		for (const part of ["who", "want", "why"] as const)
			if (story[part].trim() === "") problems.push(`${at}: its \`${part}\` is empty.`);
	});
	return {problems, ids};
}

/** Everything wrong with a plan, as sentences the planner can act on. None: it passes. */
export const planProblems: Check<PlanDraft, Known> = (plan, known) => {
	const names = new Set(known?.names ?? []);
	const problems: string[] = [];
	if (plan.summary.trim() === "") problems.push("The summary is empty.");
	const stories = storyProblems(plan);
	problems.push(...stories.problems);

	const served = new Set<string>();
	if (plan.tasks.length === 0)
		problems.push("The plan has no task. Every ticket has at least one.");
	// A task's criteria and the plan's own are held alike: the job first, then single claims.
	const claims = (
		at: string,
		owner: {readonly job: Job; readonly criteria: readonly Criterion[]},
	) =>
		criteriaOf<Criterion>(owner).forEach((c, i) => {
			const job = i === 0;
			const which = job
				? `${at}, its whole job ("${textOf(c)}")`
				: `${at}, criterion ${i} ("${textOf(c)}")`;
			for (const p of job ? jobProblems(owner.job) : claimProblems(c))
				problems.push(`${which}: ${p}.`);
			const text = job ? `${c.when} ${c.result} ${owner.job.fixture}` : `${c.when} ${c.result}`;
			const internal = identifiersIn(text, names);
			if (internal.length > 0)
				problems.push(
					`${which} names code a user never meets: ${internal.join(", ")}. Name things the way a user meets them (a command, a flag, a config key, a published name), and put internal files and names in pointers.`,
				);
			if (c.check.what.trim() === "")
				problems.push(`${which}: its check does not say what it does.`);
			const unknown = c.serves.filter((id) => !stories.ids.has(id));
			if (unknown.length > 0)
				problems.push(
					`${which} serves ${unknown.map((id) => `"${id}"`).join(", ")}, which no story has: name the id of a story in the plan.`,
				);
			for (const id of c.serves) served.add(id);
		});
	plan.tasks.forEach((task, t) => {
		if (task.title.trim() === "") problems.push(`Task ${t + 1} has no title.`);
		claims(`Task ${t + 1} ("${task.title}")`, task);
	});
	if (plan.goal !== undefined) claims("The plan's goal", plan.goal);
	else if (plan.tasks.length > 1)
		problems.push(
			"The plan has more than one task but no `goal`: say what a user sees only when every task is in, as a job and criteria of the whole plan. All the tasks land in one pull request, and the last review judges the goal there.",
		);
	plan.stories.forEach((story, i) => {
		if (story.id !== "" && !served.has(story.id))
			problems.push(
				`Story ${i + 1} ("${story.id}") has no criterion: write one that serves it, or drop the story if nobody needs it.`,
			);
	});

	plan.questions.forEach((q, i) => {
		const at = `Open question ${i + 1} ("${q.ask}")`;
		if (q.ask.trim() === "") problems.push(`Open question ${i + 1} asks nothing.`);
		if (q.lean.trim() === "" || dodge.test(q.lean.trim()))
			problems.push(`${at} has no lean. Say which way you lean, and why.`);
	});
	return problems;
};
