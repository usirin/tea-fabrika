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
2. **Run the fast check** with [the command below](#the-command). `run.sh` and `sample.ts` hold
   file selection, the seed, sample cap and round settings. Ask before you scale up.
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
   When the sampler selects no mutation ranges, because the diff has no product lines, commit
   nothing and end with `answer: skip <why>`; review takes that row in place of a mutation run.

## The command

The settings are [the decided fast check](../../../docs/direction/fast-and-daily-mutation.md#the-fast-check-decided-2026-11-01)
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option). Run it
from the repo root of your worktree. `T` is the ticket, `BUILD` the build commit. Set
`RELATED` to the explicit related-test paths, separated by commas. Ticket 520's proof uses
`.agents/skills/mutation/scripts/sample.test.ts`, the new TypeScript sampler's adjacent laws.
This does not grade plancheck's shell or Python. Those rely on properties and planted breaks.
The executable is `scripts/run.sh`.

Wait in the background while `pgrep -f "vitest run" | wc -l` is 6 or more before starting.

**A Claude agent in a worktree runs this step, never a Codex box.** Stryker starts a local logging
server that listens on a port, and the Codex sandbox refuses it (`listen EPERM`). This is socket
work, as the lead skill's "Who runs which step" says.

```sh
export T=520 BUILD=abc1234
export RELATED=.agents/skills/mutation/scripts/sample.test.ts
# nice lowers the priority of setup and all workers too.
nice -n 15 sh .agents/skills/mutation/scripts/run.sh
```

Set `FINAL=0` only for an intermediate round. `run.sh` defaults to the final force round.

- `report.json` holds every answer when Stryker finished. When the cap stopped it, read
  `events/*-onMutantTested.json`, one file per mutant as it came: that is what it kept. Count the
  mutants it did not reach against `sample.json`. Keep selection omissions (`left`) separate from
  selected mutants not tested before the cap. Reused answers are not fresh test results.
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
