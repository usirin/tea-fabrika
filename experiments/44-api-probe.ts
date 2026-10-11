import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parseFactory, type Factory } from "../src/factory.ts";
import { localPublishedApi } from "../src/local.ts";
import { PublishedApi } from "../src/services.ts";
import { apiLine, namedIn, ruleOnApi, ticketNames } from "../src/surface.ts";
import { rewriteOf } from "../src/triage.ts";

// What the published-API check says about a change left uncommitted in a
// checkout, against a saved run's issue: what each export-map entry of the
// package publishes at HEAD (emitted in a fresh copy) and in the folder as it
// is, and which differences go back to the builder. Offline: git, pnpm and
// the repo's own tsc, no Jev, no agent. Run it twice to see HEAD's emit cached.
//   REPO=<folder>     a checkout with the change applied and not committed; only a throwaway worktree of it is written to
//   STATE=<file>      a saved run's state.json, whose triage holds the issue and its facts
//   PACKAGE=<folder>  the package whose export map is compared (default packages/tea)
//   NEW=listed        list added names instead of sending them back

const repo = process.env.REPO;
const stateFile = process.env.STATE;
if (repo === undefined || stateFile === undefined) throw new Error("REPO and STATE are needed");
const pkg = process.env.PACKAGE ?? "packages/tea";

const saved = parseFactory(JSON.parse(await readFile(stateFile, "utf8"))) as Factory;
const issue = rewriteOf(saved.triage);
if (issue === null || !("raw" in saved.triage)) throw new Error(`${stateFile} holds no rewrite`);
const named = namedIn(issue, ticketNames(saved.triage.raw, saved.triage.facts));
console.log(`the issue names: ${[...named].join(", ")}\n`);

const layer = localPublishedApi(repo, { package: pkg, install: ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"] });
const timed = Effect.gen(function* () {
  const api = yield* PublishedApi;
  const runs = [];
  for (const run of ["first, HEAD emitted in a fresh copy", "again, HEAD's emit cached"]) {
    const started = Date.now();
    const diff = yield* api.diff();
    runs.push({ run, seconds: (Date.now() - started) / 1000, diff });
  }
  return runs;
}).pipe(Effect.provide(layer));

const runs = await Effect.runPromise(timed);
for (const { run, seconds } of runs) console.log(`compared ${run}: ${seconds.toFixed(1)}s`);
const diff = runs[0]?.diff;
if (diff === undefined || diff.kind === "skipped") throw new Error(`not compared: ${diff?.why}`);

const ruling = ruleOnApi(diff, named, process.env.NEW === "listed" ? "listed" : "problem");
console.log(`\n${diff.changes.length} published change(s) in ${diff.package}`);
console.log(`\nallowed, listed for the person who approves (${ruling.allowed.length}):`);
for (const c of ruling.allowed) console.log(`- ${apiLine(c)}`);
console.log(`\nsent back to the builder (${ruling.problems.length}):`);
for (const p of ruling.problems) console.log(`- ${p}`);
