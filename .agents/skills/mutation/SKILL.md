---
name: mutation
description: Run the hourly mutation check on what merged to tea-fabrika's main with StrykerJS, changed lines first, and file each real gap as a tracker ticket. It is no step of a pull request (decision 0066). Use when a brief says "use the mutation skill" for the hourly run, or for a lane parked inside its mutation step before 0066.
---

# The mutation run

Mutation is no step of a pull request
([0066](../../../.decisions/0066-mutation-runs-on-a-schedule.md)). It runs once an hour against
main, on the changed lines of what merged since the last run, in the container, with the tests
beside the changed files. No new merge, no run. A merge never waits on it.

- **The hourly run** changes nothing in the repo. It sorts each survivor (step 3 below), files a
  real gap as one tracker ticket per file, at most three a day, and counts noise without filing it.
  A narrowing (arm a kills, arm b lets live) is filed as a ticket marked loosening. It logs its
  counts: sampled, killed, survived, real, noise, tickets, minutes.
- **A lane parked inside its mutation step before 0066** finishes it with the steps below, as the
  ticket's test writer, test files only; then the lane goes on to review.

A brief names the ticket or the merged range, and the build commit or files to mutate. This skill
holds the rest. The fast check's settings are
[fast and daily mutation](../../../docs/direction/fast-and-daily-mutation.md)'s: changed lines
first, five minutes, survivors as advice.

Never print npm, pnpm or env settings. The runner strips secret settings and redacts saved output.

## Steps

1. **Read** `AGENTS.md`'s mutation rules.
2. **Read the fast check's report.** `drive.ts` ran it before you started, in a container with its
   own network ([0045](../../../.decisions/0045-test-steps-run-in-containers.md)), with
   [the command below](#the-command). Your prompt holds its report, `mutbox.json`, whole. Never run
   Stryker yourself, and start nothing that listens on a port. `run.sh` and `sample.ts` hold file
   selection, the seed, sample cap and round settings. Ask before you scale up.
3. **Sort each survivor:** real (a law should catch it), equivalent (no behavior changes) or
   unconfirmed. A schema or class created during module loading needs a hand-planted check
   before any claim. In a disposable copy, show the unchanged code passing in a fresh process.
   Apply the exact mutant replacement and run the relevant laws in another fresh process.
   Report killed when they fail on that change. Report equivalent only with evidence that no
   behavior changes. Otherwise report unconfirmed and why. Keep static mutants off.
4. **Survivors advise.** A real survivor never holds the pull request. Kill one with a new or
   tighter law, in test files only, when the law is clear; list the rest in the report. Run the
   touched tests and `pnpm lint`. Step-commit checks staged formatting.
5. **Commit** changed laws with the step-commit skill, as `mutation`.
6. **Report** actual tested, killed, survived, timeout, compile-error, uncovered,
   reused and unreached counts, plus the seed and `sample.json` totals; each survivor with
   `file:line` and its status, with hand-plant evidence for startup survivors; the laws added;
   the commit. If the five minutes ran out, say
   how many lines and mutants it did not reach. That is reported, and the pull request goes on.
   Name every test the report lists under `excluded` or `skipped`, with its reason: those did not
   run. Give the report's `narrowing` list as the arm a against arm b comparison. Quote its
   `reach` line, "the sample reached N of M changed files", with the files it names.
   When the sampler selects no mutation ranges, because the diff has no product lines, commit
   nothing and end with `answer: skip <why>`; review takes that row in place of a mutation run.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option).
