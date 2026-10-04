// Can the judge tell whether a test really checks a criterion?
//
// The lane's next rule is "every criterion needs a test". That moves the
// judge's job from "is this code right" to "does this test check this line",
// so this measures the new question the way judge-calibration measured the old.
//
// Each criterion gets two honest tests and four bad ones:
//
//   name_lies          named after the criterion, checks something else
//   wrong_expectation  the right input, the wrong expected result
//   misses_the_point   looks related, passes whether or not the criterion holds
//   vacuous            asserts nothing
//
// The truth is not my opinion. A test checks a criterion when it passes on the
// correct code and fails on code that breaks only that criterion. Every test
// is run on both, and the script stops if a label disagrees with the run.
//
// Each test is shown to the judge twice: as code, and as the same checks in
// plain words. That says whether a prose test is easier for it to read.
//
// Run with `node experiments/test-check-calibration.ts`; needs TYPESAFE_API_KEY.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { Effect } from "effect";
import { checkoutToy, localWorkspace } from "../src/local.ts";
import { Workspace } from "../src/services.ts";
import { type Answer, ask, pool } from "./jev.ts";
import { duration, slugify, type Toy } from "./toys.ts";

const REPEATS = 3;

const questions = jevQuestions({
  fit: {
    type: "choice",
    instructions:
      "Would this test passing show that the acceptance criterion is met? `test` is one test, as code or as a plain description of what it asserts. Go by what the test asserts, not by its name.",
    criteria: {
      checks: "The test can only pass if the code does what the criterion asks",
      does_not_check:
        "The test could pass while the criterion is unmet, or it expects a result the criterion does not ask for",
      cannot_tell: "The test and the criterion are not enough to decide",
    },
  },
});

/** One thing a test asserts about one call. */
type Check =
  | { readonly is: "equal"; readonly input: string; readonly expected: string | number | null }
  | { readonly is: "type"; readonly input: string; readonly type: "string" | "number" }
  | { readonly is: "falsy"; readonly input: string }
  | { readonly is: "called"; readonly input: string };

const equal = (input: string, expected: string | number | null): Check => ({
  is: "equal",
  input,
  expected,
});

type Kind = "good" | "name_lies" | "wrong_expectation" | "misses_the_point" | "vacuous";

interface Candidate {
  readonly kind: Kind;
  readonly name: string;
  readonly checks: readonly [Check, ...Check[]];
}

interface Subject {
  readonly criterion: string;
  /** Code that breaks this criterion and nothing else. */
  readonly breaker: string;
  readonly candidates: readonly Candidate[];
}

interface Suite {
  readonly toy: Toy;
  readonly fn: string;
  readonly subjects: readonly Subject[];
}

const variant = (toy: Toy, name: string): string => {
  const source = toy.variants[name];
  if (source === undefined) throw new Error(`${toy.fixture} has no variant ${name}`);
  return source;
};

/** Handles one unit at a time and nothing combined. */
const SINGLE_UNIT_ONLY = `export function parseDuration(text) {
  const input = text.trim().toLowerCase();
  if (input === "") return null;
  if (/^\\d+(?:\\.\\d+)?$/.test(input)) return Number(input);
  const match = /^(\\d+(?:\\.\\d+)?)\\s*([hms])$/.exec(input);
  if (!match) return null;
  return Number(match[1]) * { h: 3600, m: 60, s: 1 }[match[2]];
}
`;

