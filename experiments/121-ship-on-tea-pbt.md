# 121. Ship's laws on tea's own property tests: what do they catch on 119's mutants?

The question: experiment 119 found that our every-order search caught no
mutant on the ship stage that random walks missed. So ship's laws move to
tea's own property-test module, `@demlik/tea/pbt` (on fast-check). Does the
move lose anything? And how much do the two laws that 119 found missing add?
Two separate runs answer the two questions, so one cannot hide the other.

**Answer: the move loses nothing that ship's own laws caught, and the new
laws add far more than the tool. Confidence 80%.**

- **The mutants:** 150 of 119's 569 ship mutants, a fixed sample (experiment
  120 uses the same one). In 119 it holds 36 that both arms caught and 114
  that neither caught.
- **Run 1, today's five laws, moved as they are:**
  - tea pbt caught 45; 119's walks (B) caught 36.
  - Both 27, only tea pbt 18, only B 9, neither 96.
  - The same against our every-order search (A), since on ship A and B
    caught the same mutants.
  - **All 9 "only B" came from 119's world tests**, not from ship's five
    laws: a lane that must end, a desk that must ask, and one world that
    crashed. A one-machine tool cannot run a world law. That cost was known.
  - Of what ship's own laws caught in 119, tea pbt caught 9 of 9.
- **Run 2, run 1 plus "which outcome a run gives" and "a ready pull request
  lands":**
  - caught 118. Both 35, only tea pbt 83, only B 1, neither 31.
  - The two new laws alone caught 73 that run 1 missed. 65 of them got past
    both arms in 119.
- **A run from a saved state** found a real hole in the ship machine on 5 of
  5 seeds. A state whose proof and whose write in flight name different
  heads lands a head that was never sent. Not fixed here.

```ts
// The whole idea (packages/pipeline/src/laws/ship-pbt.ts).
// One table entry per Msg type; leaving one out does not compile.
const msgs = fc.array(arbMsg(table, {weights: WEIGHTS}), {maxLength: 60, size: "max"});

// A law that looks at one step: tea's propertyInvariant, on the real ship from its real init.
propertyInvariant(ship, undefined, msgs, (step) => {
	const why = law.each(step); // today's law, moved as it is: null, or why it broke
	if (why !== null) throw new LawBroken(law.name, why, [step]);
	return true;
}, {numRuns: 35_000, seed});

// Run 1 = today's five laws. Run 2 = run 1 + the two new laws.
// Mutant 46 (gate.ts:57), green checks: "on" made "". A green pull request never lands.
//   119: A holds, B holds.  Run 1: holds.
//   Run 2: "a ready pull request lands" breaks: "a ready read at A sent no enqueue".
```

## Who did what

- **Moved, not changed:** today's five ship laws. Their bodies are copied
  from `laws/ship.ts` into `laws/ship-pbt.ts`, with the same names and the
  same checks. `laws/ship.ts` is not touched.
- **New:**
  - `packages/pipeline/src/laws/ship-pbt.ts`: the generators, the steering,
    the five laws, the two new laws and the saved-state property;
  - `packages/pipeline/src/laws/ship-pbt.test.ts`: 8 tests, about 8 s;
  - `experiments/121-ship-on-tea-pbt.ts` and
    `results/121-ship-on-tea-pbt.json`.
- **Not changed:** the ship machine (`stages/ship/machine.ts`, `gate.ts`).
  So Stryker makes the same 569 mutants as in 119. Every chosen mutant's
  file, line, mutator and edit matched 119's results file.
- **The fence stays.** `laws/ship.ts` still imports the search engine, and
  the lanes world, `specs.ts` and the promise check still use it. So ship's
  entry in `layer-rules.json` stays, with a new reason, and so do ship's
  every-order runs in `laws.test.ts`. The new file does not import the
  engine.
- **fast-check 4.10.2** is a new catalog dev dependency of
  `@kampus/pipeline`. Installing it was the only network use.
- **Stryker 9.6.1** sat in a scratch folder outside the repo, called by
  path, as in 119.
- No live run, no ticket, nothing of today's fabrika. No model, no key. $0.

## How it was done

- **The port.**
  - A law that looks at one step became a `propertyInvariant`. A law that
    remembers something along the run became a `propertyTrace`.
  - Each property runs on the real `ship` machine, from its real `init`.
  - A broken law throws `LawBroken` with its reason, so the failure says
    which law and why, not only "false".
- **The generator** is one table entry per Msg type (16), with small sets:
  one pull request, two heads. An answer to a Cmd is made again from the
  head alone, the way the machine makes it, so about half the answers fit
  what was asked.
