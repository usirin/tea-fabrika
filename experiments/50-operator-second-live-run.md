# 50. The second live run: a failed review, a repair, and three shells that left early

The first live run (section 49) went straight through. This one was picked
to not. [kamp-us/demlik#625](https://github.com/kamp-us/demlik/issues/625)
is a small code bug in code-graph with two calls left to the builder and
three places that are easy to forget. The question was what the machine does
when a review fails.

**Answer: it repaired and merged, and it wasted a quarter of its money on the
way.** The first review failed. The machine sent the lane back to a builder,
the fix went in, the second review passed, and
[PR 628](https://github.com/kamp-us/demlik/pull/628) merged through the
queue: 40.2 minutes, $7.68, no operator agent, no person, nothing done by
hand. But three builders in a row were recorded dead when each had done its
work. That is the finding of this run, and it is a fault in how the machine
runs a shell, not in the shells.

## Before the run

Three small changes from section 49's list.

- **The lane's read names the pull request.** The reads and writes that need
  it take it from there. In the first run most of the 24 `lane history` calls
  were the Layer finding the PR again.
- **A limit on the wait for checks before a review** (45 minutes). Past it
  the run stops, with the lane where it stands.
- **A question nobody answers ends the run parked.** The working copy is
  removed and the lane released, so anyone can pick it up. The question is
  named by the park (the lane and how long its ledger was), not by the run,
  so a later run finds the question already asked and reads the replies
  since. Before, a second run would have asked again and missed the answer.

## The run

Times are UTC on 2026-10-11.

| Time | What happened | Cost |
|---|---|---|
| 02:25:52 | Claim, boot the lane, make the working copy, write "started" |  |
| 02:26:10 | **Builder 1.** Exit 3 for a crash, a test, SPEC §13.6, the CLI reference, a changeset. Opened PR 628 | $1.32, 5.0 min |
| 02:31:16 | Read the PR: checks pending. Waited 5.7 minutes | Listen |
| 02:36:56 | Checks settled, **red**. Started the reviewer anyway (below) |  |
| 02:36:56 | **Reviewer 1: FAIL** on both verdicts. The new test fails on CI: exit 3 is right, but stderr has two lines, and the issue asks for one. Its note says fix the product, not the test | $1.00, 2.2 min |
| 02:39:11 | Read the lane: back at `build`. Started a builder |  |
| 02:39:15 | **Builder 2, the repair.** Found the cause (the type server prints as it is closed), fixed it, pushed. Then started a wait on CI **in the background** and ended its turn | $2.22, 8.6 min |
| 02:47:56 | Read the lane: not moved, no last word. Wrote a dead shell (a lap). Started a builder |  |
| 02:48:03 | **Builder 3.** Took over the stranded claim, checked the fix, waited on CI in the background, ended its turn | $0.83, 2.9 min |
| 02:50:58 | Dead shell, lap 2. Started a builder |  |
| 02:51:05 | **Builder 4.** The same | $0.49, 2.4 min |
| 02:53:34 | Dead shell, lap 3. Started a builder |  |
| 02:53:40 | **Builder 5.** CI was green by now, so it had nothing to wait for. Reported | $0.62, 3.2 min |
| 02:57:04 | Read the PR: green. **Reviewer 2: PASS** | $0.87, 2.4 min |
| 02:59:42 | **Shipper.** Gates, checks, queue. Merged at 03:05:17 | $0.33, 6.1 min |
| 03:05:56 | Posted the record, removed the working copy, released the lane | Act |

The machine sent 49 Cmds, which became 83 fabrika verbs. It used no tokens
of its own and made no Jev call. Afterwards: the PR merged, the issue
closed, the lane `complete` (1 retry of 3 used, 3 laps of 16), no claim left
standing, no working copy, the main checkout untouched. The builders' local
branch `build/625-…` is still in the repo.

## The repair loop

It needed no new code. A failed review folds the lane back to `build`, and
the routing table sends `build` to a builder whatever round it is. Fabrika's
brief tells that builder it is a repair and names the PR. The machine counts
nothing: the retry budget is fabrika's, and it read 1 of 3.

The reviewer was started on a PR the machine already knew was red. "Settled"
means the checks finished, either way. That cost $1.00 and 2.2 minutes for a
verdict whose core was the CI log. A gate could send a red PR straight back
with the failing job's log. I have not built it, because this reviewer added
the sentence a log does not carry: the fix belongs in the product, not in a
looser test. The repair builder did exactly that.

## Three builders that left early

Builder 2 pushed its fix and wanted to see CI before handing off. It ran the
wait as a background command and ended its turn. In Claude Code, a subagent
that does this is woken when the command finishes. Under the machine a shell
is the one agent of a one-shot SDK session. When its turn ends, the session
ends. Nothing wakes it. Its report to the lane, the last step of its skill,
never ran.

The machine did what it is written to do. The shell ended, the lane had not
moved, there was no typed last word, so it wrote a dead shell and started
another. That builder found the fix already pushed, and also waited on CI in
the background. So did the next. The fifth arrived after CI had finished and
could report.

The three builders after the repair cost $1.94 and 236,000 tokens, a quarter
of the lane, to rediscover a finished fix three times. They cost little
wall time: they ran while CI did.

What is changed already:

- **The Check refuses a background command**, with the reason: the session
  ends with the turn. The shell's prompt says the same up front.

What it points at, in order of worth:

1. **A builder should not wait on CI at all.** The machine listens to the
   PR's checks before review, and that wait is free. The shell's wait is the
   same wait, paid for with an opus session, and here it broke the hand-off.
2. **Ask a shell that ended without reporting to finish.** Its conversation
   is still there. One short turn in it costs cents. A new builder reads the
   issue, the PR and the diff again: $0.49 to $0.83 each here. This is the
   "resume" the last two sections kept putting off, and now there is a price
   on not having it.
3. **Read the world before calling a shell dead.** The PR's head had moved.
   "Ended with no report, but pushed" is a different fact from "died".

## Cost, beside the other three lanes

`tokens` is the size of each run's conversation at its last turn, summed per
role.

| | #600 (agent) | #601 (agent) | #559 (machine) | #625 (machine) |
|---|---|---|---|---|
| Driver, tokens | 115,872 | 119,072 | **0** | **0** |
| Builders | 183,811 | 127,284 | 67,488 | 453,558 (5 runs) |
| Reviewers | 100,536 | 90,722 | 54,537 | 172,019 (2 runs) |
| Shipper | 36,354 | 36,387 | 30,407 | 31,099 |
| Lane total | 436,573 | 373,465 | 152,432 | 656,676 |
| Shell runs | 3 | 3 | 3 | 8 |
| Review rounds | 1 | 1 | 1 | 2 |
| Minutes, claim to end | 33.8 | 31.3 | 18.8 | 40.2 |
| Minutes inside shells | 31.5 | 28.8 | 11.1 | 32.8 |
| Dollars | not recorded | not recorded | $1.74 | $7.68 |

#625 is the only lane of the four that needed a repair, so its total is not
a fair match for any of the others. Two readings that are fair:

- **The driver row.** Zero again, on a lane with nine passes and a repair.
  An operator agent's cost grows with every pass it sits through; the
  machine's does not.
- **Without the three early leavers** the lane is the first build, two
  reviews, the repair and the ship: 420,502 tokens and $5.74. That is what
  this lane should have cost, and it is about what #600 cost with one review
  round and an operator.

The run stayed under its $15 cap, so the extra allowance was not used.

## What else broke

- **The Check refused two harmless commands.** One redirected to `/dev/null`
  inside a subshell, the other to `/dev/stdout`. The path rule took a closing
  bracket as part of the path and knew only one device. Fixed, with tests. A
  Check that refuses what is fine teaches a shell to work around it.
- **A stranded claim.** Each builder that left early left its build claim
  behind. The next one noticed, adopted it and released it. That is the
  shell doing by judgment what the skill gives the operator to do after a
  dead shell. It worked three times. It should be the machine's Act.
- **The field rows said "finished"** as the reason for the three dead
  builders. Fixed; the rows in `field/runs.jsonl` say what happened.
- **"Read the lane once per pass" is half done.** The PR lookups are gone.
  But a turn reads the lane to confirm its shell's report, and the run reads
  it again a second later to start the next pass: 22 `lane history` calls
  for 9 passes.

Nothing was done by hand during the run. I watched the log. I did not stop
it at the second or third dead builder, though it was clear by then what was
happening: the caps were far off, and a machine that needs a person to stop
a loop was the thing under test.

## What this run still did not test

- The merge-queue Listen. Again the shipper saw the PR land inside its run.
- A park, a recipe, a question to a person, a Jev reading. Nothing parked.
- A shell stopped for time or for money.
- A restart.
- Two lanes at once, a conflict with a moved base, an epic.

New since section 49, and now seen once: a failed review and its repair, a
dead-shell lap and the re-dispatch after it (three times, for the wrong
reason), a review started on red checks, the Check refusing something live,
and a lane of nine passes.

## Next

1. Take the CI wait out of the builder, or at least keep it in the
   foreground (done). Then run a lane that fails review again and see the
   dead laps gone.
2. Resume a shell's conversation: for "you ended without reporting", and for
   a kill.
3. Before a dead shell is written, read the PR. After it, release the
   shell's claim as an Act.
4. Decide the red-checks gate: reviewer, or straight back with the log.
5. Hand the turn's last read of the lane to the run.
6. Park a lane on purpose (an issue that touches a protected path), so the
   ask, the wait and the second run's pick-up meet a real person.
