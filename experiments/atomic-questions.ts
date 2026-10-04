// One broad question, or several narrow ones?
//
// Jev's guide says the most important thing is to split a broad judgment into
// atomic questions, ask them in one call, and combine the answers in code. We
// have been asking one broad question: would this test passing show the
// criterion is met? Under the lane's rule (the test asserts the criterion's
// own example) that judgment is three small facts:
//
//   same_input    the test calls the function with the example's input
//   same_result   the test expects the example's result
//   exact_check   the test compares against one exact value
//
// Each is a yes/no question (`noul`), phrased so that yes is the good answer,
// and each is shown only the criterion and the test. A test is accepted when
// all three are at or above a cut.
//
// Run with `node experiments/atomic-questions.ts`; needs TYPESAFE_API_KEY and
// the saved results of the earlier experiments.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { type Case, loadCases } from "./cases.ts";
import { questionsWithAbout } from "./fit.ts";
import { ask, askAll, pool } from "./jev.ts";

const atomic = jevQuestions({
  same_input: {
    type: "noul",
    instructions:
      "`criterion` ends with an example: an input and the result it must give. Does `test` call the function with exactly that input?",
    criteria: {
      true: "A call in `test` passes the same input as the example in `criterion`, character for character",
      false: "No call in `test` passes that input, or `criterion` gives no example",
    },
  },
  same_result: {
    type: "noul",
    instructions:
      "`criterion` ends with an example: an input and the result it must give. Does `test` expect exactly that result for that input?",
    criteria: {
      true: "`test` asserts that the example's input gives the example's result, character for character",
      false: "`test` expects a different result for that input, or never asserts the example at all",
    },
  },
  exact_check: {
    type: "noul",
    instructions: "Does `test` compare what the function returns against one exact value?",
    criteria: {
      true: "An equality assertion against a literal value, such as assert.equal(f(x), \"y\")",
      false:
        "Only a loose check: that the result is truthy or falsy, has a type, matches a pattern, or no assertion on the result at all",
    },
  },
});

/** Whether a test's source carries every literal of the criterion's example. Code's own answer to the first two questions. */
function assertsExample(c: Case): boolean | null {
  const example = / so (.+)$/.exec(c.criterion)?.[1];
  if (example === undefined) return null;
  const literals = [
    ...[...example.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => `"${m[1]}"`),
    ...[...example.matchAll(/returns (null|-?\d+(?:\.\d+)?)\b/g)].map((m) => m[1] as string),
  ];
  if (literals.length === 0) return null;
  const source = c.test.replaceAll("'", '"');
  return literals.every((literal) => source.includes(literal));
}

const cases = await loadCases();
const rows = await pool(cases, 8, async (c) => {
  const narrow = (await askAll(atomic, { criterion: c.criterion, test: c.test })) as Record<
    keyof typeof atomic,
    { noul: number }
  >;
  const broad = await ask(questionsWithAbout, "fit", { about: c.about, criterion: c.criterion, test: c.test });
  return {
    ...c,
    assertsExample: assertsExample(c),
    same_input: narrow.same_input.noul,
    same_result: narrow.same_result.noul,
    exact_check: narrow.exact_check.noul,
    broad: broad.choice === "checks" ? broad.confidence : 0,
  };
});
await writeFile(
  join(import.meta.dirname, "results", "atomic-questions.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);

type Row = (typeof rows)[number];
const lowest = (r: Row) => Math.min(r.same_input, r.same_result, r.exact_check);
const of = (from: Case["from"], good: boolean) => rows.filter((r) => r.from === from && r.good === good);
const mean = (group: readonly Row[], pick: (r: Row) => number) =>
  group.length === 0 ? "   -" : (group.reduce((sum, r) => sum + pick(r), 0) / group.length).toFixed(2);

console.log(`${rows.length} tests\n`);
console.log("Average answer                       tests  same_input  same_result  exact_check");
for (const [label, group] of [
  ["writer's tests, good", of("writer", true)],
  ["writer's tests, bad", of("writer", false)],
  ["fooler's tests, bad", of("fooler", false)],
  ["fooler's tests, good by accident", of("fooler", true)],
  ["hand-built, good", of("hand", true)],
  ["hand-built, bad", of("hand", false)],
] as const) {
  console.log(
    `  ${label.padEnd(34)} ${String(group.length).padStart(5)}  ${mean(group, (r) => r.same_input)}        ${mean(group, (r) => r.same_result)}         ${mean(group, (r) => r.exact_check)}`,
  );
}

const good = rows.filter((r) => r.good);
const bad = rows.filter((r) => !r.good);
const writerGood = of("writer", true);
console.log(`\nAccepting a test                    writer's good tests   all good tests   bad tests`);
const line = (label: string, accept: (r: Row) => boolean) =>
  console.log(
    `  ${label.padEnd(34)} ${String(writerGood.filter(accept).length).padStart(3)} of ${writerGood.length}          ${String(good.filter(accept).length).padStart(3)} of ${good.length}      ${bad.filter(accept).length} of ${bad.length}`,
  );
line("broad question at 0.85", (r) => r.broad >= 0.85);
for (const cut of [0.5, 0.7, 0.8, 0.9]) line(`all three narrow ones at ${cut}`, (r) => lowest(r) >= cut);

const known = rows.filter((r) => r.assertsExample !== null);
const agree = known.filter((r) => (Math.min(r.same_input, r.same_result) >= 0.5) === r.assertsExample);
console.log(`\nCode can answer the first two itself where the criterion has an example (${known.length} tests):`);
console.log(`  Jev agrees with the code on ${agree.length} of ${known.length}`);
line("code: asserts the example, plus exact_check at 0.5", (r) => r.assertsExample === true && r.exact_check >= 0.5);

const slipped = bad.filter((r) => lowest(r) >= 0.5).sort((a, b) => lowest(b) - lowest(a)).slice(0, 8);
if (slipped.length > 0) {
  console.log("\nBad tests the narrow questions liked most:");
  for (const r of slipped) console.log(`  ${lowest(r).toFixed(2)} ${r.criterion}\n      ${r.test.replaceAll("\n", " ")}`);
}
