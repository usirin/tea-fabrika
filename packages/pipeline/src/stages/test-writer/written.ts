import {createDraft} from "@kampus/fabrika-old/agents/claude";
import {Schema} from "effect";
import {matcherFor} from "../../codeowners.ts";
import type {Check} from "../../primitives.ts";
import {PropertyId, type WriterBrief} from "./brief.ts";

// What the test writer hands back, and the pure Check on it. The answer
// holds the new files whole: code makes the commit from them, so nothing
// else the agent did in its box is kept.
//
// The Check is the box's wall in code: a new file only, only where
// `includes` matches, and one answer for each Property. Each problem goes
// back to the writer in the same conversation (the refine combo).

/** One new file, whole. */
export const File = Schema.Struct({path: Schema.String, text: Schema.String});
export type File = typeof File.Type;

/** For one Property: a test, by its file and its name, or why no test can check it. */
export const Answer = Schema.Union([
	Schema.Struct({
		property: PropertyId,
		kind: Schema.Literal("test"),
		file: Schema.String,
		name: Schema.String,
	}),
	Schema.Struct({property: PropertyId, kind: Schema.Literal("cannot"), why: Schema.String}),
]);
export type Answer = typeof Answer.Type;
export type TestAnswer = Extract<Answer, {readonly kind: "test"}>;

export const Written = Schema.Struct({files: Schema.Array(File), answers: Schema.Array(Answer)});
export type Written = typeof Written.Type;

/** `[test_writer] includes` when a repo's `fabrika.toml` leaves it out. */
export const DEFAULT_INCLUDES = ["**/*.test.ts", "fixtures/**"] as const;

/** The writer as a Draft: its Msgs are `tests_write_finished`, `tests_write_failed`, `tests_write_tool`. */
export const testsWrite = createDraft({name: "tests_write", output: Written});

/** The patterns as one test on a path, the way CODEOWNERS reads a row (../../codeowners.ts). */
export const includedBy = (includes: readonly string[]) => {
	const matchers = includes.map(matcherFor);
	return (path: string): boolean => matchers.some((m) => m.test(path));
};

const outside = (path: string) =>
	path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "");

/** The box's wall: each file new, plain, once, and where `includes` lets it be. Both jobs' Checks start here. */
export function fileProblems(
	files: readonly File[],
	brief: Pick<WriterBrief, "includes" | "taken">,
): readonly string[] {
	const included = includedBy(brief.includes);
	const taken = new Set(brief.taken);
	const seen = new Set<string>();
	return files.flatMap((f) => {
		if (outside(f.path)) return [`\`${f.path}\` is not a plain path inside the repository.`];
		if (seen.has(f.path)) return [`\`${f.path}\` is written twice. Hand each file back once.`];
		seen.add(f.path);
		if (taken.has(f.path))
			return [`\`${f.path}\` exists already. Never change a file that exists: add a new one.`];
		if (!included(f.path))
			return [
				`\`${f.path}\` is outside what you may write. A new file must match one of: ${brief.includes.join(", ")}.`,
			];
		return [];
	});
}

function answerProblems(written: Written, brief: WriterBrief): readonly string[] {
	const asked = new Set<string>(brief.properties.map((p) => p.id));
	const paths = new Set(written.files.map((f) => f.path));
	const count = new Map<string, number>();
	const each = written.answers.flatMap((a) => {
		count.set(a.property, (count.get(a.property) ?? 0) + 1);
		if (!asked.has(a.property)) return [`${a.property} is not a Property of this plan.`];
		if (a.kind === "test" && !paths.has(a.file))
			return [`${a.property}'s test is in \`${a.file}\`, which is not among the files you wrote.`];
		return [];
	});
	const once = brief.properties.flatMap((p) => {
		const n = count.get(p.id) ?? 0;
		if (n === 0) return [`${p.id} has no answer. Write its test, or say why none can check it.`];
		return n > 1 ? [`${p.id} has ${n} answers. Give it one.`] : [];
	});
	return [...each, ...once];
}

/** The Check: every problem with a draft, as sentences the writer can act on. None is a pass. */
export const problemsOf: Check<Written, WriterBrief> = (written, brief) => [
	...fileProblems(written.files, brief),
	...answerProblems(written, brief),
];
