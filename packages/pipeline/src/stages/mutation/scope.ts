import {createHash} from "node:crypto";
import {Schema} from "effect";

// What the mutation step reads before it runs anything, and the pure Checks
// on it (docs/direction/promises-in-the-pipeline.md, step 5):
//
//   spansOf     which lines Stryker mutates: the source lines the build
//               added, and the lines each kept Property covers
//   changesOf   what in the diff changes the exam: a Stryker disable
//               comment it adds, or a file of the exam it touches (the skip
//               list). Each one asks the owner, unless the owner said yes
//
// No agent judges any of it. A disable comment is the one way out for a
// mutant no test can tell apart, and only the owner opens it.

/** Lines `from` to `to` of one file, both in, counted from 1. */
export const Span = Schema.Struct({
	file: Schema.String,
	from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	to: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type Span = typeof Span.Type;

/** One line the diff adds, as it reads at the head. */
export const Added = Schema.Struct({
	file: Schema.String,
	line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	text: Schema.String,
});
export type Added = typeof Added.Type;

/** What the build changed from the plan's base to its head. `files`: every path it touches, a deleted one too. */
export const Diff = Schema.Struct({files: Schema.Array(Schema.String), added: Schema.Array(Added)});
export type Diff = typeof Diff.Type;

/** A named piece of code a kept Property covers: the plan's `code` (../test-writer/brief.ts). */
export const CodeRef = Schema.Struct({file: Schema.String, name: Schema.String});
export type CodeRef = typeof CodeRef.Type;

/** The read: the diff, and where each kept Property's code stands at the head. */
export const Scope = Schema.Struct({diff: Diff, kept: Schema.Array(Span)});
export type Scope = typeof Scope.Type;

/** A change to the exam: a disable comment the diff adds, or a file of the exam it touches. */
export const Change = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("disable"),
		file: Schema.String,
		line: Schema.Int,
		text: Schema.String,
	}),
	/** `hash`: of the lines the diff adds to the file, so a yes holds for these contents only. */
	Schema.Struct({kind: Schema.Literal("exam"), file: Schema.String, hash: Schema.String}),
]);
export type Change = typeof Change.Type;

/** Stryker's own disable comment: `// Stryker disable next-line all: why`, or `disable all`. */
const DISABLE = /\bStryker\s+disable\b/i;

/** A file Stryker can mutate and a test is not: a test's own lines are not graded. */
export const isSource = (path: string): boolean =>
	/\.[cm]?[jt]sx?$/.test(path) &&
	!/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
	!/\.d\.[cm]?ts$/.test(path);

/** Spans of one file as few as they can be: sorted, with touching and overlapping ones joined. */
function joined(spans: readonly Span[]): readonly Span[] {
	const sorted = [...spans].sort((a, b) => a.from - b.from);
	const out: Span[] = [];
	for (const s of sorted) {
		const last = out.at(-1);
		if (last !== undefined && s.from <= last.to + 1)
			out[out.length - 1] = {...last, to: Math.max(last.to, s.to)};
		else out.push(s);
	}
	return out;
}

/** The lines to mutate: each source line the diff adds, and each kept Property's code. By file, then line. */
export function spansOf(scope: Scope): readonly Span[] {
	const all = [
		...scope.diff.added
			.filter((a) => isSource(a.file))
			.map((a) => ({file: a.file, from: a.line, to: a.line})),
		...scope.kept.filter((k) => isSource(k.file)),
	];
	const files = [...new Set(all.map((s) => s.file))].sort();
	return files.flatMap((f) => joined(all.filter((s) => s.file === f)));
}

/** What in the diff changes the exam. `exam`: the files that are part of it, such as the skip list. */
export function changesOf(diff: Diff, exam: readonly string[]): readonly Change[] {
	const disables: Change[] = diff.added
		.filter((a) => DISABLE.test(a.text))
		.map((a) => ({kind: "disable", file: a.file, line: a.line, text: a.text.trim()}));
	const touched: Change[] = exam
		.filter((f) => diff.files.includes(f))
		.map((file) => ({kind: "exam", file, hash: hashOf(diff, file)}));
	return [...disables, ...touched];
}

/** A short hash of the lines `diff` adds to `file`, in order, with where each sits. */
const hashOf = (diff: Diff, file: string): string =>
	createHash("sha256")
		.update(JSON.stringify(diff.added.filter((a) => a.file === file).map((a) => [a.line, a.text])))
		.digest("hex")
		.slice(0, 12);

/**
 * The same change. A disable comment is the same wherever its line moved
 * to, so a yes to it holds after an edit above it. A file of the exam is the
 * same only with the same contents: an edit after the yes asks again.
 */
const sameAs = (a: Change, b: Change): boolean => {
	if (a.kind === "disable" && b.kind === "disable") return a.file === b.file && a.text === b.text;
	if (a.kind === "exam" && b.kind === "exam") return a.file === b.file && a.hash === b.hash;
	return false;
};

/** The changes the owner has not said yes to. `allowed`: the ones the owner said yes to. */
export const unapproved = (
	changes: readonly Change[],
	allowed: readonly Change[],
): readonly Change[] => changes.filter((c) => !allowed.some((a) => sameAs(a, c)));
