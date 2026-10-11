# 53. 882 real lanes, read back from their logs

The operator machine has driven three tickets. Today's fabrika has driven
hundreds, and it keeps a log of each. This experiment reads those logs to see
how lanes really go, and what that says about moving each stage from an agent
into code.

**Answer: for one issue's lane the routing is already code, and it holds on
840 lanes, not 3.** The machine walked 831 of 840 single-issue lanes to the
end their log shows, and met no state it has no route for. 8 of the 9 it
lost are one rule it lacks. The work is in three other places.

- **Parks.** Where a park names its cause, the machine would ask a person 3
  times in 4. In half of those, the agent that drives lanes today cleared the
  park itself.
- **Ship.** 78% of shipper runs end "merged" or "queued", and every other
  ending is one of five fixed words.
- **Epics.** 37 lanes, a quarter of all events, and the machine stops in 34
  of them.

No model ran, no Jev, no money. Files in, counts out.

## Who did what

| Part | Whose |
|---|---|
| The 882 lanes, their logs, every agent that worked in them | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| Reading a log back through its own machine (`src/lane-log.ts`) | tea-fabrika, new here, written from fabrika-cli's fold rules |
| A recorded lane served to the operator as its world (`src/lane-replay.ts`) | tea-fabrika, new here |
| The operator machine and its tables (`src/operator.ts`, `src/turn.ts`, `src/fabrika.ts`) | tea-fabrika, unchanged |

## The data, and how far to trust it

The `.fabrika/` folder of one phoenix checkout: 883 lane folders, one
without a log. That leaves 882 lanes and 8,078 events, from 2026-08-17 to
2026-10-05, 50 days. 845 lanes are one issue each. 37 are epics, with 3 to 25
tasks each. Every line parsed.

I fold each log through the lane's own `workflow.json`, by the rules
fabrika-cli uses. 30 lines in 5 old lanes do not fold, because the state has
no arm for the event. I left those 5 lanes out, so "single lanes" below means
840.

| End | Single lanes | Epic lanes | What it means |
|---|---|---|---|
| complete | 725 (86.3%) | 19 | the lane shipped it |
| diagnosed | 6 (0.7%) | 0 | an investigation, answered with no pull request |
| board:landed | 51 (6.1%) | 5 | shipped outside the lane, and the lane was settled after |
| board:cancelled | 5 (0.6%) | 1 | the issue was closed unplanned |
| tripped | 9 (1.1%) | 5 | the repair budget ran out and nobody cleared it |
| active | 44 (5.2%) | 7 | still open when the data ends |

The 44 open single lanes stand at `blocked` (22), `build` (11), `queued` (5),
`human:cp-approval` (4) and `review` (2). 31 of them had been silent for more
than a week when the data ends. I call those abandoned, though no line says
so.

Three things make the data weaker than its size suggests.

- **The lines grew fields over time.** A park's cause is on 14 of 211
  `BLOCKED` lines in August, 110 of 250 in September, and 37 of 37 in
  October. Why a park was cleared is on no line in August and 70 lines after.
  So 324 of 551 parks say nothing about why they parked.
- **No line says who wrote it.** A driver, a shell and a person all append
  to the same file.
- **Fabrika changed under the lanes.** The workflows have 9 different sets
  of states. An August lane and an October lane ran different rules.

One repo, one owner, one machine. Read every share below as "on phoenix".

## How to read one lane

A lane's log is a list of events. Two of them mean different things in
different states, so the string alone misleads.

- `WIP` out of `queued` starts the build. `WIP` out of `ship` means the
  pull request went into the merge queue. `WIP` in `ship:queued` is one more
  wait. `WIP` out of `review` rewinds the lane.
- `DONE` out of `build` means a pull request is ready. `DONE` out of `ship`
  or `ship:queued` means it merged. If that merge left the issue open, the
  lane goes back to `queued`.
