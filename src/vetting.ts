import {z} from "zod";
import {
	type ExampleCriterion,
	type ExistingTestCriterion,
	type Issue,
	type Snippet,
	snippetName,
	type TypeCriterion,
	testName,
} from "./issue.ts";
import {marksError, type TestNames} from "./tests.ts";

// Vetting an enricher's draft, by code. Every file a criterion names must be
// at HEAD, and every check is run on today's code in a clean copy before any
// builder sees it. An example that does not load, typecheck or run is broken;
// one that passes already shows nothing the change does; one whose assertion
// fails is what an example should be before the change. A type snippet must
// stand today the way it says it does: a guard holds already, one that shows
// the change fails, the right way round. An existing test may pass or fail
// today; it only has to be there and runnable. Running is the workspace's (it
// knows the repo and how its tests are written); reading the run and deciding
// what is wrong is here, and pure.

/**
 * How one example ran on today's code. `broken`: it did not load, did not
 * typecheck, or threw for a reason other than its assertion. `holds_already`:
 * it passes before any change. `fails`: its assertion fails, as it should
 * before the change is made.
 */
export const Verdict = z.enum(["broken", "holds_already", "fails"]);
export type Verdict = z.infer<typeof Verdict>;

export const ExampleVerdict = z.object({
	criterion: z.string(),
	call: z.string(),
	verdict: Verdict,
	/** The error, the type error, or the assertion's message: what the writer is shown. Empty when it passed. */
	detail: z.string(),
});
export type ExampleVerdict = z.infer<typeof ExampleVerdict>;

/**
 * How one type snippet typechecked on today's code. `holds`: it did what it
 * expects (it compiles; or each marked line is a type error and the rest
 * compiles). `fails`: it did not, in a way a change to the code can fix (a
 * type error in a `compiles` snippet; a marked line that compiles). `broken`:
 * no change makes it hold as written: it does not parse, names what it never
 * imports, declares what it never uses, or its imports do not typecheck.
 */
export const SnippetVerdict = z.object({
	criterion: z.string(),
	/** Counted from 1, as its check is named. */
	snippet: z.number(),
	verdict: z.enum(["holds", "fails", "broken"]),
	/** As the end of a sentence about the snippet: the type errors, or what a rejected line is rejected with. */
	detail: z.string(),
});
export type SnippetVerdict = z.infer<typeof SnippetVerdict>;

/** How an existing test ran on today's code. Passing and failing are both fine; `cannot_run` is a file the lane could not run either. */
export const TestVerdict = z.object({
	criterion: z.string(),
	test: z.string(),
	verdict: z.enum(["passes", "fails", "cannot_run"]),
	/** Why it cannot run, or the failing run cut short. Empty when it passed. */
	detail: z.string(),
});
export type TestVerdict = z.infer<typeof TestVerdict>;

/** A file a criterion names, and the criterion. */
export const Named = z.object({criterion: z.string(), file: z.string()});
export type Named = z.infer<typeof Named>;

/** What the workspace found about a draft: the named files not at HEAD, and how each example, type snippet and existing test ran. */
export const Vetted = z.object({
	missing: z.array(Named).readonly(),
	examples: z.array(ExampleVerdict).readonly(),
	snippets: z.array(SnippetVerdict).readonly(),
	tests: z.array(TestVerdict).readonly(),
});
export type Vetted = z.infer<typeof Vetted>;

/** The files one criterion names, each of which must be at HEAD. */
const filesNamed = (c: Issue["criteria"][number]): readonly string[] => {
	switch (c.kind) {
		case "example":
			return [c.file, ...c.uses.map((u) => u.file)];
		case "type":
			return [...c.files, ...c.uses.map((u) => u.file)];
		case "existing_test":
			return [c.test, ...c.files];
		case "unchecked":
			return c.files;
	}
};

/** Every file a criterion names: what its calls or snippets import from, an existing test, and the files a rule is about. */
export const namedBy = (issue: Issue): readonly Named[] =>
	issue.criteria.flatMap((c) => filesNamed(c).map((file) => ({criterion: c.id, file})));

/** The examples of an issue, each once, with the name of the test it becomes. */
export const examplesOf = (issue: Issue) =>
	issue.criteria
		.filter((c): c is ExampleCriterion => c.kind === "example")
		.flatMap((c) => c.examples.map((e) => ({criterion: c.id, call: e.call, name: testName(c, e)})));