- **The mutants.** 119's harness, reused:
  - Stryker's command runner, `inPlace`, the same two files;
  - the 150 sample ids, plus the named 502 and 516; every other mutant exits
    at once and is not counted;
  - each mutant: 5 seeds, each seed one child process (limit 300 s), every
    property of the run on that seed;
  - a fixed number of runs per property, 35,000, so that run 1's five take
    about 10 s on a quiet machine (`calibrate`: 2.8 s at 10,000);
  - under `nice -n 15`, at most 8 workers, started only when no other
    Stryker ran.
- **The two runs are two Stryker passes.** Run 2 is run 1's five on the same
  seeds and counts, plus the two new laws. Each is counted on its own. Run
  1's five gave the same answer on every mutant in both passes.
- **One extra pass, S,** runs the saved-state property alone. It is counted
  in neither run.

### Generator and steering, in lines

| Part | Code lines |
|---|---|
| The Msg table and the read's facts | 108 |
| Steering: weights and list length | 13 |
| The ready runs for "lands", with noise between steps | 75 |
| The saved states | 63 |
| `reach`, Hughes's counts | 32 |
| `planted`, so a planted mistake runs as a machine | 23 |

Each piece of steering, and why:

- **Weights.** A read's answer 4, the enqueue and merge answers 3, `start`,
  the checks Listen and the queue Listen 2, the rest 1. Every path goes
  through a read; an answer to a write fits only half the time (two heads);
  nothing happens before `start`.
- **`mostly`: each field of a read is its good value 8 times in 9.** A read
  has about ten such fields. With an even pick almost no read is ready; with
  this, about a third are ready and about a third have one thing wrong.
- **Reviews are unread 1 time in 10.**
- **Lists up to 60 long, drawn at full size.** At fast-check's default size
  a list with `maxLength: 60` comes out about 10 long, and most runs never
  get past a read.
- **One pull request, two heads.** So an answer names the head that was
  asked about half the time.
- **The base branch is fixed (`ON_TIP`), and the verdict rows come in four
  kinds** (met, a fail, judged at another head, judged on old words). It
  keeps reads valid. It also means the gate's last refusal is never reached
  (mutants 186 to 188 survive).
- **"Lands" has a built path, not a random list.** Its answers must answer
  the Cmd the machine really sent, and tea's `arbGuidedSequence` would do
  that but is not built yet. Noise Msgs that change nothing go between the
  steps.

## What came back

### Run 1: today's five laws

| Against | Both | Only tea pbt | Only the other | Neither |
|---|---|---|---|---|
| B, the walks | 27 | 18 | 9 | 96 |
| A, our search | 27 | 18 | 9 | 96 |
| A, not counting its crashes | 10 | 35 | 8 | 97 |

- **Caught 45 of 150:** 8 by a law, 36 by a throw, 1 where the module did not
  load (194). Every catch was on all 5 seeds.
  - A throw: the machine, tea's runner or our law code threw on what the
    mutant made. In 119 the walks counted these as the law "update throws",
    and 8 of the 9 ship-law kills in 119 were throws too.
- **Where 119 caught them:**
  - by ship's own laws: 9, tea pbt caught 9;
  - only in a world: 9, tea pbt caught 1 (559);
  - where our checker crashed: 17, tea pbt caught 16 (not 458);
  - no row (the module did not load): 1, caught.
- **Only tea pbt, 18:**
  - 87, 110, 178, 179 (`gate.ts`): reads that 119's fixed world never sent
    (merge conflicts or unknown, reviews unread). "Merge only when the last
    read shows it ready" breaks. The generator is wider, not the search.
  - 315, 322 (a Listen and a clock opened in the wrong phase) and 339
    (`init` made to return nothing): tea's runner calls the real `init` and
    the real Subs, and these throw.
  - 404, 406, 414, 415, 446, 447, 481, 482, 492, 494: a phase guard made
    always true. An answer that comes in the wrong phase then reads a Cmd
    that is not there, and throws. The noise in the lists finds these.
  - 565: "only the head that was sent lands" breaks.
- **Only B, 9:**
  - 145, 511: the desk worlds' law "a lane that stops to ask the owner
    leaves an ask";
  - 269, 270, 350, 359, 456, 491: the worlds' "every lane ends";
  - 458: a junk Cmd (`["Stryker was here"]`) that crashed a world. No ship
    law says a Cmd must be one of ship's.
- Every catch came within 1,823 lists, out of 35,000. The median was 3.

### Run 2: run 1 plus the two new laws

