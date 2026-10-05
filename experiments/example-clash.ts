// Does anything catch a wrong example?
//
// With criteria as data, each criterion's example becomes a visible test, and
// a wrong example (`parseDuration("1.5h") -> 4500`) becomes a wrong test the
// builder codes to. Jev cannot tell a right result from a wrong one
// (experiment 18). The idea under test: something written from the rules
// alone, without the examples, disagrees with a wrong one. Three such things:
//
//   reference  an agent writes a quick throwaway implementation from the
//              rules; the example's call is run on it
//   hidden     an agent writes hidden tests from the rules; they are run on
//              code that follows the wrong example: the code that misreads or
//              skips the rule, and code a real builder writes to the example
//   builder    the builder, shown the rules and the examples, may say an
//              example contradicts its rule instead of coding to it
//
// Every detector is also run on correct examples, to count false alarms.
//
// The rules come in two wordings. `clear` says each rule plainly. `loose` is
// how a person might file it, and leaves room to misread: both agents may then
// make the same mistake as the wrong example, and nothing would disagree.
//
// BUILD=loose shows the builder the loose rules instead of the clear ones.
//
// Run with `node experiments/example-clash.ts`; needs `claude`.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { turn } from "../src/claude.ts";
import { checkoutToy } from "../src/local.ts";
import { type Example, agrees, testFile } from "./examples.ts";
import { passing, testsIn } from "./grading.ts";
import { pool } from "./jev.ts";
import { duration, slugifyOneClaim, type Toy, variant } from "./toys.ts";

const RUNS = 3;
const HIDDEN_FILE = "hidden.test.js";
const VISIBLE_FILE = "criteria.test.js";
type Wording = "clear" | "loose";
/** The wording the builder is shown. BUILD=loose shows it the loose rules. */
const BUILD: Wording = process.env.BUILD === "loose" ? "loose" : "clear";

interface Rule {
  readonly id: string;
  readonly clear: string;
  readonly loose: string;
  /** The criterion's own example, which the correct code satisfies. */
  readonly example: Example;
}

/** An example that the correct code does not satisfy. */
interface Wrong extends Example {
  readonly rule: string;
  readonly kind: "skips_rule" | "misreads_rule" | "off_value";
  /** Code that follows this wrong example in general, when there is such code. */
  readonly follows: string | null;
}

interface Subject {
  readonly toy: Toy;
  readonly fn: string;
  readonly ownTests: string;
  readonly about: Readonly<Record<Wording, string>>;
  readonly rules: readonly Rule[];
  readonly wrong: readonly Wrong[];
  /** Code for each misreading: what someone who read the rule that way would write. */
  readonly misreadings: Readonly<Record<string, string>>;
}

const slugifyOf = (body: string) => `export function slugify(title) {\n${body}\n}\n`;
const durationCorrect = variant(duration, "correct");

