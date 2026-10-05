// Do the checks catch the mistakes triage makes on its own?
//
// Experiment 20 planted wrong examples by hand, and all of them sat on the
// ticket's own inputs. Triage had made no mistake of its own yet: on the first
// toys it picked easy inputs. Here the toys need real working out (which
// weekday a date falls on, rounding at a unit boundary), and triage is asked
// for three examples per rule, one on an edge. Every example is run against
// the correct code to find the wrong ones, and two checks from experiment 20
// are tried on them:
//
//   reference  three throwaway implementations written from the rules alone;
//              an example is flagged when one of them returns something else
//   builder    the builder, shown the rules and triage's examples, names the
//              examples it thinks contradict their rule
//
// Both are also counted on triage's correct examples, as false alarms.
//
// Run with `node experiments/natural-mistakes.ts`; needs `claude`.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { turn } from "../src/claude.ts";
import { checkoutToy } from "../src/local.ts";
import { type DataCriterion, triage } from "./data-triage.ts";
import { agrees, type Example, testFile } from "./examples.ts";
import { pool } from "./jev.ts";

const RUNS = 3;
const VISIBLE_FILE = "criteria.test.js";

interface Subject {
  readonly fixture: string;
  readonly file: string;
  readonly fn: string;
  readonly rules: string;
  readonly correct: string;
}

const subjects: readonly Subject[] = [
  {
    fixture: "business-days",
    file: "days.js",
    fn: "businessDays",
    rules: [
      `- start and end are dates written as "YYYY-MM-DD"`,
      `- it counts the days after start, up to and including end, that fall on Monday to Friday`,
      `- Saturdays and Sundays are not counted`,
      `- January 1 and December 25 are not counted, in any year`,
      `- when end is the same day as start, or before it, the result is 0`,
      `- text that is not a real date in that form, such as "2024-02-30", gives null`,
    ].join("\n"),
    correct: `const HOLIDAYS = ["01-01", "12-25"];
const DAY = 24 * 60 * 60 * 1000;
const parse = (text) => {
  if (typeof text !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(text)) return null;
  const date = new Date(\`\${text}T00:00:00Z\`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
};
export function businessDays(start, end) {
  const from = parse(start);
  const to = parse(end);
  if (from === null || to === null) return null;
  let count = 0;
  for (let day = new Date(from.getTime() + DAY); day <= to; day = new Date(day.getTime() + DAY)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (HOLIDAYS.includes(day.toISOString().slice(5, 10))) continue;
    count++;
  }
  return count;
}
`,
  },
  {
    fixture: "format-bytes",
    file: "bytes.js",
    fn: "formatBytes",
    rules: [
      `- below 1024 bytes, the size is the number followed by " B", like "512 B"`,
      `- from 1024 up, the number is divided by 1024 as many times as it takes to get below 1024, and the unit is KB, MB, GB or TB; TB is the largest, and bigger sizes stay in TB`,
      `- the number has one decimal place, rounded half up, and a trailing ".0" is dropped`,
      `- if rounding makes the number 1024, the size moves up to the next unit and reads 1 of it`,
      `- a negative number, or a number that is not whole, gives null`,
    ].join("\n"),
    correct: `const UNITS = ["KB", "MB", "GB", "TB"];
export function formatBytes(n) {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n < 1024) return \`\${n} B\`;
  let value = n;
  let unit = -1;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  let rounded = Math.round(value * 10) / 10;
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    rounded = Math.round((value / 1024) * 10) / 10;
    unit++;
  }
  return \`\${rounded} \${UNITS[unit]}\`;
}
`,
  },
];

const BRIEF = `- Give each rule three examples, each with a different input. At least one should sit on an edge the rule decides: a boundary, a rounding, a crossing from one case to the next.`;