| Against | Both | Only tea pbt | Only the other | Neither |
|---|---|---|---|---|
| B, the walks | 35 | 83 | 1 | 31 |
| A, our search | 35 | 83 | 1 | 31 |
| A, not counting its crashes | 18 | 100 | 0 | 32 |

- **Caught 118 of 150:** 84 by a law, 33 by a throw, 1 did not load. Every
  catch on all 5 seeds.
- **Only the new laws caught 73:** 52 by "which outcome a run gives" alone, 1
  by "lands" alone (350), 20 by both.
  - 65 of the 73 got past both arms in 119.
  - 8 are the world catches of run 1's "only B". The new one-machine laws
    see them: a lane that never ends is, on one machine, a ready run that
    never lands, or a run that ends with the wrong outcome.
  - "Which outcome a run gives" broke on 115 mutants in all; "lands" on 47.
- **Where 119 caught them:** ship's laws 9 of 9, worlds 9 of 9, crashes 16 of
  17, no row 1 of 1.
- **Still missed, 32,** in kinds:
  - the schemas, never decoded on the way (189, 195, 199, 204, 208, 337);
  - the Listens and their clocks, which tea's runner calls but no law reads
    (311, 314, 317, 318, 331, 215);
  - `revived`, the check of a saved state: no run in these lists starts from
    one (237, 240, 243, 246, 252, 253);
  - the gate's last refusal, which these reads never reach (186, 187, 188);
  - "checks stuck" after 5 waits, never reached (296);
  - a junk Cmd added that no law forbids (291, 346, 458);
  - `no_verdict`, which the generator never makes (26, 28);
  - a check answer in another phase starts a new read; no law says it must
    not (426, 429);
  - likely the same behaviour: an empty landing read as whole (14), and two
    intent tags made empty (367, 473).
- Every catch came within 2,373 lists. "Lands" needed at most 17.

### Beside experiment 120

Experiment 120 ran the same sample with arm C: inputs drawn from Effect
schemas, an answer given only to a Cmd that was sent, today's five laws, and
a seed that fails when a Msg type is never sent.

| | Both | Only here | Only 120's arm C | Neither |
|---|---|---|---|---|
| Run 1 | 29 | 16 | 16 | 89 |
| Run 2 | 42 | 76 | 3 | 29 |

- **Run 1's 16 misses that arm C caught:**
  - 13 by "never sent": the mutant cuts off a whole path, so some answer is
    never asked for (16, 46, 92, 108, 135, 145, 168, 175, 269, 270, 350,
    359, 378);
  - 2 by answers drawn from a Cmd's own schema (199, 208);
  - 1 junk Cmd that arm C could not answer (458).
- **So a check on reach is a law of its own.** Here the answers are drawn
  whether or not a Cmd was sent, so "never sent" cannot be asked as 120
  asks it. `reach` counts the phases, but nothing fails on it.
- Run 2's new laws catch all 13 of those paths. Arm C still has 3 that run 2
  missed.
- Arm C's misses that run 1 caught: the 10 guard flips, the Listen, the
  clock and `init` (315, 322, 339), 559, 565, and 194, which did not load
  here.

### Time per mutant

| Per mutant, median | A, our search (119) | B, the walks (119) | Run 1 | Run 2 |
|---|---|---|---|---|
| Caught | 0.5 s | 0.9 s, first catch 0.1 s | 2.0 s, first catch 1 ms | 56.7 s, first catch 3 ms |
| Not caught | 4.0 s | 101 s | 70.7 s | 70.9 s |
| All 150, added up | 9 min | 194 min | 130 min | 116 min |

- The times are wall times under load: 8 workers here, 11 in 119, with the
  laptop in use. Each tea pbt time holds 5 child processes starting up.
- A catch does not stop the other properties: each runs its full count. So
  run 2's "caught" is high, because 6 other properties still run to 35,000.
  In a normal test run the first failure ends it, and the first catch is the
  number to read.
- Not caught, tea pbt runs its fixed count: 5 seeds of about 10 s on a quiet
  machine, about 14 s under this load. Like the walks' budget, that is a
  choice.
- On a machine as small as ship, our search is still the cheapest per mutant
  (4 s for every order to depth 30). It is not what catches more.
- The passes took 17 min 47 s (run 1), 16 min 11 s (run 2) and 4 min 4 s
  (pass S) on 8 workers.

### The three named mutants

502 (`"conflicts"` made `""`, in the enqueue answer), 515 (`"stale"` made
`""`, in the merge answer) and 516 (the merge error handler made to return
nothing).

