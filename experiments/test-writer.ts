// Can an agent write the tests before anyone writes the code?
//
// Claude gets a toy's starting code and its criteria, and writes one test per
// criterion. It never sees an implementation or the toy's own tests. Each
// criterion's tests are then graded the hard way: they are good when they pass
// on the correct code and fail on code that breaks only that criterion.
//
// The judge is asked about each one too, so we can see whether it would have
// let the good ones through and stopped the bad ones.
//
// Run with `node experiments/test-writer.ts`; needs TYPESAFE_API_KEY and `claude`.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { turn } from "../src/claude.ts";
import { checkoutToy } from "../src/local.ts";
import { questions } from "./fit.ts";
import { passing, TEST_FILE, testsIn } from "./grading.ts";
import { ask, pool } from "./jev.ts";
import {
  breakerOf,
  duration,
  slugify,
  slugifyOneClaim,
  slugifyWithExamples,
  type Toy,
  variant,
} from "./toys.ts";

const REPEATS = 3;
const FLOOR = 0.9;

interface Subject {
  readonly label: string;
  readonly toy: Toy;
  readonly fn: string;
  /** The toy's own tests, taken away before the writer looks. */
  readonly ownTests: string;
}

const subjects: readonly Subject[] = [
  { label: "slugify", toy: slugify, fn: "slugify", ownTests: "slugify.test.js" },
  {
    label: "slugify, criteria with examples",
    toy: slugifyWithExamples,
    fn: "slugify",
    ownTests: "slugify.test.js",
  },
  {
    label: "slugify, one claim with an example",
    toy: slugifyOneClaim,
    fn: "slugify",
    ownTests: "slugify.test.js",
  },
  { label: "duration", toy: duration, fn: "parseDuration", ownTests: "duration.test.js" },
];

const idOf = (index: number) => `c${index + 1}`;

const promptFor = ({ toy, fn }: Subject) =>
  [
    `You write the tests for an issue before anyone implements it. Someone else writes the code afterwards and must make your tests pass without changing them.`,
    `# ${toy.title}`,
    `\`${fn}\` in ${toy.file} is only a starting point and does not work yet.`,
    `Acceptance criteria:\n${Object.keys(toy.criteria)
      .map((text, i) => `- [${idOf(i)}] ${text}`)
      .join("\n")}`,
    [
      `Write ${TEST_FILE} with node:test and node:assert/strict:`,
      `- Exactly one test per criterion. Start its name with the criterion's id and a colon, like "c1: ...".`,
      `- When the criterion gives an example, the test asserts exactly that example: the same input and the same result.`,
      `- A test must pass only if its criterion is met, and it checks that one criterion and nothing else. Add a second assertion only when the first would already pass on code that does nothing.`,
      `- Only top-level test() calls. No describe, no nested tests.`,
      `- Change no other file. You cannot run commands.`,
    ].join("\n"),
    `Reply with one sentence when the file is written.`,
  ].join("\n\n");

type Grade =
  | "good"
  /** No test carries this criterion's id. */
  | "missing"
  /** A test fails on correct code: it expects something wrong. */
  | "wrong"
  /** The tests pass on code that breaks the criterion. */
  | "too_weak";

interface Row {
  readonly toy: string;
  readonly run: number;
  readonly criterion: string;
  readonly grade: Grade;
  readonly tests: number;
  /** Whether at least one of the tests fails on the starting code. */
  readonly redOnStart: boolean;
  readonly source: string;
  readonly choice: string | null;
  readonly confidence: number | null;
}

