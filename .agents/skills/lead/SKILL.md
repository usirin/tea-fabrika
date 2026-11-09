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

A brief never prints npm, pnpm or environment settings (owner, 2026-11-08), not even to show a
step where they come from. A run once printed a token to a local log that way. Name the setting
and say where it is set; never echo its value. `pnpm config list` and `env` stay out of briefs.

For a stacked lane, put the parent and landing facts in the state file and the brief before the
first step:

```text
Parent: ticket <id>, branch <branch>, signed build head <sha>, or none.
Children: <ticket, branch and signed parent head for each child>, or none. Record before starting.
Start a child at its parent's signed build head. Keep the child's tests through catch-up.
Land the stack with `gh stack merge <pr> --squash`, then `gh stack sync --prune`.
Return plans unsigned, including reviews and revisions. Only the lead session approves them.
```

The draft check checks the handoff format. Shared shell access cannot prove which session signed.
Do not add a marker, key or readable file as proof of session identity.

## Review brief template

Use this for the whole diff, including a re-review after fixes:

```text
Use the review skill for the ticket below.
Ticket: <id and title>
Version: <today's tooling or next/>
Approved plan: <path, including amendments>
Parent base: <branch and full signed SHA, or origin/main and full SHA>
Reviewed head: <branch and full SHA>
Decided notes: <every decided note the PR builds>
Last fixes: <commit range and report, or none>
```

Sweep, do not sample. For each law in the plan's table, list every way in: each public call,
each cut point, and each saved or binding state. Check each one.
A finding names its class and every case of it.
A law written as examples over a class the plan names is a defect when a found case escapes
those examples.
On a re-review, read every line the last fixes changed and what calls them first. Then finish
the remaining checks.
Read every decided note the PR builds, following the plan's references and the change itself.
Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law.
Each blocker cites that source and shows the missed case.

Start with merge-ready; tickets: <m> or changes: <n>; tickets: <m>.
n counts blocking classes. Each class lists every affected case. m counts distinct confirmed
tracker tickets linked in this answer.
Give every finding in that answer, grouped by class, most serious first.
Name each checked decided note and say where the change follows or breaks it.
Other actionable findings become tracker tickets. Use tracker_query to find an existing ticket,
or tracker_file with value: {title, body, from: {_tag: "pr", url, step: "review"}}.
Record the returned ID.
If filing fails, include the exact pending payload for lead to retry. Do not count it as filed
or start another review round for it.
Every agent may file. Filing claims no ticket and starts no build.
Keep the four reason labels in the review skill. A missed case in a named class checks the law;
it does not reopen every test's merits.

## Who runs which step

Decided in [stage agents run on Codex](../../../docs/direction/agents-run-on-codex.md) (owner,
2026-11-08), which this section follows.

