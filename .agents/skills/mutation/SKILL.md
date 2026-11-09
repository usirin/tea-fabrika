---
name: mutation
description: Run the fast mutation check for one tea-fabrika ticket with StrykerJS, changed lines first, in five minutes per pull request. Survivors advise and never hold the pull request. Use when a brief says "use the mutation skill for ticket N", after the build's laws pass.
---

# The mutation step

You run the fast check on the product files the build changed, as
[fast and daily mutation](../../../docs/direction/fast-and-daily-mutation.md) decides: changed lines
first, five minutes for the whole pull request, survivors as advice. As the ticket's test writer you
may kill a real survivor with a law. You change test files only.

A brief names the ticket, the branch, and the build commit or files to mutate. This skill holds the
rest.

## Steps

1. **Read** `AGENTS.md`'s mutation rules. Find how earlier mutation steps ran here: `field/runs.jsonl`
   rows whose step is mutation, `git log --oneline -40 origin/main | grep -i mutation`, and
   `packages/pipeline/src/stages/mutation/stryker.ts`. Run the same way.
2. **Pick the files:** only the product files the build changed (`git show --stat <build commit>`),
   not files of a branch underneath. When the ticket's product is itself exam (a lint rule), mutate
   those files and use their laws.
3. **Run the fast check** with [the command below](#the-command): mutants on the changed lines
   only, static mutants off, a 10 s test limit and a 5 s over-run. Five minutes of wall time for the
   whole pull request, setup included: at five minutes, stop your workers and keep what they have.
   `sample.ts` sorts candidate identities and uses seed 119120 to select one range per changed
   line first, then remaining ranges, at most 150 enclosed mutants. Equal locations and nested
   ranges count every mutant they select. The seed controls selection; Stryker does not promise
   to execute ranges in that order. Never the whole set. Ask before you scale up.
   - **A round after a send-back** reuses the last round's answers: Stryker's `incremental`, with
     its file kept per ticket. Only mutants whose code or tests changed run again.
   - **The last round before review** runs with `force`, so a stale answer cannot reach the review.
     The lead's brief says which round is the last. When unsure, use `force`.
4. **Sort each survivor:** real (a law should catch it) or equivalent (no behavior changes). An
   equivalent mutant gets one line on why, and is left alone.
5. **Survivors advise.** A real survivor never holds the pull request. Kill one with a new or
   tighter law, in test files only, when the law is clear; list the rest in the report. Run the
   touched tests, `pnpm format`, `pnpm lint`. No typecheck: another agent may be running one.
6. **Commit and sign** with the step-commit skill, as `mutation` (it signs as `tests` for now). If no
   law changed, commit nothing.
   `sh .agents/skills/step-commit/scripts/stepcommit.sh mutation <ticket> "T<ticket> tests: <subject>" <paths...>`
7. **Report** in under 15 lines: actual tested, killed, survived, timeout, compile-error, uncovered,
   reused and unreached counts, plus the seed and `sample.json` totals; each survivor with
   `file:line` and real or equivalent; the laws added; the commit. If the five minutes ran out, say
   how many lines and mutants it did not reach. That is reported, and the pull request goes on.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option). Run it
from the repo root of your worktree. `T` is the ticket, `BUILD` the build commit. Set
`RELATED` to the explicit related-test paths, separated by commas. Ticket 520's proof uses
`.agents/skills/mutation/scripts/sample.test.ts`, the new TypeScript sampler's adjacent laws.
This does not grade plancheck's shell or Python. Those rely on properties and planted breaks.

The supervisor caps the whole command, including setup, and stops its process group on exit or
signal. It removes its temporary config after success or failure. Run one command at a time.
Wait in the background while `pgrep -f "vitest run" | wc -l` is 6 or more before starting.

**A Claude agent in a worktree runs this step, never a Codex box.** Stryker starts a local logging
server that listens on a port, and the Codex sandbox refuses it (`listen EPERM`). On ticket 520,
2026-11-08, the sampler picked its 150 mutants, then Stryker stopped before the dry run and no
mutant ran. This is socket work, as the lead skill's "Who runs which step" says.

