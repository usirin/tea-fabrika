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

## Driver brief template

For a driver, add the parent and landing facts before it starts:

A ticket's driver is not the lead session. Every plan and amendment returns unsigned.
Before handing it to lead, the driver runs plancheck.sh --draft, saves the approval wait and ends.
Only the lead session reads and signs each plan and amendment itself.
The draft check checks the handoff format. Shared shell access cannot prove which session signed.
Do not add a marker, key or readable file as proof of session identity.

```text
Parent: ticket <id>, branch <branch>, signed build head <sha>, or none.
Children: <ticket, branch and signed parent head for each child>, or none. Record before starting.
Merge method: merge when this parent has a stacked child; squash otherwise.
Start a child at its parent's signed build head. Keep the child's tests through catch-up.
Land the child after the parent reaches main. Pass the recorded method to catchup.sh.
Return every plan and amendment unsigned, including reviews and revisions.
Run plancheck.sh --draft, save the approval wait and end. The driver is not the lead session.
Only the lead session reads and signs each plan and amendment itself.
Every agent may file tracker tickets, even during read-only repo work. Filing claims no ticket
and starts no build.
```

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

## Saved driver state

Save each wait in `$BOXES/state/<name>.md`:

```text
Ticket or row:
Branch and full SHA:
Plan path:
Parent branch and signed head:
Children and merge method:
Worktree and box names:
Wait: kind, target, report or log path
Cleared when: exact fact to read
Next step:
Field rows already written: run IDs, note IDs, commits
Saved at:
```

A Codex box, parent build, CI, plan approval or owner read is a wait.
Before ending, save completed field work and replace a temporary sibling with this file.
Then end the driver session.
Write the new state to a temporary sibling, then rename it over the saved path.
Background commands may keep running after the session ends.
Lead checks the saved clearing condition and starts a fresh driver when it holds.
Pass the saved file and the driver brief above to the fresh driver.
The new driver reads the current branch, SHA, reports and checks again before acting. It does
not rerun completed steps or duplicate listed field rows.
Missing or unclear state sends it back to those facts.
This Markdown has no program reading it. Lead owns when to restart.

## Who runs which step

Decided in [stage agents run on Codex](../../../docs/direction/agents-run-on-codex.md) (owner,
2026-11-08), which this section follows.

- **Codex in a box runs each step:** plan, tests, build, mutation and review, each its own agent.
- **Except Electron or socket work** (owner, 2026-11-08): a step whose laws or shots need the app
  running (a program's window, the desk, keys, the look) or need to bind a socket is run by a Claude
  agent instead. A Codex box can start neither, so a Codex build there would come back half checked.
  The mutation step is socket work: Stryker binds a port, so it always runs on Claude.
  Still one agent per step.
- **One active driver per ticket** (owner, 2026-11-08): a Claude agent carries the ticket until a
  wait, saves state and ends. Lead starts a fresh driver when that wait clears. Each starts one
  agent per step on the runner above. It merges its own PR only
  after every step ran, each by its own agent (plan, tests, build, mutation, one review saying
  merge-ready), with CI green and the leak grep clean. No step is ever skipped. The driver keeps its
  own status line and field rows. Plans and amendments always return unsigned to the lead session.
  A new design call or an exam hit waits on the owner.
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
| `box.sh rm <name>` | inspect from outside, keep unretained commits or tracked changes, otherwise remove the pair |
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
   other than `tests`, or a law has no generator. Then the plan goes back. The `exam path named`
   listing is a total scan of the whole file, fences and link titles included, so a false listing
   is harmless. Check each listed path is owned by `tests` in the files table; the files-table
   check is a parser over free text and may miss an exotic form the listing still shows.
3. **Approve in the lead session only.** Read the whole plan, its laws and generators or labels,
   its decided notes and open questions. Plan writers and agents reviewing or revising a plan
   return it unsigned, with line one blank. This includes every amendment. A driver runs the draft
   check, saves the approval wait and ends. Only the lead session reads and signs it itself.
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
   Then run `catchup.sh` in the background: it brings the PR up to
   date, signs only the new merge as `lead`, waits for every check on that exact head (e2e and
   commits included) and lands it pinned to that head. Pass `--merge-method merge` for a parent
   with a recorded stacked child, so the signed parent head stays in main's history. Otherwise
   pass `--merge-method squash`, the default. A child lands only after its parent reaches main.
   Catch-up merges main in and keeps the child's tests. It never signs a step's commit: an
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
