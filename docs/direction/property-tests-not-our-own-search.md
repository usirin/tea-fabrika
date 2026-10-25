# Property tests, not our own search engine

Decided 2026-10-23.

```ts
// A sketch. One law of the ship stage, on tea's own property-test module.
import * as fc from "fast-check";
import {arbMsg, arbMsgSequence, arbRecordMsg, propertyInvariant, stubCtxThrowingProxy} from "@demlik/tea/pbt";

const pr = fc.constantFrom("pr1", "pr2"); // small sets, so an answer can match what was asked
const msgs = arbMsg<ShipMsg>({
	start: arbRecordMsg("start", {pr}),
	ship_merge_ok: arbRecordMsg("ship_merge_ok", {/* … */}),
	// one entry per Msg type: leaving one out does not compile
});

// "an ended run sends nothing", run on the real machine from its real init
propertyInvariant(ship, stubCtxThrowingProxy(), arbMsgSequence(msgs), (step) =>
	!(step.prev.phase === "over" && step.cmds.length > 0),
);
```

## What was decided

- **We use the industry's test tools. We do not build or grow our own.**
  - Property tests:
    - tea's own `@demlik/tea/pbt`, on fast-check;
    - Effect's `Arbitrary`.
  - Mutation testing: StrykerJS.
  - TLA+, only for a design with no code yet.
- **One machine is tested with tea's pbt.**
  - It folds a random list of messages through the real machine, starting
    from its real `init`, and checks a law after every step. A failing list
    is shrunk to the shortest one that still fails.
  - Its step is `{prev, msg, next, cmds}`, the same shape as our laws, so a
    law carries over almost as it is.
- **Ship goes first, as the test of this decision.** It is run on 119's
  569 Stryker mutants in two separate runs, so one change cannot hide the
  other:
  1. ship's laws as they are today, moved to tea's pbt, compared with 119.
     This one answers whether the tool catches what the walks caught.
  2. then the two laws that 119 found missing are added: which outcome a
     run gives, and "a ready pull request lands". This one answers how much
     the new laws add.
- **A gap in tea's pbt goes to demlik as an issue.** We do not work around
  it in our own code here. Gaps known today:
  - state-aware inputs, where an answer comes only for a Cmd that was sent.
    `arbGuidedSequence` is a stub that throws.
  - no reason on a broken law: a law returns only true or false;
  - generators written by hand in fast-check, not drawn from our Effect
    schemas. Experiment 120 tests drawing them from the schemas.
- **Our search engine is an experiment, not part of the codebase.**
  - The engine is `explore` in `laws/explore.ts` and `search` in
    `laws/world/search.ts`. It tries every order of messages.
  - It is fenced today. In `layer-rules.json` it is a layer above all the
    others, so no file may import it unless it is listed in `allowed`. Every
    file that imports it now is listed there with its count of imports.
  - `pnpm lint` fails on a new import, and on a listed entry that is no
    longer used. So the list can only shrink.
- **It leaves in stages:**
  1. ship's laws, now;
  2. the host's laws (`laws/tea-host.ts`), in the core sweep, because the
     core is kept;
  3. the rest of the old pipeline's laws, when the old pipeline is deleted
     ([Sweep the core; rebuild the pipeline small](./sweep-the-core-rebuild-the-pipeline.md)
     says no cleanup goes into it);
     - The lane's laws (`laws/lane.ts`) move to tea's pbt first, as laws of
       the rebuilt lane (added 2026-10-24). In
       [experiment 139](../../experiments/139-tla-trace-validation.md) they
       were the only check that caught 5 of 46 mutants (432, 464, 465, 472,
       553): the stall rule's count and the `unseen` rule. The move is done
       when 139's fixed sample, seed 139, is caught by the new laws as well.
  4. then the engine moves to `experiments/` as a record.

## Why

- **Experiment 119** ran StrykerJS on the ship stage: 569 small breaks that
  nobody wrote for either tool.
  - Our search caught none that the property tests missed.
  - On 69 of them it crashed, where the property tests said "update throws".
- **72% of those breaks got past both tools.** A better search would not
  have caught them. More laws, and laws on what must happen, catch them.