const slugify: Subject = {
  toy: slugifyOneClaim,
  fn: "slugify",
  ownTests: "slugify.test.js",
  about: {
    clear: "slugify(title) turns a title into a slug that can go in a URL.",
    loose: "slugify should give me something i can put in a URL.",
  },
  rules: [
    { id: "c1", clear: "Upper-case letters come out lower case.", loose: "The slug is lower case.", example: { call: `slugify("Hello")`, result: `"hello"` } },
    { id: "c2", clear: "A run of one or more spaces between two words becomes one dash.", loose: "Spaces between words become dashes.", example: { call: `slugify("a   b")`, result: `"a-b"` } },
    { id: "c3", clear: "Punctuation is removed.", loose: "No punctuation in the slug.", example: { call: `slugify("hello, world!")`, result: `"hello-world"` } },
    { id: "c4", clear: "Accented letters are removed entirely, not turned into plain letters.", loose: "Accented letters are not kept as they are.", example: { call: `slugify("héllo")`, result: `"hllo"` } },
  ],
  wrong: [
    { rule: "c1", kind: "skips_rule", call: `slugify("Hello")`, result: `"Hello"`, follows: "no_lower_case" },
    { rule: "c1", kind: "off_value", call: `slugify("Hello")`, result: `"hell"`, follows: null },
    { rule: "c2", kind: "misreads_rule", call: `slugify("a   b")`, result: `"a---b"`, follows: "one_dash_per_space" },
    { rule: "c2", kind: "off_value", call: `slugify("a   b")`, result: `"a-"`, follows: null },
    { rule: "c3", kind: "skips_rule", call: `slugify("hello, world!")`, result: `"hello,-world!"`, follows: "leaves_punctuation" },
    { rule: "c3", kind: "off_value", call: `slugify("hello, world!")`, result: `"hello-worl"`, follows: null },
    { rule: "c4", kind: "misreads_rule", call: `slugify("héllo")`, result: `"hello"`, follows: "plain_letters" },
    { rule: "c4", kind: "skips_rule", call: `slugify("héllo")`, result: `"héllo"`, follows: "leaves_accents" },
    { rule: "c4", kind: "off_value", call: `slugify("héllo")`, result: `"hll"`, follows: null },
  ],
  misreadings: {
    // Turns é into e instead of dropping it.
    plain_letters: slugifyOf(
      String.raw`  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "-");`,
    ),
  },
};

const durationText: Subject = {
  toy: duration,
  fn: "parseDuration",
  ownTests: "duration.test.js",
  about: {
    clear:
      'parseDuration(text) turns a duration such as "1h30m" into its total number of seconds, and returns null for text that is not a valid duration.',
    loose: 'parseDuration always gives null. i need it to turn things like "1h30m" into seconds.',
  },
  rules: [
    { id: "c1", clear: "Hours and minutes written together are added up.", loose: "Hours and minutes can be written together.", example: { call: `parseDuration("1h30m")`, result: "5400" } },
    { id: "c2", clear: "A bare number with no unit is read as seconds.", loose: "A plain number works too.", example: { call: `parseDuration("90")`, result: "90" } },
    { id: "c3", clear: "A part's number can be a decimal, and counts in full.", loose: "Decimals are allowed.", example: { call: `parseDuration("1.5h")`, result: "5400" } },
    { id: "c4", clear: "Unit letters can be upper case.", loose: "Upper case units work too.", example: { call: `parseDuration("1H30M")`, result: "5400" } },
    { id: "c5", clear: "Units written smaller before larger give null.", loose: "Units have to be in order.", example: { call: `parseDuration("30m1h")`, result: "null" } },
    { id: "c6", clear: "Text with an unknown unit gives null.", loose: "Unknown units are rejected.", example: { call: `parseDuration("1x")`, result: "null" } },
  ],
  wrong: [
    { rule: "c1", kind: "skips_rule", call: `parseDuration("1h30m")`, result: "null", follows: "single_unit_only" },
    { rule: "c1", kind: "off_value", call: `parseDuration("1h30m")`, result: "4500", follows: null },
    { rule: "c2", kind: "skips_rule", call: `parseDuration("90")`, result: "null", follows: "no_bare_number" },
    { rule: "c2", kind: "misreads_rule", call: `parseDuration("90")`, result: "5400", follows: "bare_minutes" },
    { rule: "c3", kind: "skips_rule", call: `parseDuration("1.5h")`, result: "null", follows: "no_decimals" },
    { rule: "c3", kind: "misreads_rule", call: `parseDuration("1.5h")`, result: "3600", follows: "decimals_dropped" },
    { rule: "c3", kind: "off_value", call: `parseDuration("1.5h")`, result: "4500", follows: null },
    { rule: "c4", kind: "skips_rule", call: `parseDuration("1H30M")`, result: "null", follows: "no_upper_case" },
    { rule: "c4", kind: "off_value", call: `parseDuration("1H30M")`, result: "5040", follows: null },
    { rule: "c5", kind: "skips_rule", call: `parseDuration("30m1h")`, result: "5400", follows: "any_order" },
    { rule: "c6", kind: "misreads_rule", call: `parseDuration("1x")`, result: "0", follows: "zero_for_unknown" },
  ],
  misreadings: {
    // A bare number counted as minutes.
    bare_minutes: durationCorrect.replace("return Number(input);", "return Number(input) * 60;"),
    // The decimal part of each number thrown away.
    decimals_dropped: durationCorrect.replace(
      "return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);",
      "return Math.trunc(Number(hours)) * 3600 + Math.trunc(Number(minutes)) * 60 + Math.trunc(Number(seconds));",
    ),
  },
};

