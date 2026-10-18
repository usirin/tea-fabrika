import {z} from "zod";

/** One worked example: a JavaScript call and the exact value it returns, as a literal. */
export const Example = z.object({call: z.string(), result: z.string()});
export type Example = z.infer<typeof Example>;

/** An exported name and the file it comes from, relative to the repo root. */
export const Import = z.object({name: z.string(), file: z.string()});
export type Import = z.infer<typeof Import>;

/**
 * What an unchecked rule is about, so the check for its kind can find it once
 * one exists: a type or a signature (the compiler's), a doc page, or anything else.
 */
export const UncheckedAbout = z.enum(["type", "doc", "other"]);
export type UncheckedAbout = z.infer<typeof UncheckedAbout>;

/**
 * One TypeScript snippet a type rule is shown by. `compiles`: the code must
 * typecheck. `rejects`: the line under each `// @ts-expect-error` must be a
 * type error, and the rest must compile, the idiom of a repo's `.test-d.ts`
 * files. `today` is how it stands before the change: `holds` for a guard, a
 * limit the change must keep (a call that must stay rejected); `fails` for one
 * that shows the change. After the change every snippet must hold.
 */
export const Snippet = z.object({
	expect: z.enum(["compiles", "rejects"]),
	today: z.enum(["holds", "fails"]),
	code: z.string(),
});
export type Snippet = z.infer<typeof Snippet>;

/**
 * One acceptance criterion, as data, and what checks it. An `example` is a
 * rule and the calls that show it; a `type` rule is shown by snippets the
 * compiler checks; an `existing_test` is a test file in the repo that must
 * pass after the change, such as a doc page's twin. Code turns each into a
 * check, so no model decides whether it is met. Any other rule is `unchecked`
 * until a check for its kind exists, and says what it is `about` and why
 * nothing can show it.
 */
export const Criterion = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("example"),
		id: z.string(),
		rule: z.string(),
		/** The file the calls import from, relative to the repo root, and the export they call. */
		file: z.string(),
		name: z.string(),
		/**
		 * Every other name the calls use, such as the library's own constructor
		 * for a value the call takes. Imported beside `name`; not the files the
		 * issue is about.
		 */
		uses: z.array(Import),
		examples: z.tuple([Example], Example),
	}),
	z.object({
		kind: z.literal("type"),
		id: z.string(),
		rule: z.string(),
		/** The files the rule is about, such as the one that declares the signature. */
		files: z.array(z.string()),
		/** Every name the snippets import, with the file it is exported from. Imported once, above all of them. */
		uses: z.array(Import),
		snippets: z.tuple([Snippet], Snippet),
	}),
	z.object({
		kind: z.literal("existing_test"),
		id: z.string(),
		rule: z.string(),
		/**
		 * The test file, relative to the repo root, that must pass once the change
		 * is made. Not locked: a doc page's twin mirrors the page, so a change to
		 * the page changes it too.
		 */
		test: z.string(),
		/** The files the rule is about beside the test, such as the doc page it checks. */
		files: z.array(z.string()),
	}),
	z.object({
		kind: z.literal("unchecked"),
		id: z.string(),
		rule: z.string(),
		/** The files the rule is about, such as a doc page it changes. Empty for a rule about no one file. */
		files: z.array(z.string()),
		about: UncheckedAbout,
		why: z.string(),
	}),
]);
export type Criterion = z.infer<typeof Criterion>;
export type ExampleCriterion = Extract<Criterion, {kind: "example"}>;
export type TypeCriterion = Extract<Criterion, {kind: "type"}>;
export type ExistingTestCriterion = Extract<Criterion, {kind: "existing_test"}>;

/**
 * A unit of work a lane can pick up. `goal` says what the code does once the
 * issue is done, as a plain fact; the title may well describe the bug instead.
 * An issue with no criteria has nothing to check against, so the type does not
 * allow one. `openDecision` is a product or design call the issue rests on that
 * nobody has made yet, as one question for the owner; `null` when the code and
 * the issue settle everything. Triage builds nothing while it is set.
 */
export const Issue = z.object({
	id: z.string(),
	title: z.string(),
	goal: z.string(),
	body: z.string(),
	criteria: z.tuple([Criterion], Criterion),
	openDecision: z.string().nullable(),
});
export type Issue = z.infer<typeof Issue>;

/** The files one criterion says the issue is about. An existing test is one: a change to its page may change it too. */
const filesOf = (c: Criterion): readonly string[] => {
	switch (c.kind) {
		case "example":
			return [c.file];
		case "existing_test":
			return [c.test, ...c.files];
		default:
			return c.files;
	}
};

/** Every file the criteria say the issue is about: what example calls import from, existing tests, and what other rules name. */
export const namedFiles = (issue: Issue): ReadonlySet<string> =>
	new Set(issue.criteria.flatMap(filesOf));

/**
 * The issue with one example set by a person: the call's result replaced when
 * the criterion has that call, added to it when not. A fix to an example that
 * broke its rule, or a new one after the owner changed their mind.
 */
export const setExample = (
	issue: Issue,
	criterion: string,
	call: string,
	result: string,
): Issue => ({
	...issue,
	criteria: issue.criteria.map((c) => {
		if (c.kind !== "example" || c.id !== criterion) return c;
		const has = c.examples.some((e) => e.call === call);
		const examples = has
			? c.examples.map((e) => (e.call === call ? {call, result} : e))
			: [...c.examples, {call, result}];
		return {...c, examples: examples as typeof c.examples};
	}) as Issue["criteria"],
});

/** The issue with one more rule, after the owner asked for behaviour no rule covered. */
export const addRule = (issue: Issue, rule: ExampleCriterion): Issue => ({
	...issue,
	criteria: [...issue.criteria, rule],
});

/** The name of the test one example becomes. The lane reads results back by it. */
export const testName = (criterion: ExampleCriterion, example: Example) =>
	`${criterion.id}: ${example.call}`;

/** The name of the check one type snippet becomes, counted from 1. */
export const snippetName = (criterion: TypeCriterion, index: number) =>
	`${criterion.id}: snippet ${index + 1}`;

/** The name of the check an existing test becomes. */
export const existingName = (criterion: ExistingTestCriterion) =>
	`${criterion.id}: ${criterion.test}`;

/** The names of the checks one criterion becomes. An unchecked rule becomes none. */
const checksOf = (c: Criterion): readonly string[] => {
	switch (c.kind) {
		case "example":
			return c.examples.map((e) => testName(c, e));
		case "type":
			return c.snippets.map((_, i) => snippetName(c, i));
		case "existing_test":
			return [existingName(c)];
		case "unchecked":
			return [];
	}
};

/** Every check the issue's criteria become, once each: its examples' tests, its type snippets and its existing tests. */
export const testNames = (issue: Issue): readonly string[] => [
	...new Set(issue.criteria.flatMap(checksOf)),
];

/**
 * An issue as somebody filed it: rough words, no criteria. Triage turns one of
 * these into an {@link Issue}. Who filed it matters: triage may throw away an
 * agent's filing, never a person's.
 */
export const RawIssue = z.object({
	id: z.string(),
	title: z.string(),
	body: z.string(),
	filedBy: z.enum(["agent", "human"]),
});
export type RawIssue = z.infer<typeof RawIssue>;
