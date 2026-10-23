# 119. On mutants nobody wrote, does our checker catch any that property tests miss?

The question: experiment 118 measured our two checkers against property tests
on 132 planted bugs. Every plant was kept because our checker caught it, so that
test was tilted. Here StrykerJS, the industry's mutation tool, makes the bugs.
Nobody wrote them for either tool.

**Answer: no. On the ship stage, 569 mutants, our checker caught none that
the property tests missed. 0 "only ours", 0 "only property tests".
Confidence 75%.** The run was stopped after ship. See what was cut, at the end.

- 569 mutants in `stages/ship/machine.ts` (380) and `stages/ship/gate.ts` (189).
- **161 killed by both.** Of these:
  - 87 caught by both in the plain way: a law broke.
  - 69 where our checker crashed and the property test caught a clean "update
    throws". Mutation testing counts a crash as a kill, since the test fails.
  - 5 that stop the module loading at all (a Cmd made into `{}`).
- **0 only ours (arm A). 0 only the property tests (arm B).**
- **408 caught by neither: 72%.** A hand check of 12 found 11 real behaviour
  changes that no law covers. That is the main finding: the laws, not the
  search, are what is thin.
- If a crash does not count as a kill for our checker, the count turns the
  other way: **0 only A, 69 only B.**

```ts
// The whole idea (experiments/119-mutation-testing.ts).
// Stryker builds every mutant into the file at once; an env var turns one on.
// For each mutant, the same checks run twice, at today's bounds:
const a = armA("ship"); // explore(ship, depth 2*MAX_WAITS+20) + world search, depth 200, 9 worlds
const b = armB("ship"); // 118's walks over the same laws and worlds: 5 seeds x 10 s, then swarm

// Mutant 380 (machine.ts:320), `||` made `&&`:
//   nameOf(outcome) !== "send:builder:checks_red" || s.rerunFor === head
//   nameOf(outcome) !== "send:builder:checks_red" && s.rerunFor === head
// Every stop, not just red checks, now runs the checks again. A: holds. B: holds.
// Nothing unsafe lands, so no law breaks: a real change that no law covers.
```

## Who did what

- **Not changed:** every law, plant, checker, bound and world. `explore.ts`,
  `world/search.ts`, `walk.ts` and `sample.ts` are run as they are.
- **New:** `experiments/119-mutation-testing.ts` (the run, both arms, the
  report) and `results/119-mutation-testing.json` (every mutant, both arms).
- **Stryker is not in the workspace.** It was installed once with npm into a
  scratch folder outside the repo (`@stryker-mutator/core@9.6.1`) and called
  by path. That was the only network use.
- Stryker ran with its `command` runner and `inPlace`. Its own test command is
  this script (`mutant ship`), which runs each arm as a child process with a
  time limit (A: 180 s, B: 600 s) and writes one row per mutant under `runs/`.
- No model, no key. $0.

## How it was done

- **Arm A, our checkers, at the bounds today's tests use:**
  - one machine: `explore` on ship's laws, depth `2 * MAX_WAITS + 20` (30),
    the depth at which `laws.test.ts` says the whole space is walked;
  - worlds: `search` at depth 200 on the 9 worlds of `world.test.ts` that run
    the real reducers and must hold (two lanes; no queue; no queue, up to date;
    one ticket; one ticket, may fail; and four desk worlds), with "every lane
    ends" where the test asks for it.
  - Killed when any check fails. About 3 s per mutant.
- **Arm B, 118's property walks on the same laws and worlds:**
  - the whole suite as one property: the first choice picks which law and
    world to walk, the rest is the walk, as in 118;
  - 5 seeds, 10 s each; a seed counts at 1 s when it caught within 1,000 ms;
  - then swarm walks, where the plain walk missed on some seed;
  - where A killed a mutant and B missed on some seed, B again the way 118
    ran it: each check A broke, alone, 10 s a seed, plain and swarm.
  - Killed when any seed of any of these caught it.