const subjects: readonly Subject[] = [slugify, durationText];

const sourceOf = (subject: Subject, name: string) => subject.misreadings[name] ?? variant(subject.toy, name);

const rulesText = (subject: Subject, wording: Wording) =>
  subject.rules.map((r) => `- [${r.id}] ${r[wording]}`).join("\n");

// --- what agents write from the rules alone ----------------------------------

async function reference(subject: Subject, wording: Wording): Promise<string> {
  const { toy, fn } = subject;
  const { dir } = await checkoutToy(toy.fixture, { without: [subject.ownTests] });
  await turn(
    dir,
    {},
    {
      prompt: [
        `Implement \`${fn}\` in ${toy.file}. ${subject.about[wording]}`,
        `The rules:\n${rulesText(subject, wording)}`,
        `Follow the rules and nothing else. Change no other file. You cannot run commands. Reply with one sentence when done.`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  return readFile(join(dir, toy.file), "utf8");
}

async function hidden(subject: Subject, wording: Wording): Promise<string> {
  const { toy, fn } = subject;
  const { dir } = await checkoutToy(toy.fixture, { without: [subject.ownTests] });
  await turn(
    dir,
    {},
    {
      prompt: [
        `You write hidden tests for an issue before anyone implements it. The implementer never sees them; they catch code that handles a few examples and not the rule.`,
        `\`${fn}\` in ${toy.file} is only a starting point. ${subject.about[wording]}`,
        `The rules:\n${rulesText(subject, wording)}`,
        [
          `Write ${HIDDEN_FILE} with node:test and node:assert/strict, importing from ./${toy.file}.`,
          `- 3 tests per rule, each with a different input. Start each name with the rule's id and a colon, like "c1: ...", and make every name different.`,
          `- Each test checks its rule and nothing the rules do not promise. Correct code must pass every one.`,
          `- Only top-level test() calls. Change no other file. You cannot run commands.`,
        ].join("\n"),
        `Reply with one sentence when done.`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  return readFile(join(dir, HIDDEN_FILE), "utf8").catch(() => "");
}

// --- the builder, shown the rules and the examples ---------------------------

const builderSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "note"],
  properties: {
    status: { type: "string", enum: ["done", "contradiction"] },
    note: { type: "string", description: "One sentence: what you changed, or which example contradicts which rule" },
  },
};

interface Built {
  readonly source: string;
  readonly status: string;
  readonly note: string;
}

async function build(subject: Subject, examples: readonly (Example & { readonly id: string })[]): Promise<Built> {
  const { toy, fn } = subject;
  const { dir } = await checkoutToy(toy.fixture, { without: [subject.ownTests] });
  await writeFile(join(dir, VISIBLE_FILE), testFile(toy.file, fn, examples));
  const criteria = subject.rules
    .map((r) => {
      const mine = examples.filter((e) => e.id === r.id).map((e) => `${e.call} returns ${e.result}`);
      return `- [${r.id}] ${r[BUILD]} Example: ${mine.join("; ")}`;
    })
    .join("\n");
  const result = await turn(
    dir,
    {},
    {
      prompt: [
        `Implement this issue by editing ${toy.file}. ${subject.about[BUILD]}`,
        `Acceptance criteria, each with its example:\n${criteria}`,
        `${VISIBLE_FILE} asserts every example. You cannot run commands; the tests are run for you, and editing a test file has no effect.`,
        `If an example contradicts its own rule, do not code around it: answer status "contradiction" and say which. Otherwise answer "done".`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      edits: true,
      schema: builderSchema,
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  const answer = result.structured as { status: string; note: string };
  return { source: await readFile(join(dir, toy.file), "utf8"), status: answer.status, note: answer.note };
}

// --- the run -----------------------------------------------------------------

const correctExamples = (subject: Subject) => subject.rules.map((r) => ({ id: r.id, ...r.example }));

/** The hidden tests of one rule that `source` fails, out of the ones correct code passes. */
async function hiddenFailures(subject: Subject, file: string, sound: readonly string[], rule: string, source: string) {
  const passed = await passing(subject.toy, file, source);
  return sound.filter((name) => name.startsWith(`${rule}:`) && !passed.has(name));
}

async function runSubject(subject: Subject) {
  const { toy, fn } = subject;
  for (const wrong of subject.wrong) {
    if (await agrees(variant(toy, "correct"), fn, wrong)) throw new Error(`${wrong.call} -> ${wrong.result} is not wrong`);
    if (wrong.follows !== null && !(await agrees(sourceOf(subject, wrong.follows), fn, wrong))) {
      throw new Error(`${wrong.follows} does not give ${wrong.call} -> ${wrong.result}`);
    }
  }
  const wordings: readonly Wording[] = ["clear", "loose"];
  const written = await pool(
    wordings.flatMap((wording) => Array.from({ length: RUNS }, (_, n) => ({ wording, n }))),
    6,
    async ({ wording, n }) => {
      const [ref, hiddenFile] = await Promise.all([reference(subject, wording), hidden(subject, wording)]);
      const tests = testsIn(hiddenFile).map((t) => t.name);
      const onCorrect = await passing(toy, hiddenFile, variant(toy, "correct"));
      return { wording, n, ref, hiddenFile, tests, sound: tests.filter((t) => onCorrect.has(t)) };
    },
  );

  // Builders: one per wrong example, and RUNS with only correct examples as the control.
  const jobs = [
    ...subject.wrong.map((wrong) => ({ wrong })),
    ...Array.from({ length: RUNS }, () => ({ wrong: null as Wrong | null })),
  ];
  const built = await pool(jobs, 5, async ({ wrong }) => {
    const examples = correctExamples(subject).map((e) =>
      wrong !== null && e.id === wrong.rule ? { id: e.id, call: wrong.call, result: wrong.result } : e,
    );
    return { wrong, ...(await build(subject, examples)) };
  });

  const clearHidden = written.filter((w) => w.wording === "clear");
  const onExample = async (example: Example & { readonly rule: string }, follows: string | null, builtFor: Built | undefined) => ({
    // References whose answer differs from the example, per wording.
    references: Object.fromEntries(
      await Promise.all(
        wordings.map(async (wording) => {
          const refs = written.filter((w) => w.wording === wording);
          const differ = await Promise.all(refs.map(async (w) => !(await agrees(w.ref, fn, example))));
          return [wording, differ.filter(Boolean).length] as const;
        }),
      ),
    ),
    // Hidden sets with a test of this rule that fails on code following the example, per wording.
    hiddenOnFollower:
      follows === null
        ? null
        : Object.fromEntries(
            await Promise.all(
              wordings.map(async (wording) => {
                const sets = written.filter((w) => w.wording === wording);
                const caught = await Promise.all(
                  sets.map(async (w) => (await hiddenFailures(subject, w.hiddenFile, w.sound, example.rule, sourceOf(subject, follows))).length > 0),
                );
                return [wording, caught.filter(Boolean).length] as const;
              }),
            ),
          ),
    // Clear hidden sets with a test of this rule that fails on what the builder wrote.
    hiddenOnBuilder:
      builtFor === undefined
        ? null
        : (
            await Promise.all(
              clearHidden.map(async (w) => (await hiddenFailures(subject, w.hiddenFile, w.sound, example.rule, builtFor.source)).length > 0),
            )
          ).filter(Boolean).length,
    builderSaid: builtFor?.status ?? null,
    builderNote: builtFor?.note ?? null,
    builderFollowsExample: builtFor === undefined ? null : await agrees(builtFor.source, fn, example),
  });

  const wrongRows = await Promise.all(
    subject.wrong.map(async (wrong) => ({
      ...wrong,
      ...(await onExample(wrong, wrong.follows, built.find((b) => b.wrong === wrong))),
    })),
  );
  const controls = built.filter((b) => b.wrong === null);
  const correctRows = await Promise.all(
    subject.rules.map(async (r) => ({
      rule: r.id,
      ...r.example,
      ...(await onExample({ rule: r.id, ...r.example }, null, undefined)),
      // Control builders whose code a clear hidden test of this rule fails.
      hiddenOnControls: (
        await Promise.all(
          controls.map(async (b) =>
            (await Promise.all(clearHidden.map(async (w) => (await hiddenFailures(subject, w.hiddenFile, w.sound, r.id, b.source)).length > 0))).some(Boolean),
          ),
        )
      ).filter(Boolean).length,
    })),
  );
  return {
    toy: toy.fixture,
    hiddenTests: written.map((w) => ({ wording: w.wording, tests: w.tests.length, wrongOnCorrect: w.tests.length - w.sound.length })),
    referencesCorrect: await Promise.all(
      written.map(async (w) => ({ wording: w.wording, passesToyTests: await referencePassesAll(subject, w.ref) })),
    ),
    controls: controls.map((b) => ({ status: b.status, note: b.note })),
    wrong: wrongRows,
    correct: correctRows,
  };
}

const results = await pool(subjects, 2, runSubject);

/** Does a reference agree with the correct code on every input the toy's own tests use? */
async function referencePassesAll(subject: Subject, source: string): Promise<boolean> {
  const own = await readFile(join(import.meta.dirname, "..", "fixtures", subject.toy.fixture, "repo", subject.ownTests), "utf8");
  const passed = await passing(subject.toy, own, source);
  return testsIn(own).every((t) => passed.has(t.name));
}

await writeFile(join(import.meta.dirname, "results", `example-clash${BUILD === "loose" ? "-loose-builder" : ""}.json`), `${JSON.stringify(results, null, 2)}\n`);

for (const r of results) {
  console.log(`\n${r.toy}`);
  for (const h of ["clear", "loose"] as const) {
    const sets = r.hiddenTests.filter((t) => t.wording === h);
    const refs = r.referencesCorrect.filter((t) => t.wording === h);
    console.log(
      `  ${h}: hidden tests wrong on correct code ${sets.reduce((n, s) => n + s.wrongOnCorrect, 0)} of ${sets.reduce((n, s) => n + s.tests, 0)}; references passing the toy's own tests ${refs.filter((x) => x.passesToyTests).length} of ${refs.length}`,
    );
  }
  console.log(`  control builders said: ${r.controls.map((c) => c.status).join(", ")}`);
  console.log(`  ${"wrong example".padEnd(40)} kind           refs differ (clear/loose)  hidden on follower (c/l)  hidden on builder  builder`);
  for (const w of r.wrong) {
    console.log(
      `  ${`${w.call} -> ${w.result}`.padEnd(40)} ${w.kind.padEnd(14)} ${`${w.references.clear}/${RUNS} ${w.references.loose}/${RUNS}`.padEnd(25)} ${(w.hiddenOnFollower === null ? "-" : `${w.hiddenOnFollower.clear}/${RUNS} ${w.hiddenOnFollower.loose}/${RUNS}`).padEnd(25)} ${`${w.hiddenOnBuilder}/${RUNS}`.padEnd(18)} ${w.builderSaid}${w.builderFollowsExample ? " (coded to it)" : ""}`,
    );
  }
  console.log(`  ${"correct example".padEnd(40)}                refs differ (clear/loose)  hidden on control builders`);
  for (const c of r.correct) {
    console.log(`  ${`${c.call} -> ${c.result}`.padEnd(55)} ${`${c.references.clear}/${RUNS} ${c.references.loose}/${RUNS}`.padEnd(25)} ${c.hiddenOnControls}/${RUNS}`);
  }
}
