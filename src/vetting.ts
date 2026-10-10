import { z } from "zod";
import { type ExampleCriterion, type Issue, testName } from "./issue.ts";

// Vetting an enricher's draft, by code. Every file a criterion names must be
// at HEAD, and every example is run on today's code in a clean copy before any
// builder sees it: one that does not load, typecheck or run is broken; one
// that passes already shows nothing the change does; one whose assertion fails
// is what an example should be before the change. Running is the workspace's
// (it knows the repo and how its tests are written); reading the run and
// deciding what is wrong is here, and pure.

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

/** A file a criterion names, and the criterion. */
export const Named = z.object({ criterion: z.string(), file: z.string() });
export type Named = z.infer<typeof Named>;

/** What the workspace found about a draft: the named files not at HEAD, and each example's run. */
export const Vetted = z.object({
  missing: z.array(Named).readonly(),
  examples: z.array(ExampleVerdict).readonly(),
});
export type Vetted = z.infer<typeof Vetted>;

/** Every file a criterion names: the file its calls import from, the files of what they use, and an unchecked rule's files. */
export const namedBy = (issue: Issue): readonly Named[] =>
  issue.criteria.flatMap((c) =>
    (c.kind === "example" ? [c.file, ...c.uses.map((u) => u.file)] : c.files).map((file) => ({ criterion: c.id, file })),
  );

/** The examples of an issue, each once, with the name of the test it becomes. */
export const examplesOf = (issue: Issue) =>
  issue.criteria
    .filter((c): c is ExampleCriterion => c.kind === "example")
    .flatMap((c) => c.examples.map((e) => ({ criterion: c.id, call: e.call, name: testName(c, e) })));

/** One test's result in a report. `assertion`: the failure was its assertion, not anything else thrown. */
export type TestOutcome =
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly assertion: boolean; readonly error: string };

/** A report read back: each test that ran, by name, and why the file did not load, if it did not. */
export interface TestOutcomes {
  readonly tests: ReadonlyMap<string, TestOutcome>;
  readonly loadError: string | null;
}

/** A type error in the written test file, by its line, counted from 1. */
export interface TypeCheckError {
  readonly line: number;
  readonly message: string;
}

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
  const lines = written.split("\n");
  const examples = examplesOf(issue);
  const starts = examples.map((e) => lines.findIndex((l) => l.includes(JSON.stringify(e.name))) + 1);
  const first = Math.min(...starts.filter((n) => n > 0), lines.length + 1);
  const sorted = [...new Set(starts.filter((n) => n > 0))].sort((a, b) => a - b);
  const endOf = (start: number) => (sorted.find((n) => n > start) ?? lines.length + 1) - 1;
  const inImports = typeErrors.filter((t) => t.line < first);
  return examples.map((e, i): ExampleVerdict => {
    const base = { criterion: e.criterion, call: e.call };
    const start = starts[i] ?? 0;
    const own = start === 0 ? [] : typeErrors.filter((t) => t.line >= start && t.line <= endOf(start));
    const typeTrouble = [...inImports, ...own];
    if (typeTrouble.length > 0) {
      return { ...base, verdict: "broken", detail: `does not typecheck: ${typeTrouble.map((t) => t.message).join("; ")}` };
    }
    const outcome = outcomes.tests.get(e.name);
    if (outcome === undefined) {
      return { ...base, verdict: "broken", detail: `did not run: ${outcomes.loadError ?? "the report has no result for it"}` };
    }
    if (outcome.kind === "passed") return { ...base, verdict: "holds_already", detail: "" };
    return outcome.assertion
      ? { ...base, verdict: "fails", detail: outcome.error }
      : { ...base, verdict: "broken", detail: `throws: ${outcome.error}` };
  });
}

const shown = (e: ExampleVerdict) => `Example \`${e.call}\` (criterion ${e.criterion})`;

/** A detail as the middle of a sentence: a message's own last full stop is dropped. */
const clause = (detail: string) => detail.trim().replace(/\.$/, "");

/** What the writer is told about one example that will not do. */
function exampleProblem(e: ExampleVerdict): string | null {
  switch (e.verdict) {
    case "fails":
      return null;
    case "holds_already":
      return `${shown(e)} already holds on today's code, so it shows nothing the change does. If the rule is really about types or docs, make it unchecked with that kind; if today's code already follows it, leave it out.`;
    case "broken":
      return e.detail.startsWith("does not typecheck")
        ? `${shown(e)} ${clause(e.detail)}. If that type error is the bug itself, the rule is about types: make it unchecked with kind type. Otherwise rewrite the call so it typechecks before and after the change.`
        : `${shown(e)} is broken on today's code: it ${clause(e.detail)}. Rewrite it so it loads and runs and only its assertion can fail, or make the rule unchecked.`;
  }
}

/**
 * What is wrong with a draft, as plain sentences the writer can act on; none
 * means it passes. Every named file is at HEAD, criterion ids are unique, no
 * example is broken or holds already, and at least one fails, unless there are
 * no examples at all and every rule is unchecked.
 */
export function vetProblems(issue: Issue, vetted: Vetted): string[] {
  const ids = issue.criteria.map((c) => c.id);
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const ran = new Set(vetted.examples.map((e) => `${e.criterion}\n${e.call}`));
  const unrun = examplesOf(issue).filter((e) => !ran.has(`${e.criterion}\n${e.call}`));
  const examples = vetted.examples.length + unrun.length;
  return [
    ...twice.map((id) => `Criterion id ${id} is used more than once. Give each criterion its own id.`),
    ...vetted.missing.map(
      (m) => `Criterion ${m.criterion} names ${m.file}, which does not exist at HEAD. Name the file as it is in the repo.`,
    ),
    ...vetted.examples.flatMap((e) => exampleProblem(e) ?? []),
    ...unrun.map((e) => `Example \`${e.call}\` (criterion ${e.criterion}) was not run. Write it again.`),
    ...(examples > 0 && !vetted.examples.some((e) => e.verdict === "fails")
      ? ["No example fails on today's code, so none shows what the change does."]
      : []),
  ];
}