- **Codex in a box runs each step:** plan, tests, build, mutation and review, each its own agent.
- **Except Electron or socket work** (owner, 2026-11-08): a step whose laws or shots need the app
  running (a program's window, the desk, keys, the look) or need to bind a socket is run by a Claude
  agent instead. A Codex box can start neither, so a Codex build there would come back half checked.
  The mutation step is socket work: Stryker binds a port, so it always runs on Claude
  (`drive.ts --agent claude`).
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
| `box.sh new <name> <base> <branch> --ticket <n> --plan <path> [--root <sha>]` | check the start and save its facts (the lane root that build order and the commits check read from), then clone and install |
| `box.sh run <name> <prompt> <out> --step <step>` | run Codex, save redacted output and the run row |
| `box.sh fetch <name> <branch> --sign <step> --ticket <n>` | fetch without force, sign the recorded run and check commits |
| `box.sh gc [--dry-run]` | remove every box that sat idle 2 h (24 h when drive kept it stuck) once its work is on a remote, backing unpushed commits up to `<branch>-wip` first (a box with uncommitted files is kept, since a backup saves only HEAD), then every `state/<box>.box` whose box is gone; drive runs it at start |
| `drive.ts <lane> <step> <brief>` | one Codex step end to end, with no agent waiting: box, run, fetch, checks, backup push, field row, state; one JSON line (below) |
| `runplan.sh <name> <brief>` | a read-only plan writer in the main checkout; the plan lands in `BOXES/<name>-plan.md` |
| `botpush.mjs <tree> fabrikalfa/<branch>` | merge the remote notes in, then push the branch and `refs/notes/fabrika` as the bot, in one atomic push |
| `governance.sh [base]` | list the `.decisions/` files the diff from `base` (default `origin/main`) touches; advice only, always exits 0 |
| `catchup.sh <pr> <ticket>` | merge `main` in as the bot, sign `lead`, push, check that exact head and squash-land pinned to it; a PR in a gh stack lands with `gh stack merge` |
| `fieldrow.py [--parent R] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why>` | one `field/runs.jsonl` row from a Codex run's events |
| `clauderow.py --run R [--billing B] [--role R] [--parent R] [--corrects R] <transcript> [why]` | one `field/runs.jsonl` row from a Claude subagent's transcript, tokens and list dollars; `billing` only when given, since a transcript does not say; `--turns <transcript>` prints each call's context and dollars |

box.sh run and runplan.sh strip secret settings and redact saved output.
fetch --sign checks owners and signs missing notes in MAIN.
Review and mutation briefs say never to print npm, pnpm or env settings.
leakgrep.sh checks added text; private words stay outside the repo.

## Use drive.ts for any step

Every step goes through `drive.ts`, on a Codex box or a Claude agent; no box is made by hand. A
Claude agent in the lead session only reads its result and makes the judgment call. Start it in the
background and read the last line only:

```sh
node .agents/skills/lead/scripts/drive.ts <lane> <plan|tests|build|mutation|review> <brief.md> \
	[--agent codex|claude] [--model sonnet|opus] [--from <ref>] [--ticket <n>] \
	[--branch fabrikalfa/<name>] [--plan-only] &
```

- `--agent codex` (the default) runs Codex in a box. `--agent claude` runs `claude -p` in the same
  kind of box, with a new `--session-id`, `--model` (default `sonnet`; `opus` when asked), `--tools`
  per step (a review gets no Edit or Write), no setting sources, no MCP servers, and the step's
  skill named in its prompt. Its `stream-json` goes to the events file, and `clauderow.py` writes
  the field row with tokens and list-price dollars.
- Claude runs under `sandbox-exec`: it cannot read `~/.fabrika/step-keys`, the leak words or
  `~/.codex`, and it writes only its box and caches. It commits with plain git. drive then signs its
  work as one commit through `stepcommit.sh`, with main's own signer, never the box's code.
- Mutation runs on `--agent claude` only, since it binds ports and starts Electron. One mutation
  step at a time holds `BOXES/state/electron.lock`; the next waits.
- It starts a box at `--from`, else the lane's last head (`BOXES/state/<lane>.json`, moved only
  by a step it accepted) or the newest tip on origin of the branch or its `-wip` backup when that
  is ahead of it, else `origin/main`. So a lead commit (a merge of main, a lockfile commit) pushed
  to `-wip` is where the next step starts, and `box.sh new` takes a verified lead head as a base
  like a build head. A plan reads the main checkout and takes no `--from`.
- `box.sh new` refuses `shared_ticket` only when another live branch carries a link for the same
  ticket: one with an open PR, or one a box on disk names. A branch the base already holds, one
  with neither, or one whose change is only `field/*.jsonl` rows, does not block.
- It runs the agent with the brief and an `answer:` line it asks for, waits with no agent, fetches,
  and checks: `pnpm commits check` and this step's name on every new commit, no exam path in any
  build commit, the leak grep on each commit's added lines, a review committing nothing, and
  `plancheck --draft` on a plan. A `stale_link` counts only for a step the lane has signed; one for
  a step it has not reached (lead, before catch-up) is left to CI on the PR. Stepcommit reads the
  facts of the box it runs in, never another `.box` on the branch. A check that cannot run is
  `stuck`, never a pass. A build that
  answers `done` with no commit is done only with a `laws: green <paths>` line (every law already
  green at its start); else it is `stuck:no_commit`, as a tests step with no commit always is.