const slugifySuite: Suite = {
  toy: slugify,
  fn: "slugify",
  subjects: [
    {
      criterion: "Upper-case letters in the title come out lower case in the slug.",
      breaker: variant(slugify, "no_lower_case"),
      candidates: [
        { kind: "good", name: "the slug is lower case", checks: [equal("Hello", "hello")] },
        { kind: "good", name: "mixed case is lowered", checks: [equal("HeLLo WORLD", "hello-world")] },
        {
          kind: "name_lies",
          name: "upper case becomes lower case",
          checks: [equal("hello   big world", "hello-big-world")],
        },
        { kind: "wrong_expectation", name: "the slug is lower case", checks: [equal("Hello", "HELLO")] },
        {
          kind: "misses_the_point",
          name: "the slug has no upper case",
          checks: [equal("hello world", "hello-world")],
        },
        { kind: "vacuous", name: "the slug is lower case", checks: [{ is: "called", input: "Hello" }] },
      ],
    },
    {
      criterion: "A run of one or more spaces between words becomes a single dash.",
      breaker: variant(slugify, "one_dash_per_space"),
      candidates: [
        {
          kind: "good",
          name: "spaces become single dashes",
          checks: [equal("hello   big world", "hello-big-world")],
        },
        { kind: "good", name: "two spaces are one dash", checks: [equal("a  b", "a-b")] },
        { kind: "name_lies", name: "spaces become single dashes", checks: [equal("Hello", "hello")] },
        {
          kind: "wrong_expectation",
          name: "spaces become dashes",
          checks: [equal("hello   big world", "hello---big-world")],
        },
        {
          kind: "misses_the_point",
          name: "a space becomes a dash",
          checks: [equal("hello world", "hello-world")],
        },
        {
          kind: "vacuous",
          name: "spaces become single dashes",
          checks: [{ is: "type", input: "hello   big world", type: "string" }],
        },
      ],
    },
    {
      criterion: "Punctuation and accented letters are removed from the slug.",
      breaker: variant(slugify, "keeps_punctuation"),
      candidates: [
        {
          kind: "good",
          name: "characters outside a-z and 0-9 are dropped",
          checks: [equal("héllo, wörld 42!", "hllo-wrld-42")],
        },
        {
          kind: "good",
          name: "punctuation and accents go away",
          checks: [equal("it's done.", "its-done"), equal("café", "caf")],
        },
        { kind: "name_lies", name: "punctuation is removed", checks: [equal("a  b", "a-b")] },
        {
          kind: "wrong_expectation",
          name: "accents and punctuation are cleaned up",
          checks: [equal("héllo, wörld 42!", "hello-world-42")],
        },
        {
          kind: "misses_the_point",
          name: "only letters and digits are left",
          checks: [equal("Hello World 42", "hello-world-42")],
        },
        {
          kind: "vacuous",
          name: "punctuation is removed",
          checks: [{ is: "called", input: "héllo, wörld 42!" }],
        },
      ],
    },
  ],
};

