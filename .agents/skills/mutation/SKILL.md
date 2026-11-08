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
4. **Sort each survivor:** real (a law should catch it), equivalent (no behavior changes) or
   unconfirmed. A schema or class created during module loading needs a hand-planted check
   before any claim. In a disposable copy, show the unchanged code passing in a fresh process.
   Apply the exact mutant replacement and run the relevant laws in another fresh process.
   Report killed when they fail on that change. Report equivalent only with evidence that no
   behavior changes. Otherwise report unconfirmed and why. Keep static mutants off.
5. **Survivors advise.** A real survivor never holds the pull request. Kill one with a new or
   tighter law, in test files only, when the law is clear; list the rest in the report. Run the
   touched tests, `pnpm format`, `pnpm lint`. No typecheck: another agent may be running one.
6. **Commit and sign** with the step-commit skill, as `mutation` (it signs as `tests` for now). If no
   law changed, commit nothing.
   `sh .agents/skills/step-commit/scripts/stepcommit.sh mutation <ticket> "T<ticket> tests: <subject>" <paths...>`
7. **Report** in under 15 lines: actual tested, killed, survived, timeout, compile-error, uncovered,
   reused and unreached counts, plus the seed and `sample.json` totals; each survivor with
   `file:line` and its status, with hand-plant evidence for startup survivors; the laws added;
   the commit. If the five minutes ran out, say
   how many lines and mutants it did not reach. That is reported, and the pull request goes on.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option). Run it
from the repo root of your box or worktree. `T` is the ticket, `BUILD` the build commit. Set
`RELATED` to the explicit related-test paths, separated by commas. Ticket 520's proof uses
`.agents/skills/mutation/scripts/sample.test.ts`, the new TypeScript sampler's adjacent laws.
This does not grade plancheck's shell or Python. Those rely on properties and planted breaks.
The executable is `scripts/run.sh`. It refuses missing inputs, empty test lists and empty or
failed selections before starting Stryker. It sets `vitest.related` to `false`, so tests that
import by package name can run. Only the explicit `RELATED` paths enter its temporary config.

The supervisor caps the whole command, including setup, and stops its process group on exit or
signal. It removes its temporary config after success or failure. Run one command at a time.
Outside a box, wait in the background while `pgrep -f "vitest run" | wc -l` is 6 or more before
starting. In a box `pgrep` is blocked; never start another test command alongside this one.

```sh
export T=520 BUILD=abc1234
export RELATED=.agents/skills/mutation/scripts/sample.test.ts
# In a Codex box, drop nice. Elsewhere it lowers the priority of setup and all workers too.
nice -n 15 sh .agents/skills/mutation/scripts/run.sh
```

The default is the final `--force` round. Set `FINAL=0` only for an intermediate round that
reuses unchanged answers. The sampler still uses seed 119120, at most 150 enclosed mutants, and
one range per changed line first. The supervisor keeps the five-minute cap, cleanup and one
worker. The nested-Stryker and e2e excludes, 10 s test limit and 5 s over-run stay.

Ticket 300's labeled command scenario at `scripts/run.test.ts:333` uses a disposable repo whose
test imports by package name. It requires a discovered test and a real killed mutant. Run it
within this step's five-minute budget where sockets work. A box socket refusal is neither red
nor green. The unrelated-test-list plant must fail too. The command properties and plants check
its config and cleanup. They do not prove mutation coverage of shell or Python.

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
- In a Codex box, drop `nice`.

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- Under `nice -n 15` outside a Codex box. In a box, `nice` and `pgrep` are blocked: skip them.
- One worker. Changed lines only, at most 150 enclosed mutants, never the whole set.

## Never

- Change product code. A survivor the product should catch, but a law cannot reach, goes in the
  report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
- Reset, rebase or amend. Read, print or copy a key file. Push.
