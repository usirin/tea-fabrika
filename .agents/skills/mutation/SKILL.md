---
name: mutation
description: Run the mutation step for one tea-fabrika ticket with StrykerJS on a fixed sample, then kill every real survivor with a law. Use when a brief says "use the mutation skill for ticket N", after the build's laws pass.
---

# The mutation step

You mutate the product files the build changed, on a fixed sample, and then, as the ticket's test
writer, kill every real survivor with a new or tighter law. You change test files only.

A brief names the ticket, the branch, and the build commit or files to mutate. This skill holds the
rest.

## Steps

1. **Read** `AGENTS.md`'s mutation rules. Find how earlier mutation steps ran here: `field/runs.jsonl`
   rows whose step is mutation, `git log --oneline -40 origin/main | grep -i mutation`, and
   `packages/pipeline/src/stages/mutation/stryker.ts`. Run the same way.
2. **Pick the files:** only the product files the build changed (`git show --stat <build commit>`),
   not files of a branch underneath. When the ticket's product is itself exam (a lint rule), mutate
   those files and use their laws.
3. **Run a fixed-seed sample:** about 150 mutants, seed 119120, never the whole set, a fixed number
   of runs, one worker, a five-minute limit per run. Ask before you scale up.
4. **Sort each survivor:** real (a law should catch it) or equivalent (no behavior changes). An
   equivalent mutant gets one line on why, and is left alone.
5. **Kill every real survivor** with a new or tighter law, in test files only. Run the touched
   tests, `pnpm format`, `pnpm lint`. No typecheck: another agent may be running one.
6. **Commit and sign** with the step-commit skill, as `mutation` (it signs as `tests` for now). If no
   law changed, commit nothing.
   `sh .agents/skills/step-commit/scripts/stepcommit.sh mutation <ticket> "T<ticket> tests: <subject>" <paths...>`
7. **Report** in under 15 lines: mutants run, killed, survived, timeouts; each survivor with
   `file:line` and real or equivalent; the laws added; the commit.

## Go easy on the machine

- Under `nice -n 15` outside a Codex box. In a box, `nice` and `pgrep` are blocked: skip them.
- One worker. The fixed sample, never the whole set.

## Never

- Change product code. A survivor the product should catch, but a law cannot reach, goes in the
  report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
- Reset, rebase or amend. Read, print or copy a key file. Push.