`--ticket` is the ticket, `--build` the build commit, `--base` the commit whose tests are arm a.
With a base, the sample is the pull request's own lines, `base..build`, so a tip that merged main
samples the lane and not main (ticket 568); with none, it is the build commit against its parent.
`--related` is the explicit related-test paths, separated by commas; in a brief that is one line,
`RELATED=<paths>`, which `drive.ts` reads. They are the tests that run, never the files mutated:
the sample is drawn from every changed product file in the diff (`PRODUCT` in `sample.ts`: `.ts`,
`.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, less tests and `.d.*`), each file's cheapest
range first, round-robin, so every changed file gets a mutant before any gets a second (ticket
655). For arm a, name the base's test file a moved or changed law came from too: arm a runs only
the related tests the base has. `--plan` is the approved plan; drive passes it. Ticket 520's proof uses
`.agents/skills/mutation/scripts/sample.test.ts`, the new TypeScript sampler's adjacent laws.
This does not grade plancheck's shell or Python. Those rely on properties and planted breaks.
The executable inside the container is `scripts/run.sh`, from the build commit. There it mutates
the container's own copy in place (`IN_PLACE=1`): Stryker's sandbox links each package's
`node_modules` back to the checkout, so a test that reaches a file by its package name, such as
`@tea-fabrika/tracker`, loaded the unmutated file, and a lane read 0 kills of 61 (ticket 457).
A lane built before that fix samples with the old `run.sh` until it merges main.

**The run happens in a container, never on the host and never in an agent's sandbox**
([0045](../../../.decisions/0045-test-steps-run-in-containers.md)). Stryker starts a logging
server that listens on a port. The container has its own network (`--network none`), so it may,
and nothing on the laptop is opened. `mutbox.ts` copies the build commit in read-only, mounts
nothing from the home folder, and takes the one Docker box lock. `drive.ts` runs it for a
mutation step. By hand:

```sh
node .agents/skills/lead/scripts/mutbox.ts run --checkout . --ticket 520 --build abc1234 \
	--base origin/main --related .agents/skills/mutation/scripts/sample.test.ts \
	--out ../boxes/t520-mutbox --lock ../boxes/state/docker.lock
```

It prints one JSON line and writes it to `<out>/mutbox.json`: `done`, `skip` (no product line) or
`stuck`. Docker missing or stopped is `stuck`. It is never run on the host instead.

- `excluded` names each related test left out before the run, with why: a test that loads
  Electron or a browser driver needs a display, and the container has none. That is read from its
  parsed imports, so a lint rule's test whose planted strings name Electron still runs. `skipped` names each
  test that skipped itself inside the container. Neither ran. A test that fails there before any
  mutant makes the run `stuck`, naming it.
- `b` is the branch's own tests. `a` is the same sample against the base's tests, and `narrowing`
  the mutants `a` kills that `b` lets live. `reach` is the line "the sample reached N of M changed
  files", naming each file with zero mutants.
- Arm a first runs the base's related tests on the build and keeps only the files that pass,
  since Stryker stops at a failing test in its dry run; `armA.dropped` names each one left out
  and why.
- A run never passes silently. A known gap is `done` with the gap in its reason and `narrowing:
  "unknown"`: `no_arm_a:base_has_none` or `no_arm_a:none_pass` (arm a had nothing to run), and
  `no_reach:old_sampler` (the build's `sample.ts` predates per-file reach). Say so in the report;
  the lead hand-checks the laws as for a loosening hit. Arm a that was due and gave no clean
  answer is `stuck` `arm_a_failed`, and a sample that reached none of the plan's build-owned files
  with a mutant on their changed lines is `stuck` `no_build_reach`.

- `<out>/box/b/report.json` holds every answer when Stryker finished. When the cap stopped it,
  `mutbox.ts` reads `events/*-onMutantTested.json`, one file per mutant as it came: that is what it
  kept, and the arm says `from: "events"` and how many were `unreached`. Keep selection omissions
  (`left`) separate from selected mutants not tested before the cap.
- **A dry run is not proof.** Ignored or uncovered mutants alone are not proof either. At least
  one mutant needs a real test result. Record the dry-run log and the actual result counts.

## Outside your task

Something wrong that your task does not cover is one finding row with proof, then keep going:
never a fix, a ticket or only a mention, and never a security hole.
[A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
counts as proof.

A survivor is this step's own answer and stays in its report, never a finding row. Outside
means anything else you meet that is wrong.
Put the row in your report as one JSON line. The lead adds it to `field/findings.jsonl` unchanged.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

## Never

- A survivor the product should catch, but a law cannot reach, goes in the report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
