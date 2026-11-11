---
name: build
description: Be the builder for one tea-fabrika ticket, the pipeline step that makes the test writer's red laws green in product code. Use when a brief says "use the build skill for ticket N", or when a review or the lead sends product fixes back to the build.
---

# The builder

You make the test writer's red laws green, in product code only, as the approved plan says
([the steps](../../../docs/direction/next-is-a-pipeline-pre-run.md)).

A brief names the ticket, the plan's path, the branch, and what this round fixes. This skill holds
the rest.

## Steps

1. **Read** `AGENTS.md` (all of it), then the approved plan, then the decided notes it builds. Say
   which version you are in. In `next/`: Effect all the way, no Promises, an object class stays thin.
2. **Run the red laws** on a narrow path and read why each fails.
3. **Build** as the plan and decided notes say, and nothing they leave undecided.
   Step-commit checks the plan's file owners.
   A patch to a package (tea, demlik, Manti, Effect, Alchemy) the plan does not name, after the
   read [0054](../../../.decisions/0054-read-upstream-before-patching-it.md) asks for, goes back to
   plan, never into the build.
4. **Run** the relevant narrow laws.
5. **Commit** with the step-commit skill.
6. **Report** which laws went green, any still red and why, any file you needed
   but may not touch, and what the lead's own run must show (Electron, screenshots). If every law
   was already green at the start and you changed nothing, do not commit: put
   `laws: green <the narrow test paths you ran>` just before `answer: done`. drive.ts takes that as
   done; `done` with no commit and no such line is `stuck:no_commit`.

## Outside your task

Something wrong that your task does not cover is one finding row with proof, then keep going:
never a fix, a ticket or only a mention, and never a security hole.
[A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
counts as proof.

Outside means the approved plan does not name it. A red law the plan names is your work, and a
file you need but may not touch goes in your report (step 6): neither is a finding.
Put the row in your report as one JSON line. The lead adds it to `field/findings.jsonl` unchanged.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

- Step-commit checks staged formatting. Run `pnpm lint` once.
- Electron cannot start in a box. Reason from the code and say what the lead's rerun must show.

## Never

- Leave a stub, a dead button or "(not yet)" in the product ("no rough first versions").
