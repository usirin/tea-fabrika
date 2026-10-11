# 55. The ship machine's seven outcomes, set beside 961 recorded shipper runs

*Added 2026-10-11, later the same day: the outcome names below are the ones
of that morning. They have since changed to five verbs and one way to spell
them (`landed` is now `done`, `back_to_builder` is `send:builder:…`), see
[`docs/direction/outcome-names.md`](../docs/direction/outcome-names.md). The
script and `results/ship-outcomes-on-recorded-runs.json` print the new names.
Every count is the same. The text below is left as it was written.*

The ship machine hands back one of seven typed outcomes
([`docs/ship-machine.md`](../docs/ship-machine.md)). Experiment 53 found that
961 real shipper runs ended in one of seven ways. They are not the same seven.
This experiment maps one list onto the other and counts.

**Answer: 540 of 961 runs end in a way that is one outcome kind. 421 do not,
and 325 of those are not a gap: they are "queued", where the machine waits and
today's shipper ends its run.** The real gaps are smaller.

- **63 runs parked with no cause on the line.** Old lines. Nothing to map.
- **30 runs parked because the branch was behind main.** No outcome fits. The
  design already lists this as open.
- **3 runs were merged by hand under the shipper.** That is a landing, and the
  line does not say which of the two kinds.

Three outcome kinds have no recorded run at all: `back_to_reviewer`,
`cannot_tell` and `not_ours`.

No model ran, no Jev, no money. Files in, counts out.

## Who did what

| Part | Whose |
|---|---|
| The 840 single-issue lanes, their logs, every shipper that ran in them | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| The lane fold (`src/lane-log.ts`) | tea-fabrika, from experiment 53, unchanged |
| The outcomes, the facts and the gate (`src/stages/ship/`) | tea-fabrika, new here |
| The table from a logged ending onto an outcome (`src/stages/ship/recorded.ts`) | tea-fabrika, new here |

No lane ran. Nothing was written anywhere but this folder.

## The mapping, in code

A shipper's run ends with the line that takes the task out of `ship`. That
line is read into one of seven endings, and each ending is mapped or left
unmapped with a reason.

```ts
type RecordedEnding =
  | { ending: "merged" }                               // DONE, to shipped
  | { ending: "merged_issue_open" }                    // DONE, back to queued
  | { ending: "queued" }                               // WIP: in the merge queue, and the run ended
  | { ending: "parked"; cause: string | null }         // BLOCKED
  | { ending: "sent_back" }                            // FAIL
  | { ending: "lap"; cause: string | null }            // LAP
  | { ending: "board_ended"; how: "landed" | "cancelled" };

outcomeOf({ ending: "merged" });
// → { mapped: true, kind: "landed" }
outcomeOf({ ending: "parked", cause: "head-behind-base" });
// → { mapped: false, reason: "no_outcome_fits" }
outcomeOf({ ending: "board_ended", how: "landed" });
// → { mapped: false, reason: "fits_two", kinds: ["landed", "landed_part"] }
```

One rule is used for parks and laps: the cause names a fact, and where the
gate has a line for that fact, the outcome is that line's. No other rule was
made up. An ending with no row stays unmapped.

## The counts

| Ending in the log | Runs | Share | Outcome |
|---|---|---|---|
| merged | 423 | 44.0% | `landed` |
| queued | 325 | 33.8% | unmapped: not an ending for the machine |
| parked, no cause | 63 | 6.6% | unmapped: the line does not say |
| sent back | 55 | 5.7% | `back_to_builder`, why not known |
| parked, `head-behind-base` | 30 | 3.1% | unmapped: no outcome fits |
| merged, issue left open | 29 | 3.0% | `landed_part` |
| parked, `head-ci-red` | 13 | 1.4% | `back_to_builder`, `checks_red` |
| lap, `base-conflicted` | 10 | 1.0% | `back_to_builder`, `conflicts_with_main` |
| parked, `awaiting-cp-approval` | 10 | 1.0% | `waiting_on_person` |
| ended by the board, `LANDED` | 3 | 0.3% | unmapped: fits two, `landed` or `landed_part` |

No eighth ending came up, the same as in experiment 53.

## Runs per outcome kind

| Outcome kind | Runs | Share of 961 |
|---|---|---|
| `landed` | 423 | 44.0% |
| `landed_part` | 29 | 3.0% |
| `back_to_builder` | 78 | 8.1% |
| `back_to_reviewer` | 0 | 0% |
| `waiting_on_person` | 10 | 1.0% |
| `cannot_tell` | 0 | 0% |
| `not_ours` | 0 | 0% |
| unmapped | 421 | 43.8% |

The 78 `back_to_builder` runs split by `why`: 55 where the line does not say,
13 `checks_red`, 10 `conflicts_with_main`. No run can be given `review_failed`,
`bot_comment` or `thrown_out_of_queue` from the ending alone.

The 421 unmapped runs split by reason: 325 not an ending, 63 the line does not
say, 30 no outcome fits, 3 fits two.

## What did not fit, one by one

**"Queued" is not an outcome, and that is by design.** Today's shipper puts
the pull request in the merge queue and ends its run. The ship machine stays
open and listens. So the run's ending has no outcome, and the queue's next
line is the real one. For the 325:

