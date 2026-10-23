# 118. Can property tests on the real code replace our checkers?

The question: we wrote two model checkers of our own. `laws/explore.ts` (431
lines) searches one machine. `laws/world/search.ts` (573 lines) searches a
world of machines. Could plain property tests, on the same real reducers, laws
and worlds, do their job instead?

**Answer: not fully. Keep the one-machine checker. The world search could go,
but it is cheap to keep. Confidence 70%.**

- There are 132 planted mistakes our checkers catch today. Our checkers catch
  all 132.
- The property test caught **127 on all 5 seeds within 1 s**, and **130 within
  10 s**.
- It missed two, both in one machine:
  - `deviationExcuses` (review): a law that compares two different runs. One
    random walk can never see it. 0 of 5 seeds.
  - `forgetsTheLowest` (loop): needs one exact order of review counts over
    four rounds. About 160,000 random walks per seed did not hit it. Our
    checker finds it in 145 ms. A swarm walk (see the glossary) caught it on 2
    of 5 seeds at 10 s.
- Three more needed more than 1 s: `stallOffByOne` (two laws, about 1 to 5.6
  s) and `waitsForEver` (an "eventually" law, 5 to 14 s).
- Every world plant was caught on every seed. All 10 safety plants within 1 s.
  The four "every lane ends" plants within 10 s.
- Deep runs on the real machines with no plant: walks up to 250 steps on one
  machine (our bounds are 3 to 20) and up to 1,000 steps in a world. **Nothing
  new was found.**
- The harness is 325 lines (`walk.ts` 254, `sample.ts` 71), against our 1,004.
  But it reuses every world and law written for our checkers, so it is not a
  replacement for them, only for the search.

```ts
// The whole idea (packages/pipeline/src/laws/walk.ts and sample.ts).
// An input is a list of numbers. At each step the walk lists every move the world
// could make now, the same list our checker makes, and takes move number `choice % count`.
const choices = Arbitrary.array(Arbitrary.schema(CHOICE), {maxLength: 60});

// The property: on this walk, no law breaks after any step.
Arbitrary.checkEffect(choices, (cs) => walk(machine, cs).broke === null, {runs: 100, seed: "1:0"});

// A plant from experiment 90: review takes a review limit as a pass.
// Ours: broken at 3 messages. Property: Falsified on 5 of 5 seeds within 1 s,
// shrunk to 3 or 4 messages.
```

## Who did what

- **Not changed:** every law, planted mistake, checker setting, test and lint
  rule. `explore.ts` and `world/search.ts` are measured, not touched.
- **New, reusable:** `packages/pipeline/src/laws/walk.ts` (one walk through a
  machine or a world, plain functions) and `sample.ts` (the Effect part: draw,
  check, shrink, under a wall clock budget). Five small tests in
  `sample.test.ts`, under a second.
- **New, this experiment only:** `experiments/118-pbt-vs-checker.ts`, which
  lists the plants, runs both methods and writes
  `results/118-pbt-vs-checker.json`.
- No model, no key, no network. $0. The full run took 1,790 s (about 30
  minutes) on one laptop.

## How it was done

- **The same inputs for both methods.** For each plant: the real reducer with
  the planted mistake, the real laws, the real world. Our checker gets its
  usual bound. The property test gets the same three things and nothing more.
- **One walk.** `walk.ts` repeats our checker's moves exactly:
  - one machine: an outside message, an answer to a Cmd in flight, an echo, a
    restart that empties the Cmds in flight;
  - a world: `System.moves`, as `search.ts` takes them.
  - Each law is checked after every step. A reducer that throws breaks the law
    "update throws".
- **Drawing and shrinking.** Effect 4's own `Arbitrary` draws lists of
  choices and shrinks a failing list (fewer choices, each nearer 0, so a
  shorter or plainer run). fast-check was not needed: `Arbitrary.checkEffect`
  takes `runs`, `seed`, `size` and `maxShrinks`, which is all this needs.
  - One catch: by default the lists stay short (about 10). `sample.ts` sets
    `size` to four times the longest list, so walks reach 60 to 400 steps.
- **Lengths.** One machine: up to 60 choices. A world, safety laws: 150. A
  world, "every lane ends": 400 choices, used round and round.
- **Budget.** One run of 10 s per seed, seeds 1 to 5. A seed is "caught at 1
  s" when that same run caught it within 1,000 ms. The time includes
  shrinking.
