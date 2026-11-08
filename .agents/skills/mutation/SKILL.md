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
   whole pull request, not per run: at five minutes, stop the Stryker process you started and keep
   what it has. When the lines hold more mutants than five minutes reach, mutate one range per
   changed line first (seed 119120 picks the order), then the rest. Never the whole set. Ask before
   you scale up.
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
7. **Report** in under 15 lines: mutants run, killed, survived, timeouts; each survivor with
   `file:line` and real or equivalent; the laws added; the commit. If the five minutes ran out, say
   how many lines and mutants it did not reach. That is reported, and the pull request goes on.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option). Run it
from the repo root of your box or worktree. `T` is the ticket, `BUILD` the build commit.

```sh
T=277; BUILD=abc1234
M=${TMPDIR:-/tmp}/mut-$T; mkdir -p "$M"   # one folder per ticket: the incremental file lives here
S=packages/pipeline/node_modules/@stryker-mutator
# The changed lines of the build's product files, as Stryker's `file:start-end` ranges.
ranges=$(git diff -U0 "$BUILD^" "$BUILD" -- '*.ts' '*.tsx' ':!*.test.ts' ':!*.test.tsx' |
	awk '/^\+\+\+ b\//{f=substr($0,7)} /^@@/{split($3,a,/[+,]/); n=a[3]==""?1:a[3]; if (n>0) {printf "%s\"%s:%d-%d\"", s, f, a[2], a[2]+n-1; s=","}}')
# The 10 s test limit, and the tests that run Stryker themselves left out. Not committed: delete it after.
cat > vitest.mutation.config.ts <<'TS'
import base from "./vitest.config.ts";
import {defineConfig, mergeConfig} from "vitest/config";
export default mergeConfig(base, defineConfig({test: {testTimeout: 10_000, hookTimeout: 10_000,
	exclude: [...(base.test?.exclude ?? []), "**/node_modules/**", "**/dist/**",
		"packages/pipeline/src/stages/mutation/stryker*.test.ts",
		"packages/pipeline/src/stages/pipeline/{program,github}.test.ts"]}}));
TS
cat > "$M/stryker.json" <<JSON
{"testRunner": "vitest", "vitest": {"configFile": "vitest.mutation.config.ts"},
 "plugins": ["$PWD/$S/vitest-runner/dist/src/index.js"], "coverageAnalysis": "perTest",
 "mutate": [$ranges], "ignoreStatic": true, "timeoutMS": 5000, "concurrency": 2,
 "incremental": true, "incrementalFile": "$M/incremental.json",
 "reporters": ["json", "event-recorder", "progress-append-only"],
 "jsonReporter": {"fileName": "$M/report.json"}, "eventReporter": {"baseDir": "$M/events"},
 "tempDirName": "$M/tmp", "tsconfigFile": "$M/none.json", "cleanTempDir": "always",
 "ignorePatterns": [".claude", "runs"]}
JSON
echo '{}' > "$M/none.json"
# Add --force on the last round before review. The 5 minutes are for the whole pull request.
nice -n 15 node "$S/core/bin/stryker.js" run "$M/stryker.json" > "$M/log.txt" 2>&1 & pid=$!
( sleep 300; kill "$pid" 2>/dev/null ) & cap=$!
wait "$pid"; kill "$cap" 2>/dev/null; rm vitest.mutation.config.ts
```

- `report.json` holds every answer when Stryker finished. When the cap stopped it, read
  `events/*-onMutantTested.json`, one file per mutant as it came: that is what it kept. Count the
  lines and mutants it did not reach from `ranges`.
- `incremental.json` is written only by a round that finished. A round the cap stopped leaves the
  last finished one in place.
- **A dry run that fails on the 10 s limit** stops Stryker before any mutant runs. A test that
  takes longer than 10 s alone is not a fast test: add its file to the `exclude` list above, say
  so in the report, and run again. A 2026-11-08 try on one small file hit this after about 3
  minutes of dry run, on a settings test in `packages/pipeline`.
- `concurrency` is 2, the note's budget. With two or more code agents running, use 1.
- `ignorePatterns` keeps `.claude` out of Stryker's sandbox copy: its skill links are folders
  linked to `.agents/skills`, and the copy fails on them (tried 2026-11-08).
- `tsconfigFile` points at an empty file: Stryker rewrites a tsconfig with TypeScript's JavaScript
  API, which TypeScript 7 does not have (`packages/pipeline/src/stages/mutation/stryker.ts`).
- In a Codex box, drop `nice`.

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- Under `nice -n 15` outside a Codex box. In a box, `nice` and `pgrep` are blocked: skip them.
- Two workers, one with two or more code agents running. Changed lines only, never the whole set.

## Never

- Change product code. A survivor the product should catch, but a law cannot reach, goes in the
  report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
- Reset, rebase or amend. Read, print or copy a key file. Push.