```sh
export T=520 BUILD=abc1234
export RELATED=.agents/skills/mutation/scripts/sample.test.ts
# nice lowers the priority of setup and all workers too.
nice -n 15 node --input-type=module -e '
import {spawn} from "node:child_process";
import {rmSync} from "node:fs";
const child = spawn("sh", ["-eu"], {detached: true, stdio: "inherit"});
const kill = (signal) => { try { process.kill(-child.pid, signal); } catch (e) {
  if (e.code !== "ESRCH") throw e;
}};
let stopped = false;
const stop = () => { stopped = true; kill("SIGTERM");
  hard = setTimeout(() => kill("SIGKILL"), 1000);
};
let hard;
const cap = setTimeout(stop, 300_000);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("exit", (code) => {
  clearTimeout(cap); clearTimeout(hard); kill("SIGKILL");
  rmSync("vitest.mutation.config.ts", {force: true});
  process.exitCode = stopped ? 124 : code ?? 1;
});
' <<'SH'
M=${TMPDIR:-/tmp}/mut-$T; mkdir -p "$M"   # one folder per ticket: the incremental file lives here
S=packages/pipeline/node_modules/@stryker-mutator
ranges=$(node .agents/skills/mutation/scripts/sample.ts \
  --build "$BUILD" --seed 119120 --max 150 --report "$M/sample.json")
# This config is temporary. Keep the 10 s limit and the existing nested-Stryker and e2e excludes.
cat > vitest.mutation.config.ts <<'TS'
import base from "./vitest.config.ts";
import {defineConfig} from "vitest/config";
const include = process.env.RELATED?.split(",").filter(Boolean);
if (!include?.length) throw new Error("RELATED must list the test paths");
export default defineConfig({...base, test: {...base.test, include, maxWorkers: 1,
  testTimeout: 10_000, hookTimeout: 10_000,
	exclude: [...(base.test?.exclude ?? []), "**/node_modules/**", "**/dist/**",
		"packages/pipeline/src/stages/mutation/stryker*.test.ts",
		"packages/pipeline/src/stages/pipeline/{program,github}.test.ts"]}});
TS
cat > "$M/stryker.json" <<JSON
{"testRunner": "vitest", "vitest": {"configFile": "vitest.mutation.config.ts", "related": true},
 "plugins": ["$PWD/$S/vitest-runner/dist/src/index.js"], "coverageAnalysis": "perTest",
 "mutate": [$ranges], "ignoreStatic": true, "timeoutMS": 5000, "concurrency": 1,
 "incremental": true, "incrementalFile": "$M/incremental.json",
 "reporters": ["json", "event-recorder", "progress-append-only"],
 "jsonReporter": {"fileName": "$M/report.json"}, "eventReporter": {"baseDir": "$M/events"},
 "tempDirName": "$M/tmp", "tsconfigFile": "$M/none.json", "cleanTempDir": "always",
 "ignorePatterns": [".claude", "runs"]}
JSON
echo '{}' > "$M/none.json"
# Keep --force on the last round before review. Omit it only for an intermediate reused round.
node "$S/core/bin/stryker.js" run "$M/stryker.json" --force > "$M/log.txt" 2>&1
SH
```

- `report.json` holds every answer when Stryker finished. When the cap stopped it, read
  `events/*-onMutantTested.json`, one file per mutant as it came: that is what it kept. Count the
  mutants it did not reach against `sample.json`. Keep selection omissions (`left`) separate from
  selected mutants not tested before the cap. Reused answers are not fresh test results.
- `incremental.json` is written only by a round that finished. A round the cap stopped leaves the
  last finished one in place.
- **A dry run is not proof.** Ignored or uncovered mutants alone are not proof either. At least
  one mutant needs a real test result. Record the dry-run log and the actual result counts.
- **The historical settings timeout is still unidentified.** On 2026-11-08, tests measured
  `packages/pipeline/src/settings.test.ts` at 0.45 s and `settings-source.test.ts` at 3.8 s, both
  under 10 s. Exclude neither on a guess. If the real dry-run log shows a file passing 10 s,
  report its exact path and seconds. Send that exclude to build, then reuse the remaining budget.
- `concurrency` and Vitest's `maxWorkers` are both 1 under the current laptop caps.
- `ignorePatterns` keeps `.claude` out of Stryker's sandbox copy: its skill links are folders
  linked to `.agents/skills`, and the copy fails on them (tried 2026-11-08).
- `tsconfigFile` points at an empty file: Stryker rewrites a tsconfig with TypeScript's JavaScript
  API, which TypeScript 7 does not have (`packages/pipeline/src/stages/mutation/stryker.ts`).
- **The command as written ran** on 2026-11-08 on ticket 520's `sample.ts`, seed 119120: 150 of
  202 mutants selected; the final round had 94 killed, 1 survived (equivalent), 49 no coverage (the
  CLI block, which only the end-to-end run reaches) and 6 static ignored, in about 40 s. The dry run
  took 1 s with `RELATED` limiting the tests, so no settings test came near 10 s.

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- Under `nice -n 15`, on a Claude agent in a worktree. A Codex box cannot bind Stryker's port.
- One worker. Changed lines only, at most 150 enclosed mutants, never the whole set.

## Never

- Change product code. A survivor the product should catch, but a law cannot reach, goes in the
  report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
- Reset, rebase or amend. Read, print or copy a key file. Push.