- In 119 the walks caught them on only 3 or 4 of 5 seeds within 10 s. Each
  needed one exact answer to one exact Cmd, deep in a world.
- Here all three were caught on all 5 seeds, by a throw, in both runs.
  - Run 1: 3.6, 3.8 and 2.1 s a mutant; the first catch after 47, 32 and
    1 ms.
  - Run 2: 6.2, 5.8 and 4.6 s.
- One machine with two heads gets to the exact answer far more often than a
  world does.

### What the generator reaches

Hughes's rule: count what the inputs reach before trusting a pass. 2,000
lists, seed 7.

- **58,340 Msgs drawn; only 3,672 (6%) changed the state or sent a Cmd.**
  `ship_checks` acted 7 times in 4,627; a rerun's answer 2 times in 2,116.
- **Runs that reached each phase:** idle 2,000, reading 1,513, over 1,183,
  enqueueing 334, merging 35, queued 34, finishing 14, waiting 14,
  rerunning 10.
- **23 kinds of outcome reached,** among them `done` 44 times and
  `done:part` 4 times.
- The 94% of Msgs that change nothing are not all waste: they are the noise
  that caught the 10 guard mutants of run 1.
- The deep phases are thin. With 35,000 lists a seed they are still reached
  hundreds of times, but the "checks stuck after 5 waits" end never was.

### Planted mistakes

- **All 6 plants of `laws/ship.ts` are caught,** and each of today's five
  laws is seen to fail at least once:

  | Plant | Laws that break |
  |---|---|
  | `forgetsMissingReview` | the last read shows it ready; a pass for another head never counts |
  | `skipsTheRead` | the last read shows it ready; a merge carries a passing row |
  | `takesAnOldVersion` | the last read shows it ready; a merge carries a passing row |
  | `keepsAnOldPass` | the last read shows it ready; a pass for another head never counts |
  | `landsAnyHead` | only the head that was sent lands |
  | `actsAfterTheEnd` | an ended run sends nothing |

- **The new laws, each seen to fail:**
  - a failed tidy-up told as "done" breaks both new laws;
  - staying in `enqueueing` when there is no merge queue breaks only
    "lands".
- Experiment 90's real 2-Msg break (a failed review-doc beside a passed
  review-code) is a fixed regression test.
- Nothing was loosened.

### A run from a saved state

One property starts the real machine from a state drawn as storage could
hand it back: any phase, counts anywhere in range, its proofs as kept or
edited, read back through JSON. It runs through the real `init`, which
checks the state again (`revived`).

- **Finding: a state whose two proofs name different heads lands a head that
  was never sent.** On all 5 seeds, within 392 to 1,274 tries:
  `landed B, and the heads sent were A, after ship_queue`.
  - In `enqueueing` or `merging`, a state holds its proof (`ready`) and the
    write in flight (`asked`), which holds a proof too.
  - `revived` checks that each proof proves its criteria. It does not check
    that the two name the same head.
  - So a state with `ready` at B and an enqueue in flight at A passes. The
    queue lands B; A was sent.
  - A real run never writes such a state. A store that is edited, or a bug
    elsewhere, could. The machine's own comment says a state read back is
    "checked again, not trusted".
- **Not fixed here,** so the mutants stay the same as 119's. The test that
  shows it is in `ship-pbt.test.ts`, marked as a finding.
- **With the two proofs on one head, the real machine holds.**
- **Pass S, the same property on the mutants** (one head, 35,000 runs, 5
  seeds), counted in neither run:
  - caught 46 of 150: 5 by a law, 40 by a throw, 1 did not load;
  - **7 that run 2 missed:** the six `revived` mutants (237, 240, 243, 246,
    252, 253), and 346, where `init` sends a Cmd. tea refuses that on a
    loaded state as a contract break; on a fresh start no law looks at what
    `init` sends;
  - median 1.5 s caught, 15.4 s not caught.

### Gaps in tea's pbt, for demlik

Hit while building, on `@demlik/tea` 0.21.0:

| Gap | What was done instead | Lines |
|---|---|---|
| `arbGuidedSequence` throws: no answer made from the Cmd really sent | "lands" folds by hand with `applyCell`, on a built path | 43, plus 75 of generator |
| A law returns only true or false | throw `LawBroken`; read it from fast-check's `err.cause` | about 15 |
| `loaded` is one fixed value | the saved-state property calls `fc.assert` and `foldEvents` itself | about 10 |
| `arbMsgSequence` takes no `size`, so lists come out about 10 long | `fc.array(arbMsg(...), {size: "max"})` | 4 |
| The runners return nothing and pass on only `numRuns` and `seed` | the experiment reads tests run and shrinks from the error text | about 6 |
| A planted mistake must be a whole `Machine` | `planted()` names all 16 Msg types | 23 |
| No hook to count what the inputs reach | `reach()` | 32 |
| No law that something must happen; only `propertyTerminates`, on the last state | "lands" as its own property | in the 43 |
| The runners check no sent Cmd against the machine's own Cmds, and show no Cmd that `init` sends | nothing: 3 junk-Cmd mutants survive (291, 346, 458) | 0 |

