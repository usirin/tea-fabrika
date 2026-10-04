// How often is the judge right at each confidence level?
//
// Each toy gets one correct implementation and several broken on purpose. The
// real tests say which criteria each one meets, so every case has a known
// answer. The judge is then asked about each criterion twice over:
//
//   covered    the test for it is among the passing tests it is shown
//   uncovered  that test is left out, as if nobody had written it, so the
//              judge has only the diff to go on
//
// A criterion that is not met is only ever asked "uncovered": in the real lane
// a failing test sends the work back before the judge sees it.
//
// Run with `node experiments/judge-calibration.ts`; needs TYPESAFE_API_KEY.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { questions } from "../src/judge.ts";
import { checkoutToy, localWorkspace } from "../src/local.ts";
import { Workspace } from "../src/services.ts";
import { type Answer, ask, pool } from "./jev.ts";
import { duration, slugify, type Toy } from "./toys.ts";

const REPEATS = 3;

interface Case {
  readonly toy: string;
  readonly variant: string;
  readonly criterion: string;
  readonly truth: "met" | "not_met";
  readonly shown: "covered" | "uncovered";
  readonly state: object;
}

/** Build every case of one toy: write the variant, run the real tests, read the truth off them. */
async function casesOf(toy: Toy): Promise<Case[]> {
  const cases: Case[] = [];
  for (const [variant, source] of Object.entries(toy.variants)) {
    const { dir } = await checkoutToy(toy.fixture);
    await writeFile(join(dir, toy.file), source);
    const checked = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Workspace).check();
      }).pipe(Effect.provide(localWorkspace(dir, { test: ["node", "--test"] }))),
    );
    for (const [criterion, test] of Object.entries(toy.criteria)) {
      const met = checked.passingTests.includes(test);
      const without = checked.passingTests.filter((name) => name !== test);
      const state = (passingTests: readonly string[]) => ({
        issue: toy.title,
        criterion,
        diff: checked.diff,
        passingTests,
      });
      const base = { toy: toy.fixture, variant, criterion, truth: met ? "met" : "not_met" } as const;
      if (met) cases.push({ ...base, shown: "covered", state: state(checked.passingTests) });
      cases.push({ ...base, shown: "uncovered", state: state(without) });
    }
  }
  return cases;
}

const cases = [...(await casesOf(slugify)), ...(await casesOf(duration))];
const asked = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(asked, 8, (c) => ask(questions, "verdict", c.state));
const rows = asked.map((c, i) => {
  const { state: _state, ...rest } = c;
  return { ...rest, ...(answers[i] as Answer) };
});
await writeFile(
  join(import.meta.dirname, "results", "judge-calibration.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);

const pct = (part: number, whole: number) =>
  whole === 0 ? "   -" : `${Math.round((100 * part) / whole)}%`.padStart(4);
const right = (r: (typeof rows)[number]) => r.choice === r.truth;

console.log(`${cases.length} cases, ${rows.length} answers\n`);
console.log("By confidence        answers  right  wrong  cannot_tell");
for (const [low, high] of [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
  const band = rows.filter((r) => r.confidence >= low && r.confidence < high);
  const told = band.filter((r) => r.choice !== "cannot_tell");
  console.log(
    `  ${low.toFixed(1)} to ${Math.min(high, 1).toFixed(1)}    ${String(band.length).padStart(7)}  ${pct(told.filter(right).length, band.length)}   ${pct(told.filter((r) => !right(r)).length, band.length)}   ${pct(band.length - told.length, band.length)}`,
  );
}

console.log("\nIf the lane acted on every met / not_met at or above a floor:");
console.log("  floor   acted on   wrong among those   wrong 'met' (ships broken)");
for (const floor of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
  const acted = rows.filter((r) => r.confidence >= floor && r.choice !== "cannot_tell");
  const wrong = acted.filter((r) => !right(r));
  const wrongMet = wrong.filter((r) => r.choice === "met");
  console.log(
    `  ${floor.toFixed(2)}    ${pct(acted.length, rows.length)}       ${pct(wrong.length, acted.length)} (${wrong.length})            ${wrongMet.length}`,
  );
}

console.log("\nBy what the judge was shown:");
for (const shown of ["covered", "uncovered"] as const) {
  for (const truth of ["met", "not_met"] as const) {
    const group = rows.filter((r) => r.shown === shown && r.truth === truth);
    if (group.length === 0) continue;
    const mean = group.reduce((sum, r) => sum + r.confidence, 0) / group.length;
    console.log(
      `  ${shown.padEnd(9)} truly ${truth.padEnd(7)}  ${String(group.length).padStart(3)} answers  right ${pct(group.filter(right).length, group.length)}  mean confidence ${mean.toFixed(2)}`,
    );
  }
}

const misses = rows.filter((r) => r.choice !== "cannot_tell" && !right(r));
if (misses.length > 0) {
  console.log("\nWrong answers:");
  for (const r of misses) {
    console.log(`  ${r.toy}/${r.variant} [${r.shown}] said ${r.choice} ${r.confidence}: ${r.criterion}`);
  }
}
