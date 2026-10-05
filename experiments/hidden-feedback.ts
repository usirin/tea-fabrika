// What may the builder hear from a hidden test that fails?
//
// Experiment 25 found the hidden tests leak: the feedback is the runner's
// output, and it holds each failing assertion's expected value. Three ways to
// answer a failed hidden test are tried here, on the duration toy, starting from
// its hand-written ticket (3 rules: minutes, combining units, null on junk):
//
//   full    the runner's output, as the lane does today
//   name    the names of the failing tests, and nothing else
//   ticket  the ticket missed a rule: a triage turn, shown only the failing
//           test's name, writes the rule an example; it joins the ticket and
//           the visible tests, and the builder is told the new rule
//
// Each run builds until everything passes or 4 builds are spent. The finished
// code is then scored on 20 held-out tests: the same rules as the hidden tests,
// other values, never run during the build. Passing them means the builder
// learned the rules; passing only the hidden tests may mean it copied answers.
//
// Run with `node experiments/hidden-feedback.ts`; needs `claude`. RUNS=<n> per way.
import { readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { Effect } from "effect";
import { claudeBuilder, turn } from "../src/claude.ts";
import { type Criterion, type Issue, testName } from "../src/issue.ts";
import { checkoutToy, localWorkspace } from "../src/local.ts";
import { type BuildAnswer, Builder, Workspace } from "../src/services.ts";
import { agrees } from "./examples.ts";
import { pool } from "./jev.ts";

const RUNS = Number(process.env.RUNS ?? 5);
const MAX_BUILDS = 4;
const HIDDEN = join(import.meta.dirname, "..", "fixtures", "duration", "hidden");
const run = promisify(execFile);

/** Correct, written by hand from the hidden tests. Checked against them before anything runs. */
const REFERENCE = String.raw`export function parseDuration(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/i.exec(t);
  if (m === null || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
`;

/** The same rules as the hidden tests, other values. One assertion per test, so the score is fine-grained. */
const HELD_OUT: readonly (readonly [string, string, string])[] = [
  ["single units", `"3h"`, "10800"],
  ["single units", `"10s"`, "10"],
  ["single units", `"7m"`, "420"],
  ["combined units", `"2h5s"`, "7205"],
  ["combined units", `"1m30s"`, "90"],
  ["spaces between the parts", `"2h 15m 10s"`, "8110"],
  ["spaces between the parts", `"1m  5s"`, "65"],
  ["upper case units", `"2M30S"`, "150"],
  ["upper case units", `"1h30M"`, "5400"],
  ["a part can be a decimal", `"2.5m"`, "150"],
  ["a part can be a decimal", `"0.5h"`, "1800"],
  ["a bare number is seconds", `"45"`, "45"],
  ["a bare number is seconds", `"3600"`, "3600"],
  ["units in order, each once", `"10s5m"`, "null"],
  ["units in order, each once", `"2m2m"`, "null"],
  ["units in order, each once", `"1s1h"`, "null"],
  ["not a duration", `"h"`, "null"],
  ["not a duration", `"1y"`, "null"],
  ["not a duration", `"one hour"`, "null"],
  ["not a duration", `"  "`, "null"],
];

const heldOutFile = [
  `import assert from "node:assert/strict";`,
  `import test from "node:test";`,
  `import { parseDuration } from "./duration.js";`,
  ...HELD_OUT.map(([rule, input, want], i) => `test(${JSON.stringify(`${i} ${rule}: ${input}`)}, () => assert.deepStrictEqual(parseDuration(${input}), ${want}));`),
].join("\n");

const HIDDEN_NAMES = [
  "single units",
  "combined units",
  "spaces between the parts are fine",
  "units can be upper case",
  "a part can be a decimal",
  "a bare number is seconds",
  "units must go from largest to smallest, each at most once",
  "text that is not a duration is null",
];

const failingNames = (output: string) =>
  [...output.matchAll(/^not ok \d+ - (.+)$/gm)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** Run `node --test <file>` in `dir` and count the passing and failing tests. */
async function score(dir: string, file: string, source: string) {
  await writeFile(join(dir, file), source);
  const out = await run("node", ["--test", file], { cwd: dir }).then(
    (r) => r.stdout,
    (e: { stdout?: string }) => e.stdout ?? "",
  );
  await rm(join(dir, file));
  return { passed: [...out.matchAll(/^ok \d+ - /gm)].length, failed: failingNames(out) };
}

type Way = "full" | "name" | "ticket";

interface Written {
  readonly hidden: string;
  readonly rule: string;
  readonly call: string;
  readonly result: string;
  readonly right: boolean;
}

/** The ticket way: a triage turn writes the missing rule an example, from the failing test's name alone. */
async function writeRule(dir: string, issue: Issue, hidden: string): Promise<Written> {
  const result = await turn(
    dir,
    { timeoutMs: 10 * 60 * 1000 },
    {
      prompt: [
        `You are triaging an issue for the code in the current folder. You write no code, and you cannot run anything.`,
        `# ${issue.title}`,
        issue.body,
        `Its rules so far:\n${issue.criteria.map((c) => `- ${c.rule}${c.kind === "example" ? `: ${c.examples.map((e) => `${e.call} -> ${e.result}`).join(", ")}` : ""}`).join("\n")}`,
        `A check the ticket did not mention failed. All we know of it is its name: "${hidden}". Write the rule it stands for as one plain sentence, and one example: a JavaScript call of parseDuration and the exact value it returns, as a literal. Pick an input that the rule decides.`,
      ].join("\n\n"),
      session: null,
      tools: ["Read", "Glob", "Grep"],
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["rule", "call", "result"],
        properties: { rule: { type: "string" }, call: { type: "string" }, result: { type: "string" } },
      },
    },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  const { rule, call, result: value } = result.structured as { rule: string; call: string; result: string };
  return { hidden, rule, call, result: value, right: await agrees(REFERENCE, "parseDuration", { call, result: value }) };
}

interface Run {
  readonly way: Way;
  readonly n: number;
  readonly builds: number;
  readonly passedHidden: boolean;
  readonly answers: readonly (BuildAnswer["kind"] | "failed")[];
  readonly heldOut: number;
  readonly heldOutFailed: readonly string[];
  readonly written: readonly Written[];
  readonly feedback: readonly string[];
}

async function once(way: Way, n: number): Promise<Run> {
  const toy = await checkoutToy("duration");
  const workspace = localWorkspace(toy.dir, { test: ["node", "--test"], hidden: HIDDEN });
  const call = <A, E>(f: (w: Workspace["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.gen(function* () { return yield* f(yield* Workspace); }).pipe(Effect.provide(workspace)));
  const builderLayer = claudeBuilder(toy.dir, { timeoutMs: 15 * 60 * 1000 });
  const build = (request: Parameters<Builder["Service"]["build"]>[0]) =>
    Effect.runPromise(Effect.gen(function* () { return yield* (yield* Builder).build(request); }).pipe(Effect.provide(builderLayer)));

  let issue: Issue = toy.issue;
  await call((w) => w.prepare(issue));
  const session = randomUUID();
  const answers: (BuildAnswer["kind"] | "failed")[] = [];
  const written: Written[] = [];
  const feedbacks: string[] = [];
  let feedback: string | null = null;
  let passed = false;
  let builds = 0;

  while (builds < MAX_BUILDS) {
    builds++;
    const answer = await build({ issue, feedback, session: { id: session, continues: builds > 1 } }).catch(() => null);
    answers.push(answer?.kind ?? "failed");
    if (answer?.kind !== "done") break;
    const checked = await call((w) => w.check());
    if (checked.passed) {
      passed = true;
      break;
    }
    const failing = failingNames(checked.output);
    const hidden = failing.filter((name) => HIDDEN_NAMES.includes(name));
    const visible = failing.filter((name) => !HIDDEN_NAMES.includes(name));
    if (way === "full") {
      feedback = `Tests failed:\n${checked.output}`;
    } else if (way === "name") {
      feedback = `Tests failed:\n${failing.map((name) => `- ${name}`).join("\n")}`;
    } else {
      const fresh = hidden.filter((name) => !written.some((w) => w.hidden === name));
      const added = await Promise.all(fresh.map((name) => writeRule(toy.dir, issue, name)));
      written.push(...added);
      const criteria: Criterion[] = added.map((w, i) => ({
        kind: "example",
        id: `missed-${written.length - added.length + i + 1}`,
        rule: w.rule,
        file: "duration.js",
        name: "parseDuration",
        examples: [{ call: w.call, result: w.result }],
      }));
      issue = { ...issue, criteria: [...issue.criteria, ...criteria] as Issue["criteria"] };
      await call((w) => w.prepare(issue));
      const stillFailing = [...visible, ...hidden.filter((name) => !fresh.includes(name))];
      feedback = [
        ...(stillFailing.length === 0 ? [] : [`Tests failed:\n${stillFailing.map((name) => `- ${name}`).join("\n")}`]),
        ...(criteria.length === 0
          ? []
          : [`The ticket was missing rules. They are now criteria, and their examples are tests in criteria.test.js:\n${criteria.map((c) => `- ${c.rule} (${c.id})\n    ${c.kind === "example" ? c.examples.map((e) => `${testName(c, e)} -> ${e.result}`).join("") : ""}`).join("\n")}`]),
      ].join("\n\n");
    }
    feedbacks.push(feedback);
  }

  const held = await score(toy.dir, "held-out.test.js", heldOutFile);
  const result: Run = {
    way,
    n,
    builds,
    passedHidden: passed,
    answers,
    heldOut: held.passed,
    heldOutFailed: held.failed,
    written,
    feedback: feedbacks,
  };
  console.log(
    `${way.padEnd(6)} #${n}  builds ${builds}  hidden ${passed ? "pass" : "FAIL"}  held-out ${held.passed}/${HELD_OUT.length}` +
      (written.length === 0 ? "" : `  examples ${written.filter((w) => w.right).length}/${written.length} right`),
  );
  return result;
}

// The reference must pass the hidden tests and the held-out ones, or the scores mean nothing.
{
  const toy = await checkoutToy("duration");
  await writeFile(join(toy.dir, "duration.js"), REFERENCE);
  const hiddenRun = await score(toy.dir, "duration.test.js", await readFile(join(HIDDEN, "duration.test.js"), "utf8"));
  const held = await score(toy.dir, "held-out.test.js", heldOutFile);
  if (hiddenRun.failed.length > 0 || held.failed.length > 0) {
    throw new Error(`the reference is wrong: ${[...hiddenRun.failed, ...held.failed].join("; ")}`);
  }
  console.log(`reference: hidden ${hiddenRun.passed}/8, held-out ${held.passed}/${HELD_OUT.length}\n`);
}

const ways: readonly Way[] = ["full", "name", "ticket"];
const jobs = ways.flatMap((way) => Array.from({ length: RUNS }, (_, i) => [way, i + 1] as const));
const runs = await pool(jobs, 5, ([way, n]) => once(way, n));

console.log("\nway     runs  passed hidden  builds (mean)  held-out (mean)  examples right");
for (const way of ways) {
  const mine = runs.filter((r) => r.way === way);
  const mean = (f: (r: Run) => number) => (mine.reduce((sum, r) => sum + f(r), 0) / mine.length).toFixed(1);
  const written = mine.flatMap((r) => r.written);
  console.log(
    `${way.padEnd(8)}${String(mine.length).padEnd(6)}${String(mine.filter((r) => r.passedHidden).length).padEnd(15)}${mean((r) => r.builds).padEnd(15)}${`${mean((r) => r.heldOut)}/${HELD_OUT.length}`.padEnd(17)}${written.length === 0 ? "-" : `${written.filter((w) => w.right).length}/${written.length}`}`,
  );
}
await writeFile(join(import.meta.dirname, "results", "hidden-feedback.json"), JSON.stringify(runs, null, 2));
