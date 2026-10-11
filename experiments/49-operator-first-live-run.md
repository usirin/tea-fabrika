# 49. The operator machine drives one real lane

Section 48 stopped at a fake. This one wires the machine to real fabrika,
real git and real GitHub, and runs one issue on kamp-us/demlik with no
operator agent.

**Answer: it merged.** [kamp-us/demlik#559](https://github.com/kamp-us/demlik/issues/559),
a one-paragraph doc bug, went from claim to merged
([PR 626](https://github.com/kamp-us/demlik/pull/626)) in 18.8 minutes. The
machine sent 22 Cmds, used no tokens of its own, made no Jev call and asked
nobody anything. Its three shells cost $1.74. It made one working copy and
removed it. Nothing was nudged by hand while it ran.

One run, on the easiest kind of issue. It shows the loop works end to end. It
does not show a rate.

## What was built for it

- **`Fabrika` over fabrika-cli 0.9.0** (`src/fabrika-cli.ts`). The temporary
  Layer section 48 argued for. Each method runs one or two verbs from the
  repo's main checkout and turns stdout and the exit code into the typed
  answer. A code no rule covers is "could not read or write", and the machine
  stops. The CLI has no key for a write, so the Layer keeps a file of the
  intents it has written and answers a repeat from it. Three places where
  0.9.0 and the service disagree, and what the Layer does:
  - A lane that "tripped" reads as done. The Layer shows it as an active task
    parked at `human:budget-spent`, because a person can still open it.
  - The conflict lap only exists out of `ship`. Anywhere else the Layer writes
    a park with that cause.
  - A dead shell is a lap where the state has one, and a park where it has not.
- **`Worktrees` on git** (`src/operator-live.ts`). `git worktree add --detach`
  at the remote's default branch, then the repo's install. Remove is
  `git worktree remove --force` on that one path. No `prune`: other drivers
  keep working copies in the same repo.
- **`Thread` on issue comments.** A question is one comment with a hidden mark
  naming its intent, so it is posted once. A reply is any later comment with
  no hidden mark at all. Fabrika's verbs and shells comment under the same
  account a person answers from, and they mark what they post.
- **The Check before each step** (`src/shell-guard.ts`), a PreToolUse hook as
  experiment 43 recommended. It refuses `gh pr merge`, `--auto`,
  `--delete-branch`, a push whose target is `main`, `git worktree add`, a
  Write or Edit outside the shell's own copy, and a shell command whose shape
  writes outside it (a redirect, `tee`, `rm`, `mv`, `cp`). The lane's ledger
  and the temp folders are allowed. A shell with Bash can still reach further
  than this sees; it stops the plain cases and the named ones.
- **Limits.** A shell's tools are the ones its fabrika definition names,
  pre-approved, and anything else is denied with no prompt. $6 a shell (the
  SDK stops it). $15 a run: past it the machine starts no new shell and stops,
  leaving the lane where it stands. The time limits from section 48.
- **The host** (`src/operate.ts`): the machine on the Effect engine with a
  file store, the Layers, and a log of every Cmd, verb and shell message.

## The dry runs, and what they caught

Four cheap runs before the lane, on haiku, each in a working copy the live
`Worktrees` Layer made and removed (`experiments/49-shell-dry-run.ts`, logs in
`results/shell-dry-run-*.json`). About $0.10 in all. They were worth it: three
of the four things below would have ended the live run at its first shell.

| Risk from section 48 | What the dry run showed |
|---|---|
| `agent: "fabrika:builder"` with the plugin loaded from a folder | It starts. The plugin loads once, though the repo's settings also enable it from a marketplace. The shell gets its definition's tools. **It gets no skill.** |
| A shell makes its own working copy | It does not. `build branch` makes a branch in the folder it stands in. The brief's rule "run in your own git worktree" is the only pull toward a second copy, and the Check refuses `git worktree add` |
| The Check | Refused all five things it should, before they ran, and let the sixth (a write inside the copy) through |

**The skill.** A fabrika shell is an agent definition that names its skill
(`skills: ["fabrika:build"]`). Spawned as a subagent, the harness puts that
skill in its context. Run as an SDK session's main agent, it gets nothing:
10,041 tokens of context against 34,134 with the skill. So the host does the
preload itself (`src/shell-skill.ts`): the skill's text with its arguments
blank, as the harness does it, then the brief. The Check refuses the Skill
tool for a skill already loaded.

**The mistake.** The first version of that check gave the builder Bash and
asked it to read its branch step. With no skill in context it called the Skill
tool. The build skill is declared to run as a second agent in the background,
and that agent did what the skill says: picked the next ready issue, claimed
[#593](https://github.com/kamp-us/demlik/issues/593), read it, and released
the claim. Nothing was left on the issue, and the log is kept
(`results/shell-dry-run-fork.json`). A wiring check must not hold a shell
tool. The dry runs have read-only tools now.

**The typed last word.** Two more. The SDK refused the answer's schema because
of the `$schema` line zod adds, and the run died before its first turn. With
that gone, a named agent with its own tool list is never given the SDK's
answer tool, so the structured answer came back empty. Now code reads the last
JSON object in the shell's closing text that fits the schema, and anything
else is `null`.

## The run

Times are UTC on 2026-10-11.

| Time | What the machine did | Move |
|---|---|---|
| 01:06:35 | Claimed the lane: seats, claim, no lane yet, so it booted one | Act |
| 01:06:45 | Named the working copy in its state, then made it (2 s, with the install) | Act |
| 01:06:48 | Read the lane (`queued`), wrote "started", read it back (`build`) | remember |
| 01:06:54 | Read the brief, wrote "dispatched", started the builder | Gather, Act, Draft |
| 01:10:23 | Builder ended: one paragraph changed, PR 626 open, its own report landed. $0.88, 18 turns, 3.5 min |  |
| 01:10:30 | Read the lane (`review`), read the PR: mergeable, checks pending. Waited | Gather, Listen |
| 01:17:27 | Checks green (14 reads, 30 s apart). Started the reviewer | Draft |
| 01:18:33 | Reviewer ended: PASS, verdict posted. $0.56, 9 turns, 1.1 min |  |
| 01:18:40 | Read the lane (`ship`), started the shipper | Draft |
| 01:25:10 | Shipper ended: gates, checks, merge queue, merged at 01:24:34. $0.30, 5 turns, 6.5 min |  |
| 01:25:13 | Read the lane: done. Posted its record | Gather, Act |
| 01:25:21 | Removed the working copy | Act |
| 01:25:23 | Released the lane. Ended | Act |

The machine's own work was 22 Cmds, which became 60 fabrika verbs: 24
`lane history`, 14 `build verdicts`, 10 `lane status`, and 12 others. The
one non-zero exit was the read that said the lane did not exist yet. The
Check refused nothing: no shell tried anything on its list. All three shells' reports landed on their own, so the typed last words
(`SHIPPED-PR`, `PASS`, `LANDED`) were parsed and never needed.

After: the PR merged through the merge queue, the issue closed, the lane
`complete` with its record posted, the claim comment gone, no working copy
left, and the main checkout untouched. One leftover: the builder's local
branch `build/559-…` still exists in the repo, beside the 67 that earlier
lanes left.

## Cost, beside the two clean lanes

`tokens` here is the size of a run's conversation at its last turn, which is
what a Claude Code subagent reports and so what the baseline rows hold.

| | #600 (operator agent) | #601 (operator agent) | #559 (machine) |
|---|---|---|---|
| Driver, tokens | 115,872 | 119,072 | **0** |
| Builder | 183,811 | 127,284 | 67,488 |
| Reviewer | 100,536 | 90,722 | 54,537 |
| Shipper | 36,354 | 36,387 | 30,407 |
| Lane total | 436,573 | 373,465 | 152,432 |
| Driver's share | 26.5% | 31.9% | 0% |
| Minutes, claim to end | 33.8 | 31.3 | 18.8 |
| Minutes inside shells | 31.5 | 28.8 | 11.1 |
| Dollars | not recorded | not recorded | $1.74 |

Read it with care. **Only the first row is like for like.** #559 is one
paragraph of a doc; #600 and #601 were code changes, so their builders and
reviewers had more to do, and the smaller shell numbers on the right are the
issue's doing, not the machine's. The shippers do the same job on all three
and come out about the same, which is some comfort that the shells run the
same under the machine. The claim this run supports is the narrow one from
section 48: the driver's 116k to 119k tokens are gone, and the lane lost
nothing by it.

In dollars, the three shells were billed for 1.37 million tokens (a turn pays
for its whole input again), almost all of it cache reads. Each shell starts
large before it does anything: 47k tokens for the builder, 44k for the
reviewer, 27k for the shipper, most of it the skill.

Where the 18.8 minutes went: 11.1 in shells, 7 waiting on CI before the
review, under 1 in the machine. The 7 minutes cost nothing, because the wait
is a Listen. The shipper's 6.5 minutes are the same kind of wait done by an
agent: it ran `ship checks --wait` and sat on the merge queue with an opus
session open.

## What broke, and what was done by hand

- Before the lane: the four things the dry runs caught, above. One of them
  touched a real issue for a minute.
- During the lane: nothing broke, and nothing was done by hand. I watched the
  log and read GitHub. I did not answer, restart or edit anything.
- **The shipper still tried to clean up.** Its skill is newer than the pinned
  CLI, so it ran `lane cleanup`, got "unknown subcommand", and told the person
  "the lane's working copies are still on disk". They were gone four seconds
  after the record was posted. Field note 2026-10-10-06 again, now harmless
  but still a wrong sentence in a closing message.
- **The logged token counts were wrong.** The first row writer logged every
  billed token (929,592 for the builder), which is not what the baseline rows
  hold. The rows in `field/runs.jsonl` were recomputed from the shells'
  session transcripts after the run. `Spend` now carries both numbers, and
  the runner keeps the conversation's size from the turns it sees.
- **The install ran twice.** The machine installed the repo's packages when
  it made the copy. The builder checked for `node_modules`, found them, and
  went on, so this one was fine. A shell that does not check would pay again.

## What this run did not test

- The merge-queue Listen. The shipper saw the PR land inside its own run, so
  the lane never sat in `ship:queued`.
- A park, a recipe, a question to a person, a Jev reading. Nothing parked.
- A failed review and a repair round. A dead or overtime shell.
- A restart. The run was never stopped.
- Two lanes at once, a conflict with a moved base, an epic.

## Before a second run

1. **Pick an issue that fails a review once.** A code issue, so the repair
   loop, the retry budget and a second builder run are real.
2. **Resume a shell's conversation.** A kill mid-shell still means a dead
   shell and a lap. It is the gap most likely to bite on a longer lane.
3. **A time limit on the wait for CI.** `pr_waiting` has none. Checks that
   never finish would hold the run forever.
4. **Read the lane once per pass.** The Layer calls `lane history` for every
   view and every PR lookup: 24 of the 60 verbs, about a second each.
5. **Pin the plugin to the CLI.** The shells read a skill written for a newer
   fabrika. This run survived it; the next verb the skill names and 0.9.0
   lacks may not be one a shell can shrug off.
6. **Move the shipper's waiting out of the agent.** Its gates are Checks, the
   enqueue is an Act, and the queue is a Listen. That is most of its 6.5
   minutes and all of its idle spend. It is also the start of shells whose
   result the machine records itself, which is when the lane machine can move
   here and the CLI Layer can go.
7. **Record dollars for agent-driven lanes too**, or the cost table stays
   tokens on one side and dollars on the other.