- **Swarm walks** were run only where the plain walk missed on some seed at 1
  s.

### "Eventually" laws on a walk

"Every lane ends" cannot break at one step. Our search proves it over the
whole space with weak fairness, Tarjan's algorithm and lassos. On one walk,
`walkEnds` looks for two shapes:

- **A dead state:** a lane is still open and nothing that must happen can
  happen.
- **A fair loop:** the walk comes back to a state it saw before, a lane is
  open the whole way round, and every fairness class possible in every state
  of the loop is taken somewhere in it. The choices are used round and round,
  so a walk can go round a loop for good. A rare move (a restart) is only
  allowed the first time round.

What that misses:

- a loop the walk never closes, because the random choices never repeat a
  state;
- a lane that runs on for good without ever repeating a state (an unbounded
  counter);
- a fair loop the walk goes round only with a fairness class it never takes.

On the four plants here that did not matter: all four were caught. But each
walk is up to 1,000 steps, each step checks for a loop, and shrinking walks
them again. So `waitsForEver` took 5 to 14 s, though it was found within 10 to
165 walks.

## What came back

Totals, by group. "All seeds" means caught on all 5 seeds. The full list, one
row per plant, is at the end.

| Group | Plants | Our shortest run | Ours | Property, 1 s | Property, 10 s | Shrunk to our length |
|---|---|---|---|---|---|---|
| ship | 6 | 2 to 4 | 6 | 6 | 6 | 4 |
| review | 7 | 3 | 7 | 6 | 6 | 4 |
| build | 2 | 3 to 4 | 2 | 2 | 2 | 0 |
| loop | 10 | 2 to 14 | 10 | 7 | 9 | 4 |
| queue | 4 | 2 to 3 | 4 | 4 | 4 | 3 |
| acp session, transcript | 3 | 1 to 3 | 3 | 3 | 3 | 1 |
| refine | 3 | 3 to 6 | 3 | 3 | 3 | 3 |
| plan, plan task, catch-up, lane | 12 | 2 to 7 | 12 | 12 | 12 | 10 |
| criteria book | 5 | 3 | 5 | 5 | 5 | 0 |
| local check runs | 2 | 1 to 2 | 2 | 2 | 2 | 2 |
| sort | 3 | 4 to 7 | 3 | 3 | 3 | 3 |
| tea-host: host, call, supervisor, monitor | 61 | 1 to 7 | 61 | 61 | 61 | 18 |
| world, safety | 10 | 4 to 28 | 10 | 10 | 10 | 5 |
| world, every lane ends | 4 | 6 to 17 | 4 | 3 | 4 | 2 |
| **All** | **132** | 1 to 28 | **132** | **127** | **130** | 59 |

- **Shrinking is good, not perfect.** 59 plants shrank to exactly our
  shortest run on every seed. The rest came back a little longer on some
  seeds, mostly by one or two steps. A few came back much longer:
  - `takesAnyAnswer` (90's echo break): 6 to 10 against our 6.
  - `rewordRevives` (plan): 3 to 9 against our 3.
  - `waitsForEver`: 17 to 26 against our 17.
  - `ignoresAFailedPost`: 11 to 20 against our 11.
  - No shrunk run was ever shorter than ours. That fits: our search is
    breadth first, so its run is the shortest there is.
- **Deep world plants are easy for it.** The door and claim plants need 24 to
  28 steps. All were caught within 1 s on every seed (the slowest took 939
  ms). A world plant needs one bad order of a few lanes, and almost every
  random order gets there.
- **The real breaks.**
  - Experiment 90: `limitIsAPass` (3 messages) and `takesAnyAnswer` (5
    messages, an echo): caught 5 of 5 within 1 s.
  - Experiment 91: `asksAtTheFirstStall`, and the no-claim and door worlds:
    caught 5 of 5 within 1 s.
  - Experiment 115's hang, both laws: caught 5 of 5 in 2 to 14 ms, shrunk to 6
    steps.
  - 90's other three real breaks (ship trusting one word, build closing
    another ticket, loop passing another head) have no plant. They were
    fixed, and only regression tests pin them. So neither method was measured
    on them.

### The five that were missed or slow

