import { z } from "zod";

/** One worked example: a JavaScript call and the exact value it returns, as a literal. */
export const Example = z.object({ call: z.string(), result: z.string() });
export type Example = z.infer<typeof Example>;

/**
 * One acceptance criterion, as data. An `example` criterion is a rule and the
 * calls that show it; code turns each call into a test, so no model decides
 * whether it is met. Any other rule is `unchecked` until a check for its kind
 * exists, and says why no call can show it.
 */
export const Criterion = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("example"),
    id: z.string(),
    rule: z.string(),
    /** The file the calls import from, relative to the repo root, and the export they call. */
    file: z.string(),
    name: z.string(),
    examples: z.tuple([Example], Example),
  }),
  z.object({
    kind: z.literal("unchecked"),
    id: z.string(),
    rule: z.string(),
    why: z.string(),
  }),
]);
export type Criterion = z.infer<typeof Criterion>;
export type ExampleCriterion = Extract<Criterion, { kind: "example" }>;

/**
 * A unit of work a lane can pick up. `goal` says what the code does once the
 * issue is done, as a plain fact; the title may well describe the bug instead.
 * An issue with no criteria has nothing to check against, so the type does not
 * allow one.
 */
export const Issue = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  body: z.string(),
  criteria: z.tuple([Criterion], Criterion),
});
export type Issue = z.infer<typeof Issue>;

/** The issue with one example's result replaced: a person's fix to an example that broke its rule. */
export const fixExample = (issue: Issue, criterion: string, call: string, result: string): Issue => ({
  ...issue,
  criteria: issue.criteria.map((c) =>
    c.kind === "example" && c.id === criterion
      ? { ...c, examples: c.examples.map((e) => (e.call === call ? { call, result } : e)) as typeof c.examples }
      : c,
  ) as Issue["criteria"],
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
