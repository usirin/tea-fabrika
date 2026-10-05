// Can Jev say why a test run failed: the builder's change, the test file, or the setup?
//
// Real failing runs, kept in `failures/`: vitest on tea-fabrika itself and
// node --test on the duration toy, each with the builder's diff. Made by
// breaking one thing on purpose, so the label is known:
//   change       the builder's code is wrong (a bug, a syntax error, a renamed
//                export, a package it uses but never declared)
//   test_file    the test file the lane wrote is broken, and the code is right
//   environment  the run itself cannot work: no tool, no folder, a timeout,
//                a declared package nobody installed
// Two pairs print the same output and differ only in the diff: a syntax error
// in the code against one in the test file, and an undeclared package against
// a declared one that was never installed.
//
// What the lane would do: "change" sends the work back to the builder at 0.8
// or more; anything else, or less sure, parks for a person. The costly error is
// sending setup trouble back to the builder: it burns tries on what it cannot fix.
// Not covered: a flaky test (no honest way to make one on demand).
//
// Run with `node experiments/failure-probe.ts`; needs TYPESAFE_API_KEY.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { askAll, pool } from "./jev.ts";

const REPEATS = 3;
const BACK_FLOOR = 0.8;
/** The end of a long output is where the runner sums up; the start is where it names what it ran. */
const OUTPUT_CHARS = 20_000;

type Label = "change" | "test_file" | "environment";
const cases: readonly { readonly name: string; readonly command: string; readonly label: Label }[] = [
  { name: "change-attempts", command: "npx vitest run src/lane.test.ts", label: "change" },
  { name: "change-approval", command: "npx vitest run src/ship.test.ts", label: "change" },
  { name: "change-rename", command: "npx vitest run src/lane.test.ts src/factory.test.ts", label: "change" },
  { name: "toy-change-seconds", command: "node --test", label: "change" },
  { name: "toy-change-syntax", command: "node --test", label: "change" },
  { name: "toy-change-undeclared-dep", command: "node --test", label: "change" },
  { name: "toy-test-syntax", command: "node --test", label: "test_file" },
  { name: "toy-test-wrong-path", command: "node --test", label: "test_file" },
  { name: "env-no-git", command: "npx vitest run src/local.test.ts", label: "environment" },
  { name: "env-no-tmp", command: "npx vitest run src/local.test.ts", label: "environment" },
  { name: "env-timeout", command: "npx vitest run src/local.test.ts --testTimeout=20", label: "environment" },
  { name: "toy-env-no-node", command: "node --test", label: "environment" },
  { name: "toy-env-bad-reporter", command: "node --test --test-reporter=junitt", label: "environment" },
  { name: "toy-env-not-installed", command: "node --test", label: "environment" },
];

const questions = jevQuestions({
  cause: {
    type: "choice",
    instructions:
      "A coding agent changed a codebase (`diff`). Then `command` ran the tests and failed with `output`. The test file was written by the pipeline, not by the agent. What made the run fail?",
    criteria: {
      change:
        "The agent's change is wrong: its code has a bug, does not parse, removed or renamed something still used, or uses a package its diff never adds",
      test_file:
        "The test file itself is broken while the agent's code is fine: it does not parse, or it imports from a path that does not exist",
      environment:
        "The run could not work whatever the code says: a tool or folder is missing, a flag is wrong, the time limit is too short, or a package the diff declares was never installed",
    },
  },
});

const dir = join(import.meta.dirname, "failures");
const load = async (name: string) => {
  const output = await readFile(join(dir, `${name}.txt`), "utf8");
  return { output: output.length > OUTPUT_CHARS ? output.slice(-OUTPUT_CHARS) : output, diff: await readFile(join(dir, `${name}.diff`), "utf8") };
};

const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(jobs, 8, async (c) => {
  const { output, diff } = await load(c.name);
  const reply = (await askAll(questions, { command: c.command, diff, output })) as {
    cause: { choice: Label; confidence: number };
  };
  const { choice, confidence } = reply.cause;
  const acted = choice === "change" && confidence >= BACK_FLOOR ? "back to builder" : "person";
  return { ...c, choice, confidence, acted };
});

const count = (f: (a: (typeof answers)[number]) => boolean) => answers.filter(f).length;
console.log(`answers: ${answers.length}, right: ${count((a) => a.choice === a.label)}`);
console.log(`setup or test-file trouble sent back to the builder (costly): ${count((a) => a.label !== "change" && a.acted === "back to builder")}`);
console.log(`the builder's mistake sent to a person (costs a question): ${count((a) => a.label === "change" && a.acted === "person")}`);
for (const c of cases) {
  const mine = answers.filter((a) => a.name === c.name);
  console.log(`${c.label.padEnd(12)} ${mine.map((a) => `${a.choice}(${a.confidence.toFixed(2)})`).join(" ").padEnd(64)} ${c.name}`);
}
await writeFile(join(import.meta.dirname, "results", "failure-probe.json"), JSON.stringify(answers, null, 2));
