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

A brief never prints npm, pnpm or environment settings (owner, 2026-11-08), not even to show a
step where they come from. A run once printed a token to a local log that way. Name the setting
and say where it is set; never echo its value. `pnpm config list` and `env` stay out of briefs.

For a stacked lane, put the parent and landing facts in the state file and the brief before the
first step:

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
  The mutation step is socket work: Stryker binds a port, so it always runs on Claude.
  Still one agent per step.
- **One fresh Claude agent per step, not one long driver per ticket** (owner, 2026-11-09). Each
  step gets a new agent with a short brief. It reads the lane's state file
  (`BOXES/state/<lane>.md`), does its one step, and writes the state file back for the next agent:
  the branch, the signed heads, what ran and what is next. Nothing is carried in an agent's
  memory. A PR still merges only after every step ran, each by its own agent (plan, tests, build,
  mutation, one review saying merge-ready), with CI green and the leak grep clean. No step is ever
  skipped. Only a new design call or an exam read that does not meet the bar (step 9) comes back to
  the lead. A drive script (tracker ticket 341) will chain the mechanical steps in code and start an
  agent only where judgment is needed. *It said (owner, 2026-11-08): one driver per ticket, start
  to finish. One driver ran for 11 hours, which was wasteful.*
- **A step agent never writes another step's code or tests** (owner, 2026-11-08). The agent
  that hands work along fetches, reads the report, and runs what a Codex box cannot: e2e runs and
  screenshots.
- Plan every row as soon as its tier opens, and start each test writer when its plan is approved.
  Tests do not wait for the code under them; only builds wait in line.

## Scripts

All read `scripts/env.sh`, which finds the main checkout from the repo and keeps the boxes beside
it (`BOXES`, default `<parent of the main checkout>/boxes`). Each value can be set from outside.

| Script | What it does |
|---|---|
| `box.sh new <name> <base> <branch> --ticket <n> --plan <path>` | check the start and save its facts, then clone and install |
| `box.sh run <name> <prompt> <out> --step <step>` | run Codex, save redacted output and the run row |
| `box.sh fetch <name> <branch> --sign <step> --ticket <n>` | fetch without force, sign the recorded run and check commits |
| `drive.ts <lane> <step> <brief>` | one Codex step end to end, with no agent waiting: box, run, fetch, checks, backup push, field row, state; one JSON line (below) |
| `runplan.sh <name> <brief>` | a read-only plan writer in the main checkout; the plan lands in `BOXES/<name>-plan.md` |
| `botpush.mjs <tree> fabrikalfa/<branch>` | merge the remote notes in, then push the branch and `refs/notes/fabrika` as the bot, in one atomic push |
| `catchup.sh <pr> <ticket> [--merge-method squash\|merge]` | merge `main` in as the bot, sign `lead`, push, check that exact head and land pinned to it; squash by default |
| `fieldrow.py [--parent R] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why>` | one `field/runs.jsonl` row from a Codex run's events |
| `clauderow.py --run R [--billing B] [--role R] [--parent R] [--corrects R] <transcript> [why]` | one `field/runs.jsonl` row from a Claude subagent's transcript, tokens and list dollars; `billing` only when given, since a transcript does not say; `--turns <transcript>` prints each call's context and dollars |

`box.sh run` names the box's `.agents/` as its own writable root because Codex otherwise keeps
that folder read-only inside the writable checkout.

box.sh run and runplan.sh strip secret settings and redact saved output.
fetch --sign checks owners and signs missing notes in MAIN.
Review and mutation briefs say never to print npm, pnpm or env settings.

Catch-up retries read-only `gh` failures three times, waiting 1 and 2 seconds. A successful red or
untrusted answer stops immediately. Logs are captured before parsing, so a failed read cannot
look green. Pushes and merges are never retried by that helper.

## Use drive.ts for any Codex step

Use `drive.ts` for any Codex step. A Claude agent only reads its result and makes the judgment call.
Start it in the background and read the last line only:

```sh
node .agents/skills/lead/scripts/drive.ts <lane> <plan|tests|build|review> <brief.md> \
	[--from <ref>] [--ticket <n>] [--branch fabrikalfa/<name>] [--plan-only] &
```

- It starts a box at `--from`, else the lane's last head (`BOXES/state/<lane>.json`, moved only
  by a step it accepted), else `origin/main`. A plan reads the main checkout and takes no `--from`.
- It runs Codex with the brief and an `answer:` line it asks for, waits with no agent, fetches,
  and checks: `pnpm commits check` and this step's name on every new commit, no exam path in any
  build commit, the leak grep on each commit's added lines, a review committing nothing, and
  `plancheck --draft` on a plan. A check that cannot run is `stuck`, never a pass.
- Then it pushes `<branch>-wip` as the bot when the step committed, writes the field row to
  `BOXES/<lane>-rows.jsonl`, appends the step to `state/<lane>.json` and `.md`, and removes the box.
  A stop after the time limit takes Codex's whole process group with it.
- Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (the question
  is in `why`), 30 stuck, 2 usage, 3 refused (8 Codex boxes running). It never retries. A stuck
  step keeps its box. A tests or build step waits while `pgrep -x tsgo` finds one.
- The mutation step binds a port, so a Claude agent still runs it. `DRIVE_MINUTES` (default 60)
  stops a step that runs too long.

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
2. **Check the unsigned plan.** Run `sh .agents/skills/plan/scripts/plancheck.sh --draft <plan>`.
   It checks sections, generators and file owners, and prints the whole body's hash.
   The exam listing is a total scan of the whole file, fences and link titles included.
   Read the list for paths the files-table parser may miss.
