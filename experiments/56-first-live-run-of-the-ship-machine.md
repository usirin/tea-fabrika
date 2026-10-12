# 56. The first live runs of the ship machine

On every real lane so far the ship stage was an agent: today's fabrika's
shipper, an opus session that checks the gates, puts the pull request in the
merge queue and watches it. The ship machine (`src/stages/ship/`) does that
job in code. Until these runs it had only met scripted answers, and its
writes had never touched a real repository. Here it filled the operator
machine's ship stage on two real lanes, a few hours apart.

**Answer: it shipped, twice.** [kamp-us/demlik#561](https://github.com/kamp-us/demlik/issues/561),
a docs-only ticket, went from claim to merged
([PR 632](https://github.com/kamp-us/demlik/pull/632)) in 19.3 minutes for
$1.73. No shipper agent ran and the ship stage cost $0. The child read the
pull request's facts, the gate said go, it put the head in the merge queue,
listened on the queue, and saw the merge land as commit `0da7233`. The driver
then wrote `LANDED` on the lane and fabrika took it. No Jev call. Nothing
done by hand.

The second lane was a code change.
[kamp-us/demlik#622](https://github.com/kamp-us/demlik/issues/622), a bug
fixed across two packages, merged
([PR 634](https://github.com/kamp-us/demlik/pull/634)) in 28.3 minutes for
$3.95, the same way and again with a ship stage that cost $0. It is written
up in [A second lane, on code](#a-second-lane-on-code-622). Every section
before that one is about the first run.

That is two enqueues, on one repo, on two pull requests with nothing in
their way: one docs-only, one code. Both took the straight path. They say
nothing about the machine's other 20 endings.

```sh
# The command of experiments 49, 50 and 52, with one more word: SHIP=machine.
# Folder names are shortened here.
LANE=561 SHIP=machine MODEL=opus EFFORT=medium ASK_WAIT_MIN=10 \
  REPO=~/demlik PLUGIN=~/fabrika-plugin TREES=~/demlik-trees \
  RUN=runs/operate/561-1 WHO=<login>,<login> \
  node src/operate.ts

# What the ship stage did, from the run's own state. No agent, no tokens.
#   reading > enqueueing > queued > finishing > over
#   { "kind": "done", "part": false, "commit": "0da7233…", "cleanup": "done" }
```

## Who did what

| Part | Whose | Here |
|---|---|---|
| The driver: claim, working copy, routing, the wait on checks before the review, the clean-up | tea-fabrika, the operator machine (`src/operator.ts`, `src/turn.ts`) | 21 Cmds, no tokens |
| The ship stage: the facts, the gate, the enqueue, the wait on the queue | tea-fabrika, the ship machine, run as the operator's child. New in this run | 3 Cmds, no tokens, 1 write to GitHub |
| Builder and reviewer | today's fabrika: its skill agents, started through the Agent SDK | 2 runs, $1.73 |
| The lane's ledger: the claim, the brief, the `LANDED` line, the record | today's fabrika: CLI 0.9.0 behind the `Fabrika` wrapper (`src/fabrika-cli.ts`) | 45 verbs |
| The shipper agent | today's fabrika | did not run |

## The run

Times are UTC on 2026-10-12.

| Time | What happened | Cost |
|---|---|---|
| 00:59:34 | Claim, boot the lane, make the working copy, write "started" |  |
| 00:59:53 | **Builder.** Reworded "door" on two how-to pages and in the test file that mirrors one. Opened PR 632 | $1.06, 4.1 min |
| 01:04:08 | Read the PR: checks pending. Waited 7.4 minutes, 14 reads | Listen |
| 01:11:30 | Checks green. **Reviewer: PASS** on code and on doc | $0.67, 1.3 min |
| 01:12:55 | Read the lane: `ship`. **Started the ship machine.** No shell |  |
| 01:12:56 | The child had read the pull request's facts, in 1.2 s. The gate said go | Gather, Check |
| 01:12:58 | The child had put head `a150ab9` in the merge queue, in 1.8 s. GitHub dates the entry 01:12:57 | Act, the first real write |
| 01:12:58 | The child listened on the queue | Listen, $0 |
| 01:18:30 | GitHub merged the PR as `0da7233` and closed the issue |  |
| 01:18:35 | The Listen said landed, with that commit. The child ended `done` |  |
| 01:18:36 | The driver wrote `LANDED` on the lane. Fabrika checked it against GitHub and took it, exit 0 | Act |
| 01:18:44 | Posted the record, removed the working copy, released the lane. Ended at 01:18:49 | Act |

The operator sent 24 Cmds, 3 of them the child's, which became 45 fabrika
verbs: 15 `build verdicts`, 10 `lane status`, 9 `lane history` and 11 others.
The one non-zero exit was the read that said the lane did not exist yet. The
Check refused nothing. The log shows one start, no stop, no restart and no
question.

The child stood in five phases and never in `waiting` or `rerunning`. The
checks were green before it started, so it had nothing to wait for and
nothing to run again.

## How I know the write was the machine's

The run kept no record of its own `gh` calls (see "What broke"). So this
rests on three things read together:

- GitHub's `AddedToMergeQueueEvent` on the PR is dated 01:12:57Z. The enqueue
  Cmd ran from 01:12:56.2 to 01:12:58.0.
- No shell was alive then. The reviewer ended at 01:12:51 and no shipper was
  ever started.
- Neither shell's logged commands name the queue, a merge or a ship verb.
  The log keeps the first 600 characters of each command. The Check, which
  refuses `gh pr merge` and `--auto`, refused nothing.

GitHub names the account behind the event, and every writer here uses the
owner's accounts, so the name alone would not tell a shell from the machine.

## What a time in `msgs.jsonl` means

The run's message file has `ship_facts_ok` at 01:12:57.995 and
`ship_enqueue_ok` at 01:12:58.002. That is 7 ms for a write to GitHub, which
cannot be. It was not.

The host stamps a message when tea's loop tells its observer about it. The
loop does that last. It saves the new state, runs the Cmds the message's step
sent, waits for them, and only then calls the observers. So the time beside a
message is when the Cmds it sent ended. It is not when the message arrived.
I read this in the engine (`commit` in `@demlik/tea` 0.20.0) and checked it
against the verbs, which are stamped as each one returns. `start` is stamped
2 ms after the last verb of the claim, and `lane_brief_ok` 1 ms after
`lane dispatched`.

The ship stage, read that way:

```text
01:12:55.064  the lane read before ship ends
01:12:56.228  stamp on lane_view_ok     the facts read it sent has ended     1.2 s
01:12:57.995  stamp on ship_facts_ok    the enqueue it sent has ended        1.8 s
01:12:58.002  stamp on ship_enqueue_ok  it sent nothing, the Listen opens    7 ms
01:18:35.283  stamp on ship_queue       the tidy-up it sent, a no-op here
01:18:36.859  stamp on ship_finish_ok   the LANDED write it sent has ended   1.6 s
```

The next message is stepped as soon as the one before is done, so the gap
between two stamps is how long the later message's Cmds took. What the files
cannot tell: the single `gh` calls inside a Cmd. The enqueue is one read and
then one write, and only their sum is known.

## Cost

`tokens` is the size of a run's conversation at its last turn. `billed` is
every token it was billed for, each turn's input counted again.

| Role | Whose | Dollars | `tokens` | `billed` | Minutes |
|---|---|---|---|---|---|
| Driver | tea-fabrika, the operator machine | $0 | 0 | 0 | 19.3, the whole lane |
| Builder | fabrika agent, opus, medium | $1.06 | 80,248 | 1,038,958 | 4.1 |
| Reviewer | fabrika agent, opus, medium | $0.67 | 63,062 | 386,957 | 1.3 |
| Ship stage | tea-fabrika, the ship machine | $0 | 0 | 0 | 5.7 |
| Lane |  | $1.73 | 143,310 | 1,425,915 | 19.3 |

Where the 19.3 minutes went: 5.4 in the two shells, 7.4 waiting on checks
before the review, 5.7 in the ship stage, and under 1 in the driver's own
reads and writes. Of the ship stage's 5.7 minutes, 5.6 were the merge queue.

## The ship stage, beside a shipper agent

The three earlier lanes where a shipper agent shipped a pull request, all
under the operator machine.

| | #559 | #625 | #623, second run | #561 |
|---|---|---|---|---|
| Who shipped | shipper agent | shipper agent | shipper agent | ship machine |
| Dollars | $0.30 | $0.33 | $0.29 | **$0** |
| `tokens` | 30,407 | 31,099 | 31,072 | 0 |
| `billed` | 143,482 | 203,575 | 205,159 | 0 |
| Minutes in the stage | 6.5 | 6.1 | 8.7 | 5.7 |
| Who saw it land | the shipper | the shipper | the operator's Listen, after the shipper's watch ran out | the ship machine's Listen |

So the saving is about 30 cents and one 30,000-token opus session a lane. The
minutes barely move, because the merge queue takes what it takes: 5 minutes
33 seconds here by GitHub's own dates.

The whole lane was not cheaper than the one most like it. #559 was also one
docs change straight through, and it cost $1.74 with a shipper agent. This
one cost $1.73 without. Its builder and reviewer had three files to handle
where #559 had one paragraph. They came to $0.29 more, which ate the saved
shipper. The like-for-like row is the ship row. It is one docs-only lane, so
read $0 against $0.30 as a first number, not a rate.

## Two things that were not known, each seen once

[`docs/ship-machine.md`](../docs/ship-machine.md) listed both as unchecked.

**Fabrika took a `LANDED` written by the driver, with no shipper shell.** The
driver ran `fabrika lane report 561 --task issue --token LANDED --pr …`. It
exited 0. Fabrika did check first: its output says the pull request closes
the issue on merge and that the issue reads closed. It folded the line as the
lane's last event, with PR 632 as what landed. The next read said the lane
was complete, and `lane record` posted
[the record](https://github.com/kamp-us/demlik/issues/561#issuecomment-6116048289).
That is one of the ten lines the child can write, in the one case where
everything was true. `ALREADY-MERGED`, `BASE-CONFLICTED`, `EJECTED`,
`ROUTED-REPAIR`, `ROUTED-REVIEW`, `AWAITING-CP-APPROVAL`, `REFUSED`,
`UNKNOWN` and the park with no cause were not written. `QUEUED` is never
written in this mode, so that question was not asked and stays open.

**The ship machine's own queue Listen ran.** It opened at 01:12:58, set to
read the pull request every 30 seconds. The reads are not logged, so I cannot
count them. It said `landed` about 5 seconds after GitHub's merge time. The
commit it named is the one on main, `0da7233`, not the head `a150ab9`, and it
matches GitHub's merge commit. The queue's clock was set beside it, for 60
minutes, and did not fire.

## What broke

- **The `shipper` row says 0 minutes.** The child ran about 5.7 minutes.
  `fieldRows` in `src/operator-host.ts` writes `minutes: 0` and `tools: 0`
  for a ship stage the machine ran, as fixed numbers. It has nothing to work
  from. The record the operator keeps of a child (`ShipRow` in `src/turn.ts`)
  holds its phases and its outcome and no time, because a machine reads no
  clock. Not fixed. The row in `field/runs.jsonl` says 5.7, measured from the
  message file, and field note 2026-10-12-04 says so.
- **That row's `note` is a sentence.** `field/README.md` says `note` holds
  the id of a note, and every other row does. In `field/runs.jsonl` the row
  points at its note, and the sentence (the phases and the ending) is in the
  note.
- **The log is silent for 5 minutes 40 seconds.** From 01:12:56 to 01:18:36
  it prints nothing. A person watching could not see "enqueued" or "waiting
  on the queue", only that the lane was at `ship`. Two causes. The log prints
  a line when the run's one-line summary changes, and that summary shows the
  turn's phase, `shipping`, and not the child's. And only fabrika's verbs are
  logged as they run. The code host's `gh` calls go another way with no log.
  Experiment 52 found the same hole for the question on the issue.
- **The one write left no record of its own.** `verbs.jsonl` has no line
  between 01:12:55 and 01:18:36. The enqueue shows only as a message type and
  as a phase name. The facts the child read and the gate's answer were not
  kept at all. To see what the machine saw, someone has to read GitHub again.
- **Message times read as arrival times, and are not.** See above. Nothing
  was wrong in the run. Anyone timing a Cmd from that file would be wrong.
- **`cleanup: "done"` says more than was done.** Under the operator the
  child's tidy-up does nothing, on purpose: the operator removes the working
  copy. The doc already says the tidy-up is thin. The outcome still reads as
  if a tidy-up ran.

Two things that are today's fabrika's and did not change the run. The builder
pushed with fabrika's own `build check` red on the CODEOWNERS guard and said
so in the pull request, as in experiment 52. CI was green. And `lane record`
said its table did not sync, because the repo has no project table. The
record was posted all the same.

## Checked, and the same as before

- **The closed issue still carries `status:triaged` and `ready-for:agent`.**
  So do #559, #625 and #623, which a shipper agent shipped under the machine,
  and #600 and #601, which an operator agent drove. Six of six. It is not a
  difference the ship machine made.
- **The builder's local branch is still in the repo's main checkout**
  (`build/561-…`), as after experiments 49 and 50. GitHub deleted the remote
  branch at the merge. No working copy and no claim are left.
- **Nothing told a person it landed**, beyond the record on the issue. A
  shipper agent ends with a two-line message in its own conversation, which
  nobody reads under the machine either. It left no comment on PR 626 or 628.

## A second lane, on code (#622)

**Answer: it shipped again, the same way.**
[kamp-us/demlik#622](https://github.com/kamp-us/demlik/issues/622) is a bug
in tea's check of its published API, and the fix touches two packages. It
went from claim to merged
([PR 634](https://github.com/kamp-us/demlik/pull/634)) in 28.3 minutes for
$3.95. The command was the one above with `LANE=622` and
`RUN=runs/operate/622-1`. No shipper agent ran and the ship stage cost $0.
The child stood in the same five phases, `reading > enqueueing > queued >
finishing > over`, and ended `done` with commit `9915b2e`. The driver wrote
`LANDED` and fabrika took it, exit 0. No Jev call. Nothing done by hand.

The lane was picked in the hope that its first review would fail. The ship
machine would then have read a pull request that carried an old FAIL and a
new PASS. The review passed the first time. So this is a second run of the
straight path, and the list of what has not been seen is as long as it was.

Who did what is the same as in the first run. The driver and the ship stage
are this repo's machines. The builder, the reviewer and the lane's ledger are
today's fabrika's.

### The run

Times are UTC on 2026-10-12.

| Time | What happened | Cost |
|---|---|---|
| 03:09:41 | Claim, boot the lane, make the working copy, write "started" |  |
| 03:10:01 | **Builder.** Fixed the check in `code-graph` and in `tea`, wrote a 418-line test that builds the fixture, changed the spec and a reference page, added a changeset. Opened PR 634 at 03:19:27, 11 files. Then watched the checks itself for 7.5 minutes | $2.94, 17.4 min |
| 03:27:35 | Read the PR: every required check had passed. No wait |  |
| 03:27:40 | **Reviewer: PASS** on code and on doc | $1.01, 2.3 min |
| 03:30:00 | Read the lane: `ship`. **Started the ship machine.** No shell |  |
| 03:30:02 | The child had read the pull request's facts, in 1.4 s. The gate said go | Gather, Check |
| 03:30:04 | The child had put head `7c2dcc4` in the merge queue, in 1.9 s. GitHub dates the entry 03:30:03 | Act |
| 03:30:04 | The child listened on the queue | Listen, $0 |
| 03:37:23 | GitHub merged the PR as `9915b2e` and closed the issue |  |
| 03:37:43 | The Listen said landed, with that commit. The child ended `done` |  |
| 03:37:45 | The driver wrote `LANDED` on the lane. Fabrika checked it against GitHub and took it, exit 0 | Act |
| 03:37:52 | Posted [the record](https://github.com/kamp-us/demlik/issues/622#issuecomment-6117294730), removed the working copy, released the lane. Ended at 03:37:59 | Act |

The operator sent 24 Cmds, 3 of them the child's, which became 31 fabrika
verbs: 10 `lane status`, 9 `lane history`, 1 `build verdicts` and 11 others.
The first run had 15 `build verdicts`, and 14 of them were its wait on
checks. The one non-zero exit was again the read that says the lane does not
exist yet. The log shows one start, no stop, no restart and no question.

The write was the machine's, on the same three grounds as before. GitHub
dates the queue entry 03:30:03Z, and the enqueue Cmd ran from 03:30:02.3 to
03:30:04.2. No shell was alive: the reviewer ended at 03:29:57. Neither
shell's logged commands name the queue or a merge.

### Cost

| Role | Whose | Dollars | `tokens` | `billed` | Minutes |
|---|---|---|---|---|---|
| Driver | tea-fabrika, the operator machine | $0 | 0 | 0 | 28.3, the whole lane |
| Builder | fabrika agent, opus, medium | $2.94 | 152,353 | 4,268,109 | 17.4 |
| Reviewer | fabrika agent, opus, medium | $1.01 | 90,467 | 656,792 | 2.3 |
| Ship stage | tea-fabrika, the ship machine | $0 | 0 | 0 | 7.7 |
| Lane |  | $3.95 | 242,820 | 4,924,901 | 28.3 |

Where the 28.3 minutes went: 19.7 in the two shells, 7.7 in the ship stage,
and under 1 in the driver's own reads and writes. Of the builder's 17.4
minutes, 7.5 were its wait on checks. Of the ship stage's 7.7 minutes, all
but 5 seconds were the merge queue. By GitHub's own dates the queue took
7 minutes 20 seconds, against 5 minutes 33 seconds on the first run.

### Beside the other lanes the machine drove

Lane #559 is experiment 49, #625 is experiment 50 and #623 is experiment 52.

| | #559 | #625 | #623 | #561 | #622 |
|---|---|---|---|---|---|
| The change | docs, one paragraph | code, a failed review and a repair | code, parked for an approval, two runs | docs, three files | code, 11 files |
| Who shipped | shipper agent | shipper agent | shipper agent | ship machine | ship machine |
| Lane dollars | $1.74 | $7.68 | $3.51 | $1.73 | **$3.95** |
| Run minutes | 18.8 | 40.2 | 28.3 and 9.9 | 19.3 | 28.3 |
| First builder | $0.88, 3.5 min | $1.32, 5.0 min | $1.90, 9.3 min | $1.06, 4.1 min | $2.94, 17.4 min |
| The review that passed | $0.56, 1.1 min | $0.87, 2.4 min | $1.02, 2.4 min | $0.67, 1.3 min | $1.01, 2.3 min |
| Ship stage | $0.30 | $0.33 | $0.60, two shippers | $0 | $0 |

This is the dearest lane that went straight through, 2.3 times #561. All of
the difference is in the two shells. The builder is the dearest single shell
on any lane the machine has driven: $2.94 over 58 turns, against $2.22 for
the repair builder on #625 and $1.90 on #623. The reviewer's $1.01 and 2.3
minutes sit with the other reviews of code, which cost $0.87 to $1.02 and
took 2.2 to 2.4 minutes.

The ship stage saved about 30 cents again. On this lane that is about 7% of
what it would have cost with a shipper agent. On #561 it was about 15%. The
dearer the build, the less the saving shows.

### Three things I looked at

**Why the review started with no wait.** On the first run the driver waited
7.4 minutes for checks before the review. Here it read the pull request once
and started the reviewer 4 seconds later. The builder had done the waiting.
After its push it ran one command, `gh pr checks 634 --watch`, and sat in it
from 03:19:32 until the checks ended, about 7.5 minutes, with its session
open. The first run's builder has no such call and ended right after its
push. Fabrika's build skill leaves this to the builder: it says how to wait
if the builder waits, and does not say whether to. The lane's clock time is
the same either way. What changes is what a builder's minutes mean. This
builder worked for about 10 minutes and waited for 7.5, so 17.4 beside the
first run's 4.1 overstates the work. The log keeps one dollar total per
shell, so I cannot say what the wait cost. A builder that waits can mend a
red check in the same session, so the wait is not plain waste. Field note
2026-10-12-08.

**What the reviewer ran.** It made 13 tool calls. Nine were commands:
fabrika's `review scope`, `criteria`, `verdicts`, `deviations`, `diff`,
`scratch` and `ci --wait`, `gh` reads of the pull request and of issues 622
and 633, and `git show` on four files at the head. Four were file reads: the
saved diff twice, and the rubrics for code and for doc. No logged call runs
a test, a type check or the fixture. The log keeps the first 600 characters
of a command and three of the nine are longer, so I cannot see their tails.
The first criterion asks for an end-to-end fixture. The reviewer read the
test that builds it, and read that CI was green at the head. Its verdict
says the same: it lists what it read as the full diff, the pull request's
own list of deviations, and CI. CI's required check runs the test suite, so
the fixture did run, on CI.

Fabrika's review skill asks for exactly this. It says no review class runs
again what CI enforces, and it takes the read of CI at the head as the proof
that the code ran. The target repo's own guide says the reviewer runs the
first criterion's fixture. This run followed the skill. The machine has
started six reviewers so far, and none of their logs shows a test command.

It posted two verdicts, both PASS at head `7c2dcc4`, round 1:
[`review-code`](https://github.com/kamp-us/demlik/pull/634#issuecomment-6117219455)
and [`review-doc`](https://github.com/kamp-us/demlik/pull/634#issuecomment-6117220477).
It then reported PASS to the lane for the classes code and doc. One row
passed "with a named limit". The seventh criterion says the output names
every removed subpath. A removed subpath that published no name is not named
and does not fail. The builder had listed that in the pull request as a
known defect left unfixed and filed
[#633](https://github.com/kamp-us/demlik/issues/633). The reviewer read the
row as met and wrote that the owner might read it otherwise. The ship
machine's gate reads each review kind's word at the head. It does not read
the text under it.

**What else broke or surprised.** Nothing new broke.

- The run kept no `refused.jsonl`, and both shells end with an empty list of
  denied tools. The Check refused nothing.
- The run's `shipper` row said 0 minutes again, with a sentence in `note`.
  The log printed nothing for 7 minutes 43 seconds, from 03:30:02 to
  03:37:45. `ship_facts_ok` and `ship_enqueue_ok` are 8 ms apart. All three
  are in "What broke" above, and none was fixed between the runs. The row in
  `field/runs.jsonl` says 7.7 minutes, measured the same way.
- The builder's local branch `build/622-…` is still in the repo's main
  checkout, beside `build/561-…`. No working copy and no claim are left.
- The builder left one new open issue in the target repo, #633, filed with a
  plain `gh issue create` during the build.
- `lane record` posted the record and said its table did not sync, as on the
  first run. The record says 27 minutes, from the lane's opening to
  `LANDED`, and says its dollars are not measured.
- The builder pushed with fabrika's `build check` red on the CODEOWNERS
  guard and said so in the pull request, as on the first run. CI was green.
- The closed issue still carries `status:triaged` and `ready-for:agent`.
  Seven of seven now.
- The Listen said landed about 20 seconds after GitHub's merge time. On the
  first run it was 5. It reads every 30 seconds, so both are inside one read.

### What it adds, and what it does not

It adds a second enqueue, a second wait on the queue and a second `LANDED`
that fabrika took from the driver. It adds a pull request that changes code:
11 files in two packages, 756 lines added, with a changeset. The gate said
go on it as it did on the first run's three files. Field note 2026-10-12-07.

It adds no new phase, no new line and no new answer from the gate. The
checks were green before the child started, both reviews had passed, no
owner's approval was needed, and the head did not move. The child never
stood in `waiting` or `rerunning`. Every item in the list below is as
untested as it was after the first run.

## What two clean runs do not show

Both runs took the straight path, so the second one crossed nothing off.

- A pull request that carries an old FAIL and a new PASS. The second lane
  was picked for this and its review passed the first time. Four of the five
  lanes the machine has driven passed their first review, so a lane picked in
  hope is a poor way to get one.
- Red checks, and the one re-run before the builder is called. The re-run
  write has still never run on a real repository.
- The wait for checks that are still running, and its limit.
- An ejection from the queue, and whether fabrika takes `EJECTED` from the
  driver.
- An owner's approval: a protected file, the `ask`, the park and its recipe.
- A part landing, where the ticket stays open.
- A head that moves under the enqueue.
- A restart during the queue wait. The child's state is saved with the
  operator's, and nothing here stopped the run to prove it carries on.
- A repo with a busy queue. I did not check what else was in the queue on
  either run. Nothing in the runs' files says.
- An unresolved comment, a missing review, a closed or draft pull request, a
  repo with no merge queue.
- `--write` in `src/stages/ship/run.ts`, the machine alone with no operator.
  Still never run.
- Whether the gate's order is right. One "go" cannot test an order.

## Next

The second lane leaves this list as it was. It was run before item 1 was
done, so its ship stage was as hard to see as the first one's. It went
straight through, so little had to be worked out from GitHub. A third run
should not count on that.

1. **Make the ship stage visible before running it again.** Show the child's
   phase in the log line, log each code host call the way verbs are logged,
   keep the facts and the gate's answer, and stamp the child's start and end
   so the row has its minutes. Why: the next run should be one that goes
   wrong, and today a run that goes wrong would have to be worked out from
   GitHub. Cost: an hour or two, all in the host. Sure: 90%.
2. **Stop a run while the child is in `queued`, and start it again.** It is
   the cheapest untested path, and the pull request is safe in the queue
   either way. Cost: one more docs-only lane, about $1.75. Sure it is worth
   doing: 85%. Sure it carries on cleanly the first time: 70%. No real
   run has restarted a child, and a Listen that opens late is known to miss an
   ejection that happened meanwhile.
3. **A lane that touches a protected file**, so the child ends
   `ask:owner:approval` and the driver writes `AWAITING-CP-APPROVAL`. That is
   the second of the ten lines, and experiment 52 already has the same lane
   done by a shipper agent to set it beside. Cost: about $3.50 and a person's
   approval. Sure: 80%.
4. **Keep `SHIP=agent` the default** until red checks and an ejection have
   each been seen once. Two clean lanes on the same path are not enough to
   change a default. Sure: 95%.
