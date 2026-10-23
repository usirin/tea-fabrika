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
