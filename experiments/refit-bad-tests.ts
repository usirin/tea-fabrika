// The floor was checked against bad tests with the first wording of the
// question. This asks the reworded one (with `about`) about the same saved
// tests, to see that the floor still holds.
//
// Run with `node experiments/refit-bad-tests.ts` after `bad-tests.ts`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { questionsWithAbout } from "./fit.ts";
import { ask, pool } from "./jev.ts";
import { duration, slugify } from "./toys.ts";

interface Saved {
  readonly toy: string;
  readonly criterion: string;
  readonly source: string;
  readonly truth: "checks" | "does_not_check";
}

const about: Readonly<Record<string, string>> = {
  [slugify.fixture]: slugify.title,
  [duration.fixture]: duration.title,
};
const saved = JSON.parse(
  await readFile(join(import.meta.dirname, "results", "bad-tests.json"), "utf8"),
) as readonly Saved[];
const rows = await pool(saved, 8, async (s) => ({
  ...s,
  ...(await ask(questionsWithAbout, "fit", { about: about[s.toy], criterion: s.criterion, test: s.source })),
}));

const bad = rows.filter((r) => r.truth === "does_not_check");
const good = rows.filter((r) => r.truth === "checks");
console.log(`${rows.length} answers over the saved tests`);
console.log("floor   bad accepted   good passed");
for (const floor of [0.8, 0.85, 0.9]) {
  const through = (r: (typeof rows)[number]) => r.choice === "checks" && r.confidence >= floor;
  console.log(`${floor.toFixed(2)}    ${bad.filter(through).length} of ${bad.length}       ${good.filter(through).length} of ${good.length}`);
}
const worst = bad.filter((r) => r.choice === "checks").sort((a, b) => b.confidence - a.confidence).slice(0, 5);
for (const r of worst) console.log(`  ${r.confidence} ${r.criterion}\n      ${r.source.replaceAll("\n", " ")}`);
