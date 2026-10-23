# 120. Property tests from the schemas alone: do they catch what 119's walks caught?

The question: 119's property walks on ship used a hand-written world (which
answers each Cmd may get) and our own walker (`walk.ts`, `sample.ts`). Can the
same tests be written with only Effect 4's own `Arbitrary`, drawing every
message from a schema the code already has, and still catch the same mutants?
This is Elm's answer too: a fuzzer per message type and a fold over `update`.

**Answer: mostly yes, and it caught more. On a fixed sample of 150 of 119's
569 ship mutants, arm C killed 47 and 119's arm B 36. 32 both, 4 only B, 15
only C, 99 neither. Confidence 70%.** The run was cut to this sample for cost
and noise (see below), so every count here is on the same 150 ids in both.

- **Only B (4):** all four need 119's lane worlds. Each makes a run stop
  answering or end with a wrong reason. Arm C has only ship's own laws, and
  none says "a run ends".
- **Only C (15):** three kinds.
  - **8 by "never sent":** the mutant removes a whole path (enqueue, merge and
    finish, or the checks rerun). One is 119's hand-checked mutant 46: a green
    pull request never lands, which no law covers.
  - **4 by a law, in the gate:** a read that is ready but for one field (merge
    conflicts, reviews unknown, mergeable unknown) is let through. The schema
    draws that read; 119's hand-written world never did.
  - **3 where the mutant edits a Cmd's own schema:** arm C draws its answers
    from that schema, so the handler gets a value it does not take.
- **Without the never-sent check:** 27 both, 9 only B, 7 only C, 107 neither.
  It never fired on the real code.
- **119's three narrow mutants (502, 515, 516):** caught on all 5 seeds each.
  119's B caught them on 3, 4 and 4 seeds.
- **Lines:** arm C is 244 lines. B's ship part was 328 (the ship world 173,
  the walker 106, `sample.ts` 49), plus 1,313 for the lane worlds and their
  walker.
- **Steering was needed.** 68 lines narrow ids, lean each read toward ready,
  and start a new run when one ends. With none, 8 of 16 Msg types were never
  sent.
- **A surprise:** the real code breaks a law on a read the schema allows (one
  criterion twice). See below.

```ts
// The whole idea, as a sketch of experiments/120-schema-property-tests.ts (Effect 4.0.6).
// An event is an outside Msg, drawn from a schema of ship's Msg type, or an answer.
// An answer holds one value per Cmd, each drawn from that Cmd's own ok/err schema.
const ANSWER = Arbitrary.all({
	pick: Arbitrary.schema(CHOICE), // which waiting Cmd it answers
	fails: FAILED,                  // ok or err
	...Object.fromEntries(ship.cmds.map((d) => [d.cmdType, Arbitrary.schema(d.schema.ok)])),
	...Object.fromEntries(ship.cmds.map((d) => [d.errType, Arbitrary.schema(ErrOf(d))])),
});
const EVENTS = Arbitrary.array(Arbitrary.flatMap(COIN, (o) => (o ? OUTSIDE : ANSWER)), {minLength: 60, maxLength: 60});

// The fold: the real reducer, and each law of laws/ship.ts after every step.
// An answer goes only to a Cmd that was sent and is still waiting:
const i = e.pick % waiting.length;
const msg = e.fails ? d.err(waiting[i], e[d.errType]) : d.ok(waiting[i], e[d.cmdType]);
const [next, cmds] = update(s, msg); // a throw is the law "update throws"
waiting = [...waiting.without(i), ...cmds];

// Hughes's rule: count each Msg type sent. A seed that never sent one fails.
const never = Object.keys(ship.update).filter((t) => !sent.has(t));
```

## Who did what

- **Not changed:** every law, plant, machine, world and checker. `ship`,
  `laws/ship.ts`, `explore.ts`, `walk.ts` and `sample.ts` run as they are.