/** The type snippets of an issue, with the name of the check each becomes and its number in its criterion, from 1. */
export const snippetsOf = (issue: Issue) =>
	issue.criteria
		.filter((c): c is TypeCriterion => c.kind === "type")
		.flatMap((c) =>
			c.snippets.map((s, i) => ({...s, criterion: c.id, snippet: i + 1, name: snippetName(c, i)})),
		);

/** The existing tests an issue names. */
export const existingTestsOf = (issue: Issue): readonly ExistingTestCriterion[] =>
	issue.criteria.filter((c): c is ExistingTestCriterion => c.kind === "existing_test");

/** One test's result in a report. `assertion`: the failure was its assertion, not anything else thrown. */
export type TestOutcome =
	| {readonly kind: "passed"}
	| {readonly kind: "failed"; readonly assertion: boolean; readonly error: string};

/** A report read back: each test that ran, by name, and why the file did not load, if it did not. */
export interface TestOutcomes {
	readonly tests: ReadonlyMap<string, TestOutcome>;
	readonly loadError: string | null;
}

/** A type error in a written file, by its line, counted from 1. The message starts with its code: `TS2345: …`. */
export interface TypeCheckError {
	readonly line: number;
	readonly message: string;
}

/**
 * Where each named block of a written file is: from the line naming it to the
 * line before the next one, counted from 1, `null` when no line names it.
 * `first` is the first named line; above it are the imports.
 */
function blocksOf(written: string, names: readonly string[]) {
	const lines = written.split("\n");
	const starts = names.map((name) => lines.findIndex((l) => l.includes(JSON.stringify(name))) + 1);
	const sorted = [...new Set(starts.filter((n) => n > 0))].sort((a, b) => a - b);
	const first = sorted[0] ?? lines.length + 1;
	const endOf = (start: number) => (sorted.find((n) => n > start) ?? lines.length + 1) - 1;
	const ranges = starts.map((from) => (from === 0 ? null : {from, to: endOf(from)}));
	return {lines, first, ranges};
}

const within = (range: {readonly from: number; readonly to: number}) => (t: TypeCheckError) =>
	t.line >= range.from && t.line <= range.to;

const messages = (errors: readonly TypeCheckError[]) => errors.map((t) => t.message).join("; ");

/**
 * Each example's verdict, from the test file as written, its run, and its type
 * errors. A test's lines run from the line naming it to the line before the
 * next one; a type error above the first test is in the imports, and breaks
 * every example.
 */
export function classify(
	issue: Issue,
	written: string,
	outcomes: TestOutcomes,
	typeErrors: readonly TypeCheckError[],
): ExampleVerdict[] {
	const examples = examplesOf(issue);
	const {first, ranges} = blocksOf(
		written,
		examples.map((e) => e.name),
	);
	const inImports = typeErrors.filter((t) => t.line < first);
	return examples.map((e, i): ExampleVerdict => {
		const base = {criterion: e.criterion, call: e.call};
		const range = ranges[i] ?? null;
		const own = range === null ? [] : typeErrors.filter(within(range));
		const typeTrouble = [...inImports, ...own];
		if (typeTrouble.length > 0) {
			return {...base, verdict: "broken", detail: `does not typecheck: ${messages(typeTrouble)}`};
		}
		const outcome = outcomes.tests.get(e.name);
		if (outcome === undefined) {
			return {
				...base,
				verdict: "broken",
				detail: `did not run: ${outcomes.loadError ?? "the report has no result for it"}`,
			};
		}
		if (outcome.kind === "passed") return {...base, verdict: "holds_already", detail: ""};
		return outcome.assertion
			? {...base, verdict: "fails", detail: outcome.error}
			: {...base, verdict: "broken", detail: `throws: ${outcome.error}`};
	});
}

/**
 * Type errors no change to the code fixes, so a snippet with one is broken
 * rather than failing: a syntax error (TS1xxx, but a `satisfies` that does not
 * hold, TS1360), a name or module not found (TS2304, TS2305, TS2307, TS2552,
 * TS2724), and a name declared or imported and never used (TS6133, TS6192,
 * TS6196, TS6198).
 */
const NO_TYPE_RULE = /^TS(1(?!360)\d{3}|2304|2305|2307|2552|2724|6133|6192|6196|6198):/;

/** TS2578, "Unused '@ts-expect-error' directive": the marked line compiles. */
const UNUSED_MARK = /^TS2578:/;

/**
 * A type snippets file typechecked: as written, and its bare copy, where each
 * `@ts-expect-error` is a plain comment so the errors it hid show.
 */
export interface SnippetsRun {
	readonly written: string;
	readonly errors: readonly TypeCheckError[];
	readonly bare: readonly TypeCheckError[];
}

