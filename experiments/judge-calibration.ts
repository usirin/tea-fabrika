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

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");
const REPEATS = 3;

interface Toy {
  readonly fixture: string;
  readonly file: string;
  readonly title: string;
  /** Criterion text -> the name of the test that settles it. */
  readonly criteria: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, string>>;
}

const slugify: Toy = {
  fixture: "slugify",
  file: "slugify.js",
  title: "slugify turns a title into a URL slug",
  criteria: {
    "Upper-case letters in the title come out lower case in the slug.": "the slug is lower case",
    "A run of one or more spaces between words becomes a single dash.": "spaces become single dashes",
    "Punctuation and accented letters are removed from the slug.":
      "characters outside a-z and 0-9 are dropped",
  },
  variants: {
    correct: `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`,
    no_lower_case: `export function slugify(title) {
  return title.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`,
    one_dash_per_space: `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ /g, "-");
}
`,
    keeps_punctuation: `export function slugify(title) {
  return title.toLowerCase().trim().replace(/ +/g, "-");
}
`,
  },
};

const durationHead = (number: string) => `const NUMBER = "${number}";
const PARTS = new RegExp(
  \`^(?:\${NUMBER}\\\\s*h)?\\\\s*(?:\${NUMBER}\\\\s*m)?\\\\s*(?:\${NUMBER}\\\\s*s)?$\`
);
const BARE_NUMBER = new RegExp(\`^\${NUMBER}$\`);
`;
const DECIMAL = "(\\\\d+(?:\\\\.\\\\d+)?)";
const durationBody = (o: { lower: boolean; bare: boolean; miss: string }) => `
export function parseDuration(text) {
  const input = text.trim()${o.lower ? ".toLowerCase()" : ""};
  if (input === "") return null;
${o.bare ? "  if (BARE_NUMBER.test(input)) return Number(input);\n" : ""}  const match = PARTS.exec(input);
  if (!match) return ${o.miss};
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
`;
const ok = { lower: true, bare: true, miss: "null" };

const duration: Toy = {
  fixture: "duration-open",
  file: "duration.js",
  title: 'parseDuration turns text like "1h30m" into seconds',
  criteria: {
    'parseDuration("1h30m") returns 5400.': "combined units",
    'A bare number with no unit, such as "90", is returned as that many seconds.':
      "a bare number is seconds",
    'A decimal part is accepted, so "1.5h" returns 5400.': "a part can be a decimal",
    'Upper-case unit letters are accepted, so "1H30M" returns 5400.': "units can be upper case",
    'Units written smaller before larger, such as "30m1h", return null.':
      "units must go from largest to smallest, each at most once",
    'Text with an unknown unit, such as "1x", returns null.': "text that is not a duration is null",
  },
  variants: {
    correct: durationHead(DECIMAL) + durationBody(ok),
    no_bare_number: durationHead(DECIMAL) + durationBody({ ...ok, bare: false }),
    no_decimals: durationHead("(\\\\d+)") + durationBody(ok),
    no_upper_case: durationHead(DECIMAL) + durationBody({ ...ok, lower: false }),
    zero_for_unknown: durationHead(DECIMAL) + durationBody({ ...ok, miss: "0" }),
    any_order: `export function parseDuration(text) {
  const input = text.trim().toLowerCase();
  if (input === "") return null;
  if (/^\\d+(?:\\.\\d+)?$/.test(input)) return Number(input);
  const unit = { h: 3600, m: 60, s: 1 };
  let total = 0;
  let rest = input;
  while (rest !== "") {
    const match = /^(\\d+(?:\\.\\d+)?)\\s*([hms])\\s*/.exec(rest);
    if (!match) return null;
    total += Number(match[1]) * unit[match[2]];
    rest = rest.slice(match[0].length);
  }
  return total;
}
`,
  },
};

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

interface Answer {
  readonly choice: string;
  readonly confidence: number;
}

async function ask(state: object): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", questions, state }),
    });
    if (res.ok) {
      const { answers } = (await res.json()) as { answers: { verdict: Answer } };
      return { choice: answers.verdict.choice, confidence: answers.verdict.confidence };
    }
    if (attempt >= 4) throw new Error(`Jev answered ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

/** Run `work` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    }),
  );
  return results;
}

const cases = [...(await casesOf(slugify)), ...(await casesOf(duration))];
const asked = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(asked, 8, (c) => ask(c.state));
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