- **New:** `experiments/120-schema-property-tests.ts` (arm C, the plants, the
  Stryker run, the report) and `results/120-schema-property-tests.json` (every
  mutant, arm C next to 119's arms A and B).
- **Reused:** 119's Stryker setup. Stryker 9.6.1, installed in 119 into a
  scratch folder outside the repo and called by path. The `command` runner,
  `inPlace`, 8 mutants at a time. No network this time: the install was
  already there.
- **Effect 4.0.6** (`effect` in the catalog, after the move in PR 41).
- No model, no key. $0.

## How it was done

- **Arm C, one property per seed:**
  - Outside Msgs come from a schema of ship's `ShipMsg` type, written in the
    script (19 lines). `machine.ts` has only the type. Two one-line functions
    fail to compile if the schema and the type drift apart.
  - Answers come from each Cmd's own schemas, read off `ship.cmds`: tea keeps
    the Effect schema it was given behind `schema.ok`, so
    `Arbitrary.schema(d.schema.ok)` works with no cast. Errors come from
    `errTags`.
  - The resolver (14 lines): a drawn `pick` names one Cmd among those sent and
    not answered yet. No Cmd waiting: the answer is thrown away. `resume`
    empties the list, since a restart loses what was in flight.
  - The laws: the 5 of `laws/ship.ts`, plus "update throws" (a throw, or a
    handler that returns nothing).
  - **Never sent:** each seed counts every Msg type it sent. A seed that ends
    its budget with a type never sent fails, as Hughes asks.
  - The same budget as 119's arm B: 5 seeds of 10 s, a seed counts as "short"
    when it caught within 1 s. Walks of 60 events, `size` 6.
- **Search and shrink are split.** `checkEffect` builds a shrink tree for
  every input it draws. That made one walk cost 60 ms, against 6 ms to draw it
  with `sampleEffect` and 0.2 ms to fold it. So the search draws with
  `sampleEffect`, one input per seed string. When an input breaks a law,
  `checkEffect` draws it again from the same string and shrinks it. It drew the
  same failing input every time: 53 of 53 caught seeds in the plants, 155 of
  155 in the mutant run.
- **The run was cut.** It started on all 569 mutants. After 85 of them it was
  stopped, for cost (about an hour more at 8 mutants at a time) and fan noise.
  It then ran on a fixed sample of 150 of 119's ids, drawn with seed 119120 by
  a seeded shuffle: 36 "both" and 114 "neither" in 119. Plus 502 and 516,
  reported on their own. 25 sample rows from the stopped run were kept, not run
  again. The rest ran under `nice -n 15`. Every other mutant exited at once
  and is not counted.
- **A mutant is killed** when a seed breaks a law or a seed never sends some
  Msg type. A crash of the whole arm (the module does not load) also counts,
  as in 119.

### What had to be steered

Drawn straight from the schemas, the read never says "go". The gate wants
about ten fields to hold their one good value at once (state open, ours,
mergeable clean, reviews passed, a verdict row on each criterion at its version
at this head, checks green, no comments, approval). Unsteered, 8 Msg types
were never sent: every answer after the gate (enqueue, merge, finish, rerun).

| Field | Steering | Why |
|---|---|---|
| `pr` | the one pull request `P` | Every message is about one pull request; a drawn string never matches. |
| `head` | `A` or `B` | A read, a check, a queue message must name the same head to count. |
| criterion ids, versions | `c1`/`c2`, `1`/`2`; ids by place | A verdict row counts only on its criterion's id and version. Ids by place: see the surprise below. |
| each field of a read | the ready read's value, but one time in 4 | Ten fields at once. Each field still takes any value of its schema one time in 4. |
| ok or error | an error one time in 4, not 1 in 2 | Most errors end the run at once. |
| walk length | always 60, with `size` 6 | Effect's `size` caps both a list's length and every value in it. A read at size 60 costs 0.14 ms; at size 6, 7 µs. |
| a run that ended | 4 events after the end, a new run starts in the same walk | Most runs end within a few messages; the rest of the walk was drawn for nothing. |

- 63 lines in the script's steering part, plus 5 in the fold for the new
  run: 68 in all. The ready read alone is 23 of them, one field a line.
  Nothing else was narrowed: `wait`, `commit`, the text of a
  criterion, the comments and every answer but the read are drawn as their
  schemas say.
- The steering was set by looking at what the real code reached (the gate's
  answers, the Msg types sent). It was not tuned on any mutant.
- What it bought, on the real code, one seed of 10 s, quiet machine:

  | | No steering (`size` 60) | Steered (`size` 6) |
  |---|---|---|
  | Walks in 10 s | 469 | 1,763 |
  | Runs ended | 1,603 | 11,184 |
  | Msg types never sent | 8 of 16 (every answer after the gate) | 0 |
  | Answers to enqueue, merge, finish, rerun | 0, 0, 0, 0 | 855, 105, 64, 121 |

- **Where a walk's time goes** (`size` 6, 60 events): drawing it 5.6 ms,
  folding it with the laws 0.3 ms, `checkEffect` 54.5 ms. An answer draws a
  value for every Cmd, the read included, since what waits is known only in
  the fold.

### The planted-break check

Before the mutant run: 119's three narrow mutants, two of its clean "both"
ones, and the six planted mistakes of `laws/ship.ts`, each written as a plant
around the real reducer. Then the real code.

| Plant | Seeds within 1 s | Within 10 s | First catch |
|---|---|---|---|
| 502, merge `"conflicts"` falls through | 3 | 5 | update throws, 0.9 s |
| 515, merge `"stale"` falls through | 5 | 5 | update throws, 0.3 s |
| 516, the merge error handler returns nothing | 5 | 5 | update throws, 20 ms |
| 93, a failed review is let through | 4 | 5 | merge only when ready, 0.5 s |
| 540, ejected is taken as landed | 5 | 5 | only the sent head lands, 50 ms |
| `forgetsMissingReview` | 4 | 5 | merge only when ready, 1.9 s |
| `skipsTheRead` | 5 | 5 | merge only when ready, 70 ms |
| `takesAnOldVersion` | 5 | 5 | merge only when ready, 25 ms |
| `keepsAnOldPass` | 0 | 3 | merge only when ready, 5.5 s |
| `landsAnyHead` | 5 | 5 | only the sent head lands, 0.5 s |
| `actsAfterTheEnd` | 5 | 5 | an ended run sends nothing, 5 ms |
| **the real code** | 0 | 0 | none; every Msg type sent on all 5 seeds |

- `keepsAnOldPass` is the weak one: it needs two reads in one run, the
  first with reviews passed, the second at the other head with reviews not
  passed and the rest ready. A second read comes only after a wait or a moved
  head. 3 of 5 seeds.
- 119's write-up places 502 in the enqueue answer. Line 386 is in the merge
  answer, and the plant is written there.

## What came back

On the 150 sample ids, against 119's B (plain walks) on the same ids:

| | Mutants | In 119: both, neither | Both | Only B | Only C | Neither |
|---|---|---|---|---|---|---|
| `gate.ts` | 61 | 8, 53 | 8 | 0 | 11 | 42 |
| `machine.ts` | 89 | 28, 61 | 24 | 4 | 4 | 57 |
| **sample** | **150** | **36, 114** | **32** | **4** | **15** | **99** |
| without never sent | 150 | | 27 | 9 | 7 | 107 |

- Every id matched 119's mutant: the same line, mutator and edit (150 of 150).
- **How arm C killed its 47:** a law 29 (23 of them "update throws"), never
  sent 13, its own fold crashed 3, the module did not load 2.
- **Only B, all four:** 119's arm A caught them in a lane world only.

  | Mutant | Edit | What it does |
  |---|---|---|
  | 456, `machine.ts:357` | the queued state made `{}` | A queued run is left in no phase and never ends. |
  | 491, `machine.ts:382` | the merge answer's guard made `true` | Every merge answer is ignored; the run waits for good. |
  | 511, `machine.ts:390` | `"behind"` made `""` | A wrong outcome reason. |
  | 559, `machine.ts:415` | `"finishing"` check made `!==` | The finish answer is ignored; the run waits for good. |

  Ship's laws say what must never be written. None says a run ends or which
  reason it gives. Every Msg type is still sent here, only ignored, so the
  never-sent check does not see it either.
- **Only C, 15:**
  - never sent (8): 16, 92, 108, 135, 168, 175 and 378 make the enqueue path
    or the checks rerun unreachable; 46 (green checks `"on"` made `""`) means
    a ready pull request never lands. 119's hand check named 46 as a change
    no law covers. Each list of never-sent types is a whole path (enqueue,
    merge and finish together, or both rerun answers), never one rare type.
  - a law (4): 87 (`"conflicts"` made `""`), 110 (`reviews === "unknown"`
    made `!==`), 178 and 179 (`mergeable === "unknown"`): the gate lets
    through a read with merge conflicts, unread reviews or an unknown
    mergeable. "Merge only when the last read shows it ready" breaks within
    0.2 s on every seed. 119's world held a handful of hand-picked reads; none
    was ready but for one of these fields.
  - a Cmd's schema (3): 199 and 208 make one of enqueue's or merge's answer
    words `""`. Arm C draws `""` from the mutated schema; the handler has no
    case for it and returns nothing: "update throws". 204 makes the merge
    answer a union of nothing. The module still loads, but Effect cannot draw
    from it ("Unable to derive an arbitrary for a union with no members"), so
    the script fails at load. That counts as a kill the way a crash does. It
    is the weakest of the 15, though a merge with no possible answer is broken.
- **Both, 32:** where a law caught it, 20 of 23 on all 5 seeds within 1 s,
  23 of 23 within 10 s. Shrunk runs: median 8 messages, longest 26.
- **119's three narrow mutants**, outside the sample's counts (515 is also in
  the sample):

  | Mutant | 119 B: seeds within 1 s, 10 s | C: within 1 s, 10 s | C's first catch |
  |---|---|---|---|
  | 502 | 1, 3 | 2, 5 | 1.1 s, 159 walks |
  | 515 | 1, 4 | 5, 5 | 0.4 s, 48 walks |
  | 516 | 2, 4 | 5, 5 | 49 ms, 4 walks |

### Time and walks

| Per mutant, median | 119 B (plain, then swarm) | C (plain only) |
|---|---|---|
| Caught | 0.9 s, first catch 0.1 s | 3.6 s, first catch 48 ms |
| Not caught | 101 s | 50 s |
| All 150, added up | 194 min | 99 min |

- C's "not caught" is its 5 seeds of 10 s and nothing more. B ran the same
  plain walks, then as many swarm walks.
- C's "caught" is longer: arm C runs all 5 seeds even after one catches, and
  a seed that misses spends its full 10 s.
- **C draws far fewer walks.** Under load, a seed that missed walked 1,512
  times (median; 1,272 to 1,823). B's plain walk did 18,300. C catches more
  with a twelfth of the walks: an answer always goes to a waiting Cmd, a run
  starts again when it ends, and a drawn read is near the gate's edge.
- Wall time: 8 minutes for the stopped run's first 85 mutants, 12 for the
  sample run, both 8 mutants at a time on a 12-core laptop.

### Lines

| Part | Arm C | 119's B for ship |
|---|---|---|
| Msg schema / the ship world (facts, answers) | 19 | 173 |
| Steering | 63 (plus 5 in the fold) | (in the world) |
| Generator, resolver | 33 + 14 | |
| Fold with laws, reach counts / the walker (`walk.ts`, one machine) | 69 | 106 |
| Seed loop / `sample.ts` | 46 | 49 |
| **Ship alone** | **244** | **328** |
| Lane worlds and their walker | none | 1,313 |

- Code lines only, no comments or blank lines, counted by the script. Both
  sides are counted as `pnpm format` leaves them (tabs, 100 columns), so a
  long object counts one line per field on both.
- Of arm C's 244, only the Msg schema and the steering (82) are about ship.
  The other 162 would serve any machine with a few changes (`fold` names
  ship's laws and its `show`).

## The surprise: the schema lets a read hold one criterion twice

Before the steering gave criteria their ids by place, the real code failed
on its first seed, shrunk to two messages. The run printed the verdict rows,
not the criteria; the criteria below are read back from the law's message.

```ts
// start, then one read (ShipFacts, as the schema allows it):
criteria: [{id: "c2", version: 1, text: "…"}, {id: "c2", version: 1, text: "other words"}],
verdicts: [{id: "v1", criterion: "c2", version: 1, head: "A", grade: "pass", proof: ""}],
// The gate says go: ReadyToMerge.of finds a passing row for each criterion (the same row).
// The law "a merge carries a passing row per criterion, on its current version, at its head":
//   ship_enqueue: its proof does not hold c2 as v1
// It finds the first c2 in the proof by id, and its words are not the second one's.
```

- **Which side is wrong:** neither the gate nor the law is. The criteria book
  gives each id once ("the next id is `c<next>`, so no id is given twice"),
  but `ShipFacts.criteria` and `Proof.criteria` are lists with no rule on
  ids, so the type allows a read the ledger can never send.
- **What would settle it:** make the state unrepresentable. A check on
  `ShipFacts.criteria` that ids are unique, so a read like this fails to
  decode. Not done here: this experiment changes no machine or schema.
- 119's hand-written world could never show this: its two criteria were
  written by hand, once each.
- Arm C's own fold has the gap 119 found in `explore.ts`: a handler that
  returns `[]` gives a `next` of `undefined`, and the fold reads `next.phase`
  outside its `try`. Three mutants (217, 299, 458) crashed it instead of
  breaking "update throws". They count as kills, as crashes did in 119.

## How the resolver maps onto tea/pbt

`@demlik/tea` 0.21.0 ships `@demlik/tea/pbt`, built on fast-check. Arm C stays
on Effect's `Arbitrary`, since Effect 4 has its own and no fast-check inside.

- **`arbGuidedSequence` is the same idea at draw time.** It is declared, and
  it throws ("not implemented in v1"). Its cells are one function per Msg
  type: `(state) => Arbitrary<Msg> | null`. For ship, the cell for a merge
  answer would read:

  ```ts
  // A sketch: the guided cell arm C's resolver stands in for.
  ship_merge_ok: (s) => (s.phase === "merging" ? Arbitrary.map(okOf(merge), (v) => merge.ok(s.asked, v)) : null),
  ```

- **The resolver moves that choice to fold time.** It draws the choice blind
  (`pick`) and lets the fold say what it means in this state. Two things
  follow:
  - **It works for any machine.** A cell needs the Cmds still waiting. Ship
    keeps them in its state (`asked`), but tea does not ask a machine to: the
    runtime holds them. So a generic set of answer cells needs
    `(state, waiting)`, not `(state)`.
  - **It should shrink better (not measured).** A guided sequence over
    Effect's `Arbitrary` is a chain of `flatMap`s, one per step. When a shrink
    changes an early step, Effect draws the rest of the chain again. The blind
    picks keep the later draws, though what they mean can shift.
- **What arm C needed that tea/pbt has:**
  - a table of one arbitrary per Msg type, checked by the compiler
    (`MsgArbitraryTable`); arm C's `fits` and `covers` do this for a Union
    schema;
  - weights per Msg type (`arbMsg`); arm C used coins and "one time in N"
    instead;
  - the fold and its step (`foldEvents`, `Step` with `prev`, `msg`, `next`,
    `cmds`, the same shape as our laws' `Step`), and `propertyInvariant`;
  - the alphabet (`msgTypeKeys`), which the never-sent check needs;
  - a fixed first Msg (`arbMsgSequence`'s `prefix`), like arm C's `start` on
    a new run.
- **What it lacks:**
  - answers drawn from a Cmd's own schemas. tea/pbt takes fast-check
    arbitraries, so each answer is written by hand, while the Cmd's `ok`
    schema is right there;
  - answers only for a Cmd that was sent: the resolver;
  - the never-sent check: `msgTypeKeys` gives the alphabet, nothing counts;
  - a schema for the outside Msgs. A machine has only a type, so arm C wrote
    one (19 lines).

## Recommendation

**Write a machine's property tests the arm C way: answers from the Cmds' own
schemas, a schema for the outside Msgs, the resolver, the never-sent check.
Keep a world only for laws that need one, until a machine has a "run ends"
law of its own.** Confidence 70%.

- **Why:** on the same 150 ids, C killed 47 and B 36, with three quarters of
  the lines for ship (244 against 328) and none of the 1,313 for lane worlds. What B caught and C missed (4) all need a liveness or outcome law,
  not a better search. What C caught and B missed (15) came from the schemas
  (reads B's world never held, answer words B never sent) and from the
  never-sent check.
- **What it costs:**
  - a Msg schema beside each machine's Msg type (19 lines for ship);
  - steering written per machine, by someone who reads the gate (68 lines
    here), and measured with reach counts before it is trusted;
  - a walk costs over ten times one of B's: a 10 s seed is about 1,500
    walks under load, against B's 18,300.
- **Next steps, cheap first:**
  - a unique-id check on `ShipFacts.criteria` (the surprise above);
  - catch a handler that returns nothing inside the fold's `try`;
  - add "every run ends" and a "took" count (a Msg type sent but never
    changing anything) to the fold. A guess, not measured: the took count
    may catch 491 and 559.
- **What would lift the confidence:** the same on `stages/operate/` and
  `stages/review/` mutants, with their steering written before the run.

Doubt: arm C was built and steered by the same hand that judged it, on one
machine with a small Msg type. A larger machine may need much more steering,
and the steering is ship knowledge in a new place, much like the world was.

## What it cannot tell us

- **A sample, not all of ship.** 150 of 569 mutants, plus two named ones.
  The draw was fixed before the run (seed 119120), and both arms are compared
  on the same ids only. 25 rows came from the stopped full run, at the same
  settings but not under `nice`.
- **One machine, its own laws.** B also had 9 lane worlds. C had none, so
  the 4 "only B" are the price of leaving them out, not of the search.
- **Steering is a choice.** It was set from the real code's reach, before any
  mutant ran, and never changed after. Another person would write other
  steering and get other counts.
- **Never sent says a path vanished, not that it is wrong.** All 13 here are
  real changes (each removes the enqueue, merge and finish path or the
  rerun). A mutant that only makes a path rarer would pass it.
- **Mutants inside a Cmd's schema** change both the code and what C draws.
  That is the point of arm C, but 3 of the 15 "only C" come from it, and one
  (204) is a failure to load.
- **Load.** 8 mutants at a time; a seed walked about 1,500 times against
  about 1,800 on a quiet machine. The real code reached every Msg type on
  every seed; a mutant seed close to the line could have been counted as
  never sent by bad luck. None was: each never-sent list is a whole path.
- **Shrinking is weak.** The walk length is fixed at 60, so a shrink cannot
  drop messages, only change them. 502's shrunk run still carries two dead
  runs before the one that breaks.
- **One laptop, one run.** Times are wall times.

Cost: $0, no model, no network. About 21 minutes of Stryker (8 for the
stopped run, 12 for the sample, each with a 50 s dry run), 2 minutes of
plants, a few of reach measures.