- Then it pushes `<branch>-wip` (a `-wip` branch as it is) as the bot when the step committed, writes the field row to
  `BOXES/<lane>-rows.jsonl`, appends the step to `state/<lane>.json` and `.md`, and removes the box.
  It keeps the box, whatever the step answered, while it holds uncommitted files or commits off the
  step's branch, and the outcome line's `reason` ends with `(box kept: ...)` saying what is left.
  A stop after the time limit takes the agent's whole process group with it.
- Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (the question
  is in `reason`), 30 stuck, 2 usage, 3 refused (8 agents running: Codex boxes plus Claude steps
  drive started, under 20 GB free after `box.sh gc`, or the lane's branch checked out in a
  worktree, which the end-of-step fetch could not update). It never retries. A stuck step keeps its
  box. The commits check reads the whole lane, from where it left main, so each earlier step's
  newest link is in its chain. After a lead merge of main it starts at the merge-base with
  `origin/main` instead, so main's own commits are not judged as the lane's. A tests, build or mutation step waits while `pgrep -x tsgo` finds
  one. `DRIVE_MINUTES` (default 60) stops a step that runs too long.

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
4. **Start the lane** on a `fabrikalfa/<name>` branch through `drive.ts`, never `box.sh new` by
   hand. Use `origin/main` for an independent ticket. A stacked child starts at the parent's signed build head, before the
   parent merges, as [Tier 1](../../../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) allows.
   Record the child, parent branch and signed head before starting it. Keep the child's tests
   when merging parent work in. Never replace them with the parent's older tests.
   box.sh new checks the approved plan, base and ticket.
5. **Run the steps in order,** in the background: tests, build, mutation, review. Each runs
   through `drive.ts`, except a step with Electron or socket work, which a Claude agent runs
   (above). No builder starts before tests that exist. Each brief names its skill.
   box.sh run --step checks order and slots, and saves the run row.
6. **After each step:** read drive's last line, the report and the diff, and log the run the same day:
   one `field/runs.jsonl` row (`fieldrow.py` for Codex, `clauderow.py` for a Claude agent, a
   driver included, once it has finished), and one `field/notes.jsonl` note for anything that
   broke, cost too much, needed a person or worked well. Send a fix to the step that owns the file.
   Step-commit checks file owners.
   Each correction the owner makes, and each slip of the lead's own, gets a note too, with the code
   that would have caught it. Running the steps by hand is how `next/`'s pipeline learns.