const durationSuite: Suite = {
  toy: duration,
  fn: "parseDuration",
  subjects: [
    {
      criterion: 'parseDuration("1h30m") returns 5400.',
      breaker: SINGLE_UNIT_ONLY,
      candidates: [
        { kind: "good", name: "combined units", checks: [equal("1h30m", 5400)] },
        {
          kind: "good",
          name: "hours and minutes add up",
          checks: [equal("1h30m", 5400), equal("2h15m", 8100)],
        },
        { kind: "name_lies", name: "1h30m is 5400 seconds", checks: [equal("90", 90)] },
        { kind: "wrong_expectation", name: "combined units", checks: [equal("1h30m", 90)] },
        {
          kind: "misses_the_point",
          name: "hours and minutes are understood",
          checks: [equal("1h", 3600), equal("30m", 1800)],
        },
        { kind: "vacuous", name: "combined units", checks: [{ is: "called", input: "1h30m" }] },
      ],
    },
    {
      criterion: 'A bare number with no unit, such as "90", is returned as that many seconds.',
      breaker: variant(duration, "no_bare_number"),
      candidates: [
        { kind: "good", name: "a bare number is seconds", checks: [equal("90", 90)] },
        { kind: "good", name: "numbers alone count as seconds", checks: [equal("5", 5), equal("120", 120)] },
        { kind: "name_lies", name: "a bare number is seconds", checks: [equal("90s", 90)] },
        { kind: "wrong_expectation", name: "a bare number is seconds", checks: [equal("90", 5400)] },
        {
          kind: "misses_the_point",
          name: "seconds come back as a number",
          checks: [{ is: "type", input: "90s", type: "number" }],
        },
        { kind: "vacuous", name: "a bare number is seconds", checks: [{ is: "called", input: "90" }] },
      ],
    },
    {
      criterion: 'A decimal part is accepted, so "1.5h" returns 5400.',
      breaker: variant(duration, "no_decimals"),
      candidates: [
        { kind: "good", name: "a part can be a decimal", checks: [equal("1.5h", 5400)] },
        { kind: "good", name: "decimal amounts work", checks: [equal("0.5m", 30), equal("2.5h", 9000)] },
        { kind: "name_lies", name: "a part can be a decimal", checks: [equal("1h30m", 5400)] },
        { kind: "wrong_expectation", name: "a part can be a decimal", checks: [equal("1.5h", 3900)] },
        { kind: "misses_the_point", name: "hours are parsed", checks: [equal("2h", 7200)] },
        { kind: "vacuous", name: "a part can be a decimal", checks: [{ is: "called", input: "1.5h" }] },
      ],
    },
    {
      criterion: 'Upper-case unit letters are accepted, so "1H30M" returns 5400.',
      breaker: variant(duration, "no_upper_case"),
      candidates: [
        { kind: "good", name: "units can be upper case", checks: [equal("1H30M", 5400)] },
        { kind: "good", name: "capital unit letters work", checks: [equal("45S", 45), equal("2H", 7200)] },
        { kind: "name_lies", name: "units can be upper case", checks: [equal("1h30m", 5400)] },
        { kind: "wrong_expectation", name: "upper case units", checks: [equal("1H30M", null)] },
        {
          kind: "misses_the_point",
          name: "units are read whatever the spacing",
          checks: [equal("1h 30m", 5400)],
        },
        { kind: "vacuous", name: "units can be upper case", checks: [{ is: "called", input: "1H30M" }] },
      ],
    },
    {
      criterion: 'Units written smaller before larger, such as "30m1h", return null.',
      breaker: variant(duration, "any_order"),
      candidates: [
        { kind: "good", name: "units must go from largest to smallest", checks: [equal("30m1h", null)] },
        {
          kind: "good",
          name: "out of order units are rejected",
          checks: [equal("15s2m", null), equal("1s1h", null)],
        },
        { kind: "name_lies", name: "units out of order are rejected", checks: [equal("abc", null)] },
        { kind: "wrong_expectation", name: "units in any order", checks: [equal("30m1h", 5400)] },
        { kind: "misses_the_point", name: "largest unit first works", checks: [equal("1h30m", 5400)] },
        { kind: "vacuous", name: "units must go in order", checks: [{ is: "called", input: "30m1h" }] },
      ],
    },
    {
      criterion: 'Text with an unknown unit, such as "1x", returns null.',
      breaker: variant(duration, "zero_for_unknown"),
      candidates: [
        { kind: "good", name: "text that is not a duration is null", checks: [equal("1x", null)] },
        { kind: "good", name: "unknown units are null", checks: [equal("5d", null), equal("10q", null)] },
        { kind: "name_lies", name: "unknown units are null", checks: [equal("", null)] },
        { kind: "wrong_expectation", name: "unknown units count as nothing", checks: [equal("1x", 0)] },
        {
          kind: "misses_the_point",
          name: "an unknown unit gives no duration",
          checks: [{ is: "falsy", input: "1x" }],
        },
        { kind: "vacuous", name: "unknown units are null", checks: [{ is: "called", input: "1x" }] },
      ],
    },
  ],
};

const call = (fn: string, check: Check) => `${fn}(${JSON.stringify(check.input)})`;