| What left the merge queue | Runs |
|---|---|
| merged | 299 |
| merged, issue left open | 12 |
| `FAIL` out of the queue, back to build | 7 |
| waited past the budget, parked | 3 |
| ended by the board (`LANDED`) | 2 |
| a `queue-ejected` lap, back to ship | 2 |

I did not map these: they are the queue's lines, not a shipper's ending. Read
plainly, 311 are landings and 9 are a pull request thrown out of the queue.
The 3 that waited past the budget have no outcome. The machine's Listen has
no time limit in the sketch, so it has no answer for a queue that never
answers.

**A branch behind main has no outcome.** 30 shipper runs ended parked on
`head-behind-base`. The gate has no line for it, on purpose: the design says a
branch that is behind but merges cleanly ships as it is. The logs do not show
that fact (see the next section), so I left it unmapped.

**A park on red checks fits by name and not by what happened next.** The
cause `head-ci-red` names the fact the gate's `checks_red` line reads, so it is
mapped. But today's fabrika parks there and code re-runs the checks. Experiment
53 counted 9 of those 13 trips shipping from the park. If the parent treats
`checks_red` as "start a build", it starts a build on trips that today ship
without one. This is the place where the outcome list and the logs pull apart
most. Confidence that `checks_red` needs a "try the checks again
first" step: about 70%. Reading those 13 pull requests would settle it.

**"Sent back" lands in four places.** The 55 `FAIL` lines out of `ship` went
to build 42 times, to a spent repair budget 6 times, to `frozen` 4 times and
to `review` 3 times. I mapped all 55 to `back_to_builder` by the shipper's
word. The 3 that landed in `review` may be what `back_to_reviewer` is for. The
line does not say, and I did not guess.

**Merged by hand under the shipper.** 3 runs ended with a `LANDED` line
written from outside. A fresh read would see a merged pull request, and the
gate's first line would answer `landed` or `landed_part`. The line does not
say which.

## Extra: what happened after a park on a branch behind main

31 parks on `head-behind-base` in single lanes, 30 out of `ship` and 1 out of
`review`. (Experiment 53 counted 37; that count includes epic lanes.) For
each, the next line that moved the task, and then how that stay in ship ended.

| What happened next | Parks |
|---|---|
| unparked, then merged | 9 |
| unparked, then merged with the issue left open | 1 |
| unparked, then back to the builder: it conflicted (a lap) | 4 |
| unparked, then back to the builder: sent back for repair | 1 |
| unparked, then parked again for an approval | 5 |
| unparked, then parked again on `head-behind-base` | 4 |
| unparked, then parked again, no cause | 3 |
| merged by hand while parked (`LANDED`) | 2 |
| unparked back to review | 1 |
| nothing: still parked when the data ends | 1 |

So 10 of 31 shipped from there, 5 went back to a builder, 12 parked again, 2
were merged by hand, 1 went back to review, and 1 never moved. The 4 that
parked again on the same cause are counted twice: once as a "next", once as a
park of their own.

Whether a person acted is not in the log: no line has an author. 22 of the 28
unpark lines carry a written reason. I did not sort those texts here.
Experiment 53 read them and found three kinds: an owner had approved and the
branch still merged clean, the driver merged main into the branch, or the
branch conflicted and the park was cleared to send it back to a builder.

## What the logs can check, and what they cannot

**They can check the list of outcomes.** Every ending a shipper wrote is
either one outcome kind, or one of four named misses above. That is a real
test of the type: nothing ended in a way the seven kinds cannot say, apart
from a branch behind main and a queue that never answers.

**They cannot check the gate.** The gate takes nine facts and its answer
depends on their order: conflicts before a failed review, a person's comment
before a bot's, comments before a missing approval. A log line holds one
word, and for 55 of the 78 `back_to_builder` runs not even which gate refused.
So no recorded run can say whether the order is right. The gate's order is
pinned by tests in `src/stages/ship/gate.test.ts`, which check the code
against the design, not against real tickets.

## What this cannot tell us

- **Whether the gate's order is right on real tickets.** See above. It needs
  the facts of each pull request at the moment the shipper ran, read from
  GitHub, as experiment 54 did for reviews.
- **Why the 63 old parks parked.** The cause is not on the line.
- **Which gate sent 55 runs back.** Experiment 53 said the same.
- **How often `back_to_reviewer`, `cannot_tell` and `not_ours` would come up.**
  Today's shipper has no ending word for them, or folds them into a park or a
  `FAIL`. Zero runs here does not mean they are rare.
- **Whether a behind branch shipped as it was or was brought up to date
  first.** The log shows the park and the merge, not what was done in between.
- **Anything about another repo.** One repo, one owner, a busy merge queue.

## Run it

```
LANES=<a repo's .fabrika folder> node experiments/55-ship-outcomes-on-recorded-runs.ts
```

It prints every table above and writes
`results/ship-outcomes-on-recorded-runs.json`, which holds counts and no line
of any log. The mapping is tested in `src/stages/ship/recorded.test.ts`, on
lanes written by hand.
