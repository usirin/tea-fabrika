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
Every agent may file tracker tickets, even during read-only repo work. Filing claims no ticket
and starts no build.
```

For a driver, add the parent and landing facts before it starts:

```text
Parent: ticket <id>, branch <branch>, signed build head <sha>, or none.
Children: <ticket, branch and signed parent head for each child>, or none. Record before starting.
Merge method: merge when this parent has a stacked child; squash otherwise.
Start a child at its parent's signed build head. Keep the child's tests through catch-up.
Land the child after the parent reaches main. Pass the recorded method to catchup.sh.
Return plans unsigned, including reviews and revisions. Only the lead session approves them.
Every agent may file tracker tickets, even during read-only repo work. Filing claims no ticket
and starts no build.
```

## Who runs which step

Decided in [stage agents run on Codex](../../../docs/direction/agents-run-on-codex.md) (owner,
2026-11-08), which this section follows.

- **Codex in a box runs each step:** plan, tests, build, mutation and review, each its own agent.
- **Except Electron or socket work** (owner, 2026-11-08): a step whose laws or shots need the app
  running (a program's window, the desk, keys, the look) or need to bind a socket is run by a Claude
  agent instead. A Codex box can start neither, so a Codex build there would come back half checked.
  Still one agent per step.
- **One driver per ticket, start to finish** (owner, 2026-11-08): a Claude agent carries one ticket
  through every step, starting one agent per step on the runner above. It merges its own PR only
  after every step ran, each by its own agent (plan, tests, build, mutation, one review saying
  merge-ready), with CI green and the leak grep clean. No step is ever skipped. The driver keeps its
  own status line and field rows. Only a new design call or an exam read comes back to the lead.
- **A driver never writes a step's code or tests itself** (owner, 2026-11-08). It starts the step agents, fetches, hands
  work along, and runs what a Codex box cannot: e2e runs and screenshots.
- Plan every row as soon as its tier opens, and start each test writer when its plan is approved.
  Tests do not wait for the code under them; only builds wait in line.

## Scripts

All read `scripts/env.sh`, which finds the main checkout from the repo and keeps the boxes beside
it (`BOXES`, default `<parent of the main checkout>/boxes`). Each value can be set from outside.

| Script | What it does |
|---|---|
| `box.sh new <name> <base> <branch>` | a Codex box: its own clone, git data outside `.git`, installed |
| `box.sh run <name> <prompt> <out>` | run Codex in the box, writable only there |
| `box.sh fetch <name> <branch>` | fetch the branch and step notes into the main checkout, nothing else |
| `runplan.sh <name> <brief>` | a read-only plan writer in the main checkout; the plan lands in `BOXES/<name>-plan.md` |
| `botpush.mjs <tree> fabrikalfa/<branch>` | merge the remote notes in, then push the branch and `refs/notes/fabrika` as the bot, in one atomic push |
| `catchup.sh <pr> <ticket> [--merge-method squash\|merge]` | merge `main` in as the bot, sign `lead`, push, check that exact head and land pinned to it; squash by default |
| `fieldrow.py [--parent R] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why>` | one `field/runs.jsonl` row from a Codex run's events |

`box.sh run` names the box's `.agents/` as its own writable root because Codex otherwise keeps
that folder read-only inside the writable checkout.

Catch-up retries read-only `gh` failures three times, waiting 1 and 2 seconds. A successful red or
untrusted answer stops immediately. Logs are captured before parsing, so a failed read cannot
look green. Pushes and merges are never retried by that helper.

## Pushes and protected refs

Keep the bot's explicit atomic push of notes plus branch. On a person's branch, notes-only as the
bot and branch-only as the person are two intended writes. A refusal stops the step.

`Cannot update this protected ref.` alone does not prove a push failed. Read the command's exit
status and the rule suite's overall result and named ref. In
[rule suite 4984058968](https://api.github.com/repos/usirin/tea-fabrika/rulesets/rule-suites/4984058968),
the update check named a person's branch, and the overall result was `bypass`: that push
succeeded through the owner's bypass. It did not show a refused notes ref. Keep real push failures
visible, and never weaken the rules to hide this message.

## Steps

1. **Plan.** Write a brief that names the ticket, its version, what to read and an older plan to copy
   the shape of. Run `runplan.sh` in the background. Save the answer as `BOXES/<name>-PLAN.md`.
2. **Check the unsigned plan.** Run `sh .agents/skills/plan/scripts/plancheck.sh --draft <plan>`. It lists every exam
   path the plan names and exits 1 when a files table has no owner, gives an exam path to a step
   other than `tests`, or a law has no generator. Then the plan goes back. Check that each listed path is in the files table at all.
3. **Approve in the lead session only.** Read the whole plan, its laws and generators or labels,
   its decided notes and open questions. Plan writers and agents reviewing or revising a plan
   return it unsigned, with line one blank. A driver sends it to the lead session for approval.
   A plan that only builds decided notes: write "Approved by the lead agent, builds
   <note>" on its blank first line. A plan that raises a new design call goes to the owner as one
   yes or no. Answer, in the plan, any open question a decided note already answers.
4. **Start a box** on a `fabrikalfa/<name>` branch, with `box.sh new`. Use `origin/main` for an
   independent ticket. A stacked child starts at the parent's signed build head, before the
   parent merges, as [Tier 1](../../../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) allows.
   Record the child, parent branch and signed head before starting it. Keep the child's tests
   when merging parent work in. Never replace them with the parent's older tests.
5. **Run the steps in order,** in the background: tests, build, mutation, review. Each runs in the
   box with `box.sh run`, except a step with Electron or socket work, which a Claude agent runs
   (above). No builder starts before tests that exist. Each brief names its skill.
6. **After each step:** `box.sh fetch`, read the report and the diff, and log the run the same day:
   one `field/runs.jsonl` row (`fieldrow.py`), and one `field/notes.jsonl` note for anything that
   broke, cost too much, needed a person or worked well. Send a fix to the step that owns the file.
7. **Run what the box cannot,** yourself: Electron e2e and screenshots. One Electron app at a time,
   each run with its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`. Look at every shot.
8. **Push** with `botpush.mjs` and open the pull request. Its body says which parts were this repo's
   steps, what ran each one, and the dollars.
9. **Land it** by [the plan's rule](../../../docs/plan/README.md#how-a-change-lands): the review says
   `merge-ready`, CI is green (e2e included), and you read the diff and run the leak grep. An exam
   path touched stays `ask owner exam_read`; never write "owner read" unless the owner did, and give
   each such merge a field note. Then run `catchup.sh` in the background: it brings the PR up to
   date, signs only the new merge as `lead`, waits for every check on that exact head (e2e and
   commits included) and lands it pinned to that head. Pass `--merge-method merge` for a parent
   with a recorded stacked child, so the signed parent head stays in main's history. Otherwise
   pass `--merge-method squash`, the default. A child lands only after its parent reaches main.
   Catch-up merges main in and keeps the child's tests. It never signs a step's commit: an
   unsigned one goes back to its own step.
10. **After the merge:** comment the pull request's URL on its ticket and close it, write the
    `MergeRow`, then `git pull --ff-only origin main` and `pnpm install` in the main checkout.

## Same-day decisions

The lead owns the count of decisions still missing from the repo. Its status gives that count
and the docs PR carrying them. The owner does not keep the list.

Start a docs agent the same day and land the day's decisions together in one docs PR, separate
from slow builds. Update that PR as more decisions arrive. Keep the count current until all are
in the repo. Code cannot count decisions nobody recorded.

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