/**
 * Each snippet's verdict on today's code, by the lines of its block. A type
 * error above the first block is in the imports, and breaks every snippet.
 * A `rejects` snippet holds when its marks hide a type error each; what each
 * marked line is rejected with is read from the bare copy, and a rejection no
 * change fixes (a name never imported, say) is no rule at all.
 */
export function classifySnippets(issue: Issue, run: SnippetsRun): SnippetVerdict[] {
	const snippets = snippetsOf(issue);
	const {lines, first, ranges} = blocksOf(
		run.written,
		snippets.map((s) => s.name),
	);
	const inImports = run.errors.filter((t) => t.line < first);
	return snippets.map((s, i): SnippetVerdict => {
		const base = {criterion: s.criterion, snippet: s.snippet};
		const range = ranges[i] ?? null;
		if (inImports.length > 0)
			return {
				...base,
				verdict: "broken",
				detail: `has imports that do not typecheck: ${messages(inImports)}`,
			};
		if (range === null) return {...base, verdict: "broken", detail: "was not written"};
		const own = run.errors.filter(within(range));
		const noRule = own.filter((t) => NO_TYPE_RULE.test(t.message));
		if (noRule.length > 0)
			return {
				...base,
				verdict: "broken",
				detail: `does not typecheck for a reason no change fixes: ${messages(noRule)}`,
			};
		if (s.expect === "compiles") {
			return own.length === 0
				? {...base, verdict: "holds", detail: "compiles"}
				: {...base, verdict: "fails", detail: `does not compile: ${messages(own)}`};
		}
		const other = own.filter((t) => !UNUSED_MARK.test(t.message));
		if (other.length > 0)
			return {
				...base,
				verdict: "broken",
				detail: `does not compile outside its marked lines: ${messages(other)}`,
			};
		if (own.length > 0)
			return {
				...base,
				verdict: "fails",
				detail: `has a marked line that compiles: ${messages(own)}`,
			};
		// The line under a mark, counted from 1: a mark on line n (index n - 1) marks line n + 1.
		const marked = new Set(
			lines.flatMap((l, at) =>
				at + 1 >= range.from && at + 1 <= range.to && marksError(l) ? [at + 2] : [],
			),
		);
		const rejected = run.bare.filter((t) => marked.has(t.line));
		return rejected.some((t) => NO_TYPE_RULE.test(t.message))
			? {
					...base,
					verdict: "broken",
					detail: `has a marked line rejected for a reason no change fixes: ${messages(rejected)}`,
				}
			: {...base, verdict: "holds", detail: `is rejected: ${messages(rejected)}`};
	});
}

/**
 * Whether each snippet holds as written, by its check's name, as the lane
 * reads it: no type error in its block, and none in the imports. A snippet
 * with no block in the file is in neither list: it did not run.
 */
export function snippetResults(
	issue: Issue,
	written: string,
	errors: readonly TypeCheckError[],
): TestNames {
	const snippets = snippetsOf(issue);
	const {first, ranges} = blocksOf(
		written,
		snippets.map((s) => s.name),
	);
	const inImports = errors.some((t) => t.line < first);
	const results = snippets.flatMap((s, i) => {
		const range = ranges[i] ?? null;
		return range === null ? [] : [{name: s.name, holds: !inImports && !errors.some(within(range))}];
	});
	return {
		passing: results.flatMap((r) => (r.holds ? [r.name] : [])),
		failing: results.flatMap((r) => (r.holds ? [] : [r.name])),
	};
}

const shown = (e: ExampleVerdict) => `Example \`${e.call}\` (criterion ${e.criterion})`;

const shownSnippet = (s: {readonly criterion: string; readonly snippet: number}) =>
	`Snippet ${s.snippet} of criterion ${s.criterion}`;

/** A detail as the middle of a sentence: a message's own last full stop is dropped. */
const clause = (detail: string) => detail.trim().replace(/\.$/, "");

/** What the writer is told about one example that will not do. */
function exampleProblem(e: ExampleVerdict): string | null {
	switch (e.verdict) {
		case "fails":
			return null;
		case "holds_already":
			return `${shown(e)} already holds on today's code, so it shows nothing the change does. If the rule is really about types, make it a type criterion; if today's code already follows it, leave it out.`;
		case "broken":
			return e.detail.startsWith("does not typecheck")
				? `${shown(e)} ${clause(e.detail)}. If that type error is the bug itself, the rule is about types: make it a type criterion, with a snippet that shows it. Otherwise rewrite the call so it typechecks before and after the change.`
				: `${shown(e)} is broken on today's code: it ${clause(e.detail)}. Rewrite it so it loads and runs and only its assertion can fail, or make the rule unchecked.`;
	}
}