- **An engine of our own is code to own forever,** about 1,000 lines. tea
  already ships a property-test module that fits our laws.
- **Elm does the same:** elm-test's fuzzers and a fold over `update`, with no
  search engine.

## What it costs

- **Two generator systems for a while.** tea's pbt uses fast-check, while
  Effect 4's `Arbitrary` is its own. fast-check is a new dev dependency here.
- **One machine at a time.** tea's pbt cannot see a bug between machines,
  like the lane's hang (experiments 115 and 116). It also cannot check a law
  that something must happen in the end.
- **The engine stays in the tree** until the old pipeline is deleted. The
  fence keeps it from growing.
- **A sample, not every order.** A bug that needs one rare order can slip
  past. 119 found no such break on ship. The loop machine, where 118's
  `forgetsTheLowest` needed one narrow path, was not tested.
- **How sure: 85%,** up from 75% after the ship port (below).
  - The doubt was whether tea's pbt catches on ship what the walks caught.
    On ship's own laws it does.
  - What is left: one machine only, and the loop machine is still untested.

## What the ship port found (2026-10-23)

Experiments 120 and 121 ran on the same fixed sample of 150 of 119's ship
mutants.

- **Experiment 121, run 1: today's five laws moved to tea's pbt.**
  - It caught 45. 119's walks caught 36.
  - It lost nothing that ship's own laws caught: 9 of 9.
  - Its 9 misses all came from 119's lane worlds, which a one-machine tool
    cannot run.
- **Run 2: plus the two new laws.**
  - It caught 118 of 150. The new laws alone caught 73, and 65 of those
    got past both of 119's tools.
  - 73 is an upper bound, not a settled count. 52 of the 73 came from
    "which outcome a run gives" alone. That law works out the gate's answer
    again, in about 155 lines. So it fails on any change to an outcome,
    harmless or not, and every change to the gate means changing it too.
  - Its lone catches were not checked for harmless changes, and both laws
    were written after reading 119's misses.
  - **The hand check (2026-10-24): the repo's own checks already catch all
    52.** `pnpm typecheck` refuses 42 of the edits, and the example tests
    beside the code catch 50. 121's Stryker ran with neither. So "73 more"
    means more than the other property tests, not more than the repo's own
    checks. The other 21 were not checked this way.
  - So "the laws were what was thin" is not shown. A mutant count means
    something only with the typecheck on and the repo's own tests run
    first.
- **A saved-state property found a real hole.** A saved state whose two
  proofs name different heads lands a head that was never sent. Not fixed
  yet.
- **Experiment 120: inputs drawn from Effect schemas, no hand world.**
  - It caught 47 with today's laws.
  - Its "never sent" check caught 13 mutants that cut off a whole path.
    121's run 1 missed all 13.
