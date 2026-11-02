# Agent hours

**Decided 2026-11-01.** The owner approved every lean: the names `estimate` and `spent`, the
eight principles H1 to H8, and the fields a run records from now on. Each lean below keeps its
confidence. A ticket's size is an `estimate` in agent hours, written by the planner before the
build, and the work's real size is `spent`, folded from the ticket's own run facts and never
typed.

The five open questions, as answered on the same day:

| Question | Answer | Sure | Where |
|---|---|---|---|
| Wall clock with waits, or active time? | Wall clock with waits for now, and record active time beside it | 70% | [H3](#h3-wall-clock-waits-included-for-now) |
| Cap the scale at 8? | Yes: cap at 8 agent hours, split anything larger | 75% | [H4](#h4-an-estimate-is-a-step-on-a-doubling-scale-and-too-big-means-split) |
| Where does the rate come from? | The last ten merged tickets, one rate per model | 70% | [H7](#h7-the-rate-comes-from-what-merged-per-model) |
| Restate Tier 1's size? | Yes: Tier 1 and the self-fix plan, at the measured rate | 80% | [Where this differs](#where-this-differs-from-settled-notes) |
| Split the field log's `lane`? | Yes: `ticket` and `pr`, two fields | 85% | [What a run records](#what-a-run-records) |

Built from [experiment 187](../../experiments/187-agent-hours.md), which defined the unit,
measured it from `field/runs.jsonl` joined to merged PRs, and held our past guesses up to it.
AGENTS.md says "Size work in files, lines and agent hours" and never said what an agent hour is.
This note does.

```ts
// A sketch, today's tracker (packages/pipeline/src/tickets/ticket.ts). Not built.
// Ticket facts there use `type`; next/'s tracker takes the same shape with `_tag`.
import {Schema} from "effect";

/** Agent hours on a doubling scale, Linear's exponential shape. Over 8, split the ticket. */
const Hours = Schema.Literals([0.25, 0.5, 1, 2, 4, 8]);
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Written by the lane with each plan version, from the planner's draft. Never overwritten. */
const Estimated = Schema.Struct({
	type: Schema.Literal("estimated"),
	plan: Count, // the plan version it sizes
	hours: Hours,
	lines: Schema.Struct({code: Count, test: Count, docs: Count}),
	rate: Count, // the lines per agent hour it used
	sure: Count, // 0 to 100
});

/** Never written. Folded from the ticket's `started` and `ended` facts. */
type Spent = {
	readonly hours: number; // every run's minutes over 60, failed runs too
	readonly active: number | null; // working hours beside wall (H3); null until runs record it
	readonly runs: number;
	readonly failed: number; // ended on anything but done
	readonly open: number; // started and never ended: unknown, never zero
	readonly by: Readonly<Record<string, number>>; // hours per stage
};
```

```text
one ticket traced: PR 267, every step logged by hand (experiment 187)
estimated   none: no planner wrote one
spent       test_writer  5 runs  128.19 min
            build        4 runs  152.89 min
            review       2 runs   20.87 min    the first failed it, so the work went back
            mutants      1 run    84.30 min
            gap tests    1 run    83.40 min
            rehearsal    1 run    54.46 min
            total       14 runs  524.11 min = 8.7 agent hours
lines       1,466 code, 4,150 test, 556 docs: 6,172 written, 707 an agent hour
the scale   over 8, so H4 says split. It went as one PR of 249 files.
```

## Which version

- **Today's tracker first.** Tickets, their `started` and `ended` facts and the watcher's `pr`
  fact live there now, and [ticket 117](../plan/README.md) is the first real lane. The planner
  writes the estimate, the lane writes the fact, and the ticket window shows both.
- **`next/` later,** when its tracker exists: the same two names and the same fold, with `_tag`.
- **The field log** (`field/README.md`) changes too, for hand work: see
  [What a run records](#what-a-run-records).

## The name

The rule is [use the industry's names](./use-the-industrys-names.md). The candidates, read on
2026-11-01 (sources in experiment 187):

| Name | Who | What it is | Fits here? |
|---|---|---|---|
| story point | Scrum teams (Cohn) | relative effort, no unit, never checked | No: we have the clock, so we can check |
| estimate | Linear, Jira | the field on an issue | **Yes, for the field** |
| time spent | Jira | logged hours against the estimate | **Yes, for the actual, as `spent`** |
| person-hour | effort models (COCOMO) | one worker's hour, summed across workers | **Yes, as the pattern for the unit** |
| ACU | Devin | a vendor's billing unit for its agent's work, waits left out | No: a price, set by one vendor |
| task length | METR | how long the task takes a skilled person | No: a person's time, not an agent's |
| time bucket | SWE-bench Verified | an annotator's guess of an engineer's time | No: a person's time, a guess |
| credits, tokens | Codex, the APIs | a meter | No: not time; differs by model |

- **Decided 2026-11-01, 75%: the field is `estimate`, the actual is `spent`, and the unit is the
  agent hour.**
  Linear and Jira call the field an estimate. Jira calls the actual time spent. The unit is built
  like a person-hour, the oldest effort unit there is, with an agent in the person's place. No
  published unit measures an agent's own time on a task, so "agent hour" is the plain compound,
  not a coined word. It is already in AGENTS.md and about a dozen of our docs.
- **The doubt.** METR's "a one-hour task" is a skilled person's hour. A reader may take "a
  one-agent-hour ticket" to mean that. So the glossary row says: an agent hour is the agent's own
  clock, and a one-hour METR task may take an agent minutes. ACU is the nearest industry word, and
  if fabrika ever bills for agent work, ACU's shape (work done, waits left out) is the one to copy.

## The eight principles

### H1: an agent hour is one agent's hour of wall clock, summed

**Decided 2026-11-01, 75%.**

- **What it means.** Each agent run counts from its start to its end. Runs add up. Two agents at
  once for one hour spend two agent hours, as two people spend two person-hours.
- **Elm and OTP.** Erlang sums the same way:
  [`statistics(runtime)`](https://www.erlang.org/doc/apps/erts/erlang.html#statistics/1) "is the
  sum of the runtime for all threads ... and can therefore be greater than the wall clock time".
  Each unit of work is timed on its own, start to end: telemetry's
  [`span/3`](https://telemetry.hexdocs.pm/telemetry.html#span/3) gives each span a `duration`, "the
  current monotonic time minus the start monotonic time". Elm: none.
- **The known way.** Person-hours and Jira's time spent add up across people the same way.
- **Linear:** an estimate has no unit there, only points on a team's scale. Linear would keep
  points. **We differ** because every run already logs its minutes, so the size can be checked;
  points cannot. Jira, which does hours, is the closer match.
- **On a real ticket.** PR 267: 14 runs, 524 minutes, 8.7 agent hours, all on one day. The rows
  keep no start times, so how much of it overlapped cannot be told.
- **The doubt.** One agent hour of a fast model and one of a slow model buy different work. A rate
  belongs to its model (H7).

### H2: every run on the work counts, failed ones too, and a driver never does

**Decided 2026-11-01, 80%.**

- **What it means.** A test writer whose tests were wrong, a review that sent the work back, a run
  that was stopped: all spent. An agent that only drives others and waits on them is not counted,
  since its clock covers theirs.
- **Elm and OTP.** OTP draws both lines. A failed span still has a cost: telemetry's `span/3` ends
  in either a `stop` or an `exception` event, and both carry the `duration`. A supervisor counts
  every restart of a child against its limit, a failure included. And a driver is told apart in the
  [child spec](https://www.erlang.org/doc/system/sup_princ.html): "`type` specifies whether the
  child process is a supervisor or a worker". Our driver is OTP's supervisor, and only workers'
  hours count. Elm: none.
- **The known way.** Jira logs time spent on dead ends too. Devin bills a session whatever it
  produced.
- **Linear:** it records no spend, so nothing to compare. Its graphs count only completed points,
  which hides the failed tries. **We differ:** a failed run is a real cost a planner should learn.
- **On a real ticket.** On demlik, today's operator agents ran 38.8 hours while the runs they drove
  ran 20.1. Counting both would have tripled the number. In this repo's pipeline the driver is
  code, so a lane has no driver agent at all. Failed runs were 6% of joined hours (4.4 of 73.9).
- **The doubt.** A hand-run "driver" that also does work, such as PR 267's rehearsal run (54
  minutes), is hard to sort. For now it counts, and its row says it drove. `parent` (below) makes
  the line exact.

### H3: wall clock, waits included, for now

**Decided 2026-11-01, 70%: wall clock with waits for now, and active time recorded beside it.**

- **What it means.** A run waiting on CI, a merge queue or a slow test still spends agent hours.
  `spent` is wall clock. Once a run can say how long a model or tool was working, it records that
  too, as `active` beside the wall minutes, and the window can show both. The estimate stays in
  wall hours until active time has a record of its own.
- **Elm and OTP.** Erlang keeps both clocks side by side.
  [`statistics(wall_clock)`](https://www.erlang.org/doc/apps/erts/erlang.html#statistics/1)
  measures "real time ... as opposed to runtime or CPU time", and `timer:tc/1` times a call in
  real time too ([timer](https://www.erlang.org/doc/apps/stdlib/timer.html)). For busy time,
  `statistics(scheduler_wall_time)` gives each scheduler an `ActiveTime` beside its `TotalTime`.
  That is this answer's shape: wall as the total, active next to it. Elm: none.
- **The known way.** Jira and person-hours count waits that sit inside the work. Devin does not:
  it leaves out "Waiting for a test suite to run". The two clash, and the owner picked wall, with
  active kept beside it so Devin's number can be read too.
- **Linear:** no time, so no answer.
- **On a real ticket.** On demlik's whole lanes the shipper was 26% of the hours, mostly a
  480-second merge-queue watch. Ticket 117's waits on the owner's yes are not agent hours at all:
  no agent runs while a lane waits on a person.
- **The doubt, and what settles it.** Waits make a slow CI look like expensive work. Recording
  active time beside wall time is what settles it: when enough tickets have both, the gap between
  them shows whether waits distort the rate. Until then wall is the only number every row has.

### H4: an estimate is a step on a doubling scale, and too big means split

**Decided 2026-11-01, 75%: the cap is 8 agent hours, and anything larger splits.**

- **What it means.** `0.25`, `0.5`, `1`, `2`, `4` or `8` agent hours, nothing between. Over 8, the
  ticket splits before the build starts. There is no `16`.
- **Elm and OTP.** OTP caps by a limit and hands the overflow up. A supervisor allows `intensity`
  restarts in `period` seconds (1 in 5 by default), and "if more than `MaxR` number of restarts
  occur in the last `MaxT` seconds, the supervisor terminates all the child processes"
  ([supervisor principles](https://www.erlang.org/doc/system/sup_princ.html)). Its parent then
  decides. An estimate over 8 does the same: it stops and goes back to whoever plans, to split.
  Elm: none.
- **The known way.** Linear's exponential scale is 1, 2, 4, 8, 16, with 32 and 64 extended, and
  "When estimates are too large, refine issue scope". Cohn's scales double too: the bigger the
  work, the less a fine number means.
- **Linear:** the same doubling. **We differ** in the base: a quarter hour, since our work is
  small. Across 126 joined PRs, the middle ticket took 0.59 agent hours here and 0.36 on demlik,
  and only one passed 4.
- **On a real ticket.** Ticket 117, a small change to `map`, would be a `0.25` or a `0.5`. PR 267,
  at 8.7, would have been split, and Tier 1 already says one ticket per PR.
- **The doubt.** Is 8 the right cap? Only PR 267 passed it. Tier 1's PRs settle it.

### H5: the actual is folded from run facts, never typed

**Decided 2026-11-01, 90%.**

- **What it means.** `spent` is not a field anyone writes. It is the fold of the ticket's
  `started` and `ended` facts. A run that started and never ended shows as open, not as zero.
- **Elm and OTP.** Elm's state is a fold over messages: `update` takes each Msg and the old model.
  Early Elm named it `foldp`, and its own example summed time the same way:
  `foldp (+) 0 deltas` ([Elm 0.6](https://elm-lang.org/news/0.6)). In OTP, Elixir's
  [`Telemetry.Metrics.sum/2`](https://hexdocs.pm/telemetry_metrics/Telemetry.Metrics.html#sum/2)
  is a sum a reporter folds from events, never a value anyone sets.
- **The known way.** Event sourcing: a derived number rebuilds from the log. AGENTS.md: derived
  things can wait, since they rebuild.
- **Linear:** no actual, but its cycle graphs are folded from issue history the same way. It warns
  that after an estimate is updated, "the issue list can diverge from the historical graph and
  totals". **Same idea.**
- **On a real ticket.** Ticket 117's steps each write `{type: "ended", stage, minutes, turns, ...}`
  on the ticket today. Its `spent` is their sum, with no join to guess.
- **The doubt.** A run that dies before `ended` loses its minutes today. `open` makes that
  visible, and a start time on `started` would let the fold say how long it has been open.

### H6: the planner writes the estimate before the build, and old ones stay

**Decided 2026-11-01, 75%.**

- **What it means.** The plan draft carries `hours`, the `lines` by kind it expects, the `rate` it
  used and how `sure` it is. The lane writes it as an `estimated` fact with each plan version. A
  person may write a new one. Nothing overwrites the old, and calibration uses the planner's own.
- **Elm and OTP.** None.
- **The known way.** Scrum: "The Developers who will be doing the work are responsible for the
  sizing." Jira keeps the original estimate apart from the remaining one. Our own rule: a guess
  that turned out wrong stays, marked wrong.
- **Linear:** anyone sets or changes an estimate with Shift E, and only the latest shows. **We
  differ:** the first guess is a fact that exists only when it is written, so it is kept, and the
  window shows the latest.
- **On a real ticket.** Ticket 117's plan v1 has no estimate, since no planner writes one yet.
  Once this is built, the owner would see the size on the same card that asks for the yes.
- **The doubt.** Can a planner estimate at all? It has never been asked to. The first ten tickets
  with both numbers settle it.

### H7: the rate comes from what merged, per model

**Decided 2026-11-01, 70%: the last ten merged tickets, one rate per model.**

- **What it means.** The planner's rate is lines per agent hour over the last ten merged tickets
  that had both an estimate and a `spent`, for the same builder model. Each model has its own rate,
  and a ticket built by one model never moves another's. Before ten exist for a model, its rate
  starts at experiment 187's whole-lane median, 602, and says so.
- **Elm and OTP.** None.
- **The known way.** Linear's cycle capacity uses "the velocity of the previous three completed
  cycles". Cohn's velocity is a team's own past.
- **Linear:** three cycles of points. **We differ** in the window (ten tickets, since a cycle here
  is not a fixed time) and in counting per model. Linear also counts an unestimated issue "as 1
  point". **We differ:** an unestimated ticket shows as unestimated and is left out of the rate, so
  a missing number never looks like a small one.
- **On a real ticket.** Every past guess in our docs implied 35 to 160 lines an hour. The
  whole-lane median was 602. At the measured rate, Tier 1's 12,470 middle lines are about 21 agent
  hours (17 to 45), against the plan's 63 to 92.
- **The doubt.** Ten tickets is a guess with no source. So is "per model": most rows are one
  model. The first model change shows whether the rate moves.

### H8: lines check an estimate; they are not the size

**Decided 2026-11-01, 80%.**

- **What it means.** The size is hours. Lines by kind are how the planner gets there and how a
  person checks it: "300 product lines and 300 test lines at 602 an hour is about 1, so `1`".
- **Elm and OTP.** None.
- **The known way.** Lines of code as a size measure has a long record of misleading (a deleted
  line, a moved file, a hard one-line fix). Story points left lines out for that reason.
- **Linear:** no lines anywhere. **We differ** in using lines inside the estimate, because we can
  count them after the fact and calibrate. The window shows hours first.
- **On a real ticket.** Demlik PRs 826 and 833 took 22 to 25 minutes for 2 to 5 lines. Their hours
  were right and their lines say nothing.
- **The doubt.** Additions miss deletions and moves. A refactor ticket may need its own kind.

## What a run records

From now on, so the number is exact and nothing is guessed. Each is a fact that exists only when
the run happens.

```text
field                why                                           where today
ticket, pr           which work, as two fields                     one `lane` holds either; a reader
                                                                   must read `why` to tell
started, ended       on the writer's clock, as `said`              the pipeline writes them; hand
                                                                   rows have only `minutes`
parent               the run that started this one, or null        nowhere; drivers sum with children
the main session     a run of its own                              not logged at all
estimated            the planner's guess, before the build         nowhere
active               minutes a model or tool was working, beside   nowhere; needs per-turn times
                     the wall minutes (H3)
```

- **Today's pipeline is nearly there.** A lane's runs and its PR already meet on the ticket. The
  gaps are hand work, runs that die before `ended`, and the estimate.
- **Decided 2026-11-01, 85%: the field log splits `lane` into `ticket` and `pr`.** New hand rows
  write the two fields, plus `started`, `ended` and `parent`, and the main session logs a row of
  its own. Old rows keep `lane` and stay readable. That is a `field/README.md` change in a PR of
  its own, not made here.

## Where this differs from settled notes

- **Tier 1's size** uses "about 150 lines an hour" (`docs/plan/tier-1-detail.md`). Experiment 187
  measured about 600 for a whole lane and marks 150 wrong. **Decided 2026-11-01, 80%: Tier 1's
  size and the self-fix plan's are restated at the measured rate,** in a PR of their own. The old
  numbers stay beside the new ones, marked as an old guess. PR B's actuals are still the better
  test.
- **AGENTS.md** says to size in "files, lines and agent hours". This note keeps that and adds the
  definition. A one-line link from there can now point here.

## What it costs

- The `estimated` fact, the `spent` fold and their tests: about 150 lines with tests, a `0.25` on
  the scale. A guess at 50%, at the measured rate.
- The planner's draft gains four fields, and its brief one paragraph.
- The ticket window shows two numbers on the plan card. A screen change, so it gets its shots.
- The field log's two new fields, for hand rows.

## What it cannot tell us

- How good a planner's estimate will be. No planner has written one.
- Whether 602 holds. It comes from 11 whole lanes on one library, with no test writer or mutation
  step, plus one PR here.
- Whether wall clock or active time is the better unit. Only one kind of wait was ever seen. Active time,
  once runs can record it, sits beside wall time so the two can be compared.
- How a mix of models changes the rate.
- Whether a quarter hour is too coarse at the bottom. 19 of the 126 joined PRs took under 10
  minutes.