function asCode(fn: string, check: Check): string {
  switch (check.is) {
    case "equal":
      return `assert.equal(${call(fn, check)}, ${JSON.stringify(check.expected)});`;
    case "type":
      return `assert.equal(typeof ${call(fn, check)}, ${JSON.stringify(check.type)});`;
    case "falsy":
      return `assert.ok(!${call(fn, check)});`;
    case "called":
      return `${call(fn, check)};\n  assert.ok(true);`;
  }
}

function asProse(fn: string, check: Check): string {
  switch (check.is) {
    case "equal":
      return `${call(fn, check)} must return ${JSON.stringify(check.expected)}.`;
    case "type":
      return `${call(fn, check)} must return a ${check.type}.`;
    case "falsy":
      return `${call(fn, check)} must return something falsy.`;
    case "called":
      return `${call(fn, check)} must run without throwing.`;
  }
}

const code = (fn: string, name: string, candidate: Candidate) =>
  `test(${JSON.stringify(name)}, () => {\n${candidate.checks.map((c) => `  ${asCode(fn, c)}`).join("\n")}\n});`;

const prose = (fn: string, candidate: Candidate) =>
  `Test "${candidate.name}": ${candidate.checks.map((c) => asProse(fn, c)).join(" ")}`;

interface Case {
  readonly toy: string;
  readonly criterion: string;
  readonly kind: Kind;
  readonly truth: "checks" | "does_not_check";
  /** Whether the test fails on the untouched starting code, as the lane would require. */
  readonly redOnStart: boolean;
  readonly form: "code" | "prose";
  readonly state: object;
}

/** The ids of the tests in `file` that pass against `source`, or the starting code when `null`. */
async function passing(suite: Suite, file: string, source: string | null): Promise<ReadonlySet<string>> {
  const { dir } = await checkoutToy(suite.toy.fixture);
  if (source !== null) await writeFile(join(dir, suite.toy.file), source);
  await writeFile(join(dir, "candidates.test.js"), file);
  const checked = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Workspace).check();
    }).pipe(Effect.provide(localWorkspace(dir, { test: ["node", "--test"] }))),
  );
  return new Set(checked.passingTests);
}

/** Run every candidate to find out what it really checks, then lay out the cases. */
async function casesOf(suite: Suite): Promise<Case[]> {
  const ids = suite.subjects.map((subject, s) => subject.candidates.map((_, c) => `s${s}c${c}`));
  const file = [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    `import { ${suite.fn} } from "./${suite.toy.file}";`,
    ...suite.subjects.flatMap((subject, s) =>
      subject.candidates.map((candidate, c) => code(suite.fn, ids[s]?.[c] as string, candidate)),
    ),
  ].join("\n\n");
  const onCorrect = await passing(suite, file, variant(suite.toy, "correct"));
  const onStart = await passing(suite, file, null);
  const cases: Case[] = [];
  for (const [s, subject] of suite.subjects.entries()) {
    const onBroken = await passing(suite, file, subject.breaker);
    for (const [c, candidate] of subject.candidates.entries()) {
      const id = ids[s]?.[c] as string;
      const checks = onCorrect.has(id) && !onBroken.has(id);
      if (checks !== (candidate.kind === "good")) {
        throw new Error(`${suite.fn} "${candidate.name}" (${candidate.kind}) is mislabelled`);
      }
      const base = {
        toy: suite.toy.fixture,
        criterion: subject.criterion,
        kind: candidate.kind,
        truth: checks ? "checks" : "does_not_check",
        redOnStart: !onStart.has(id),
      } as const;
      const state = (test: string) => ({ issue: suite.toy.title, criterion: subject.criterion, test });
      cases.push({ ...base, form: "code", state: state(code(suite.fn, candidate.name, candidate)) });
      cases.push({ ...base, form: "prose", state: state(prose(suite.fn, candidate)) });
    }
  }
  return cases;
}