- The biggest effect on what was caught was the list size. Before
  `size: "max"`, most runs ended after one read.
- **A tension to settle:** the direction note
  [Property tests, not our own search engine](../docs/direction/property-tests-not-our-own-search.md)
  says a gap goes to demlik as an issue and is not worked around here. This
  experiment worked around eight of them, to measure the tool at all. Each
  is listed above with its lines, so it can leave when demlik closes the
  gap. No issue was filed from here.

## Recommendation

**Move ship's laws to tea's pbt, add the two new laws to ship's tests, and
keep the lanes world on the old engine for now.** Confidence 80%.

- **Why:**
  - Run 1: the move lost nothing that ship's own laws caught (9 of 9, and 16
    of 17 crashes), and caught 18 more. Its 9 misses are world laws.
  - Run 2: the laws were what was thin, as 119 said. Two laws caught 73 more,
    65 of them missed by both of 119's arms. That is more than the tool
    change.
  - The saved-state property found a real hole on its first run.
- **What it costs:**
  - The five law bodies live twice until the lanes world, `specs.ts` and the
    promise check move off `laws/ship.ts`.
  - "Which outcome a run gives" is a second copy of the gate's order (a
    reference model; 155 lines with its helpers). It must change whenever
    the gate changes, and it catches any change in outcome, harmless or not.
  - The eight workarounds above, about 200 lines, until demlik closes them.
- **Next steps:**
  - Fix `revived` to check that the two proofs name one head, in its own
    pull request, once 120 is done with these mutant ids. 85% sure this is a
    hole worth closing; it needs a store that hands back what the machine
    never wrote.
  - Move the promise record and `specs.ts` to `ship-pbt.ts`; then the lanes
    world is the last user of `laws/ship.ts`.
  - Make a seed fail when a phase is never reached, as 120's "never sent"
    does. It caught 13 of run 1's misses there, for a few lines over
    `reach`.
  - The normal test runs 2,000 lists a property. Every catch here came
    within 2,373. 3,000 would keep the same catches on these seeds, at about
    0.2 s a property on a quiet machine.
- **The doubt, and what would settle it:** a sample of 150, not 569. Running
  the other 419 mutants, about 100 minutes for both runs at this load, would
  settle it.

## What it cannot tell us

- **150 of 569 mutants,** one fixed sample. The 9 "only B" are a count on the
  sample, not on ship.
- **One laptop, in use.** The number of runs is fixed, so what was caught does
  not depend on load. The times do.
- **Run 2's laws were written after reading 119's misses,** by the same agent
  that ran the count. They aim at the kinds 119 listed. So run 2 is closer to
  an upper bound on what new laws add than to what a law written blind
  would add.
- **The outcome law is a copy of the gate.** Where both are wrong the same
  way, it holds. Its 52 lone catches were not checked one by one for
  harmless changes.
- **Shared code.** The generator and the laws use ship's Cmd definitions and
  test helpers from the machine's folder. A mutant in a schema changes both
  sides, so the 6 schema mutants are not caught, the same as in 119.
- **One machine.** The world catches stay with `world.test.ts`. Run 2 shows
  one-machine laws can stand in for these 8, not that they can stand in for
  a world in general.
- **The saved states are the generator's.** 8 phases, 3 ways a proof is
  edited. A store could do other things.
- **Only ship.** The loop, where 118's narrow 14-step path was, is not
  tested.
- **Stryker's default mutators only:** one small edit at a time.

Cost: $0, no model. About 38 minutes of Stryker in three passes on 8
workers, and about a minute for the report.

## Hand check of the outcome law's lone catches (2026-10-24)

"What it cannot tell us" above says that 52 mutants were caught in run 2 by
"which outcome a run gives" alone, and that nobody checked them for harmless
changes. This section checks them. **One agent read every edit and judged
it.** That is a doubt in itself: nobody else checked the verdicts.