7. **Run what the box cannot,** yourself: Electron e2e and screenshots. One Electron app at a time,
   each run with its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`. Look at every shot.
8. **Push** with `botpush.mjs` and open the pull request. Its body says which parts were this repo's
   steps, what ran each one, and the dollars.
9. **Land it** by [the plan's rule](../../../docs/plan/README.md#how-a-change-lands): the review says
   `merge-ready`, CI is green (e2e included), and you read the diff and run the leak grep.
   Every new or changed law is a property, or an example labeled vector, format, pinned or
   scenario with its reason.
   Zero hits from loosening.sh and the mutation arm-a vs arm-b comparison mean no owner read is needed.
   The lead records both outputs in the PR. A hit goes to the lead's hand check, with the hit list
   in the PR. Only real loosening waits on the owner.
   Apply the labels rule and both zero-hit checks together. These are proper property tests.
   Run `sh .agents/skills/lead/scripts/loosening.sh <base> <head> <mapping.md>` on the PR's exam
   diff. The PR writes a mapping table with `Removed` and `Replacement` columns for every renamed
   or replaced law, using exact test titles. Save that table as `mapping.md` for the command.
   A pure addition needs no replacement row. `loosening.sh` fails closed: any exam-file change
   other than purely new tests or a rename listed in the mapping table is a hit. A pattern parser
   cannot cover every TypeScript form, so it names forms it knows but never clears a change it
   does not understand.
   Missing replacements, muted tests, removed assertions, fewer runs and tighter generated ranges
   are hits for the lead's hand check. Include the
   mutation step's narrowing list: a mutant main kills that the branch lets live is a hit too.
   Before this new check blocks anything, measure false alarms on the last 20 merged `next/`
   PRs and record the count. Do not claim that measure from generated tests alone.
   Never write "owner read" unless the owner did. Log each required owner read in a field note.
   An exam change that is all proper property tests merges without the owner's read (owner,
   2026-11-08). A change that loosens or removes a law still stays `ask owner exam_read`.
   Then run `catchup.sh` in the background: it brings the PR up to
   date, signs only the new merge as `lead`, waits for every check on that exact head (e2e and
   commits included) and squash-lands it pinned to that head; a PR in a gh stack lands with
   `gh stack merge <pr> --squash --yes` once its head reads unchanged. Every PR squash-merges, a stacked
   parent too ([0004](../../../.decisions/0004-squash-merges-and-native-stacks.md)). A stack is a
   GitHub stack ([its commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)):
   `gh stack init <bottom> ... <top>` adopts the branches, `gh stack submit` opens the PRs,
   `gh stack merge <pr> --squash` lands bottom-up, and `gh stack sync --prune` rebases the rest
   onto main and pushes. Rebase by hand only locally (`gh stack rebase`, then `gh stack push`),
   never with the web "Rebase stack" button: it makes unsigned commits. The child's trees stay the
   same, so its links hold; if a tree changed, that child's steps sign again. A child keeps its own
   tests. It never signs a step's commit: an
   unsigned one goes back to its own step.
   After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.
   Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the
   driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.
   Before each removal, read MAIN's gitdir, common directory, object directory and all alternates
   from outside. Keep their paths and every link they use. Refuse any removal that contains one.
   Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates
   and any box that fails its guard.
   Print one line per retained item and continue. Cleanup never changes a landed merge's success.
   Saved plans, reports, logs and state/ remain.
   Box removal ignores untracked-only files and installs. It requires clean tracked files and
   every local branch, detached HEAD, stash and step-note tip retained in MAIN. Remote-tracking
   refs and object presence do not count. Fetch remote-only work into a retained MAIN ref first.
   HEAD, ORIG_HEAD, refs outside refs/remotes/ and reflogs outside logs/refs/remotes/ need that proof; FETCH_HEAD is a fetched copy, and ORIG_HEAD and config.worktree are ordinary metadata. Keep operation or linked-worktree
   metadata, unknown state, and any pair holding MAIN or BOXES/state.
   An annotated tag's own object ID must be reachable under MAIN's retained refs. Keeping only
   its commit loses the annotation. This also applies to signed tags and tags pointing at tags.
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

Decisions live in `.decisions/`, one file per decision
([0001](../../../.decisions/0001-decisions-live-in-the-repo.md), owner, 2026-11-09). The whole path:

```text
owner decides -> write .decisions/NNNN-slug.md -> its own docs PR -> merge on green
```

- **Write it the turn it is decided,** with a docs agent using [the adr skill](../adr/SKILL.md),
  in the shape the adr skill gives. Link its `docs/direction/` note when
  one exists.
- **One decision, one PR.** Never batch decisions, and never wait for a code PR or for the end of
  the day.
- **Merge on green.** A docs-only PR that writes down a decision is merged when CI is green and the
  leak grep is clean, with no plan, tests, review or field rows. Code PRs keep their steps.
- **Search before you ask.** Before the lead or any step asks the owner or writes a plan, it
  searches `.decisions/`, `.glossary/` and `docs/direction/` for the topic.
- **Read what a diff touches.** Before a review and before a merge, run
  `sh .agents/skills/lead/scripts/governance.sh` on the branch. It lists the decision files the
  diff's words touch. The review step and the lead read each one and say whether the diff walks it
  back. It only lists for now; it blocks later, once its false alarms are measured.

The lead owns the count of decisions still missing from the repo. Its status gives that count and
the open docs PRs carrying them. The owner does not keep the list. Code cannot count decisions
nobody recorded.

The leak check fails closed (owner, 2026-11-08): any hit stops the push or merge for the lead's
hand check.

## Go easy on the machine

- One Electron test app and one Docker box at a time. Every wait or poll loop runs in the background.

## Never

- Write a step's work, run git inside a box, or reset a branch to take a step's work over.
- Rebase, force-push or `gh pr update-branch`, except a stacked child moved with `gh stack` (0004).
- Read, print or copy a key. Leave a box, a claim or a half-open pull request behind without saying so.

## When a run teaches something

Update the skill it teaches, in the same pull request as the field note. A rule that lives only in
one brief is lost with that brief.
