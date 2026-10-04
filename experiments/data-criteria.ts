// Can triage write each criterion as data: a rule, a call, and the call's exact result?
//
// If it can, code writes the visible tests straight from the examples, and no
// agent writes them and no judge checks they fit. Two things could break that:
// rules that do not fit one call and its result, and results triage gets wrong,
// since it reads the code but cannot run it.
//
// SET=toys (the default) runs triage on the two toys and checks every example
// by running it:
//
//   wrong      the correct code returns something else
//   empty      the starting code already returns it
//   broken     how many broken versions of the toy at least one example rejects
//
// SPEC=ticket hides the toy's own tests from triage, as in experiment 16.
//
// SET=demlik runs triage on real closed demlik issues, at the commit before
// each fix, and only counts how many rules fit the shape. Their results are not
// run: tea's calls need a machine around them, not one function.
//
// Run with `node experiments/data-criteria.ts`; needs `claude`.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { turn } from "../src/claude.ts";
import { checkoutToy } from "../src/local.ts";
import { pool } from "./jev.ts";
import { duration, slugifyOneClaim, type Toy, variant } from "./toys.ts";

const run = promisify(execFile);
const RUNS = 3;
const SET = process.env.SET ?? "toys";
const TICKET_ONLY = process.env.SPEC === "ticket";

interface Example {
  readonly call: string;
  readonly result: string;
}

interface DataCriterion {
  readonly id: string;
  readonly rule: string;
  readonly examples: readonly Example[];
  /** Why the rule cannot be shown by a call and its result, when it cannot. */
  readonly no_example: string | null;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "goal", "criteria"],
  properties: {
    title: { type: "string" },
    goal: { type: "string", description: "One sentence saying what the code does once this issue is done." },
    criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "rule", "examples", "no_example"],
        properties: {
          id: { type: "string", description: "A short kebab-case name" },
          rule: { type: "string", description: "The rule in one plain sentence, one claim" },
          examples: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["call", "result"],
              properties: {
                call: { type: "string", description: "One JavaScript expression, e.g. formatPrice(3.5)" },
                result: { type: "string", description: 'The exact value as a JavaScript literal, e.g. "3.50"' },
              },
            },
          },
          no_example: {
            type: ["string", "null"],
            description: "null when examples show the rule; otherwise why no call and result can",
          },
        },
      },
    },
  },
};

const DATA_BRIEF = [
  `How your criteria will be used: each criterion is data, a rule and the examples that prove it. An example is one JavaScript call and the exact value it returns, such as call \`formatPrice(3.5)\` and result \`"3.50"\`. Code turns every example into \`assert.deepStrictEqual(<call>, <result>)\` and runs it against the finished code, with no person or model in between. So the call must run exactly as written, and the result must be exactly right.`,
  `- One claim per rule. A sentence that says two things becomes two criteria.`,
  `- Give each rule one example, or more only when one cannot show it. Pick an input that the rule decides: a test of "upper case becomes lower case" needs an upper-case letter in it.`,
  `- Say what the finished code does. A rule it has to follow gets a criterion even when the starting code happens to follow it already. Leave out only what the issue does not touch.`,
  `- If a rule cannot be shown by a call and its result (it is about types, timing, files, docs or side effects), leave examples empty and say why in no_example. Do not force it.`,
].join("\n");

function prompt(title: string, body: string): string {
  return [
    `You are triaging one raw issue for the code in the current folder. Turn it into an issue a builder can pick up cold. You write no code, and you cannot run anything.`,
    `# ${title}`,
    body,
    [
      `Rules:`,
      `- Never work from the title alone. Read the code the issue is about first, and check what the issue claims against it.`,
      `- No invention. Write only what you found or what the issue says.`,
      `- The first criterion states the user's job as an outcome someone could observe.`,
      `- Write one criterion for each rule you found, most important first.`,
    ].join("\n"),
    DATA_BRIEF,
  ].join("\n\n");
}

