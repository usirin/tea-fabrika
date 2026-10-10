import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { parseFactory, type Factory } from "../src/factory.ts";
import { localWorkspace } from "../src/local.ts";
import { Workspace } from "../src/services.ts";
import { vitestTests } from "../src/tests.ts";
import { rewriteOf } from "../src/triage.ts";
import { vetProblems } from "../src/vetting.ts";

// What vetting says about a saved run's rewrite, on a repo checked out here:
// each example written as the run's vitest file, typechecked and run on HEAD
// in a fresh copy, and the problems the enricher would be sent. Offline: git,
// pnpm and the repo's own tsc and vitest, no Jev, no agent.
//   REPO=<folder>     a checkout to vet on; only a throwaway worktree of it is written to
//   STATE=<file>      a saved run's state.json, whose triage holds a rewrite
//   PACKAGE=<folder>  the package the tests join (default packages/tea)
//   ID=<n>            names the test file src/fabrika-<n>.test.ts (default 558)

const repo = process.env.REPO;
const stateFile = process.env.STATE;
if (repo === undefined || stateFile === undefined) throw new Error("REPO and STATE are needed");
const pkg = process.env.PACKAGE ?? "packages/tea";

const saved = parseFactory(JSON.parse(await readFile(stateFile, "utf8"))) as Factory;
const issue = rewriteOf(saved.triage);
if (issue === null) throw new Error(`${stateFile} holds no rewrite`);

const tsconfig = (await access(join(repo, pkg, "tsconfig.test.json")).then(() => true, () => false)) ? "tsconfig.test.json" : "tsconfig.json";
const tests = vitestTests({ package: pkg, file: `src/fabrika-${process.env.ID ?? "558"}.test.ts`, tsconfig });
const workspace = localWorkspace(repo, {
  test: ["true"],
  tests,
  install: ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
});

const started = Date.now();
const vetted = await Effect.runPromise(
  Effect.gen(function* () {
    return yield* (yield* Workspace).vet(issue);
  }).pipe(Effect.provide(workspace)),
);
console.log(`vetted in ${((Date.now() - started) / 1000).toFixed(1)}s, typechecked with ${pkg}/${tsconfig}\n`);
for (const m of vetted.missing) console.log(`missing  ${m.file} (criterion ${m.criterion})`);
for (const e of vetted.examples) {
  console.log(`${e.verdict.padEnd(14)} ${e.criterion}: ${e.call}`);
  if (e.detail !== "") console.log(`${"".padEnd(15)}${e.detail.slice(0, 300)}`);
}
const problems = vetProblems(issue, vetted);
console.log(`\n${problems.length} problem(s) the enricher would be sent:`);
for (const p of problems) console.log(`- ${p}`);
