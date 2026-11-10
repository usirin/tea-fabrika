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
   run. Give the report's `narrowing` list as the arm a against arm b comparison.
   When the sampler selects no mutation ranges, because the diff has no product lines, commit
   nothing and end with `answer: skip <why>`; review takes that row in place of a mutation run.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option).
`--ticket` is the ticket, `--build` the build commit, `--base` the commit whose tests are arm a.
`--related` is the explicit related-test paths, separated by commas; in a brief that is one line,
`RELATED=<paths>`, which `drive.ts` reads. Ticket 520's proof uses
`.agents/skills/mutation/scripts/sample.test.ts`, the new TypeScript sampler's adjacent laws.
This does not grade plancheck's shell or Python. Those rely on properties and planted breaks.
The executable inside the container is `scripts/run.sh`, from the build commit.

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

- `excluded` names each related test left out before the run, with why: a test that imports
  Electron or a browser driver needs a display, and the container has none. `skipped` names each
  test that skipped itself inside the container. Neither ran. A test that fails there before any
  mutant makes the run `stuck`, naming it.
- `b` is the branch's own tests. `a` is the same sample against the base's tests, and `narrowing`
  the mutants `a` kills that `b` lets live.

- `<out>/box/b/report.json` holds every answer when Stryker finished. When the cap stopped it,
  `mutbox.ts` reads `events/*-onMutantTested.json`, one file per mutant as it came: that is what it
  kept, and the arm says `from: "events"` and how many were `unreached`. Keep selection omissions
  (`left`) separate from selected mutants not tested before the cap.
- **A dry run is not proof.** Ignored or uncovered mutants alone are not proof either. At least
  one mutant needs a real test result. Record the dry-run log and the actual result counts.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

## Never

- A survivor the product should catch, but a law cannot reach, goes in the report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