async function writeAndGrade(subject: Subject, run: number): Promise<Row[]> {
  const { toy } = subject;
  const { dir } = await checkoutToy(toy.fixture);
  await rm(join(dir, subject.ownTests));
  await turn(
    dir,
    {},
    { prompt: promptFor(subject), session: null, tools: ["Read", "Write", "Edit", "Glob", "Grep"], edits: true },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  const file = await readFile(join(dir, TEST_FILE), "utf8").catch(() => "");
  const written = testsIn(file);
  const onCorrect = await passing(toy, file, variant(toy, "correct"));
  const onStart = await passing(toy, file, null);
  const rows: Row[] = [];
  for (const [index, criterion] of Object.keys(toy.criteria).entries()) {
    const mine = written.filter((t) => t.name.startsWith(`${idOf(index)}:`));
    const onBroken = await passing(toy, file, breakerOf(toy, criterion));
    const grade: Grade =
      mine.length === 0
        ? "missing"
        : !mine.every((t) => onCorrect.has(t.name))
          ? "wrong"
          : mine.every((t) => onBroken.has(t.name))
            ? "too_weak"
            : "good";
    const source = mine.map((t) => t.source).join("\n\n");
    const answer =
      mine.length === 0 ? null : await ask(questions, "fit", { issue: toy.title, criterion, test: source });
    rows.push({
      toy: subject.label,
      run,
      criterion,
      grade,
      tests: mine.length,
      redOnStart: mine.some((t) => !onStart.has(t.name)),
      source,
      choice: answer?.choice ?? null,
      confidence: answer?.confidence ?? null,
    });
  }
  return rows;
}

const jobs = subjects.flatMap((subject) => Array.from({ length: REPEATS }, (_, run) => ({ subject, run })));
const rows = (await pool(jobs, 3, ({ subject, run }) => writeAndGrade(subject, run))).flat();
await writeFile(
  join(import.meta.dirname, "results", "test-writer.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);

const count = (group: readonly Row[], grade: Grade) => group.filter((r) => r.grade === grade).length;
console.log(`${jobs.length} runs, ${rows.length} criteria\n`);
const sure = (r: Row) => (r.confidence ?? 0) >= FLOOR && r.choice !== "cannot_tell";
const passed = (r: Row) => sure(r) && r.choice === "checks";
console.log("toy                                 criteria  good  too_weak  wrong  missing  judge lets through");
for (const { label } of subjects) {
  const group = rows.filter((r) => r.toy === label);
  console.log(
    `${label.padEnd(35)} ${String(group.length).padStart(8)}  ${String(count(group, "good")).padStart(4)}  ${String(count(group, "too_weak")).padStart(8)}  ${String(count(group, "wrong")).padStart(5)}  ${String(count(group, "missing")).padStart(7)}  ${String(group.filter(passed).length).padStart(18)}`,
  );
}

const judged = rows.filter((r) => r.choice !== null);
const good = judged.filter((r) => r.grade === "good");
const bad = judged.filter((r) => r.grade !== "good");
console.log(`\nThe judge at the ${FLOOR} floor:`);
console.log(
  `  good tests (${good.length}): let through ${good.filter((r) => sure(r) && r.choice === "checks").length}, refused ${good.filter((r) => sure(r) && r.choice !== "checks").length}, unsure ${good.filter((r) => !sure(r)).length}`,
);
console.log(
  `  bad tests (${bad.length}): let through ${bad.filter((r) => sure(r) && r.choice === "checks").length}, refused ${bad.filter((r) => sure(r) && r.choice !== "checks").length}, unsure ${bad.filter((r) => !sure(r)).length}`,
);
console.log(`  good tests already passing on the starting code: ${good.filter((r) => !r.redOnStart).length}`);

console.log("\nPer criterion (grade, judge):");
for (const r of rows) {
  console.log(
    `  ${r.toy}#${r.run} ${r.grade.padEnd(8)} ${r.tests} test ${(r.choice ?? "-").padEnd(14)} ${r.confidence ?? "-"}  ${r.criterion.slice(0, 60)}`,
  );
}
for (const r of rows.filter((r) => r.grade !== "good" && r.grade !== "missing")) {
  console.log(`\n${r.grade}: ${r.criterion}\n${r.source}`);
}
