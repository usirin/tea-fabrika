import { z } from "zod";

/** One worked example: a JavaScript call and the exact value it returns, as a literal. */
export const Example = z.object({ call: z.string(), result: z.string() });
export type Example = z.infer<typeof Example>;

/** An exported name and the file it comes from, relative to the repo root. */
export const Import = z.object({ name: z.string(), file: z.string() });
export type Import = z.infer<typeof Import>;

/**
 * What an unchecked rule is about, so the check for its kind can find it once
 * one exists: a type or a signature (the compiler's), a doc page, or anything else.
 */
export const UncheckedAbout = z.enum(["type", "doc", "other"]);
export type UncheckedAbout = z.infer<typeof UncheckedAbout>;

/**
 * One acceptance criterion, as data. An `example` criterion is a rule and the
 * calls that show it; code turns each call into a test, so no model decides
 * whether it is met. Any other rule is `unchecked` until a check for its kind
 * exists, and says what it is `about` and why no call can show it.
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
export type ExampleCriterion = Extract<Criterion, { kind: "example" }>;

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

/** Every file the criteria say the issue is about: what example calls import from, and what unchecked rules name. */
export const namedFiles = (issue: Issue): ReadonlySet<string> =>
  new Set(issue.criteria.flatMap((c) => (c.kind === "example" ? [c.file] : c.files)));

/**
 * The issue with one example set by a person: the call's result replaced when
 * the criterion has that call, added to it when not. A fix to an example that
 * broke its rule, or a new one after the owner changed their mind.
 */
export const setExample = (issue: Issue, criterion: string, call: string, result: string): Issue => ({
  ...issue,
  criteria: issue.criteria.map((c) => {
    if (c.kind !== "example" || c.id !== criterion) return c;
    const has = c.examples.some((e) => e.call === call);
    const examples = has
      ? c.examples.map((e) => (e.call === call ? { call, result } : e))
      : [...c.examples, { call, result }];
    return { ...c, examples: examples as typeof c.examples };
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

/** Every test the issue's examples become, once each. */
export const testNames = (issue: Issue): readonly string[] => [
  ...new Set(
    issue.criteria.flatMap((c) =>
      c.kind === "example" ? c.examples.map((e) => testName(c, e)) : [],
    ),
  ),
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