| Plant | Our run, states, time | Property, 1 s | Property, 10 s | Swarm, 1 s / 10 s |
|---|---|---|---|---|
| `deviationExcuses` (review) | 3 steps, 583 states, 177 ms | 0/5 | 0/5 | 0/5, 0/5 |
| `forgetsTheLowest` (loop) | 14 steps, 2,366 states, 145 ms | 0/5 | 0/5 | 0/5, 2/5 |
| `stallOffByOne` (loop) | 11 steps, 354 states, 16 ms | 0/5 | 5/5 (1.1 to 5.6 s) | 2/5, 5/5 |
| `stallOffByOne`, ends by round 3 | 11 steps, 354 states, 18 ms | 0/5 | 5/5 (1.0 to 5.6 s) | 2/5, 5/5 |
| `waitsForEver` (every lane ends) | 17 steps, 320 states, 17 ms | 0/5 | 5/5 (5.1 to 14.4 s) | not run |

Why each one:

- **`deviationExcuses` is an `agree` law.** It says: the same form on the
  same ticket ends the same way, whatever the builder wrote. That compares two
  runs. A property test walks one run at a time, and each walk starts the law
  fresh. It cannot catch this by design, at any budget. To test it as a
  property, you would write a different property: draw two builder texts, run
  both, compare. That is a new test, not the same law.
- **`forgetsTheLowest` needs one narrow path.** Four rounds, with exactly 1,
  2, 1, 1 reviews open, and many other moves possible at every step. Our
  checker merges states that are the same, so it walks 2,366 states. Random
  walks see each state again and again. Swarm helps (it turns off message
  types that lead away), but only 2 of 5 seeds.
- **`stallOffByOne` is the same shape, a bit wider.** 11 steps through a
  narrow path. It took 13,000 to 84,000 walks.
- **`waitsForEver` is slow because each walk is long.** It was found within
  10 to 165 walks, but each walk is up to 1,000 steps with a loop check at
  each, and shrinking walks them again. One seed took 14.4 s: the break was
  found inside 10 s and the shrinking ran past. It counts as caught at 10 s,
  as the budget is for finding (see `sample.ts`).

Why these are rare: of 132 plants, only 2 need a path this narrow, and only 1
compares runs. But both kinds live in the loop and review machines, which are
the ones with counts and rounds. That is where a real bug of this kind would
be too.

## Deeper than our bound, with no plants

Each real machine and world, walked for 10 s on each of 5 seeds, much deeper
than our checker goes:

- **One machine** (21 machines: ship, review, build, loop with and without
  echoes, queue, the hosted agent child, ACP, refine, criteria, check runs,
  plan, sort, plan task, catch-up, plan lane, three tea-host machines): walks
  of median 135 steps and up to 250. Our bounds are 3 to 20. 4,800 to 240,000
  walks per seed.
- **Worlds** (8): two and three lanes, one shared ticket that may fail, red CI
  with errors, flaky CI, a restart and an outsider, "every lane ends" on two
  lanes and on one flaky lane, and the hosted lane with the fixed Sub.
  - Walks of median 9 to 49 steps for safety laws (a world ends when its
    tickets end), up to 400.
  - The flaky lane for "every lane ends" ran all 1,000 steps on every walk.
  - The hosted lane: median 2 steps with refusals on, 7 without. Errors are
    half the answers, so random walks end early.
- **Result: 0 breaks on 0 of 5 seeds, on all 29.** Nothing new.
  - Two of these worlds (three lanes; red CI with errors, flaky CI, a restart
    and an outsider) are not searched by our checker in the normal tests,
    because they are too big for it. The property test walked them fine.

## Lines

| Part | Lines |
|---|---|
| Ours: `laws/explore.ts` | 431 |
| Ours: `laws/world/search.ts` | 573 |
| Property harness: `laws/walk.ts` | 254 |
| Property harness: `laws/sample.ts` | 71 |

- The harness is about a third of ours. But it does not stand alone. It uses
  `World`, `Law`, `watched` and `System` from our checkers' files, and every
  world and law already written. Deleting the checkers would mean keeping those
  types.
- The run used one earlier `sample.ts` of 319 lines, with the same code. It
  was split in two after the run, because a lint rule bans a plain
  `try`/`catch` in a file that imports Effect. The results file has the
  counts after the split.

## Recommendation