const cases = [...(await casesOf(slugifySuite)), ...(await casesOf(durationSuite))];
const asked = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(asked, 8, (c) => ask(questions, "fit", c.state));
const rows = asked.map((c, i) => {
  const { state, ...rest } = c;
  return { ...rest, test: (state as { test: string }).test, ...(answers[i] as Answer) };
});
await writeFile(
  join(import.meta.dirname, "results", "test-check-calibration.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);

type Row = (typeof rows)[number];
const FLOOR = 0.8;
const pct = (part: number, whole: number) =>
  whole === 0 ? "   -" : `${Math.round((100 * part) / whole)}%`.padStart(4);
const right = (r: Row) => r.choice === r.truth;
const sure = (r: Row) => r.confidence >= FLOOR && r.choice !== "cannot_tell";
const mean = (group: readonly Row[]) =>
  (group.reduce((sum, r) => sum + r.confidence, 0) / Math.max(group.length, 1)).toFixed(2);

console.log(`${cases.length} cases, ${rows.length} answers\n`);

for (const form of ["code", "prose"] as const) {
  const shown = rows.filter((r) => r.form === form);
  console.log(`Shown as ${form}:`);
  console.log("  kind               answers  right  sure and right  sure and wrong  mean confidence");
  for (const kind of ["good", "name_lies", "wrong_expectation", "misses_the_point", "vacuous"] as const) {
    const group = shown.filter((r) => r.kind === kind);
    console.log(
      `  ${kind.padEnd(18)} ${String(group.length).padStart(7)}  ${pct(group.filter(right).length, group.length)}       ${pct(group.filter((r) => sure(r) && right(r)).length, group.length)}            ${pct(group.filter((r) => sure(r) && !right(r)).length, group.length)}             ${mean(group)}`,
    );
  }
  console.log("  confidence     answers  right");
  for (const [low, high] of [[0, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
    const band = shown.filter((r) => r.confidence >= low && r.confidence < high);
    console.log(
      `  ${low.toFixed(1)} to ${Math.min(high, 1).toFixed(1)}   ${String(band.length).padStart(7)}  ${pct(band.filter(right).length, band.length)}`,
    );
  }
  const acted = shown.filter(sure);
  const accepted = acted.filter((r) => r.choice === "checks" && r.truth === "does_not_check");
  const refused = acted.filter((r) => r.choice === "does_not_check" && r.truth === "checks");
  console.log(
    `  at the ${FLOOR} floor: acts on ${pct(acted.length, shown.length).trim()}, accepts a bad test ${accepted.length} times, refuses a good one ${refused.length} times\n`,
  );
}

const once = cases.filter((c) => c.form === "code");
const bad = once.filter((c) => c.truth === "does_not_check");
console.log("What the machine's own check already settles:");
console.log(`  bad tests that pass on the starting code (it throws these out): ${bad.filter((c) => !c.redOnStart).length} of ${bad.length}`);
console.log(`  bad tests that fail on the starting code (only the judge can catch): ${bad.filter((c) => c.redOnStart).length} of ${bad.length}`);
const goodGreen = once.filter((c) => c.truth === "checks" && !c.redOnStart);
console.log(`  good tests that already pass on the starting code: ${goodGreen.length} of ${once.length - bad.length}`);
for (const c of goodGreen) console.log(`    ${c.criterion}`);

for (const form of ["code", "prose"] as const) {
  const slipped = rows.filter((r) => r.form === form && r.truth === "does_not_check" && r.redOnStart);
  console.log(
    `\nBad tests only the judge can catch, shown as ${form} (${slipped.length} answers): caught ${slipped.filter((r) => sure(r) && right(r)).length}, accepted ${slipped.filter((r) => sure(r) && !right(r)).length}, unsure ${slipped.filter((r) => !sure(r)).length}`,
  );
}

const misses = rows.filter((r) => sure(r) && !right(r));
if (misses.length > 0) {
  console.log("\nSure and wrong:");
  for (const r of misses) {
    console.log(`  [${r.form}] ${r.kind} said ${r.choice} ${r.confidence}: ${r.criterion}\n      ${r.test.replaceAll("\n", " ")}`);
  }
}