**Answer: 49 real, 0 harmless, 3 unsure. But the repo's own checks already
catch all 52: `pnpm typecheck` refuses 42 of the edits, and ship's example
tests catch 50. On this sample the outcome law found nothing those checks
miss. Confidence 85% in the verdicts. The typecheck and test counts were
measured, not judged.**

- **The count is 52**, as the write-up says. In `run2OnlyNew`, 52 rows name
  only the outcome law, 20 name both new laws, and 1 (350) names only
  "lands".
- **Real, 49:**
  - 31 change what happens next. The operate loop runs another round, or
    asks, or stops, or ends differently. Or ship sends a write it should
    not send, or never ends.
  - 18 change only the reason. The loop would end `stuck:ship` either way,
    but the reason a person reads is wrong or missing. They count as real,
    because the reason is the whole point of a stuck answer.
- **Harmless, 0.** Even mutant 36 counts as real. It edits a field no code
  reads: the tidy-up word of a pull request that was already merged. But the
  operate loop checks ship's answer against `ShipOutcome` (`loop_ship`'s
  `ok` is `ShipEnd`), and tea turns an answer that does not fit into
  `loop_ship_err`. The loop then ends `stuck:ship`, "the ship stage could
  not be run", and not `done`. A scratch check with `Schema.is(ShipEnd)`
  refused each of the 8 broken shapes tried, and took the real ones.
- **Unsure, 3:** 136 and 138 change the gate's order. 485 needs a late
  answer that may never come.
- **Every one is caught before any property test runs:**
  - `pnpm typecheck` refuses 42 of the 52 edits. Each one puts in a word
    the outcome type does not have, or `{}` where an outcome goes, or a
    comparison with `""` that can never be true. 121's Stryker config set
    no type checker, so these 42 were run and counted.
  - Ship's example tests (`gate.test.ts`, `machine.test.ts`) fail on 50 of
    the 52. They miss only 511 and 512, and the typecheck refuses both.
  - 10 edits pass the typecheck: 16, 29, 122, 136, 146, 147, 273, 381, 440
    and 485. The example tests catch all 10.
- **So run 2's "73 more" means more than the other property-test laws, not
  more than the repo's own checks.** That holds for the outcome law's 52.
  Nobody checked the other 21 this way.
- **What it suggests:** before a property-test catch counts as new, run
  Stryker with its TypeScript checker, and with the files' own tests in the
  command. Why: here they took away all 52 lone catches. Cost: the checker
  typechecks every mutant, so the Stryker passes get slower; the two test
  files take under a second. 80% sure. The doubt: the checker plugin was
  not tried here. One Stryker pass with it on this sample would settle it.

How it was checked:

- Each edit was put in by hand, at the file and line the results file
  gives.
- Then `pnpm --filter @kampus/pipeline typecheck` ran, and `vitest run` on
  the two test files.
- Then the file was put back byte for byte.
- A throwaway script ran this loop. About 5 minutes in all, no model, $0,
  no Stryker.

### The 52, one by one

Mutants on one line with the same effect share a row. "The loop" is the
operate loop (`stages/operate/`). It runs ship, reads its answer and picks
the next step.