- **The gaps in tea's pbt are filed:**

  | Gap | Issue |
  |---|---|
  | lists come out about 10 long | [demlik#744](https://github.com/kamp-us/demlik/issues/744) |
  | `arbGuidedSequence`, answers only to sent Cmds | [demlik#745](https://github.com/kamp-us/demlik/issues/745) |
  | a law cannot say why it broke | [demlik#746](https://github.com/kamp-us/demlik/issues/746) |
  | one fixed saved state, few options, no result | [demlik#747](https://github.com/kamp-us/demlik/issues/747) |
  | nothing counts what the inputs reach | [demlik#748](https://github.com/kamp-us/demlik/issues/748) |
  | answers not drawn from a Cmd's schemas | [demlik#749](https://github.com/kamp-us/demlik/issues/749) |
  | an undeclared Cmd passes unseen | [demlik#750](https://github.com/kamp-us/demlik/issues/750) |

- **Stage 1 is not done.** `laws/ship.ts` still imports the engine, for the
  lanes world, `specs.ts` and the promise check. So ship's entry in
  `layer-rules.json` stays. Next: move `specs.ts` and the promise check to
  `laws/ship-pbt.ts`.
- **Workarounds in our code.** 121 worked around eight gaps, about 200
  lines in `laws/ship-pbt.ts`, to measure the tool at all. They stay as
  merged, with no rule for more, because nothing more is ported (next item).

## Stopped here (2026-10-24)

- **No more proving fabrika's own machines for now.** Nothing more is
  ported to tea's pbt, and the old pipeline gets no fixes: it is rebuilt
  ([Sweep the core; rebuild the pipeline small](./sweep-the-core-rebuild-the-pipeline.md)).
  The saved-state hole and the duplicate criterion id go on the new ship
  stage's list.
- **The next work is the pipeline's own checks:** the verify step of
  [Promises in the pipeline](./promises-in-the-pipeline.md), with the same
  tools. Fabrika is tested later the same way, as one more repo the
  pipeline works on.
- **Why:** checks in the pipeline are the product. The tool question is
  answered well enough for that.
- **What it costs:** fabrika's own machines stay less tested for a while.
- **How sure: 80%.** Experiment 122 is the first test of the verify step.

## Decided: a TLA+ spec that outlives its design is checked against real runs (2026-10-25)

**Decided** 2026-10-25, from [experiment 139](../../experiments/139-tla-trace-validation.md).
Proposed 2026-10-24.

```ts
// A sketch. A spec kept after its code exists is checked against real runs of that code.
const steps = stepsOf(run.log, 8); // the ledger's log of one run, read as the spec's steps
const c = yield* checkTraces(jar, {against: "v2", n: 8, fixed: true}, [steps]);
// accepted: this run is a behaviour of the spec. Rejected: the spec or the code has drifted.
```

- **The rule above stays: TLA+ for a design with no code yet.** Once the code
  exists, its checks are tests of the code: property tests, on the running
  host where machines work together (experiment 116).
- **New: a spec kept after its code exists is trusted only while real runs
  of the code pass it.** That is trace validation
  ([Cirstea et al. 2024](https://arxiv.org/abs/2404.16075)). A spec that no
  run checks is a record of the design, not a check.
  - It belongs in the TLA+ drift job of
    [Scheduled jobs run on the host's alarms](./scheduled-jobs-on-the-host.md),
    not in `pnpm test`, which needs no Java today.
- **Not adopted: tests made from a spec's paths, or a trace check as a
  ticket's gate.** On the hosted lane they caught nothing the repo's own
  tests missed (below).
- **The mutation step's grader stays StrykerJS with the repo's own tests,**
  with no spec arm. The spec arms took 4 and 9 times the tests' time a
  mutant.

**Why:**

- **116's spec was wrong in three places, and it still found the hang.** It
  rejected all 300 real runs of the fixed lane: its rows had no kind, its N
  was the plan's length, and it promised an EXIT the host never sends after
  the lane has exited. Only real runs could show this. The code was right
  each time.
- **It is cheap here.** The ledger is the trace, with one order for every
  row, so the code logs nothing new. The trace spec is 56 lines; reading the
  log as the spec's steps is 188; TLC checks 300 runs in about 1.2 s.
- **On mutants it adds nothing to tests.** Of 46 Stryker mutants of the
  lane that typecheck, the trace check and the path tests caught 8, and the
  repo's tests caught all 8 too, in about a quarter of the time or less.

**What it costs:** a spec and a log reader per machine kept this way, and
Java where the drift job runs.

**How sure: 75%.** The doubt: one small machine with six variables. CCF and
MongoDB, with far larger specs, paid months for the same lever
([NSDI 2025](https://arxiv.org/html/2406.17455v2),
[VLDB 2020](https://arxiv.org/abs/2006.00915)). A second machine kept this
way, with more state, would settle it.

## Not decided here

- **How to test between machines, and "it ends" laws.** A test of the
  running host with generated inputs, as in experiment 116, may be the
  answer. fast-check's `scheduler`, which picks the order of async steps, is
  worth an experiment.
- **fast-check or Effect's `Arbitrary`** for the generators. In experiment
  120, answers drawn from the Cmds' own schemas caught 3 mutants that 121's
  hand-written answers missed, in fewer lines. demlik#749 asks how tea's pbt
  could take them.
- **What happens to `walk.ts` and `sample.ts`** (experiment 118). They use
  the engine's shapes and are fenced with it. tea's pbt replaces them where it
  can.

## What would change it

- The ship port missing mutants that the walks or the search caught.
- tea's pbt staying one machine at a time, while the bugs we find keep
  living between machines.
