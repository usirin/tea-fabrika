# 174. Where should the answer to a Cmd get chosen?

**The answer: at fold time. The lean on [demlik#745](https://github.com/kamp-us/demlik/issues/745)
holds, and by far more than a guess: 121 of 124 shrunk lists were the true shortest, against 29 of
130 for a draw-time chain.** One part of that issue has to change, though: a cell cannot look at the
state and still shrink its value. On
[demlik#749](https://github.com/kamp-us/demlik/issues/749), Effect's own generator shrinks a guided
list just as well, so the Effect flavor is worth having, but without a second set of runners. All of
this is about today's version: ship's machine in `packages/pipeline`, as in experiments 120 and 121.

```ts
// A sketch of the winner. Blind events, drawn before anything runs. The fold gives them meaning.
type Event = {k: "out"; i: number} | {k: "ans"; pick: number; v: readonly number[]};

const lists = fc.array(event, {maxLength: 60, size: "max"}).map((events) => {
	let t = start(machine); // the state, and every Cmd sent and not yet answered
	const msgs: Msg[] = [];
	for (const e of events) {
		const m = e.k === "out" ? outside[e.i] : answerTo(t.waiting, e); // undefined if nothing waits
		if (m === undefined) continue; // dropped: no answer goes out for a Cmd nobody sent
		msgs.push(m);
		t = step(machine, t, m);
	}
	return msgs; // a plain list, so it fits `fc.Arbitrary<readonly M[]>` and tea's runners as they are
});
```

Script: `174-guided-answers.ts`. Results: `results/174-guided-answers.json`, and
`results/174-shrink-closer.json` for the long search on S7. Versions as pinned in the lockfile:
`@demlik/tea` 0.21.0, `effect` 4.0.6, `fast-check` 4.10.2.

## How it was measured

- **15 breaks, each in a copy of a machine, each with a known shortest list.**
  - 7 on ship (S1 to S7). S5 and S7 need a Cmd sent twice, then the older one answered.
  - 2 on 121's "a ready pull request lands", with the merge answer (L1) or the tidy-up answer (L2)
    dropped.
  - 6 on a small machine that keeps no Cmds in its state (N1 to N6). Triage calls that the general
    case. It sends 3 Cmds at once, or 5 in N6, where one order of 120 breaks it.
- **The shortest list is proved, not assumed.** A search tries every list in order of length. All 15
  hand guesses matched it, so none is marked wrong here.
- **The laws.** "The copy does what the real machine does, step by step", looking only at phase,
  outcome and Cmds. L1, L2 and N1 use "a run with nothing waiting has ended", checked only at the end
  of the list, so a tail can hide it.
- **The control.** 45 runs on the real machines gave no false alarms.
- **The same pool for every route,** so only the route differs. This is narrower than 121's `facts`.
- **10 seeds per case and route,** at most 5,000 runs to find the break.

## The numbers

Lists shrunk across all 15 cases, 150 tries per route. "Over" is how many Msgs longer than the true
shortest. "Tried" is the lists run while shrinking, as a median. "Not sent" is shrunk lists holding
an answer to a Cmd never sent.

| Route | Found | At the shortest | Over: median, worst | Tried | Not sent |
|---|---|---|---|---|---|
| U unguided, as 121 | 128 | 107 | 0, +1 | 95 | 27 |
| D1 draw, length first | 132 | 4 | +23, +56 | 12 | 0 |
| D2 draw, stop coin | 130 | 29 | +53, +57 | 401 | 0 |
| D3 draw, no-ops taken out | 100 | 69 | 0, +11 | 409 | 0 |
| **F1 fold, blind pick** | 124 | **121** | **0, +2** | 366 | 0 |
| F2 fold, typed pick | 121 | 119 | 0, +1 | 351 | 0 |
| H drawn guided, shrunk by fold | 130 | 119 | 0, +1 | 38 | 0 |
| C `fc.commands` | 125 | 9 | +1, +3 | 259 | 0 |
| C2 `fc.commands` in a `map` | 125 | 9 | +1, +3 | 259 | 0 |
| EF Effect, fold | 133 | 131 | 0, +2 | 509 | 0 |
| ED Effect, draw | 126 | 4 | +8, +56 | 194 | 0 |

The median shrink took 5.9 ms for F1, 22.8 ms for D2, 0.4 ms for H and 114.7 ms for ED. The slowest
seen were several seconds, on ED. So time does not decide this.

- **Unguided looks fine and is not.** Its 3-long lists on S5 and S7 are shorter than the true
  shortest. They answer a Cmd that was never sent. All 20 of those lists are fake, and so are 7 more
  across S1 and S2. This is why #745 exists.
- **Why draw time is so far off.** A chain cannot delete a step. When a shrink changes an early step,
  the rest is drawn again. So the shrink replaces steps with the first Msg in the pool, `start`,
  which does nothing, and the list stays long. On D2 the median list is 60 long with the break at
  Msg 60. The shrink did not make the failure shorter. It pushed it later.
- **Being kind to draw time helps, and costs a lot.** D3 takes out the Msgs that do nothing. It got
  from 29 to 69, still far behind. It also found 0 of 30 on L1, L2 and N1, since an answer the copy
  drops looks like a Msg that does nothing. Any filter on what a machine ignores can erase the very
  break you are testing for.

## Trying to break "fold time shrinks better"

Experiment 120 said it "should shrink better (not measured)". Now it is measured, and the attempts to
break it failed on length. They found a different weakness.

- **Hard orders did not hurt the shrink.** On N6, every pick but the last is far from 0, so a shrink
  cannot zero them. F1 still reached the shortest on every list it found. On S7, the longest order,
  no route found the break in 5,000 runs. At up to 150,000 runs and a minute per seed, F1 found it
  1 time in 5, F2 and H 2 times in 5, each at the true 7. D2 found it once, 52 Msgs over. `fc.commands`
  did not find it.
- **What did break: the search.** Fold time finds narrow breaks less often. N6: F1 3 of 10, D2 9 of 10,
  H 8 of 10. It is also 94% waste on ship: of the answers F1 draws, that many find nothing waiting (86%
  on the small machine). Yet the lists reach just as deep. On ship, 1.5% of F1's lists reach `finishing`
  against 1% for D2 and 2% for D1. The waste costs draws, which are cheap, not depth.
- **What also broke: the state-aware cell.** See below.
- **F2 did not earn its keep.** The guess was that an answer naming its Cmd type keeps its meaning,
  and so shrinks better. It did not: 119 of 121 against 121 of 124. It finds S5 and N6 more often and
  S2 and S3 less often.

| Ship and the small machine, 1,000 lists | Answers dropped: ship, small | Lists reaching deep: ship, small | Never started: ship, small |
|---|---|---|---|
| D2 draw | 0%, 0% | 1%, 9.3% | 33.6%, 4.3% |
| F1 fold | 94.4%, 85.7% | 1.5%, 11.3% | 50.5%, 6.4% |
| F2 typed | 95.6%, 86.7% | 0.9%, 9.2% | 50.5%, 6.4% |
| H | 0%, 0% | 1.6%, 10.5% | 19.9%, 2.2% |
| C2 `fc.commands` | 94.6%, 85.6% | 1.2%, 10.5% | 47.5%, 5.3% |
| EF Effect, fold | 93.9%, 87.5% | 1%, 10.3% | 44%, 14.7% |

## The part of #745 that has to change

The issue asks for a cell `(state, waiting) => fc.Arbitrary | null`. At fold time, nothing can draw
from an arbitrary that depends on the state. A `map` holds no random source. The only way in is a
seed drawn ahead and a sample made inside the fold, and then a shrink sees only the seed.

Tested with a real value: an id of 3 or more letters breaks the copy. The smallest is 5 Msgs and 3
letters.

| Where the value comes from | Msgs | Id length, median | Lists with a 3-letter id |
|---|---|---|---|
| Fold, value drawn before the fold | 5 | 3 | 10 of 10 |
| Fold, state-aware cell drawn in the fold | 5 | 26 | 0 of 10 |
| Fold, value bridged from Effect | 5 | 11 | 0 of 10 |
| Draw, chain | 57 | 3 | 10 of 10 |
| Effect, fold | 5 | 3 | 10 of 10 |
| Effect, draw | 9 | 3 | 10 of 10 |

So the choice is real. Draw time shrinks the value and not the list. Fold time with a value drawn
ahead shrinks both, but the value cannot see the state.

```ts
// A sketch of the cell that fits. By Cmd type, not by state.
arbGuidedSequence(machine, ctx, {
	outside: {start: arbRecordMsg("start", {pr})},
	answers: {
		// `draw` runs before the fold. `make` runs in it, and sees the Cmd really sent.
		ship_enqueue: {draw: fc.constantFrom("queued", "no_queue"), make: (cmd, v) => enqueue.ok(cmd, v)},
	},
});
```

On ship, no answer needed the state. It only needed the Cmd, which `make` gets. The doubt is another
machine that does need it.

## Does `fc.commands` fit?

It fits, which was a wrong guess of mine.

- **Wrong guess, kept:** its value is its own iterable, not a list, so a `map` is the only way to get a
  list out. I expected a `map` to hide which commands ran. C and C2 came out exactly the same.
- **It is just fold time with a flaw.** A check on each command is the same as dropping an answer when
  nothing waits. Its one edge is that it knows what really ran.
- **The flaw: the last command can never be cut.** Its shrink is
  `fixedStart.concat(items.slice(items.length - (l.value + 1)))` (`fast-check` 4.10.2, the `commands`
  arbitrary), which always keeps at least one item from the end. Only the very first shrink can try the
  empty list. So nearly every list ends one too long: 9 of 125 at the shortest.
- **It costs more to write:** 47 lines and a class, on top of the fold's own `resolve`.

## Effect's own generator

Cheap road, so it was run in full.

- **Fold on Effect is the best route measured.** 133 found, 131 at the shortest. It uses the same
  `resolve` function as F1. Only about 15 lines differ.
- **120's "shrinking is weak" was not about Effect.** It was 120's own shape: walks fixed at 60 long
  cannot drop a Msg, as 120 itself said. A list of any length shrinks fine.
- **Effect's draw beats fast-check's, as its source says it should.** Its `flatMap` keeps the choices
  of the rest when an early step shrinks, where fast-check's `chain` draws them again. Median over: +8
  against +53. It still reached the shortest only 4 times of 126, and takes 1.5 ms a list against 0.1.
  Its stop coin also makes shorter lists than fast-check's, about 8 Msgs against 22.

## Question 749, counted

Comment-free lines of `packages/tea/src/pbt` on demlik's main, which is 0.21.0 and matches the
installed bundle. The two index files that only re-export are left out.

| File | Code lines | Could be shared | Twin |
|---|---|---|---|
| `runners/property.ts` | 113 | 26 (three check bodies, one type) | 87 |
| `runners/replay-fold.ts` | 45 | 45 | 0 |
| `util/msg-keys.ts` | 19 | 19 | 0 |
| `arbitraries/ctx.ts` | 27 | 27 | 0 |
| `arbitraries/sequence.ts` | 40 | 0 | 40, of which 25 are the stub |
| `arbitraries/msg.ts` | 36 | 0 | 36, or replaced by drawing from schemas |
| Total | 280 | 117 | 163 |

- **In the runners, the twin is nearly all wrapping.** Of its 87 lines, 42 are type signatures, 9 are
  wrappers, and 36 are options and the one `fc.assert`. The laws themselves are in the 26.
- **#765 has no code yet,** and no open pull request, so this is a sketch from its children's
  acceptance. Of its 10 new options, 6 are engine-free: a reason from a check (#746), per-type counts
  and failing a never-acted type (#748), a step with no `type`, the strict check and init's Cmds
  (#750). 4 are fast-check's own: `size` (#744), `loaded` as an arbitrary, forwarded parameters, and run
  details (#747). Effect's `checkEffect` already has its own `size` and returns `shrinks` and `runs`,
  so those 4 would not need a twin at all.
- **The fold route shares; the draw route does not.** The 25 or so lines that track what waits and
  give an answer its meaning are engine-free. Only the array and the `map` are twins, about 10 lines.
  A chain is all engine. So the answer to #745 makes #749 cheaper.
- **The subpath stamps.** `packages/tea/MAINTAINING.md` puts `./pbt` and `./effect` as stable, and a
  new experimental subpath needs a row, a line in `src/public-subpaths.test.ts`, a `tsup.config.ts`
  entry and a changeset. One thing more than the issue says: its rule that only `./effect` and
  `./testing/effect` may import `effect` has to be reworded. That is a rule change, not a row.
- **A version catch.** Tea's peer range is `effect ^4.0.0-rc.0`, its dev pin is 4.0.0-rc.117, and this
  repo pins 4.0.6, where `Arbitrary` is on the root and marked unstable. The issue's triage names
  another path for rc.117. So one import path may not hold across the peer range. Only 4.0.6 was run
  here.

## Does a bridge lose shrinking?

Yes, of values, and only of values. A bridge is a fast-check arbitrary that takes its value from
Effect's. The smallest failure here is a name of 3 letters with `n` 0.

| Generator | Name length, median | `n`, median |
|---|---|---|
| fast-check's own | 3 | 0 |
| Effect's own | 3 | 0 |
| Bridge, a seed only | 18 | 536 |
| Bridge, a seed and a size | 3 | 477 |

- **List length does not suffer.** The bridged route in the value test still reached 5 Msgs.
- **Speed is not the issue.** One draw took under 0.12 ms either way.
- **The issue's prediction was right.**

## How others solved it

The tools I read shrink a flat list and check each step again. That is the shrink of fold time.

- **fast-check's own maintainer says so about `chain`.** The docs mark it
  ["Limited shrink"](https://fast-check.dev/docs/core-blocks/arbitraries/combiners/any/). On
  [issue 650](https://github.com/dubzzz/fast-check/issues/650): after a source shrink the rest "has been
  generated from scratch" and "may not shrink towards smaller cases". On
  [issue 424](https://github.com/dubzzz/fast-check/issues/424), our question exactly: a `chain` scenario
  "will provide poor shrinking capabilities contrary to commands". That issue also floats route H.
- **`fc.commands`.** [The docs](https://fast-check.dev/docs/advanced/model-based-testing/): `check(m)`
  says whether a command can run, and the shrinker "takes into account the commands that have really
  been executed".
- **Hypothesis.** Its [2016 article](https://hypothesis.works/articles/compositional-shrinking/) gives
  the idea: one low-level representation under all generation, so that "to shrink _outputs_ it almost
  always suffices to shrink _inputs_". A smaller input can sometimes make a bigger output, which it
  accepts. That is our `pick`. Its
  [stateful page](https://hypothesis.readthedocs.io/en/latest/stateful.html) has preconditions and a
  `Bundle` of earlier values, with `consumes()` for taking one out, much like our waiting list. That page
  does not describe the shrink itself, so I cite only that much.
- **Hedgehog.** [Its state module](https://hackage-content.haskell.org/package/hedgehog-1.7/docs/Hedgehog-Internal-State.html)
  draws knowing the state, then a `Require` callback is "mainly used during shrinking to ensure that it
  is still OK to run a command", and `dropInvalid` "drops invalid actions". That is route H, with the
  drop as a named step.
- **quickcheck-state-machine.** [An article](https://www.iog.io/blog/an-in-depth-look-at-quickcheck-state-machine/):
  it shrinks "by trying to remove commands", and discards a program whose preconditions no longer hold.
  [The docs](https://hackage-content.haskell.org/package/quickcheck-state-machine-0.10.4/docs/Test-StateMachine-Sequential.html)
  call it "pre-condition and scope respecting". The same shrink.

Removing a step from the middle, then checking again, is the one thing a chain cannot do.

## Recommendations

**[demlik#745](https://github.com/kamp-us/demlik/issues/745): fold time, blind pick (F1), with the cell
by Cmd type instead of by state.**

- **Why:** 121 of 124 at the true shortest, worst +2, and no list ever answered a Cmd not sent. It fits
  the declared return type and tea's runners as they are, and needs no `machine.cmds`. A plain array and
  a `map` should hold across the `^3 || ^4` fast-check peer range, though only 4.10.2 was run.
- **What it costs:**
  - About 50 lines in tea, going by this script's 52.
  - Weaker search on narrow orders: 3 of 10 on N6 against 9 of 10. More runs pay for that.
  - The issue's `(state, waiting)` cell and its `null` go. That rewrites an acceptance line.
  - A machine's init Cmds have to be read in the fold, since `foldEvents` hides them (#750).
- **Why not H,** which found more and tried 10 times fewer lists: it subclasses `fc.Arbitrary`, takes 77
  lines, and does not yet shrink values. It is the fallback if a real machine needs state-aware answers.
- **How sure: 90% that fold beats draw on list length. 75% on the whole recommendation.** The doubt is
  the cell: on ship and a toy, nothing needed the state to choose an answer. What would settle it: one
  more real machine whose answer depends on its state, tried with `make`, plus one run on fast-check 3,
  which is tea's dev pin.

**[demlik#749](https://github.com/kamp-us/demlik/issues/749): the Effect flavor, without twin runners.
No bridge.**

```ts
// A sketch. Each law becomes a plain check of a list, and either engine calls it in one line.
const holds = invariant(machine, ctx, law); // (msgs) => boolean | string, in `./pbt`, engine-free

fc.assert(fc.property(guided, holds)); // what `propertyInvariant` already does inside
Arbitrary.checkEffect(guidedEffect, (msgs) => holds(msgs) === true); // the Effect side, in the test

// `./pbt/effect`, experimental: only what truly needs Effect.
const guidedEffect = arbGuidedEffect(machine, ctx, {outside: OutsideSchema}); // answers from Cmd schemas
```

- **Why:** Effect's fold shrinks as well as or better than anything measured, so the fear from 120 is
  gone. Two sets of runners were the doubt, and they are 87 lines of mostly wrapping, which need not
  exist. A bridge loses value shrinking, measured. Leaving it keeps 121's 108 hand lines against 120's 82
  and the 3 mutants 120 alone caught, per those experiments.
- **What it costs:** the 26 lines of check bodies move out and get exported. A new subpath of roughly 40
  to 60 lines, a guess from this script's 30 for two Effect routes, without #765's work. The import rule
  is reworded. #765 should land first, or be built with the checks already split out.
- **How sure: 70%.** The doubts: the shape is a sketch, not built. The Effect path may differ across the
  peer range. And its only user so far is this repo. What would settle it: build the subpath against rc.117
  and 4.0.6, then port ship's laws onto it and rerun 121's 150 mutants.

The experiment also bears on what the direction note
[leaves open](../docs/direction/property-tests-not-our-own-search.md): whether generators stay fast-check
or go to Effect's `Arbitrary`. For guided lists, Effect alone is enough. One run, not a decision.

## What it cannot tell us

- **One real machine and one toy.** Every read comes from a pool of 8. Ship has only one Cmd in flight
  unless `resume` sends one twice, so S5 and S7 are its only true order tests.
- **Planted breaks are mine.** I picked them to need an order, then knew the answer. 119's mutants would be
  a fairer test, and they were not run.
- **The laws here are not the laws you would write.** "Does what the real machine does" always knows the
  right answer and fires at the break. L1, L2 and N1 are the only ones a tail can hide, and they are easy.
- **121's "lands" law was rewritten as a law on a list.** Its `landsWhenReady` scripts a run, and a route
  has nothing to do there.
- **Not run through tea's own runners.** `fc.check` and tea's `foldEvents` were used, because the runners
  return nothing and so give no shrink count. Their inside is the same `fc.property` over the same fold.
- **Versions.** fast-check 4.10.2 and effect 4.0.6 only. Tea's dev pins are fast-check `^3.23.0` and effect
  rc.117.
- **Not built.** H's shrinking of values, the `make` cell in tea, and the Effect subpath. The #765 split is
  a reading of its acceptance, not of code.
- **Ten seeds, at most 5,000 runs.** Search counts on narrow cases are thin: 3 of 10 and 9 of 10 could move.
  Lengths held the same when the run was done twice. Times are one laptop, under `nice`, and moved a lot
  between runs.

Cost: $0. No model, no key, nothing written to demlik. About 25 minutes of one process for the full run,
and 4 more for the long S7 search.