- `PASS` and `FAIL` are a review's verdict. A `FAIL` in `ship` is the shipper
  sending the work back for repair.
- `BLOCKED` parks the lane, `UNBLOCKED` puts it back where it was.
- `LAP` is a round the pipeline spent on itself: a dead agent, a conflict
  with the base branch, a pull request thrown out of the merge queue.
- `CLEARED` is a person granting one more repair round. It moves nothing.
- `CORRECTED` fixes a field on an older line. 259 of them, and 11 changed
  where a merge sent its lane.
- `LANDED` and `CANCELLED` are written from outside, when the issue's
  closure says the work shipped by hand or was dropped.

So [phoenix#10034](https://github.com/kamp-us/phoenix/issues/10034) reads
`WIP DONE PASS DONE`: build 10 minutes, review 10, ship 9, merged. That is
the most common lane there is.

## 1. Lane shapes

**38% of single lanes go straight through.** 30% fail one review, 12% fail
two or more, 28% park at least once.

| | All 840 | The 725 that shipped |
|---|---|---|
| Straight through | 319 (38.0%) | 316 (43.6%) |
| 1 failed review | 255 (30.4%) | 226 (31.2%) |
| 2 failed reviews | 80 (9.5%) | 67 (9.2%) |
| 3 or more | 20 (2.4%) | 14 (1.9%) |
| At least one park | 232 (27.6%) | 162 (22.3%) |
| Sent back from ship at least once | 47 (5.6%) | 37 (5.1%) |
| Merged with the issue left open | 36 (4.3%) | 4 (0.6%) |
| A lap | 21 (2.5%) | 19 (2.6%) |
| The repair budget ran out | 21 (2.5%) | 12 (1.7%) |

The straight-through share is steady: 38.7% of August's lanes, 37.7% of
September's, 37.2% of October's. Parks fell, from 41.0% of lanes to 22.5% to
17.0%.

The 15 most common whole-lane sequences cover 559 lanes, 66.5%. There are 202
different sequences and 143 of them happened once.

1. `WIP DONE PASS DONE`, 195 lanes (23.2%)
2. `WIP DONE PASS WIP DONE`, 82 (9.8%): the same through the merge queue
3. `WIP DONE FAIL DONE PASS WIP DONE`, 77 (9.2%)
4. `WIP DONE FAIL DONE PASS DONE`, 73 (8.7%)
5. `WIP DONE PASS PASS WIP DONE`, 23: with a rendered review
6. `WIP DONE FAIL DONE FAIL DONE PASS DONE`, 22
7. `WIP DONE FAIL DONE FAIL DONE PASS WIP DONE`, 16
8. `WIP DONE PASS BLOCKED UNBLOCKED DONE`, 16: parked in ship
9. `WIP DONE BLOCKED UNBLOCKED PASS DONE`, 11: parked in review
10. `WIP BLOCKED UNBLOCKED DONE PASS DONE`, 10: parked in build
11. `WIP DONE PASS WIP WIP DONE`, 8: one wait in the queue
12. `WIP`, 7: started and never heard from again
13. `WIP BLOCKED`, 7
14. `WIP BLOCKED LANDED`, 6: parked, then shipped by hand
15. `WIP DONE FAIL DONE PASS BLOCKED UNBLOCKED DONE`, 6

A lane has 6 events at the median and 10 at the 90th percentile. The longest
has 52.

## 2. Time per stage

**Build, review and ship take about ten minutes each, and a straight lane
takes 33.** The surprise is how narrow review and ship are. That is the shape
of a wait, not of work.

Every row is the time between two lines of one lane's log, on single lanes.

| Stage | From, to | n | Median | p75 | p90 |
|---|---|---|---|---|---|
| First build | `WIP` out of `queued`, to `DONE` | 757 | 11.9 min | 17.8 | 27.3 |
| Repair build | a `FAIL` into build, to `DONE` | 497 | 6.9 min | 10.0 | 16.4 |
| Review, with the wait for CI | `DONE`, to `PASS` or `FAIL` | 1,295 | 10.2 min | 12.8 | 15.4 |
| Rendered review | `PASS` into `review:ui`, to its verdict | 58 | 4.9 min | 8.3 | 11.0 |
| Ship, merged in the shipper's run | `PASS`, to `DONE` | 376 | 9.1 min | 10.0 | 11.3 |
| Ship, up to the queue | `PASS`, to `WIP` | 305 | 10.3 min | 11.5 | 13.0 |
| In the merge queue after that | `WIP`, to `DONE` | 299 | 3.2 min | 8.4 | 10.7 |
| Ship, clean, either way | `PASS`, to shipped | 657 | 10.5 min | 13.5 | 20.5 |
| Whole lane, straight through | first line, to shipped | 316 | 32.8 min | 40.2 | 54.1 |
| Whole lane, any shape | first line, to shipped | 725 | 49.5 min | 77.7 | 2.6 h |

How I bounded each. A stage counts only when the task entered it by the
first event named and left it by the second, with no park in between. A build
that parked and came back is not in the build rows. "Clean" ship means
nothing happened between the `PASS` and the merge but the queue. Whole-lane
time minus every stay in a park is 46.3 minutes at the median, so parks are
not what makes the typical lane slow. Failed reviews are.

124 lanes also kept the moment each agent was dispatched. That splits a stage
in two.

- **The driver is fast.** From the event that opens a stage to the dispatch
  of its agent takes 0.4 to 0.6 minutes at the median, and 1.2 or less at
  the 90th percentile.
- **The agent holds the wait.** A reviewer runs 8.1 minutes from dispatch to
  verdict (p90 12.0). A shipper runs 8.0 (p90 10.7). Fabrika's wait floor is
  480 seconds, which is 8 minutes, and the reviewer's wait for checks is
  called with that budget.

In our three machine runs the code waited for CI, and the reviewers then
took 1.1 to 2.4 minutes. So I read most of those 8 minutes as an agent
sitting on a clock. That is two repos set side by side, and I say more on it
under what this cannot tell us.

## 3. Review

**The first review passes 57% of the time.** It is the most common thing
that goes wrong in a lane, well ahead of any park.

| Round | Verdicts | PASS | FAIL | Pass rate |
|---|---|---|---|---|
| 1 | 795 | 454 | 341 | 57.1% |
| 2 | 374 | 276 | 98 | 73.8% |
| 3 | 125 | 101 | 24 | 80.8% |
| 4 | 27 | 20 | 7 | 74.1% |
| 5 and later | 27 | 15 | 12 | 55.6% |
| Rendered review, round 1 | 73 | 66 | 7 | 90.4% |

Of the 725 lanes that shipped, 418 needed no repair, 226 needed one, 67
needed two, and 14 needed three or more. The mean is 0.58 failed reviews a
lane and the worst lane had 8. The first-round pass rate fell over the 50
days: 63.7% of August's lanes, 55.0% of September's, 51.1% of October's. I
do not know whether the builders got worse or the reviewers got stricter.

**The `classes` field is not a failure class.** It names what kind of files
the pull request touches: `code`, `doc`, `skill`, `ui`. It is on 593 of 1,348
text verdicts. A lane that touches a skill fails 46.2% of its reviews. Code
fails 40.4%, docs 39.5%, and rendered work 30.3%. Why a review failed is in
no line.

The other events people ask about.

- **`FAIL` is not always a review.** Of the 841 that fold, 754 are a
  reviewer's verdict. 59 are a shipper sending the work back, 7 are a pull
  request thrown out of the merge queue, and 21 are an epic child that failed
  to land.
- **`CORRECTED`** is bookkeeping. `lane reconcile` appends it to fix whether
  an old merge left its issue open. 259 lines, 248 of them changed nothing.
- **`LAP`**, 34 lines. 13 are a base conflict found in ship, which sends the
  lane back to build. 12 are a dead agent. 5 are a queue ejection and 4 an
  epic replay conflict.
- **`CLEARED`**, 78 lines. A person granting one more repair round. 58 were
  written while the lane stood parked, most of them in `frozen` and
  `human:budget-spent`.

## 4. Parks

**551 parks, and most are short.** 484 came from a `BLOCKED` line and 67 from
a spent budget. Only 160 lines name a cause, so the table below is about a
third of them.

| Cause | Parks | Parked out of | Median to clear | p90 | Cleared by today's driver, with its reason written | The machine's rule |
|---|---|---|---|---|---|---|
| head-behind-base | 37 | ship 34 | 17.2 min | 10.7 h | 24 | none: asks a person |
| no-preview-render | 36 | review:ui 31 | 17.6 min | 5.4 h | 15 | none: asks a person |
| spent repair budget | 16 | review 9, ship 7 | 2.3 min | 3.2 h | 9 | none: asks a person |
| awaiting-cp-approval | 15 | ship 15 | 11.1 min | 8.9 h | 1 | a person acts, then code clears it |
| head-ci-red | 14 | ship 13 | 7.5 min | 37.7 min | 3 | code clears it |
| founder-act-owed | 14 | build 9, queued 3 | 26.3 min | 15.2 h | 2 | unknown word |
| assembly-conflict | 9 | review 5 | 14.0 min | 8.1 h | 5 | none: asks a person |
| no-rendered-delta | 9 | review:ui 8 | 0.8 min | 3.6 min | 0 | code clears it |
| ruling-owed | 7 | queued 6 | 29.4 min | 9.1 h | 0 | unknown word |
| spawn-dead | 4 | build, review | 0.1 min | 0.2 min | 0 | code clears it |
| campaign-paused | 3 | build 3 | 6.4 min | 32.0 min | 0 | unknown word |
| worktree-holds-branch | 3 | build 3 | 1.1 min | 2.4 min | 0 | code clears it |
| base-conflicted, verdict-owed, write-unlanded, tree-hijacked, repair-budget-spent | 9 | review, build | minutes to days | | 6 | mixed |

Split the 179 parks that have a rule to read, by `PARK_ROUTE` and `RECIPES`.

- **Code can clear it today: 35 (19.6%).** `head-ci-red`, `no-rendered-delta`,
  `spawn-dead`, `worktree-holds-branch`, `tree-hijacked`, and a stalled queue.
  All 35 cleared in the log, in 1.2 minutes at the median.
- **A person must act, then code clears it: 15 (8.4%).** Every one is
  `awaiting-cp-approval`.
- **The machine knows the word and has no rule: 105 (58.7%).** It would ask a
  person. `head-behind-base` and `no-preview-render` are 73 of them.
- **The machine does not know the word: 24 (13.4%).** `founder-act-owed` 14,
  `ruling-owed` 7, `campaign-paused` 3. The machine's list is fabrika 0.9.0
  as published. The phoenix checkout's fabrika has 27 causes. Ours has 21, and
  lacks those three plus `owner-action-required`, `text-review-stale` and
  `assembly-base-red`. It also has recipes for `campaign-paused`,
  `ruling-owed` and `owner-action-required` that ours lacks. A cause the
  machine cannot read becomes "no cause", and it asks a person, which is the
  safe side.

Eight of the machine's causes never appear as a park: `claim-stranded`,
`no-design-manifest`, `no-preview-routed`, `render-axis-missing`,
`replay-budget-spent`, `size-stop`, and `queue-ejected` and
`replay-conflict`, which the logs write as laps.

The longest park with a named cause is
[phoenix#9533](https://github.com/kamp-us/phoenix/issues/9533). It parked in
ship on `head-behind-base` for 5.9 days. When it cleared, the branch
conflicted, the lane took a lap back to a builder, parked on the same cause
for 43 more minutes, and then shipped through the queue.

**Whether a lane finishes after a park depends on the cause.** After
`head-ci-red`, 12 of 14 lanes finished. After `no-preview-render`, 18 of 36.
After an approval park, 6 of 15.

## 5. Ship in detail

**779 single lanes reached ship. 596 of them, 76.5%, landed on the first try
with nothing in between.** 719 lanes needed one trip through ship, 53 needed
two, and 7 needed more.

Count each shipper's run by how it ended. There are 961.

| The shipper | Runs | Share |
|---|---|---|
| Merged, inside its own run | 423 | 44.0% |
| Queued the pull request and ended | 325 | 33.8% |
| Parked the lane | 116 | 12.1% |
| Sent it back for repair | 55 | 5.7% |
| Merged, with the issue left open | 29 | 3.0% |
| Found a base conflict, a lap back to build | 10 | 1.0% |
| The board ended the lane under it | 3 | 0.3% |

Seven endings, each a fixed word. 77.8% are the first two.

The unhappy paths, by how many of the 847 trips through ship met them.

- **A park with no cause on the line: 54 trips (6.4%).** Old lines. 41 of
  those trips shipped after.
- **Sent back for repair: 45 (5.3%), plus 10 where that spent the budget.**
  The lane shipped in the end 4 times in 5. The log does not say which gate
  refused.
- **Merged with the issue left open: 41 (4.8%).** See below. This is the one
  the machine gets wrong.
- **`head-behind-base`: 26 (3.1%).** 13 shipped from there. 4 turned out to
  conflict and went back to build. 4 were sent back for repair.
- **A wait in the queue long enough to be written down: 25 (3.0%).** 23
  shipped. 3 of them stalled past the budget, parked, and still shipped.
- **`head-ci-red`: 13 (1.5%).** 9 shipped from there.
- **`base-conflicted`, as a lap: 10 (1.2%).** All went back to build, and
  every one of those lanes shipped later.
- **`awaiting-cp-approval`, named: 10 (1.2%).** 4 shipped, 3 are still
  parked.
- **Thrown out of the merge queue: 11 (1.3%).** 7 as a `FAIL` back to build,
  from before laps existed, and 4 as a `queue-ejected` lap, which goes back
  to ship. All 4 of those shipped.
  [phoenix#7859](https://github.com/kamp-us/phoenix/issues/7859) is one.
- **`replay-conflict`: 0 in single lanes.** It is an epic's event, 4 laps
  out of `integrate`.

**The merge that leaves its issue open.** The lane goes back to `queued`, and
the machine starts every queued task. The real lanes did that 13 times out of
41. 12 times the board ended the lane. 11 times the driver parked it at once,
on `ruling-owed`, `founder-act-owed` or `no-preview-render`. 5 times nothing
followed. [phoenix#10347](https://github.com/kamp-us/phoenix/issues/10347)
merged, went back to `queued`, parked on `ruling-owed` the same minute, and
was settled as landed a minute after that. The machine would have started a
second builder on it.

## 6. What the machine's tables cover

**Every state a single lane entered has a route.** `ROUTES` has 14 rows and
the rule that every `human:*` is a park. Across all 882 workflows and logs I
found 22 state names.

| State | Times entered | Route |
|---|---|---|
| build | 2,083 | builder |
| review | 2,010 | reviewer |
| ship | 1,004 | shipper |
| shipped | 744 | final |
| blocked | 362 | park |
| ship:queued | 340 | queue |
| integrate | 308 | known, not built |
| landed | 275 | final |
| review:ui | 133 | ui-reviewer |
| human:cp-approval | 130 | park |
| board:landed | 57 | **no route** |
| queued | 52 back into it | start |
| frozen | 49 | park |
| build:ui | 45 | ui-builder |
| human:budget-spent | 16 | park |
| diagnosed, board:cancelled | 6 each | final, **no route** |
| human:epic-review | 4 | park |
| human:queue-stall | 3 | park |
| build:mixed, human:machinery-stall, human:replay-stall | 0 | has a route, never entered |

The two gaps are `board:landed` and `board:cancelled`, the ends the board
writes. On a single lane they never reach the table, because the lane reads
as over. On an epic a settled child sits beside its unfinished siblings, and
the machine would stop on "no route". It never got that far in replay,
because `integrate` stops it first.

By events, the machine's `DriverFact` covers what a driver wrote in these
logs, with one exception: a park out of `queued`, which section 7 comes back
to. The log's `CLEARED`, `CORRECTED`, `AMENDED`, `LANDED` and `CANCELLED` are
written by a person or by another verb, and the machine only needs to read
past them.

The scripted fake is another matter. Its copy of the lane has 13 arms and a
park. The logs took 79 arms. The fake folds 92.2% of single-lane steps and
every step of 651 of 840 single lanes. What it lacks, by how many steps:
everything in an epic (about 630), the rendered-review states `review:ui`
and `build:ui` (about 300), the spent repair budget and its cleared round
(about 130), an end written by the board (57), a merge that leaves the issue
open (41), a base-conflict lap out of ship (13), and the investigation's own
end (6).

## 7. The replay

**The machine walked 831 of 840 single lanes to the end the log shows.** It
stopped on "no route" in none of them.

How the replay works. The operator machine runs on the Effect engine, as it
does live. Its world is one recorded lane. The lane's own `workflow.json`
folds it. When the machine starts a shell, that shell reports the log's next
line. When it reads the merge queue, the reading is what the next line says
the queue did. When it tries a park's recipe, the recipe clears the park if
the next line is the unblock and the machine's table has a recipe for it.
When it asks a person, the person answers if the log shows the park cleared.
A cleared round and a closure by the board arrive from outside, as they did.

| Outcome | Single lanes | Epic lanes |
|---|---|---|
| Walked the whole log, ended where the lane ended | 761 (90.6%) | 0 |
| The same, and the end came from the board | 52 (6.2%) | 1 |
| The log ends mid-lane, and the machine agreed that far | 18 (2.1%) | 1 |
| The machine's move does not fit the lane's next event | 9 (1.1%) | 1 |
| The machine stopped by its own rule | 0 | 34 |

Be clear about what this tests. Of the 5,588 single-lane events the replay
landed, 3,954 were a shell's own report, 70.8%. Those test nothing. The
machine starts the shell the state names and takes whatever comes back. The
other 1,634 are the driver's part, and that is the test: 852 starts of a
build, 326 writes of what the merge queue did, 38 waits it listened through,
13 dead shells, 1 rewind, 324 parks cleared, and 80 lines that came from
outside. The machine sent 31 Cmds a lane at the median and 201 at most.

**8 of the 9 it lost are one rule.** Each is a lane back at `queued` after
a merge that left its issue open, where the driver parked it and the machine
would start a build. Section 5 has the counts. The ninth is an August lane
that was parked before its first build, with no cause on the line.

**The 34 epics are one state.** `integrate`, where a child lands on the
epic's branch. The replay landed 256 of the epics' 2,093 events before it
stopped.

**Parks are where the machine and today's driver part ways.** The machine
met 356 parks in single lanes. Its recipes cleared 35. It asked a person 321
times, on 198 lanes. Most of those are old parks with no cause, where it has
nothing to go on. Count only the 128 parks that name a cause.

- Code cleared 32.
- It asked a person 96 times, on 64 lanes.
- In 49 of those 96, today's driver cleared the park itself and wrote down
  why. 22 are `head-behind-base`, 15 `no-preview-render`, 6 a spent repair
  budget.

The fairest rate is October, when every park names its cause. 94 lanes
started. The machine would have asked a person on 11 of them, with 18 parks
met, 3 cleared by code and 15 asked.

So "the operator is thin" is true of routing and false of parks. I read the
reasons the driver wrote for `head-behind-base`. They come in three kinds.
An owner had approved and the branch still merged clean. The driver merged
the base into the branch itself. The branch conflicted, so the driver
cleared the park to send the lane back to a builder. Each is a read and a
write, and none needs an agent.

## 8. Spend

**The files do not allow it.** I cannot give cost or tokens per role per
lane, or the driver's share.

`spend-ledger.jsonl` has 112 rows, and all of them are about one epic lane
out of 882. The host is one coding agent and the model is one model. It
names 14 sessions and has a measured total for 4: 1.18 million input tokens,
1.00 million of them read from cache, and 3,221 output tokens. No row has a
role, a dollar amount or a time. So nothing in it says builder, reviewer,
shipper or driver, and nothing joins a row to a stage.

`reap.jsonl` is not spend at all. A row has four fields: a sweep's time, the
base branch, a working copy's path, and a licence. As far as those say, its
1,090 rows are working copies removed in 307 sweeps between 2026-09-10 and
2026-10-03, each with why it was safe to remove: 892 already in the base
branch, 198 squashed into it.

The only cost numbers we have are still the ones in `field/runs.jsonl` from
our own runs.

## 9. Were our three tickets typical?

**In shape, two of three. In speed, no.**

| Run | Shape, and its share of shipped lanes | First build | Review with CI | Ship | Whole lane |
|---|---|---|---|---|---|
| demlik#559, experiment 49 | straight through, 43.6% | 3.6 min, faster than 98% | 8.2 min, faster than 71% | 6.6 min, faster than 94% | 18.4 min, faster than 98% |
| demlik#625, experiment 50 | one failed review and no park, 23.3% | 5.1 min, faster than 93% | 7.9 min, faster than 75% | 6.1 min, faster than 95% | 39.7 min, faster than 63% |
| demlik#623, experiment 52 | no failed review, one approval park in ship, 2.8% | 9.4 min, faster than 66% | 7.7 min, faster than 77% | 9.4 min, faster than 66% | 44.7 min, faster than 57% |

The first two are the two most common kinds of lane. The third was picked to
park, and it parked on the less common ship park. `awaiting-cp-approval` has
15 named parks in 50 days. `head-behind-base` has 37, and the machine has no
rule for it. The 17.2 minutes #623 stood parked is the median for an approval
park that cleared.

#625's repair took 17.7 minutes, slower than 93% of repairs here. That is the
three builders that left early, and the data agrees it was not normal. Only
21 of 840 lanes have any lap.

Our runs are fast because demlik is small and its issues were picked small. A
one-paragraph doc fix is not a typical phoenix lane.

## What contradicts experiments 48 to 52

- **Experiment 48 counted the driver's judgment calls on 13 runs of one day
  and found 24.** That day had almost no parks. Over 50 days the driver
  cleared at least 70 parks on its own reasoning. The claim "the loop is
  code" stands. The claim that little is left over does not.
- **Experiment 52 tested the park the machine handles best.** It left the
  impression that parks in ship are mostly approvals. On phoenix they are
  mostly a branch behind its base.
- **`docs/fabrika-sdk.md` said of the shipper that "a red gate may need
  judgment these logs never showed".** 961 runs later there are seven
  endings and no eighth. I count that as answered for what a shipper
  reports, not for what it reads on the way.
- **The same document said nobody had used `head-ci-red`.** It parked 14
  lanes and all 14 cleared, in 7.5 minutes at the median. The driver cleared
  3 of them by hand and wrote why. Twice the red was a real defect that no
  re-run would fix. Once the red checks were not required ones.
- **Experiments 49 and 50 put the wait for CI at 5 to 7 minutes and outside
  the reviewer.** That holds for the machine. In today's fabrika the wait is
  inside the reviewer, and the shipper's is inside the shipper.
- **Nothing here contradicts the cost claims**, because nothing here
  measures cost.

## What this cannot tell us

- **Why a review failed.** The verdict's text is on the pull request. No
  line of the log carries it. So I cannot say which failures a check in code
  would have caught before the reviewer ran.
- **How much of a stage is work.** A stage's time runs from one line to the
  next. Only 124 lanes split it further, and only into "before the agent
  started" and "the agent's whole run". The 8-minute reading is fabrika's
  wait floor plus three runs on another repo.
- **Who did what.** No line has an author. "The driver cleared it" means a
  reason was written on the unblock, which only started in mid-September.
- **Why two thirds of the parks parked.**
- **What anything cost.**
- **Whether the shells would behave the same under the machine.** The
  replay hands the machine each shell's real report. Experiment 50 showed
  that shells can behave differently when the machine runs them.
- **How long a person takes to answer.** The replay answers at once.
- **Anything about another repo.** Phoenix has rendered work, a busy merge
  queue and one owner. Demlik has none of the first and little of the second.
- **Epics past their first child.**
- **Abandoned lanes.** I called 31 lanes abandoned from a week of silence.

## What to build first, by the numbers

1. **Ship as a machine, the happy path.** 961 shipper runs, 77.8% of them
   "merged" or "queued", seven endings in all, and a median 8.0 minutes of
   agent session a run. Every lane that ships pays it. The gates are reads,
   the enqueue is a write, the queue is a Listen that has already run live.
   Confidence about 85%. What would raise it is reading the 55 "sent back for
   repair" runs on their pull requests, to see which gate refused.
2. **In that machine, a branch behind its base.** `head-behind-base` is the
   largest named park, 37, and 34 of them are in ship. Today's driver cleared
   24 itself. Read how far behind and whether it merges clean, update the
   branch, wait for checks, carry on. A conflict goes back to build, which is
   the 13 `base-conflicted` laps. Without this the ship machine asks a person
   on about 3% of trips.
3. **A gate at `queued` after a merge that left the issue open.** 41 times
   in 840 lanes, and the machine's rule is wrong for 28 of them. The fix is
   small. Do not start a build there. Park and ask whether work is left.
4. **Bring `ParkCause`, `PARK_ROUTE` and `RECIPES` level with fabrika.** Six
   causes and three recipes behind. 24 parks in the logs use a word the
   machine cannot read. It is an hour of typing and it removes a silent
   "no cause".
5. **Teach the fake the arms it lacks.** A merge that leaves the issue open,
   the spent repair budget with a cleared round, the base-conflict lap, the
   rendered-review states. The replay world here already folds by a real
   `workflow.json`, so the cheap way is to let the scripted fake use the same
   fold. Then the machine's tests run on fabrika's own arms.
6. **Find out why first reviews fail.** 43% fail, and each failure costs a
   repair build and a second review, about 17 minutes. It is the biggest
   number in this write-up that code might move, and the logs cannot say how.
   Read 50 failed verdicts on their pull requests and sort them. That is an
   experiment, not a build.
7. **Epics.** 37 lanes, a quarter of the events, 308 entries into
   `integrate`. Large, and blocked on nothing but work. I put it after ship
   because a single lane's ship machine is most of an epic's last task.
8. **Not yet: `no-preview-render`.** 36 parks, the second largest cause, and
   15 cleared by the driver. All of it is rendered review on a preview
   deployment, which demlik does not have.

## Run it

```
LANES=<a repo's .fabrika folder> node experiments/53-lane-logs.ts
```

It prints every table above and writes `results/lane-logs.json`, which holds
counts and lane numbers and no line of any log. `ONLY=replay` prints one
section. The fold and the replay are tested in `src/lane-log.test.ts` and
`src/lane-replay.test.ts`, on lanes written by hand.