*2026-10-22, after a review: this recommendation leans too hard on the plants,
and is replaced by the one at the end of this section. Every plant was kept
because our checker caught it, so its 132 of 132 was certain before the run.
The property test had no such head start and still caught 130. On the real
machines neither found anything, and experiment 116 found the one real bug our
world search found with a property test too. "A property test cannot catch
the first kind at all" is also too strong: one walk cannot, but a property
that draws two walks and compares them could. That was not tried. The text
below is kept as it was written.*

**Keep `explore.ts`, the one-machine checker. Keep the world search too for
now, and add property walks beside both.** Confidence 70%.

- **Why keep the one-machine checker:**
  - It caught the two plants the property test missed: a law across runs
    (`agree`) and a narrow 14-step path. A property test cannot catch the
    first kind at all.
  - It proves the whole space on small machines (it ends with `complete:
    true`). A property test only says "not found yet".
  - It is fast where it matters: 16 to 177 ms on the hard plants.
- **Why the world search could go, and why I would not delete it yet:**
  - For it: the property test caught every world plant, including 28-step
    ones within 1 s, and it walks worlds too big for our search.
  - Against: our search proves "every lane ends" over the whole space, with
    fairness. The walk only finds the loops it happens to close. `waitsForEver`
    took 5 to 14 s against our 17 ms. And our search gives the shortest run;
    the walk gave 17 to 26 steps where ours gave 17.
  - Only 14 world plants were measured. That is too few to trust that no world
    bug is narrow.
- **What it costs:** keeping both costs nothing new; they exist and pass. The
  property harness adds 325 lines and about one second of normal tests.
  Deleting the world search would save 573 lines, and lose full-space proofs of
  "every lane ends".
- **The doubt, and what would settle it:** I am under 80% sure because the
  world plants are few, and all of them were wide. What would settle it: plant
  10 more world mistakes on purpose narrow (one exact order of three lanes,
  with a counter), and run both methods. If the walk still catches them within
  10 s, delete the world search and keep only `walkEnds` beside a small
  fairness proof. If not, keep both.

**The recommendation now, 2026-10-22: property tests on the real code are the
default for new laws.** Our two checkers stay as they are, since they exist and
pass, but nothing new is built on them until a fair test shows a bug only they
catch. Confidence 75%.

- **Why:** we have not yet seen a real bug only our checker finds. A property
  test is the industry's tool, on Effect's own `Arbitrary`, so the owner and
  new readers can learn it from outside material.
- **What it costs:** a bug hidden behind one exact order, like
  `forgetsTheLowest`, could slip past a random walk.
- **What would settle it:** mutation testing. A tool makes many small edits to
  the real machine code that nobody wrote for either checker, and we count which
  edits each one catches. A real edit only our checker catches is the evidence
  missing today.

## Glossary

- **Property test:** draw many random inputs, run the real code on each, and
  check a rule holds. On a failure, shrink the input to a small one that still
  fails.
- **Model checker:** try every order of messages up to a bound. Our two
  checkers are this kind.
- **Plant (planted mistake):** a copy of a machine with one bug put in on
  purpose, to check that a checker finds it.
- **Shortest run:** the fewest steps that show the bug. Our checker searches
  breadth first, so it always finds the shortest.
- **Shrinking:** making a failing input smaller, step by step, while it still
  fails.
- **Swarm walk (swarm testing, Groce et al. 2012):** each walk first turns off
  some message types at random for the whole walk, so it can go deep along the
  ones left on.
- **"Eventually" law:** a rule like "every lane ends", which no single step
  can break. Only a run that goes on for good, or stops in the wrong place,
  breaks it.
- **Fair loop:** a loop that keeps a lane open, while everything that must
  happen still gets its turn. A real system could go round it for good.
- **`agree` law:** a law across runs: two runs that share a key must give the
  same value.

## What it cannot tell us

- **Only planted bugs.** Every plant was written to be caught by our checker.
  A bug our checker cannot see (past its bound, or in a world too big for it)
  is not in this list, so the list favours our checker's kind of bug.
- **Few world plants.** 14, all of them wide. See the doubt above.
- **One kind of property test.** The walk takes moves at random, evenly. A
  walk tuned per machine (weights, a targeted generator) would likely catch
  `forgetsTheLowest`. That costs code per machine, which our checker does not
  need.