3. **Approve in the lead session only.** Read the whole plan, its laws and generators or labels,
   its decided notes and open questions. Plan writers and agents reviewing or revising a plan
   return it unsigned, with line one blank. The agent that wrote it sends it to the lead session for approval.
   After the read, fill line one with `Approved by the lead agent, builds <note>; body <sha256-12>`
   using the draft check's digest, then run `plancheck.sh --approved <plan>`. Any body edit,
   including an amendment, needs the same read and checks again. A new design call goes to the owner as one
   yes or no. Answer, in the plan, any open question a decided note already answers.
4. box.sh new checks the approved plan, base and ticket. Keep the child's tests
   when merging parent work in. Never replace them with the parent's older tests.
5. box.sh run --step checks order and slots, and saves the run row.
   Run steps in the background, except Electron or socket work goes to a Claude agent above.
   Each brief names its skill.
6. **After each step:** fetch with `--sign`, then read the report and diff. Commit the saved
   `state/<name>.rows.jsonl` rows in `field/runs.jsonl` (`clauderow.py` makes a Claude agent's row, a
   driver included, once it has finished). Write a `field/notes.jsonl` note for anything that broke,
   cost too much, needed a person or worked well. Step-commit checks file owners.
   Each correction the owner makes, and each slip of the lead's own, gets a note too, with the code
   that would have caught it. Running the steps by hand is how `next/`'s pipeline learns.
7. **Run what the box cannot,** yourself: Electron e2e and screenshots. One Electron app at a time,
   each run with its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`. Look at every shot.
8. **Push** with `botpush.mjs` and open the pull request. Its body says which parts were this repo's
   steps, what ran each one, and the dollars.
9. **Land it** by [the plan's rule](../../../docs/plan/README.md#how-a-change-lands): the review says
   `merge-ready`, CI is green (e2e included), and you read the diff and run the leak grep. An exam
   change that is all proper property tests merges without the owner's read (owner, 2026-11-08):
   every new or changed law is a property, or an example labeled `vector:`, `format:`, `pinned:` or
   `scenario:` with its reason; mutation shows no law got narrower; and nothing loosens. You check
   that and say so in the PR. A change that loosens or removes a law still stays
   `ask owner exam_read`; never write "owner read" unless the owner did, and give each such merge
   a field note. Then run `catchup.sh` in the background: it brings the PR up to
   date, signs only the new merge as `lead`, waits for every check on that exact head (e2e and
   commits included) and lands it pinned to that head. Pass `--merge-method merge` for a parent
   with a recorded stacked child, so the signed parent head stays in main's history. Otherwise
   pass `--merge-method squash`, the default. A child lands only after its parent reaches main.
   Catch-up merges main in and keeps the child's tests. It never signs a step's commit.
10. **After the merge:** comment the pull request's URL on its ticket and close it, write the
    `MergeRow`, then `git pull --ff-only origin main` and `pnpm install --frozen-lockfile` in the
    main checkout, plus any build the app needs to start. The owner runs the app from there and
    never pulls or installs first. If the pull refuses, because of local edits or another branch,
    leave them and tell the owner in one line.

## Tickets and tracker posts

Every ticket for this repo goes in the app's own tracker, through its `tracker_file`,
`tracker_comment` and `tracker_close` tools. Never open a GitHub issue on this repo. GitHub issues
are for other people's repos only.

- Every lane gets a ticket before its agent starts. File one if it is missing.
- Each brief names the ticket and a short writer name, such as `door-fix`.
- The agent posts when a real step starts, on a finding that matters, when blocked, when a pull
  request opens or is pushed, and when done. Not after every command.
- A post is 2 to 5 plain lines with full pull request URLs. No security holes, secrets or personal
  names: the tracker will be shared.

## Lead tooling is fast-tracked

Skills, the lead scripts and the drive script run on our own laptop, so they are not product work
(owner, 2026-11-09). They skip the plan, tests, mutation and review steps. The lead or one agent
changes them directly, keeps each change small, and merges on green CI with a clean leak grep.
Product code (`next/` and today's app) keeps its steps.

## Decisions land at once

A decision lands in the repo as soon as it is made (owner, 2026-11-09). Each decision gets its own
docs PR, opened the turn it is decided, with a docs agent. Never batch decisions, and never wait for
a code PR or for the end of the day. A docs-only PR that writes down a decision is merged when CI
is green and the leak grep is clean, with no plan, tests, review or field rows. Code PRs keep their
steps.

The lead owns the count of decisions still missing from the repo. Its status gives that count and
the open docs PRs carrying them. The owner does not keep the list. Code cannot count decisions
nobody recorded.

## The leak grep

Before every push and every merge, grep the added lines (`git diff origin/main | grep '^+'`) for
personal and account names, machine paths (a home folder, a temp folder), key prefixes and em
dashes. Keep the list of names out of the repo: it is the lead's own. Only the repo's own name in a
GitHub URL may match. The leak check script fails closed (owner, 2026-11-08): any hit stops the
push or merge, and the lead checks it by hand. A hit is never waved through by the script.

## Go easy on the machine

- One `pnpm typecheck` at a time across all agents: wait while
  `pgrep -x tsgo` finds one.
- One Electron test app and one Docker box at a time. Every wait or poll loop runs in the background.
- Every brief carries the caps the step's skill names. A Codex box blocks `nice` and `pgrep`, so
  `box.sh` runs Codex itself under `nice -n 15`.

## Never

- Write a step's work, run git inside a box, or reset a branch to take a step's work over.
- Merge a live run by hand, approve a pull request, or answer a question the machine put to a person.
- Read, print or copy a key. Leave a box, a claim or a half-open pull request behind without saying so.

## When a run teaches something

Update the skill it teaches, in the same pull request as the field note. A rule that lives only in
one brief is lost with that brief.