/** What is wrong with a snippet's shape, before anything runs: its marks must fit what it expects. */
function shapeProblem(s: ReturnType<typeof snippetsOf>[number]): string | null {
	const marks = s.code.split("\n").some(marksError);
	if (s.expect === "compiles" && marks) {
		return `${shownSnippet(s)} expects to compile, and marks a line with @ts-expect-error. Make it a rejects snippet, or take the mark out.`;
	}
	return s.expect === "rejects" && !marks
		? `${shownSnippet(s)} expects a type error, and marks no line. Put \`// @ts-expect-error\` on the line above the one that must be rejected.`
		: null;
}

/** What the writer is told about one snippet that does not stand today the way it says. */
function snippetProblem(v: SnippetVerdict, snippet: Snippet): string | null {
	if (v.verdict === "broken")
		return `${shownSnippet(v)} ${clause(v.detail)}. Fix it so only the change decides whether it holds.`;
	if (v.verdict === snippet.today) return null;
	return snippet.today === "holds"
		? `${shownSnippet(v)} is marked as holding today, a guard, but on today's code it ${clause(v.detail)}. If it shows the change, mark it today: fails; otherwise fix it.`
		: `${shownSnippet(v)} is marked as failing today, but on today's code it already ${snippet.expect === "compiles" ? "compiles" : "is rejected"}, so it shows nothing the change does. If it is a limit the change must keep, mark it today: holds; otherwise leave it out.`;
}

/**
 * What is wrong with a draft, as plain sentences the writer can act on; none
 * means it passes. Every named file is at HEAD, criterion ids are unique, no
 * example is broken or holds already, every snippet stands today the way it
 * says, every existing test can run, and something fails today (an example, a
 * snippet that shows the change, or an existing test), unless nothing is
 * checked at all and every rule is unchecked.
 */
export function vetProblems(issue: Issue, vetted: Vetted): string[] {
	const ids = issue.criteria.map((c) => c.id);
	const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
	const ran = new Set(vetted.examples.map((e) => `${e.criterion}\n${e.call}`));
	const unrun = examplesOf(issue).filter((e) => !ran.has(`${e.criterion}\n${e.call}`));
	const snippets = snippetsOf(issue);
	const verdictOf = (s: (typeof snippets)[number]) =>
		vetted.snippets.find((v) => v.criterion === s.criterion && v.snippet === s.snippet);
	const missing = new Set(vetted.missing.map((m) => `${m.criterion}\n${m.file}`));
	const tests = existingTestsOf(issue).filter((c) => !missing.has(`${c.id}\n${c.test}`));
	const unrunTests = tests.filter(
		(c) => !vetted.tests.some((t) => t.criterion === c.id && t.test === c.test),
	);
	const checks = vetted.examples.length + unrun.length + snippets.length + tests.length;
	const shows =
		vetted.examples.some((e) => e.verdict === "fails") ||
		snippets.some((s) => s.today === "fails" && verdictOf(s)?.verdict === "fails") ||
		vetted.tests.some((t) => t.verdict === "fails");
	return [
		...twice.map(
			(id) => `Criterion id ${id} is used more than once. Give each criterion its own id.`,
		),
		...vetted.missing.map(
			(m) =>
				`Criterion ${m.criterion} names ${m.file}, which does not exist at HEAD. Name the file as it is in the repo.`,
		),
		...vetted.examples.flatMap((e) => exampleProblem(e) ?? []),
		...unrun.map(
			(e) => `Example \`${e.call}\` (criterion ${e.criterion}) was not run. Write it again.`,
		),
		...snippets.flatMap((s) => {
			const verdict = verdictOf(s);
			const problem =
				shapeProblem(s) ?? (verdict === undefined ? null : snippetProblem(verdict, s));
			return (
				problem ??
				(verdict === undefined ? [`${shownSnippet(s)} was not checked. Write it again.`] : [])
			);
		}),
		...vetted.tests.flatMap((t) =>
			t.verdict === "cannot_run"
				? [
						`Criterion ${t.criterion} names the test ${t.test}, which cannot be run here: ${clause(t.detail)}. Name a test the lane can run, or make the rule unchecked.`,
					]
				: [],
		),
		...unrunTests.map((c) => `The test ${c.test} (criterion ${c.id}) was not run. Name it again.`),
		...(checks > 0 && !shows
			? [
					"Nothing fails on today's code: no example, no snippet marked to fail today, no existing test. So nothing shows what the change does.",
				]
			: []),
	];
}
