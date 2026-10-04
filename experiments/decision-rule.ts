// Is "confidence at or above a floor" the best way to read the judge's answer?
//
// Jev gives a share to every option: checks, does_not_check, cannot_tell. The
// lane has only used the top one. A good test the judge is unsure about might
// have its doubt in "cannot tell", and a bad test its doubt in "does not
// check". If so, a rule on the shares lets more good tests through at no cost.
//
// The rules are fitted on tests written by agents (the enricher's run and the
// tests written to fool the judge), then tried unchanged on the hand-built
// tests of test-check-calibration, which they were not fitted on.
//
// Run with `node experiments/decision-rule.ts` after enricher-criteria.ts,
// bad-tests.ts and test-check-calibration.ts; needs TYPESAFE_API_KEY.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { questions, questionsWithAbout } from "./fit.ts";
import { type Answer, ask, pool } from "./jev.ts";
import { duration, slugify } from "./toys.ts";

const REPEATS = 3;
const results = join(import.meta.dirname, "results");
const load = async <T>(name: string) => JSON.parse(await readFile(join(results, name), "utf8")) as T;

interface Item {
  readonly set: "fit" | "holdout";
  readonly good: boolean;
  readonly state: object;
  readonly hasAbout: boolean;
}

const titles: Readonly<Record<string, string>> = {
  [slugify.fixture]: slugify.title,
  [duration.fixture]: duration.title,
};
const unique = <T>(items: readonly T[], key: (item: T) => string) => [
  ...new Map(items.map((item) => [key(item), item])).values(),
];

const enriched = await load<
  readonly { goal: string; criteria: readonly { text: string; source: string; wrong: boolean; empty: boolean; tests: number }[] }[]
>("enricher-criteria.json");
const fooling = unique(
  await load<readonly { toy: string; criterion: string; source: string; truth: string }[]>("bad-tests.json"),
  (r) => `${r.criterion}\n${r.source}`,
);
const handBuilt = unique(
  (await load<readonly { toy: string; criterion: string; test: string; truth: string; form: string }[]>(
    "test-check-calibration.json",
  )).filter((r) => r.form === "code"),
  (r) => `${r.criterion}\n${r.test}`,
);

const items: Item[] = [
  ...enriched.flatMap((run) =>
    run.criteria
      .filter((c) => c.tests > 0)
      .map((c): Item => ({
        set: "fit",
        good: !c.wrong && !c.empty,
        state: { about: run.goal, criterion: c.text, test: c.source },
        hasAbout: true,
      })),
  ),
  ...fooling.map((r): Item => ({
    set: "fit",
    good: r.truth === "checks",
    state: { about: titles[r.toy], criterion: r.criterion, test: r.source },
    hasAbout: true,
  })),
  ...handBuilt.map((r): Item => ({
    set: "holdout",
    good: r.truth === "checks",
    state: { about: titles[r.toy], criterion: r.criterion, test: r.test },
    hasAbout: true,
  })),
];

const asked = items.flatMap((item) => Array.from({ length: REPEATS }, () => item));
const answers = await pool(asked, 8, (item) => ask(item.hasAbout ? questionsWithAbout : questions, "fit", item.state));
const rows = asked.map((item, i) => {
  const a = answers[i] as Answer;
  return {
    set: item.set,
    good: item.good,
    state: item.state,
    choice: a.choice,
    confidence: a.confidence,
    checks: a.probabilities.checks ?? 0,
    no: a.probabilities.does_not_check ?? 0,
    unsure: a.probabilities.cannot_tell ?? 0,
  };
});
await writeFile(join(results, "decision-rule.json"), `${JSON.stringify(rows, null, 2)}\n`);

type Row = (typeof rows)[number];
const rules: readonly { readonly name: string; readonly score: (r: Row) => number }[] = [
  { name: "share for 'checks'", score: (r) => r.checks },
  { name: "1 - share for 'does not check'", score: (r) => 1 - r.no },
  { name: "'checks' minus 'does not check'", score: (r) => r.checks - r.no },
  { name: "'checks' over 'checks' + 'does not check'", score: (r) => r.checks / Math.max(r.checks + r.no, 1e-9) },
];

const fit = rows.filter((r) => r.set === "fit");
const holdout = rows.filter((r) => r.set === "holdout");
const count = (group: readonly Row[], good: boolean) => group.filter((r) => r.good === good).length;
console.log(`fitted on ${fit.length} answers (${count(fit, true)} good, ${count(fit, false)} bad), tried on ${holdout.length} held back (${count(holdout, true)} good, ${count(holdout, false)} bad)\n`);

const mean = (group: readonly Row[], pick: (r: Row) => number) =>
  (group.reduce((sum, r) => sum + pick(r), 0) / Math.max(group.length, 1)).toFixed(2);
console.log("Where the shares go, on average:      checks  does_not_check  cannot_tell");
for (const [label, group] of [["good tests", fit.filter((r) => r.good)], ["bad tests", fit.filter((r) => !r.good)]] as const) {
  console.log(`  ${label.padEnd(34)} ${mean(group, (r) => r.checks)}    ${mean(group, (r) => r.no)}            ${mean(group, (r) => r.unsure)}`);
}

console.log("\nrule                                         cut    fitted: good passed  bad accepted   held back: good passed  bad accepted");
for (const rule of rules) {
  // The lowest cut that accepts no bad test in the fitted set, plus a margin of 0.05.
  const worstBad = Math.max(...fit.filter((r) => !r.good).map(rule.score));
  const cut = Math.round((worstBad + 0.05) * 100) / 100;
  const passed = (group: readonly Row[], good: boolean) => group.filter((r) => r.good === good && rule.score(r) >= cut).length;
  console.log(
    `${rule.name.padEnd(44)} ${cut.toFixed(2)}   ${String(passed(fit, true)).padStart(3)} of ${count(fit, true)}          ${passed(fit, false)} of ${count(fit, false)}        ${String(passed(holdout, true)).padStart(3)} of ${count(holdout, true)}             ${passed(holdout, false)} of ${count(holdout, false)}`,
  );
}