interface Triaged {
  readonly title: string;
  readonly goal: string;
  readonly criteria: readonly DataCriterion[];
}

async function triage(dir: string, title: string, body: string): Promise<Triaged> {
  const result = await turn(
    dir,
    { timeoutMs: 15 * 60 * 1000 },
    { prompt: prompt(title, body), session: null, tools: ["Read", "Glob", "Grep"], schema },
    AbortSignal.timeout(15 * 60 * 1000),
  );
  return result.structured as Triaged;
}

// --- toys -------------------------------------------------------------------

interface Subject {
  readonly toy: Toy;
  readonly fn: string;
  readonly ownTests: string;
}

const subjects: readonly Subject[] = [
  { toy: slugifyOneClaim, fn: "slugify", ownTests: "slugify.test.js" },
  { toy: duration, fn: "parseDuration", ownTests: "duration.test.js" },
];

type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/** Run one example's call against `source` and say whether it returns the example's result. */
async function outcome(source: string, fn: string, example: Example): Promise<Outcome> {
  try {
    const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as Record<string, unknown>;
    const value = new Function(fn, `return (${example.call});`)(module[fn]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

const expected = (example: Example): Outcome => {
  try {
    return { ok: true, value: new Function(`return (${example.result});`)() };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

const holds = (got: Outcome, want: Outcome) => got.ok && want.ok && isDeepStrictEqual(got.value, want.value);

interface CheckedExample extends Example {
  readonly runnable: boolean;
  readonly wrong: boolean;
  /** What the correct code really returns, when the example is wrong. */
  readonly actual: string | null;
  readonly empty: boolean;
}

interface ToyRun {
  readonly toy: string;
  readonly run: number;
  readonly criteria: readonly (DataCriterion & { readonly checked: readonly CheckedExample[] })[];
  readonly uncaught: readonly string[];
  readonly broken: number;
}

async function toyRun({ toy, fn, ownTests }: Subject, n: number): Promise<ToyRun> {
  const { dir, raw } = await checkoutToy(toy.fixture, TICKET_ONLY ? { without: [ownTests] } : {});
  const start = await readFile(join(dir, toy.file), "utf8");
  const triaged = await triage(dir, raw.title, raw.body);
  const correct = variant(toy, "correct");
  const criteria = await Promise.all(
    triaged.criteria.map(async (c) => ({
      ...c,
      checked: await Promise.all(
        c.examples.map(async (example): Promise<CheckedExample> => {
          const want = expected(example);
          const got = await outcome(correct, fn, example);
          const runnable = want.ok && (got.ok || !/SyntaxError/.test(got.error));
          return {
            ...example,
            runnable,
            wrong: !holds(got, want),
            actual: holds(got, want) ? null : got.ok ? JSON.stringify(got.value) ?? String(got.value) : got.error,
            empty: holds(await outcome(start, fn, example), want),
          };
        }),
      ),
    })),
  );
  // The visible tests are the examples that hold on the correct code: a wrong
  // one would be sent back before any build.
  const sound = criteria.flatMap((c) => c.checked.filter((e) => !e.wrong));
  const broken = Object.keys(toy.variants).filter((name) => name !== "correct");
  const uncaught: string[] = [];
  for (const name of broken) {
    const results = await Promise.all(sound.map(async (e) => holds(await outcome(variant(toy, name), fn, e), expected(e))));
    if (results.every(Boolean)) uncaught.push(name);
  }
  return { toy: toy.fixture, run: n, criteria, uncaught, broken: broken.length };
}

async function toys() {
  const jobs = subjects.flatMap((subject) => Array.from({ length: RUNS }, (_, n) => ({ subject, n })));
  const runs = await pool(jobs, 3, ({ subject, n }) => toyRun(subject, n));
  await writeFile(
    join(import.meta.dirname, "results", `data-criteria${TICKET_ONLY ? "-ticket-only" : ""}.json`),
    `${JSON.stringify(runs, null, 2)}\n`,
  );
  for (const r of runs) {
    console.log(`\n${r.toy}#${r.run}`);
    for (const c of r.criteria) {
      console.log(`  ${c.rule}`);
      if (c.checked.length === 0) console.log(`      NO EXAMPLE: ${c.no_example}`);
      for (const e of c.checked) {
        const flags = [!e.runnable ? "UNRUNNABLE" : "", e.wrong ? `WRONG (really ${e.actual})` : "", e.empty ? "EMPTY" : ""]
          .filter(Boolean)
          .join(" ");
        console.log(`      ${e.call} -> ${e.result} ${flags}`);
      }
    }
    console.log(`  broken versions caught: ${r.broken - r.uncaught.length} of ${r.broken}${r.uncaught.length > 0 ? ` (missed: ${r.uncaught.join(", ")})` : ""}`);
  }
  const all = runs.flatMap((r) => r.criteria);
  const examples = all.flatMap((c) => c.checked);
  console.log(`\n${all.length} criteria over ${runs.length} runs; ${all.filter((c) => c.checked.length > 0).length} carry an example`);
  console.log(`${examples.length} examples: ${examples.filter((e) => e.wrong).length} wrong on the correct code (${examples.filter((e) => !e.runnable).length} would not run), ${examples.filter((e) => e.empty).length} already true on the starting code`);
  console.log(`criteria with every example wrong: ${all.filter((c) => c.checked.length > 0 && c.checked.every((e) => e.wrong)).length}`);
  console.log(`broken versions caught: ${runs.reduce((n, r) => n + r.broken - r.uncaught.length, 0)} of ${runs.reduce((n, r) => n + r.broken, 0)}`);
}

// --- demlik -----------------------------------------------------------------

const DEMLIK = join(process.env.HOME ?? "", "code/github.com/kamp-us/demlik");

/** Closed demlik issues and the commit that fixed each. Triage reads the code from just before it. */
const issues: readonly { readonly number: number; readonly fix: string }[] = [
  { number: 576, fix: "ccaa4f2" },
  { number: 568, fix: "df980b9" },
  { number: 567, fix: "36654cb" },
  { number: 565, fix: "5029103" },
  { number: 529, fix: "c2b4cad" },
  { number: 516, fix: "73b3187" },
  { number: 569, fix: "e446bff" },
];

async function demlikRun({ number, fix }: (typeof issues)[number]) {
  const { stdout } = await run("gh", ["issue", "view", String(number), "--repo", "kamp-us/demlik", "--json", "title,body"]);
  const { title, body } = JSON.parse(stdout) as { title: string; body: string };
  const dir = await mkdtemp(join(tmpdir(), `demlik-${number}-`));
  await run("git", ["-C", DEMLIK, "worktree", "add", "--detach", dir, `${fix}^`]);
  try {
    const triaged = await triage(dir, title, body);
    return { number, title, goal: triaged.goal, criteria: triaged.criteria };
  } finally {
    await run("git", ["-C", DEMLIK, "worktree", "remove", "--force", dir]);
    await rm(dir, { recursive: true, force: true });
  }
}

async function demlik() {
  const runs = await pool(issues, 4, demlikRun);
  await writeFile(join(import.meta.dirname, "results", "data-criteria-demlik.json"), `${JSON.stringify(runs, null, 2)}\n`);
  for (const r of runs) {
    console.log(`\n#${r.number} ${r.title}`);
    for (const c of r.criteria) {
      console.log(`  ${c.examples.length > 0 ? "FITS " : "NO   "} ${c.rule}`);
      for (const e of c.examples) console.log(`        ${e.call} -> ${e.result}`);
      if (c.examples.length === 0) console.log(`        why: ${c.no_example}`);
    }
  }
  const all = runs.flatMap((r) => r.criteria);
  console.log(`\n${all.length} criteria over ${runs.length} issues; ${all.filter((c) => c.examples.length > 0).length} carry an example`);
}

await (SET === "demlik" ? demlik() : toys());
