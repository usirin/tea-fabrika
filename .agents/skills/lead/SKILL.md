---
name: lead
description: Lead one tea-fabrika ticket through the hand-run pipeline steps (plan, tests, build, mutation, review) with Codex boxes, then push, catch up and land it. Use when you are the lead session running a ticket's steps by hand, or when asked to start a box, approve a plan, or land a step pull request.
---

# The lead

Today's pipeline programs are paused, so the lead session runs each pull request's steps by hand:
plan, tests, build, mutation, one review, each by its own agent
([the steps](../../../docs/direction/next-is-a-pipeline-pre-run.md)). The lead writes no step's
work. It starts each step, reads what comes back, and lands the result.

```text
plan (read-only) -> lead approves -> box -> tests -> build -> mutation -> review
  -> fetch, read the diff, e2e -> push as the bot -> pull request -> catch up -> merge rule
```

A step's brief is short. It names the skill and the ticket's facts, and nothing the skill holds:

```text
Use the build skill for ticket 277, door fixes, next/. Plan at ../door-PLAN.md.
Laws d1 to d3 are red. This round: make them green in door.ts, answer.ts and hello.ts.
```

## Who runs which step

- **Codex in a box runs every step:** plan, tests, build, mutation and review. That is the decided
  runner for steps, and each step is its own agent.
- **A Claude agent only drives:** it starts boxes, fetches, hands work along, and does what a Codex
  sandbox cannot (start Electron, bind a socket, list processes): e2e runs and screenshots.
- A driver never writes the step's code or tests itself (owner, 2026-11-08: a session that gave step
  work to Claude agents ran few Codex agents and fell behind).
- Plan every row as soon as its tier opens, and start each test writer when its plan is approved.
  Tests do not wait for the code under them; only builds wait in line ("act like a factory").

## Scripts

All read `scripts/env.sh`, which finds the main checkout from the repo and keeps the boxes beside
it (`BOXES`, default `<parent of the main checkout>/boxes`). Each value can be set from outside.

| Script | What it does |
|---|---|
| `box.sh new <name> <base> <branch>` | a Codex box: its own clone, git data outside `.git`, installed |
| `box.sh run <name> <prompt> <out>` | run Codex in the box, writable only there |
| `box.sh fetch <name> <branch>` | fetch the branch and step notes into the main checkout, nothing else |
| `runplan.sh <name> <brief>` | a read-only plan writer in the main checkout; the plan lands in `BOXES/<name>-plan.md` |
| `botpush.mjs <tree> fabrikalfa/<branch>` | push the branch and `refs/notes/fabrika` as the bot, in one push |
| `catchup.sh <pr> <ticket> [all]` | merge `main` in as the bot, sign it `lead`, push, arm auto-merge |
| `fieldrow.py <jsonl> <run> <ticket> <outcome> <why>` | one `field/runs.jsonl` row from a Codex run's events |

## Steps

1. **Plan.** Write a brief that names the ticket, its version, what to read and an older plan to copy
   the shape of. Run `runplan.sh` in the background. Save the answer as `BOXES/<name>-PLAN.md`.
2. **Check the plan.** Run `sh .agents/skills/plan/scripts/plancheck.sh <plan>`. Every exam path it
   lists must be owned by `tests` in the files table, or the plan goes back.
3. **Approve.** A plan that only builds decided notes: write "Approved by the lead agent, builds
   <note>" on its blank first line. A plan that raises a new design call goes to the owner as one
   yes or no. Answer, in the plan, any open question a decided note already answers.
4. **Start a box** off `origin/main` on a `fabrikalfa/<name>` branch, with `box.sh new`.
5. **Run the steps in order,** each in the box with `box.sh run`, in the background: tests, build,
   mutation, review. No builder starts before tests that exist. Each brief names its skill.
6. **After each step:** `box.sh fetch`, read the report and the diff, and log the run the same day:
   one `field/runs.jsonl` row (`fieldrow.py`), and one `field/notes.jsonl` note for anything that
   broke, cost too much, needed a person or worked well. Send a fix to the step that owns the file.
7. **Run what the box cannot,** yourself: Electron e2e and screenshots. One Electron app at a time,
   each run with its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`. Look at every shot.
8. **Push** with `botpush.mjs` and open the pull request. Its body says which parts were this repo's
   steps, what ran each one, and the dollars.
9. **Land it** by [the plan's rule](../../../docs/plan/README.md#how-a-change-lands): the review says
   `merge-ready`, CI is green (e2e included), and you read the diff and run the leak grep. Then
   `catchup.sh` brings it up to date, signs the merge as `lead` and arms auto-merge. An exam path
   touched stays `ask owner exam_read`; never write "owner read" unless the owner did, and give each
   such merge a field note.
10. **After the merge:** comment the pull request's URL on its ticket and close it, write the
    `MergeRow`, then `git pull --ff-only origin main` and `pnpm install` in the main checkout.

## The leak grep

Before every push and every merge, grep the added lines (`git diff origin/main | grep '^+'`) for
personal and account names, machine paths (a home folder, a temp folder), key prefixes and em
dashes. Keep the list of names out of the repo: it is the lead's own. Only the repo's own name in a
GitHub URL may match.

## Go easy on the machine

- At most 8 code agents at once. One `pnpm typecheck` at a time across all of them: wait while
  `pgrep -x tsgo` finds one.
- One Electron test app and one Docker box at a time. Every wait or poll loop runs in the background.
- Every brief carries the caps the step's skill names. A Codex box blocks `nice` and `pgrep`, so
  `box.sh` runs Codex itself under `nice -n 15`.

## Never

- Write a step's work, run git inside a box, or reset a branch to take a step's work over.
- Rebase, force-push or `gh pr update-branch`. Catch up by merging `main` in.
- Merge a live run by hand, approve a pull request, or answer a question the machine put to a person.
- Read, print or copy a key. Leave a box, a claim or a half-open pull request behind without saying so.

## When a run teaches something

Update the skill it teaches, in the same pull request as the field note. A rule that lives only in
one brief is lost with that brief.
