# Run a ticket through the pipeline

Today's version. One line in an app tile takes one tracker ticket through every step, on a real
repository. An agent prepares and the owner starts it. **It has not yet merged a real pull request:
ticket 117 is the first try.** The program's own reference is
[`programs/pipeline/README.md`](../../programs/pipeline/README.md).

```text
tsh> pipeline --ticket 117 | runs     start it: one row per run as it goes
tsh> map --ticket 117                 another tile: the steps light up
tsh> runs --ticket 117 | trace        pick a run, see its turns
tsh> ticket --ticket 117              the questions, answered here
```

## The ticket

Ticket 117 is on the app's own tracker, in the owner's app. It is not a GitHub issue.

- **The problem:** `map` shows a ticket's steps, but `tracker | ticket | map` is refused.
- **The fix:** the `ticket` flag becomes optional, so `map` takes a ticket from a pipe.
- **The target repository:** this one.

## What must be true first

An agent goes through this list and tells the owner what is missing.

1. **[PR 267](https://github.com/usirin/tea-fabrika/pull/267) is merged.** Until it is, the lane cannot
   handle what real agents answer.
2. **The owner answered the question in [the plan](../plan/README.md#where-we-are-now):** may this
   first run go without a box? The lane has no box setting for head code: the install, the checks and
   the mutants run as the person. So a "no" means this run does not happen until head code is boxed.
   Lean: yes, 75%.
3. **`.fabrika/fabrika.toml` is on the repository.** This one has it.
   The lane needs no other file. It reads the repository off the `origin` of the checkout the app was
   started in, the way `gh` reads the folder it runs in (see [who starts it](#who-starts-it)).
4. **Everyone is logged in.** Run these as they are, so no token is printed, and do not paste their
   output anywhere, since it can name the account:
   - `codex login status`
   - `gh auth status`
   - `claude auth status`. Triage defaults to `claude` on `opus`, and this repository does not change
     that.
5. **The ticket was filed by the owner, or by an agent of theirs.** The owner looks at the first row of
   `ticket --ticket 117`: it says who filed it, such as `user:owner` or `agent:claude`. An agent has no
   proved way to read that row without typing in the owner's app. The app's MCP tools might give one, and
   nobody has checked. The lane makes the same check when it starts. If the ticket is not theirs, it ends
   `stuck:not_yours` before any agent starts.
6. **No other merges to main during the run.** A commit on main before a pinned merge (a merge that names
   the main it read) sends the lane back, and that is final. The agent preparing the run tells the owner
   and any other agent session that pushes to main.
7. **Main has no branch rule, ruleset or CODEOWNERS that blocks the merge.** A rule that wants a review
   ends ship `stuck: merge_failed`. This one has none as of 2026-11-01. To check:

   ```sh
   gh api repos/<owner>/<repo>/rules/branches/main --jq length   # 0: no rule applies to main
   gh api repos/<owner>/<repo>/branches/main --jq .protected     # false: no branch protection
   ls .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS              # all three missing
   ```

## Who starts it

1. **The owner gets the host onto main's code, started in the checkout,** doing each of these: Cmd-Q,
   pull, install, open. The lane runs in the host, not in the app, and Cmd-Q leaves the host
   running. So quitting and opening again may keep old code. The steps:

   ```sh
   # In the app: Cmd-Q. A second start would only bring the open window forward.
   volta install pnpm@12.16.1          # once per machine: pnpm 10 cannot switch itself to 12
   git pull --ff-only origin main      # in the checkout the app is built from
   pnpm install --frozen-lockfile
   pnpm fabrika                        # builds, then opens the app
   ```

   Every build gets an id made from its source files. If the code changed, the window says the host is
   another build and offers **Stop the old host and start this one**. The owner presses it. Any jobs in
   that host stop, and they come back with `attach %n`. With no such offer the host already runs this
   code. `Ctrl-B H` shows the host's build.

   **There is no other way for a person to stop the host.** That button appears only when the host is
   another version or build. A plain way to stop it is listed as not built in `apps/fabrika/README.md`.

   If a tile says `pipeline could not load`, the host outlived a rebuild and its files are gone. Stopping
   it takes that same button.

   **The lane works on the repository the host's checkout names.** `pnpm fabrika` starts the app in
   this checkout, and the host the app starts runs in the same folder. A lane reads that checkout's
   `origin` when it starts: `github.com` is the GitHub host, a folder on this disk is the local one.
   There is no file to write. A host started anywhere else, such as an app opened from the Finder, or a
   checkout with no `origin`, ends the lane before any agent starts, and the tile says why:

   ```text
   #117 ended: stuck:step_failed. <checkout> has no origin: start the app from a checkout of the repository
   ```

   To see what the lane will read, in the checkout: `git config --local --get remote.origin.url`.

2. **The owner types the line in their app.** No agent types it, because no agent answers the questions
   the lane puts to a person.

## The steps

```text
triage -> plan -> the person approves -> exam, when rules change -> test writer
       -> build -> mutation -> one review -> push -> the person's yes -> merge
```

Every step answers in the same five verbs, and the lane does too:

| Verb | What it means here |
|---|---|
| `done` | The step finished, and the lane goes on. For the lane: merged, or triage closed the ticket. |
| `send` | It goes to someone else, such as back to the builder. |
| `ask` | It waits for a person. Answer in the `ticket` window. |
| `skip` | Nothing more to do, on someone's decision: `closed`, `owner_no`, `research`. |
| `stuck` | It stopped and did not guess. The word after it says why. |

The lane asks a person four kinds of question (`packages/pipeline/src/stages/pipeline/machine.ts`):

| Ask | What it is about |
|---|---|
| `approve` | The plan. Open questions in the plan are read here too. |
| `exam_merge` | The exam's own pull request is open, and rules are the person's call. |
| `merge` | The merge yes, after the push. |
| `step` | A step ended on `ask`, and it may be run again. |

## When a lane is stuck

**A stuck lane is final. Restarting is not built.** Typing the line again only says how it ended, and
runs nothing.

Stuck words come at two levels. The ticket shows both.

| Level | Words | Where |
|---|---|---|
| The lane, seven words | `not_yours`, `no_ticket`, `claim_held`, `step_failed`, `step_stuck`, `rounds_spent`, `sent_back` | `stages/pipeline/outcome.ts` |
| One step, under a lane's `step_stuck` | Such as `exam_touched` (build), `checks_stuck`, `merge_failed`, `merge_unknown` (ship), `merged_elsewhere` (merge) | That step's own outcome, in the line it printed |

1. Read both words on the ticket. The program's README says what each GitHub one means.
2. Say exactly what is left: a claim, a branch, a pull request.
3. **Inside a live run nothing but ship merges.** Once a lane is finished and stuck, what is left is a
   by-hand change, under [the by-hand rule](../plan/README.md#how-a-change-lands): the owner's yes, green
   CI, and an agent merges after a leak grep. The other choice is a new ticket.
4. Log it in `field/`. A stuck lane teaches as much as a merged one.

## The leak check

Today the leak check is a by-hand grep, before the merge yes, when the branch is already public. A gate
before the push ([nothing is pushed before review](../direction/push-after-review.md)) is not built. A
person or an agent reads the pull request's added lines and greps them for keys, machine paths, personal
names and account names. Do not give the merge yes until that is clean.

## What to log

The same day, in [`field/`](../../field/README.md):

- **`runs.jsonl`, one `pipeline` row:** the lane as a whole, with `lane` as `<owner>/<repo>#117`.
- **`runs.jsonl`, one `step` row per agent run.** Its `why` starts `pipeline, tracker ticket 117, <step>:`,
  so it cannot be taken for an older row with the same number.
- **The numbers:** the lane prints them for each step and keeps them on the ticket. `field/README.md`
  says which goes where.
- **Dollars:** `gpt-6-astra` has no known price, so the app's cost reads zero for it. Write `costUsd`
  for Claude only, and say the Codex dollars are unknown.
- **`notes.jsonl`, one note per thing** that broke, cost too much, needed a person or worked well.
- **Say which parts were which:** in the `pipeline` row's `why`, the lane and step machines were this
  repo's machine; the agents were Codex and Claude; today's fabrika, the older pipeline, ran none of it.

## What this cannot tell us

- How a real run on real GitHub goes. The lane's GitHub path has run only over a stand-in `gh`.
- Which steps fail first. Ticket 117 is the first measure, so expect this page to change after it.