/** Which examples a builder said contradict their rule. */
const builderSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contradictions"],
  properties: {
    contradictions: {
      type: "array",
      description: "Every example whose result does not follow from its rule. Empty when all are right.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["call", "why"],
        properties: { call: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

const sameCall = (a: string, b: string) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

async function reference(subject: Subject): Promise<string> {
  const { dir } = await checkoutToy(subject.fixture);
  await turn(
    dir,
    {},
    {
      prompt: [
        `Implement \`${subject.fn}\` in ${subject.file}.`,
        `The rules:\n${subject.rules}`,
        `Follow the rules and nothing else. Change no other file. You cannot run commands. Reply with one sentence when done.`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  return readFile(join(dir, subject.file), "utf8");
}

async function build(subject: Subject, criteria: readonly DataCriterion[]) {
  const { dir } = await checkoutToy(subject.fixture);
  const examples = criteria.flatMap((c) => c.examples.map((e) => ({ id: c.id, ...e })));
  await writeFile(join(dir, VISIBLE_FILE), testFile(subject.file, subject.fn, examples));
  const listed = criteria
    .map((c) => `- [${c.id}] ${c.rule}\n${c.examples.map((e) => `    ${e.call} returns ${e.result}`).join("\n")}`)
    .join("\n");
  const result = await turn(
    dir,
    {},
    {
      prompt: [
        `Implement this issue by editing ${subject.file}.`,
        `The rules:\n${subject.rules}`,
        `Acceptance criteria, each with its examples:\n${listed}`,
        `${VISIBLE_FILE} asserts every example. You cannot run commands; the tests are run for you, and editing a test file has no effect.`,
        `Before you code, check every example against the rules. List each one whose result does not follow from the rules as a contradiction, and code to the rules, not to that example.`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
      schema: builderSchema,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  return (result.structured as { contradictions: { call: string; why: string }[] }).contradictions;
}

async function runSubject(subject: Subject) {
  const [triaged, references] = await Promise.all([
    pool(Array.from({ length: RUNS }, (_, n) => n), RUNS, async (n) => {
      const { dir, raw } = await checkoutToy(subject.fixture);
      return { n, ...(await triage(dir, raw.title, `${raw.body}\n\nThe rules:\n${subject.rules}`, BRIEF)) };
    }),
    pool(Array.from({ length: RUNS }, (_, n) => n), RUNS, () => reference(subject)),
  ]);
  return pool(triaged, RUNS, async (t) => {
    const flagged = await build(subject, t.criteria);
    const examples = await Promise.all(
      t.criteria.flatMap((c) =>
        c.examples.map(async (e: Example) => {
          const right = await agrees(subject.correct, subject.fn, e);
          const refsDiffer = (await Promise.all(references.map(async (r) => !(await agrees(r, subject.fn, e))))).filter(Boolean).length;
          const flag = flagged.find((f) => sameCall(f.call, e.call));
          return { rule: c.rule, ...e, right, refsDiffer, builderFlagged: flag !== undefined, builderWhy: flag?.why ?? null };
        }),
      ),
    );
    return { toy: subject.fixture, run: t.n, examples, unmatchedFlags: flagged.filter((f) => !examples.some((e) => sameCall(e.call, f.call))) };
  });
}

const runs = (await Promise.all(subjects.map(runSubject))).flat();
await writeFile(join(import.meta.dirname, "results", "natural-mistakes.json"), `${JSON.stringify(runs, null, 2)}\n`);

for (const r of runs) {
  console.log(`\n${r.toy}#${r.run}: ${r.examples.length} examples, ${r.examples.filter((e) => !e.right).length} wrong`);
  for (const e of r.examples.filter((x) => !x.right || x.refsDiffer > 0 || x.builderFlagged)) {
    console.log(
      `  ${e.right ? "right" : "WRONG"}  refs differ ${e.refsDiffer}/${RUNS}  builder ${e.builderFlagged ? "flagged" : "-      "}  ${e.call} -> ${e.result}`,
    );
  }
  if (r.unmatchedFlags.length > 0) console.log(`  builder flags matching no example: ${r.unmatchedFlags.map((f) => f.call).join(" | ")}`);
}
for (const toy of subjects.map((s) => s.fixture)) {
  const all = runs.filter((r) => r.toy === toy).flatMap((r) => r.examples);
  const wrong = all.filter((e) => !e.right);
  const right = all.filter((e) => e.right);
  console.log(`\n${toy}: ${wrong.length} of ${all.length} examples wrong`);
  console.log(`  wrong caught: reference ${wrong.filter((e) => e.refsDiffer > 0).length}, builder ${wrong.filter((e) => e.builderFlagged).length}, either ${wrong.filter((e) => e.refsDiffer > 0 || e.builderFlagged).length} of ${wrong.length}`);
  console.log(`  false alarms on right ones: reference ${right.filter((e) => e.refsDiffer > 0).length}, builder ${right.filter((e) => e.builderFlagged).length} of ${right.length}`);
}