| Mutant | Edit | Verdict | Why |
|---|---|---|---|
| 16 | gate.ts:31, `notMet` always true | real | Any refusal counts as a failed row. A passed pull request whose checks are still running goes back to the builder as "review failed". |
| 29, 34 | gate.ts:34, `other_head` or `old_version` not counted as owed a review | real | A new head, or reworded criteria, never goes to the reviewer. Unless something else stops it first, the run ends `stuck:proof_refused`. |
| 36 | gate.ts:41, tidy-up `"not_run"` made `""` | real | An already merged pull request's answer no longer fits. The loop ends stuck, not done. |
| 39, 41 | gate.ts:51, missing approval's `ask` or `approval` made `""` | real | The owner is never asked. The loop ends stuck. |
| 42, 43, 44 | gate.ts:52, `stuck:approval_unknown` made `{}`, or a word made `""` | real, reason only | The loop ends `stuck:ship` either way. The reason becomes "could not be run". |
| 52, 53 | gate.ts:60, `stuck:checks_stuck` made `{}` or `""` | real, reason only | The same. |
| 69 | gate.ts:79, the merged check made false | real | An already merged pull request ends `skip:merged`, a word ship does not have. The loop ends stuck, not done. |
| 76, 82, 83 | gate.ts:80-81, a skip made `{}`, or a word made `""` | real, reason only | The loop ends stuck on a skip anyway. Only the reason is lost. |
| 90, 99 | gate.ts:82-83, a send to the builder with a word made `""` | real | The loop cannot read it and stops. The builder gets no round. |
| 106, 107, 131, 132 | gate.ts:84 and 88, `send:reviewer:no_review` made `{}`, or a word made `""` | real | The loop stops. It should ask the owner, its answer to a send to the reviewer. |
| 112, 113, 118, 120 | gate.ts:85-86, `reviews_unknown` or `criteria_unknown` made `{}` or `""` | real, reason only | Stuck either way. The reason is lost. |
| 122 | gate.ts:87, the failed-row check made false | real | A criterion whose row failed ends `stuck:proof_refused`. The builder never hears of it. |
| 124 | gate.ts:87, that send to the builder made `{}` | real | The loop stops. The builder gets no round. |
| 136, 138 | gate.ts:89, the red-checks line skipped | unsure | Red checks now come after comments and approval. With red checks and an open comment, ship asks the commenter and does not run the checks again. Both answers are true. Settling the gate's order decides it: its header says the order is not settled, and `gate.test.ts` pins today's. |
| 146, 150 | gate.ts:90, a person's comment never seen as one | real | A person's comment goes to the builder as a bot's. The person is never asked. |
| 147 | gate.ts:90, every comment seen as a person's | real | A bot's comment stops the run for a person. The builder gets no round. |
| 159, 162 | gate.ts:92, `send:builder:bot_comment` made `{}` or `""` | real | The loop stops. The builder gets no round. |
| 173 | gate.ts:97, the checks table's stop made false | real, reason only | Stuck checks end `stuck:proof_refused` or `merge_unknown`. Still stuck, with the wrong reason. |
| 273 | machine.ts:240, the move cap always reached | real | The first time the head moves under the enqueue, the run stops `stuck:head_moving`. It should read again. |
| 378 | machine.ts:320, red checks always end the run | real | Red checks are never run again. A flaky check costs a builder round. |
| 381 | machine.ts:320, every stop taken for red checks | real | Every stop runs the checks again first. Closed, merged, draft and others' pull requests get a write, and a failed re-run turns the answer into `checks_red`. |
| 395 | machine.ts:332, a read error never seen in `reading` | real | A failed read is ignored. The run sits in `reading` with nothing in flight and never ends. |
| 398, 400 | machine.ts:332, `stuck:read_failed` made `{}` or `""` | real, reason only | Stuck either way. The reason is lost. |
| 440 | machine.ts:347, the clock's wait number check flipped | real | The current wait's clock is ignored. Checks that never settle hold the run forever. |
| 463, 464 | machine.ts:361, a conflict at the enqueue, a word made `""` | real | The loop stops. The builder gets no round. |
| 485 | machine.ts:377, an enqueue error taken from any enqueue | unsure | A late error from an older enqueue stops a good run `stuck:enqueue_failed`. It is real only if a host can deliver such a late answer. The machine's comment and its test say a Cmd sent twice answers twice. One such answer in a field log would decide it. |
| 487, 488 | machine.ts:378, `stuck:enqueue_failed` made `{}` or `""` | real, reason only | Stuck either way. The reason is lost. |
| 503, 504 | machine.ts:387, a conflict at the merge made `{}` or `""` | real | The loop stops. The builder gets no round. |
| 511, 512 | machine.ts:390, `send:builder:behind` with a word made `""` | real | No merge queue, and main moved on: the loop stops. The builder gets no round. 119's desk world caught 511. |
| 553 | machine.ts:411, `stuck:queue_silent` made `{}` | real, reason only | Stuck either way. The reason is lost. |

**Laws that should have caught one, and did not:**

- **395 and 440:** 119's "every lane ends". Its worlds never fail a read,
  and their checks always settle, so no world builds a run that hangs on
  either.
- **273:** "a ready pull request lands". Its built path never moves the
  head, so it never sees a cap reached at the first move.
- **90 and 463:** probably 119's desk-world law "a lane that stops to ask
  the owner leaves an ask". It caught 511, whose broken `to` takes the same
  path through the loop. But 119's worlds never answer with conflicts.
- **Gaps that no law covers,** so no law missed them:
  - **381:** today's laws watch only the enqueue and the merge (`writes`).
    A re-run of the checks is a write too, and no law says when it may go
    out.
  - **146 and 150:** no law says that a person's comment goes to a person.

### How much the outcome law copies the gate

**The short answer:** about 85% of the law's rules say what the gate and
the machine say, in the same shape and the same order. About 15% state a
claim of the law's own. Against a slip in the code, such as one small
Stryker edit, the law is a fresh copy, and that is why it caught all 52.
Against a mistake in the rule itself, 85% of the law would agree with the
gate.

