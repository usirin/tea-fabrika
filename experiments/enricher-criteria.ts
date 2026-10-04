// Do the enricher's own criteria hold up, or only the ones written by hand?
//
// Every earlier run used criteria I wrote. Here the whole front of the lane
// runs on a raw ticket: the enricher reads it and the code and writes the
// criteria, the test-writer turns each into a test, and the judge is asked
// whether each test checks its criterion. Then the tests are run:
//
//   wrong        fails on the correct code
//   empty        already passes on the starting code
//   let through  the judge says "checks" at or above the floor
//
// and every broken version of the toy is run against the whole test file, to
// see how many the enricher's criteria, as tested, would catch.
//
// Run with `node experiments/enricher-criteria.ts`; needs TYPESAFE_API_KEY and `claude`.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { claudeEnricher, turn } from "../src/claude.ts";
import { checkoutToy } from "../src/local.ts";
import { Enricher } from "../src/services.ts";
import { questionsWithAbout } from "./fit.ts";
import { passing, TEST_FILE, testsIn } from "./grading.ts";
import { ask, pool } from "./jev.ts";
import { duration, slugifyOneClaim, type Toy, variant } from "./toys.ts";
import { writerPrompt } from "./writer.ts";

const RUNS = 3;
const FLOOR = 0.85;

interface Subject {
  readonly toy: Toy;
  readonly fn: string;
  /** The toy's own tests. The enricher may read them; the test-writer may not. */
  readonly ownTests: string;
}

const subjects: readonly Subject[] = [
  { toy: slugifyOneClaim, fn: "slugify", ownTests: "slugify.test.js" },
  { toy: duration, fn: "parseDuration", ownTests: "duration.test.js" },
];

interface Row {
  readonly id: string;
  readonly text: string;
  readonly tests: number;
  readonly wrong: boolean;
  readonly empty: boolean;
  readonly choice: string | null;
  readonly confidence: number | null;
  readonly source: string;
}

interface Run {
  readonly toy: string;
  readonly run: number;
  readonly title: string;
  readonly goal: string;
  readonly criteria: readonly Row[];
  /** The broken versions of the toy that no test fails on. */
  readonly uncaught: readonly string[];
  readonly broken: number;
}

async function oneRun({ toy, fn, ownTests }: Subject, run: number): Promise<Run> {
  const { dir, raw } = await checkoutToy(toy.fixture);
  const { issue } = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Enricher).enrich({ raw, note: null, session: null });
    }).pipe(Effect.provide(claudeEnricher(dir))),
  );
  await rm(join(dir, ownTests));
  await turn(
    dir,
    {},
    {
      prompt: writerPrompt({ title: issue.title, file: toy.file, fn, criteria: issue.criteria }),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  const file = await readFile(join(dir, TEST_FILE), "utf8").catch(() => "");
  const written = testsIn(file);
  const onCorrect = await passing(toy, file, variant(toy, "correct"));
  const onStart = await passing(toy, file, null);
  const criteria = await pool(issue.criteria, 8, async (criterion): Promise<Row> => {
    const mine = written.filter((t) => t.name.startsWith(`${criterion.id}:`));
    const source = mine.map((t) => t.source).join("\n\n");
    const answer =
      mine.length === 0
        ? null
        : await ask(questionsWithAbout, "fit", { about: issue.goal, criterion: criterion.text, test: source });
    return {
      id: criterion.id,
      text: criterion.text,
      tests: mine.length,
      wrong: mine.some((t) => !onCorrect.has(t.name)),
      empty: mine.length > 0 && mine.every((t) => onStart.has(t.name)),
      choice: answer?.choice ?? null,
      confidence: answer?.confidence ?? null,
      source,
    };
  });
  const broken = Object.keys(toy.variants).filter((name) => name !== "correct");
  const uncaught: string[] = [];
  for (const name of broken) {
    const passed = await passing(toy, file, variant(toy, name));
    if (written.every((t) => passed.has(t.name))) uncaught.push(name);
  }
  return { toy: toy.fixture, run, title: issue.title, goal: issue.goal, criteria, uncaught, broken: broken.length };
}

const jobs = subjects.flatMap((subject) => Array.from({ length: RUNS }, (_, run) => ({ subject, run })));
const runs = await pool(jobs, 3, ({ subject, run }) => oneRun(subject, run));
await writeFile(
  join(import.meta.dirname, "results", "enricher-criteria.json"),
  `${JSON.stringify(runs, null, 2)}\n`,
);

const through = (r: Row) => r.choice === "checks" && (r.confidence ?? 0) >= FLOOR;
for (const r of runs) {
  console.log(`\n${r.toy}#${r.run}: ${r.title}\n  goal: ${r.goal}`);
  for (const c of r.criteria) {
    const flags = [c.tests === 0 ? "NO TEST" : "", c.wrong ? "WRONG" : "", c.empty ? "EMPTY" : ""].filter(Boolean).join(" ");
    console.log(`  ${(c.choice ?? "-").padEnd(14)} ${String(c.confidence ?? "-").padEnd(5)} ${flags.padEnd(8)} ${c.text}`);
  }
  console.log(`  broken versions caught: ${r.broken - r.uncaught.length} of ${r.broken}${r.uncaught.length > 0 ? ` (missed: ${r.uncaught.join(", ")})` : ""}`);
}

const all = runs.flatMap((r) => r.criteria);
const sound = all.filter((c) => c.tests > 0 && !c.wrong && !c.empty);
console.log(`\n${all.length} criteria over ${runs.length} runs`);
console.log(`  no test: ${all.filter((c) => c.tests === 0).length}, wrong on correct code: ${all.filter((c) => c.wrong).length}, already passing on the starting code: ${all.filter((c) => c.empty).length}`);
console.log(`  judge at ${FLOOR} lets through ${sound.filter(through).length} of ${sound.length} sound tests, and ${all.filter((c) => (c.wrong || c.empty) && through(c)).length} of ${all.length - sound.length - all.filter((c) => c.tests === 0).length} wrong or empty ones`);
console.log(`  broken versions caught: ${runs.reduce((n, r) => n + r.broken - r.uncaught.length, 0)} of ${runs.reduce((n, r) => n + r.broken, 0)}`);