- **One laptop, one run.** The times are wall times on one machine. A slower
  CI runner would move the 1 s numbers. The three plants caught between 1 and
  15 s are the ones most likely to change.
- **No new bugs does not mean no bugs.** The deep runs found nothing. That
  says the real machines hold their laws on random walks of up to 250 or 1,000
  steps, not on all of them.
- **90's other three real breaks were not measured**, as they have no plant.

## Every plant

"Bound" is the bound our checker was given. "Ours" is whether it caught it,
and its shortest run. The two property columns count seeds of 5. "Shrunk" is
the shortest and longest shrunk run over the seeds that caught it.

| Group | Plant | Bound | Ours | Property, 1 s | Property, 10 s | Shrunk |
|---|---|---|---|---|---|---|
| ship | forgetsMissingReview | 6 | yes, 2 | 5/5 | 5/5 | 2 |
| ship | skipsTheRead | 6 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| ship | keepsAnOldPass | 6 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| ship | landsAnyHead | 6 | yes, 4 | 5/5 | 5/5 | 4 |
| ship | takesAnOldVersion | 6 | yes, 2 | 5/5 | 5/5 | 2 |
| ship | actsAfterTheEnd | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| review | unseenIsMet | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| review | takesAnyHead | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| review | deviationExcuses | 6 | yes, 3 | 0/5 | 0/5 (swarm 0/5, 0/5) | - |
| review | rewordsFromDeviations | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| review | judgesTheFirstVersion | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| review | actsAfterTheEnd | 6 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| review | limitIsAPass (90's 3-message break) | 6 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| build | leftDescopes | 6 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| build | actsAfterTheEnd | 6 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| loop | stuckIsPassed | 7 | yes, 5 | 5/5 | 5/5 | 5 |
| loop | forgetsTheOpenList | 7 | yes, 5 | 5/5 | 5/5 | 5 |
| loop | aCapPutBack | 8 | yes, 8 | 5/5 | 5/5 | 8 |
| loop | actsAfterTheEnd | 7 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| loop | stallOffByOne | 12 | yes, 11 | 0/5 | 5/5 (swarm 2/5, 5/5) | 11 to 12 |
| loop | stallOffByOne, every loop ends by round 3 | 12 | yes, 11 | 0/5 | 5/5 (swarm 2/5, 5/5) | 11 to 12 |
| loop | forgetsTheLowest | 21 | yes, 14 | 0/5 | 0/5 (swarm 0/5, 2/5) | - |
| loop | takesAnyAnswer (90's 5-message echo break) | 6 | yes, 6 | 5/5 | 5/5 | 6 to 10 |
| loop | takesAnyClaim | 7 | yes, 2 | 5/5 | 5/5 | 2 |
| loop | keepsItsClaim | 7 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| queue | queuesTwice | 4 | yes, 2 | 5/5 | 5/5 | 2 |
| queue | dropsTheWorked | 4 | yes, 2 | 5/5 | 5/5 | 2 |
| queue | jumpsTheQueue | 4 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| queue | forgetsTheTidy | 4 | yes, 2 | 5/5 | 5/5 | 2 |
| acp session | endsTheLast | 4 | yes, 3 | 5/5 | 5/5 | 3 |
| acp transcript | countsAStrayAnswer | 4 | yes, 1 | 5/5 | 5/5 | 1 to 2 |
| acp transcript | overwritesTheLast | 4 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| refine | passesUnchecked | 4 | yes, 3 | 5/5 | 5/5 | 3 |
| refine | retriesPastTheLimit | 7 | yes, 6 | 5/5 | 5/5 | 6 |
| refine | actsAfterTheEnd | 4 | yes, 4 | 5/5 | 5/5 | 4 |
| plan | doneWithQuestions | 6 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| plan | takesAnyRun | 6 | yes, 5 | 5/5 | 5/5 | 5 |
| plan | dropsAFailedSpend | 6 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| criteria book | reusesIds | 4 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| criteria book | keysVerdictsByPlace | 4 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| criteria book | rewordKeepsVersion | 4 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| criteria book | passCarriesOver | 4 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| criteria book | rewordRevives | 4 | yes, 3 | 5/5 | 5/5 | 3 to 9 |
| local check runs | filesUnderTheAskedHead | 3 | yes, 1 | 5/5 | 5/5 | 1 |
| local check runs | firstRunWins | 3 | yes, 2 | 5/5 | 5/5 | 2 |
| sort | writesBeforeTheDoor | 6 | yes, 4 | 5/5 | 5/5 | 4 |
| sort | takesAnyRun | 6 | yes, 5 | 5/5 | 5/5 | 5 |
| sort | leavesANoOpen | 8 | yes, 7 | 5/5 | 5/5 | 7 |
| plan task | rawSummary | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| plan task | pushesFromMain | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| plan catch-up | pushesUnresolved | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| plan catch-up | resolvesTheLockfile | 6 | yes, 3 | 5/5 | 5/5 | 3 |
| plan lane | rawBody | 6 | yes, 2 | 5/5 | 5/5 | 2 |
| plan lane | opensBehind | 6 | yes, 2 | 5/5 | 5/5 | 2 |
| plan lane | forgetsTheRound | 14 | yes, 7 | 5/5 | 5/5 | 7 |
| plan lane | aCapPutBack(1) | 12 | yes, 7 | 5/5 | 5/5 | 7 |
| plan lane | forgetsTheLastReviews | 8 | yes, 6 | 5/5 | 5/5 | 6 |
| tea-host: host | starts unclaimed (94) | 8 | yes, 2 | 5/5 | 5/5 | 2 |
| tea-host: host | keeps running when lost (94) | 8 | yes, 4 | 5/5 | 5/5 | 4 |
| tea-host: host | renews the first fence (94) | 8 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: host | claims while owning (94) | 8 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: host | stale word stops (94) | 8 | yes, 7 | 5/5 | 5/5 | 7 to 10 |
| tea-host: host | renews after start (94) | 8 | yes, 2 | 5/5 | 5/5 | 2 |
| tea-host: host | ignores its lease clock (98) | 8 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: host | a late renew answer moves the lease end back (98) | 8 | yes, 4 | 5/5 | 5/5 | 4 |
| tea-host: host | the lease clock waits for the program to start (98) | 8 | yes, 2 | 5/5 | 5/5 | 2 |
| tea-host: host | a takeover counts as a new incarnation (99) | 8 | yes, 2 | 5/5 | 5/5 | 2 |
| tea-host: host | the program runs on while the exit is in flight (99) | 8 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: host | exits on another fence's program end (99) | 8 | yes, 3 | 5/5 | 5/5 | 3 to 7 |
| tea-host: host | a lost lease exits as a crash (99) | 8 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: host | a crash exits normal (99) | 8 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: host | stops renewing while exiting (99) | 8 | yes, 4 | 5/5 | 5/5 | 4 |
| tea-host: host | a renew that heard lost ends the exit (99) | 8 | yes, 5 | 5/5 | 5/5 | 5 |
| tea-host: host | a landed exit goes back to watching (99) | 8 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| tea-host: host | a stale restart wakes a down name (99) | 8 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: host | claims while down (99) | 8 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: call | a late reply is read again | 6 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: call | a reply for no pending call answers | 6 | yes, 1 | 5/5 | 5/5 | 1 to 2 |
| tea-host: call | a retry under a new call id | 6 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: call | resume forgets the calls in flight | 6 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: call | a send carries the try before | 6 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: call | answers with another call's request | 6 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: call | a reply answers but the call stays pending | 6 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: supervisor | no brake: restarts past its intensity (one_for_one) | 5 | yes, 5 | 5/5 | 5/5 | 5 to 6 |
| tea-host: supervisor | counts restarts forever, never over a period (one_for_one) | 5 | yes, 5 | 5/5 | 5/5 | 6 to 9 |
| tea-host: supervisor | ignores its parent's EXIT (one_for_one) | 5 | yes, 2 | 5/5 | 5/5 | 2 to 4 |
| tea-host: supervisor | starts its children again after giving up (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: supervisor | gives up and exits at once, its children left running (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 6 |
| tea-host: supervisor | a temporary child is restarted like a permanent one (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | a transient child is restarted after a clean exit (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: supervisor | a permanent child is let go after a normal exit (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | one_for_all restarts only the child that exited (one_for_all) | 5 | yes, 4 | 5/5 | 5/5 | 4 to 5 |
| tea-host: supervisor | rest_for_one restarts the children before it too (rest_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | a group restart starts the siblings without stopping them: two runs at once (one_for_all) | 5 | yes, 4 | 5/5 | 5/5 | 4 to 8 |
| tea-host: supervisor | a late start from before the group restart is taken as the restart itself (one_for_all) | 5 | yes, 4 | 5/5 | 5/5 | 4 to 6 |
| tea-host: supervisor | no backoff: restarts the moment it exits (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: supervisor | a fixed wait: a crash loop waits minMs each time (one_for_one) | 5 | yes, 5 | 5/5 | 5/5 | 5 to 9 |
| tea-host: supervisor | the wait never starts over, however long the child ran (one_for_one) | 5 | yes, 5 | 5/5 | 5/5 | 6 to 10 |
| tea-host: supervisor | a call sent again is done again (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| tea-host: supervisor | terminate_child starts the child again once it ends (one_for_one) | 5 | yes, 4 | 5/5 | 5/5 | 4 to 6 |
| tea-host: supervisor | an EXIT for an earlier run of the supervisor restarts a child (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 6 |
| tea-host: supervisor | an EXIT of an older run of the child restarts it (one_for_one) | 5 | yes, 5 | 5/5 | 5/5 | 5 to 11 |
| tea-host: supervisor | reads an old EXIT again (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | a restart of the supervisor keeps the old restart list (one_for_one) | 5 | yes, 1 | 5/5 | 5/5 | 1 |
| tea-host: supervisor | a restart names no run: a start that cannot be fenced (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: supervisor | a limit exit is restarted like a crash (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | a limit exit counts toward intensity (one_for_one) | 5 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: supervisor | a refused restart is dropped (one_for_one) | 5 | yes, 4 | 5/5 | 5/5 | 4 to 6 |
| tea-host: monitor | reports every DOWN, so one death seen by two monitors twice | 7 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: monitor | OTP's monitor alone: no gap, deaths between a DOWN and the next monitor go unseen | 7 | yes, 3 | 5/5 | 5/5 | 3 to 4 |
| tea-host: monitor | a monitor on j reports j ended too | 7 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: monitor | a noproc counts as a death | 7 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: monitor | stops watching after a death | 7 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: monitor | monitors again under the old ref | 7 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: monitor | reads an old DOWN again | 7 | yes, 3 | 5/5 | 5/5 | 3 |
| tea-host: monitor | resume forgets the monitors in flight | 7 | yes, 2 | 5/5 | 5/5 | 2 to 3 |
| tea-host: monitor | 99's fixed re-arm: a name that stays down is asked every retryMs | 7 | yes, 4 | 5/5 | 5/5 | 4 to 7 |
| tea-host: monitor | a stale retry asks again | 7 | yes, 3 | 5/5 | 5/5 | 3 to 5 |
| world | no claim at all | 200 | yes, 4 | 5/5 | 5/5 | 4 |
| world | a claim read, then written | 200 | yes, 6 | 5/5 | 5/5 | 6 |
| world | a merge door blind to main, no queue | 200 | yes, 28 | 5/5 | 5/5 | 28 to 30 |
| world | no merge door, no queue | 200 | yes, 28 | 5/5 | 5/5 | 28 to 30 |
| world | ship merges past the queue, no door | 200 | yes, 28 | 5/5 | 5/5 | 29 to 30 |
| world | no claim, no door: a failed head lands | 200 | yes, 24 | 5/5 | 5/5 | 24 to 29 |
| world | no claim, with the door: a failed head lands | 200 | yes, 24 | 5/5 | 5/5 | 26 to 27 |
| world | ship takes a missing review as passed, no claim, no door | 200 | yes, 24 | 5/5 | 5/5 | 24 |
| world | asksAtTheFirstStall (91's real gap) | 200 | yes, 20 | 5/5 | 5/5 | 20 |
| world | a desk drops a stuck ask on progress | 50 | yes, 4 | 5/5 | 5/5 | 4 |
| world ends | waitsForEver: flaky CI waited on for good | 200 | yes, 17 | 0/5 | 5/5 | 17 to 26 |
| world ends | ignoresAFailedPost: a dead state | 200 | yes, 11 | 5/5 | 5/5 | 11 to 20 |
| world ends | the hosted lane today (115's hang), every lane ends | 400 | yes, 6 | 5/5 | 5/5 | 6 |
| world ends | the hosted lane today (115's hang), every child ends | 400 | yes, 6 | 5/5 | 5/5 | 6 |