```ts
// Each statement joined onto one line; otherwise as written.
// The same lines in the same order. gate.ts:89-92:
if (f.checks === "red") return stop({kind: "send", to: "builder", why: "checks_red"});
if (f.comments.some((c) => c.by === "person")) return stop({kind: "ask", who: "commenter", for: "comment"});
if (f.comments.length > 0) return stop({kind: "send", to: "builder", why: "bot_comment"});
// ship-pbt.ts:556-559, readCalls:
if (f.checks === "red") return s.rerunFor === f.head ? send("checks_red") : "on";
if (f.comments.some((c) => c.by === "person")) return {kind: "ask", who: "commenter", for: "comment"};
if (f.comments.length > 0) return send("bot_comment");

// Stated another way. gate.ts:87-88 and 100-102, through ReadyToMerge's four refusal kinds:
if (refused.some(notMet)) return stop({kind: "send", to: "builder", why: "review_failed"});
if (refused.some(unjudged)) return stop({kind: "send", to: "reviewer", why: "no_review"});
return "ready" in readiness ? {answer: "go", ready: readiness.ready, landing: landingOf(f)} : stop({kind: "stuck", why: "proof_refused"});
// ship-pbt.ts:553-555 and 565: its own latest row per criterion, two cases, and no fallback.
const rows = latest(f, f.criteria);
if (rows.some((r) => r?.grade === "fail")) return send("review_failed");
if (rows.some((r) => r === null)) return {kind: "send", to: "reviewer", why: "no_review"};
return {go: landingOf(f)};
```

- **Same rule, same shape: 33 of 39 rules.**
  - `readCalls`: 16 of its 19 lines are the gate's lines, in the gate's
    order. Two of them, red and pending checks, also fold in a rule from
    the machine: run red checks again once per head (machine.ts:320), and
    the wait limit. The three review lines write `reviewsOf` out inline and
    check for no reviews first, with the same result. The gate's header
    calls this order "a design choice still to be checked against real
    tickets". If the order is wrong, the law is wrong the same way.
  - `landingOf` is the gate's `landingOf`, character for character. `done`
    is `outcome.ts`'s `landed`.
  - `calls`: all 15 of its rules for the other phases are the machine's
    handlers, typed again. They use the same phase checks, the same
    `intent` match, the same stuck word for each failed Cmd, and the same
    table for the enqueue and merge answers. `movedCalls` is `moved`.
  - The rule that a step the law has no answer for must not end the run
    follows the machine's `stay` cases one by one.
  - Shared code, not copies: `MAX_WAITS`, `MAX_MOVES` and `nameOf` come
    from the machine's own modules. A change there moves both sides.
- **The law's own claims: 6 of 39 rules.**
  - The criteria rows, in two rules. A fail goes to the builder. No row at
    this head, on these words, goes to the reviewer. The gate does this
    through `ReadyToMerge.of`'s four refusal kinds and its `notMet` and
    `unjudged` helpers.
  - Every line clear means go. The law has no `proof_refused` fallback, so
    a gate that falls through to it breaks the law.
  - Three rules across steps: an ended run never changes; the tidy-up
    comes only after something landed; and the `done` names the commit
    that the landing Msg named.
- **What the 52 show about this:** each of them is one small edit to code
  the law does not share. A plain copy of the gate and the machine, typed
  again, would catch them too. So the 52 show that the law does not share
  the gate's code. They do not test the 15% of the law that says something
  of its own.

### What this check cannot tell us

- **One agent judged all 52.** It is the same kind of agent that wrote the
  law and ran the count. No second reader checked the verdicts without
  seeing them first.
- **"Real" is judged against today's callers,** the operate loop and the
  ship program, and not against real tickets. The 18 "reason only" verdicts
  assume that a person reads the reason.
- **The typecheck and the tests ran by hand,** one edit at a time, and only
  on the two test files next to the code. This was not a Stryker run with
  those tests. Other test files might catch 511 and 512 too.
- **A refused edit is only that edit.** The same mistake written another
  way may pass the typecheck. For 173, 378 and 395 the typecheck fails on
  how TypeScript narrows a type, not because a type holds the rule.
- **Only the 52.** Nobody checked the 20 that both new laws caught, or 350,
  or the 32 still missed.
- **Whether a case can happen is read from the code.** Nobody knows if a
  host ever delivers a late answer to an older enqueue (485), or an old
  wait's clock (the other half of 440).
- **The 85% is a count of rules, made by hand.** Counted by lines, the law's
  own share is larger: its three rules across steps take many lines.
