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

## Who starts it

1. **An agent prepares:** it checks the list below and tells the owner what is missing.
2. **After the owner's yes,** an agent writes `<home>/pipeline.json`. `<home>` is the app's own data
   folder. The lane reads the file when it starts.

   ```json
   {"repo": "owner/name", "remote": "git@host:owner/name.git", "host": "github"}
   ```

3. **The owner restarts the app,** then types the line in their app. No agent types it, because no agent
   answers the questions the lane puts to a person.

## What must be true first

- `.fabrika/fabrika.toml` is on the repository. This one has it.
- `codex login status` and `gh auth status` both pass. Run them as they are, so no token is printed.
  Triage defaults to `claude` on `opus`, and this repository does not change that, so `claude` must be
  logged in too.
- The ticket was filed for the owner's own id. Otherwise the lane refuses it with `not_yours`, before
  any agent starts.
- **No other merges to main during the run.** A commit on main before a pinned merge sends the lane
  back, and that is final. Tell anyone with work waiting.

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
| `ask` | It waits for a person. Answer in the `ticket` window. There are two yeses: the plan and the merge. |
| `skip` | Nothing more to do, on someone's decision: `closed`, `owner_no`, `research`. |
| `stuck` | It stopped and did not guess. The word after it says why. |

## When a lane is stuck

**A stuck lane is final. Restarting is not built.** Typing the line again only says how it ended, and
runs nothing.

1. Read the reason on the ticket: for example `not_yours`, `claim_held`, `step_stuck`, `rounds_spent`,
   `sent_back`, `exam_touched`, `checks_stuck`, `merge_failed`, `merge_unknown`, `merged_elsewhere`.
   The program's README says what each GitHub one means.
2. Say exactly what is left: a claim, a branch, a pull request.
3. The owner picks: land the open pull request by hand, or file a new ticket.
4. Log it in `field/`. A stuck lane teaches as much as a merged one.

## The leak check

The leak check is not built into the lane, and this repository is public. Before the merge yes, a
person or an agent reads the pull request's added lines by hand and greps them for keys, machine paths,
personal names and account names. Do not give the merge yes until that is clean.

## What to log

The same day, in [`field/`](../../field/README.md):

- **`runs.jsonl`, one `pipeline` row:** the lane as a whole, with `lane` as `<owner>/<repo>#117` and
  `outcome` as it ended.
- **`runs.jsonl`, one `step` row per agent run:** its step in `why`, with model, effort and both token
  measures, `tokens` and `billed`.
- **Dollars:** `gpt-6-astra` has no known price, so the app's cost reads zero for it. Write `costUsd`
  for Claude only, and say the Codex dollars are unknown.
- **`notes.jsonl`, one note per thing** that broke, cost too much, needed a person or worked well.
- **Say which parts were which:** in the `pipeline` row's `why`, the lane and step machines were this
  repo's machine; the agents were Codex and Claude; today's fabrika, the older pipeline, ran none of it.

## What this cannot tell us

- How a real run on real GitHub goes. The lane's GitHub path has run only over a stand-in `gh`.
- Which steps fail first. Ticket 117 is the first measure, so expect this page to change after it.