- **11 mutants at a time** on a 12-core laptop, 70 minutes for ship.

## What came back

| | Mutants | Both | Only A | Only B | Neither |
|---|---|---|---|---|---|
| `gate.ts` | 189 | 33 | 0 | 0 | 156 |
| `machine.ts` | 380 | 128 | 0 | 0 | 252 |
| **ship** | **569** | **161** | **0** | **0** | **408** |

- **Where both caught it** (87 clean, not counting crashes and load failures):
  - our checker took about 2.9 s for the whole suite (median); B's first
    catch took 107 ms (median), the slowest 4.5 s;
  - over all 156 "both" with a row (crashes too), B caught 137 on all 5
    seeds within 1 s, 153 within 10 s;
  - B shrank to our checker's shortest run on 44 of 87, longer on 43,
    shorter on none. Our search is breadth first, so that fits.
- **Three mutants where B's seeds disagreed**, all in `machine.ts`, all
  caught by our checker as a crash: 502 (`"conflicts"` made `""`, in the
  enqueue answer), 515 (`"stale"` made `""`, in the merge answer), 516 (the
  `ship_merge_err` handler made to return nothing). The plain walk caught them
  on 3 to 4 of 5 seeds within 10 s. Each needs one exact answer to one exact
  Cmd, deep in a world.

### The 69 crashes of our checker

Our checker crashed on 69 mutants. The property test caught all 69, as the
law "update throws". Arm A was run again alone on each, to see where it
threw:

| Where it threw | Mutants | Kind |
|---|---|---|
| `explore.ts:293`, "result is not iterable" | 46 | The mutant makes a handler return nothing. `explore` catches a throw inside `update`, but takes the answer apart outside its `try`. A gap in our checker. |
| `explore.ts:258`, the world's `answers` | 9 | The mutant changes a Cmd's shape, so the law file's world cannot answer it. |
| `laws/ship.ts:247`, `writes` | 10 | The same, in the law that reads the Cmds a step sent. |
| elsewhere, a read of `undefined` | 2 | The same kind. |
| over 180 s | 2 | The world search ran past the limit. |

- All 69 are caused by the mutant. None is a bug in this script.
- In a test run each is still a failed test, so mutation testing counts it as
  killed. But our checker does not say which law broke; it stops. The walk
  says "update throws", with a run.
- 46 of them point at one small gap in `explore.ts`: a reducer that returns
  nothing is not turned into "update throws". Not fixed here, as the rules of
  this experiment say no checker changes.

### The quiet rerun

The timed run had 11 workers at once, and B's budget is wall time. So B ran
fewer walks than on a quiet machine:

- B, the whole suite, plain, on the real code alone: 28,000 to 29,100 walks a
  seed in 10 s.
- B under load, on the 408 it missed: median 18,200 walks a seed, lowest
  4,500.
- Our checker always runs to its bound, whatever the load.

So every "only A" mutant, and every mutant where B's seeds disagreed, was to
be run again alone, one process, with a fixed number of walks: what B gets in
10 s on a quiet machine (suite 28,200, swarm 29,200; each check alone was sized
too, from 8,700 to 168,800).

- There were **no "only A" mutants** to run again.
- The three where B's seeds disagreed (502, 515, 516) were run. **The rerun
  gave no answer for B:** it ran arm A in the same process first, and A
  crashed on all three, which ended the process. So the quiet rerun adds
  nothing here. It does not change the answer: our checker did not catch
  these by a law, and B caught them on most seeds even under load.

| "Only A" | Count |
|---|---|
| Timed, 11 workers at once | 0 |
| Quiet, fixed count of walks | 0 (none to run) |

### Neither: what the laws miss

408 of 569 survive both. A hand check of 12, picked at random with a fixed
seed:

| Mutant | Edit | Harmless? |
|---|---|---|
| 7, `gate.ts:28` | `f.ticket !== "none"` made `true` | Yes. `"none".link` is undefined, so the answer is the same. |
| 46, `gate.ts:57` | green checks: `"on"` made `""` | No. A green pull request never lands. No law says a ready one lands. |
| 71, `gate.ts:79` | `"merged"` made `""` | No. An already merged pull request is told as "skip", not as landed. |
| 73, `gate.ts:80` | `f.state !== "open"` made `false` | No. A closed pull request goes through the gate. |
| 251, `machine.ts:224` | `s.phase === "queued"` made `false` in `revived` | No. A run saved while queued crashes when it is read back. Neither world starts from saved state. |
| 296, `machine.ts:254` | the "checks stuck" outcome made `{}` | No. A wrong outcome. |
| 321, `machine.ts:267` | the checks Listen never opens | No. The run waits for good. Listens are not in either model. |
| 380, `machine.ts:320` | `\|\|` made `&&` | No. Every stop runs the checks again first. |
| 398, `machine.ts:332` | the "read failed" outcome made `{}` | No. A wrong outcome. |
| 400, `machine.ts:332` | `"read_failed"` made `""` | No. A wrong outcome. |
| 525, `machine.ts:399` | the "merge failed" outcome made `{}` | No. A wrong outcome. |
| 552, `machine.ts:410` | a silent queue is never noticed | No. A queued run that hears nothing waits for good. |

- **11 of 12 are real changes that no law covers.** They fall in four kinds:
  - **the outcome is not checked** (296, 398, 400, 525, 71, 380): the laws
    say what must never be written, not which answer a run gives;
  - **no "it lands" law** (46): nothing says a ready pull request is merged;
  - **outside the model** (251, 321): starting from saved state, and the
    Listens, are not in any world;
  - **a liveness gap on one machine** (552, 73): the ship world sends these
    messages, but nothing says the run must end or must refuse.
- This holds for both arms the same way. A better search does not help here;
  more laws would.

## Recommendation

**Use property tests for new laws, and stop building on our checkers.**
Confidence 75%.

- **Why:** on 569 mutants nobody wrote, our checker caught nothing the
  property test missed. Where both caught a mutant, the property test was
  faster to the first catch, and gave a clean "update throws" where our
  checker crashed.
- **What it costs:** only ship was measured. The loop, where 118's
  `forgetsTheLowest` needed one narrow path, was not.
- **What would lift it:** the 150-mutant loop sample that was planned and cut
  (below). If it also shows 0 "only A", the doubt is mostly gone.
- **The bigger finding:** 72% of mutants survive both. Writing laws for the
  outcome a run gives, and an "a ready pull request lands" law, would catch
  more than either search.

## What it cannot tell us

- **It was stopped early.** Only ship ran. The loop sample (150 mutants at
  random with a fixed seed, in `stages/operate/`) was written but never run,
  and review was never started. The owner judged ship's 0 "only A" enough to
  go with property tests.
- **The loop is where our checker last won** (118's `forgetsTheLowest`). A
  mutant of that narrow kind may exist there and was not looked for.
- **Load and time limits.** B's budget is wall time, and 11 workers at once cut
  its walks by about a third (median 18,200 against 28,500 alone). That tilts
  against B, and B still lost nothing. The quiet fixed-count rerun gave no B
  answer for its three mutants, because arm A crashed in the same process.
- **One kind of mutant.** Stryker's default mutators: small edits to one
  expression. A bug that needs two edits, or a missing line, is not here.
- **Mutants inside shared code.** The laws import ship's Cmd definitions from
  `machine.ts`, so a mutant there changes both the code and what the law
  reads. That may hide a few kills, the same for both arms.
- **One laptop, one run.** Times are wall times.

Cost: $0, no model. About 70 minutes of Stryker on ship, 5 minutes for the
quiet rerun and 6 for the crash check, on one 12-core laptop.
