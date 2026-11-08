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
3. **Run the fast check:** mutants on the changed lines only, in seed 119120's fixed order, one per
   changed line first, then the rest. Static mutants off, a 10 s test limit and a 5 s over-run. Five
   minutes of wall time for the whole pull request, not per run: at five minutes, stop the Stryker
   process you started and keep what it has. Never the whole set. Ask before you scale up.
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

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- Under `nice -n 15` outside a Codex box. In a box, `nice` and `pgrep` are blocked: skip them.
- One worker. Changed lines only, never the whole set.

## Never

- Change product code. A survivor the product should catch, but a law cannot reach, goes in the
  report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
- Reset, rebase or amend. Read, print or copy a key file. Push.
