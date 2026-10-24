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
- **Owner to check: workarounds in our code.** This note says a gap is not
  worked around here. 121 worked around eight of them, about 200 lines in
  `laws/ship-pbt.ts`, to measure the tool at all.
  - The proposal: a workaround is allowed only next to its demlik issue, and
    it leaves when that issue closes.
  - Why: without them the tool could not reach ship's deep states, and the
    new laws are worth too much to wait for.
  - What it costs: about 200 lines of our own test code, the kind this note
    warns against.
  - How sure: 70%. The doubt is that the workarounds stay for good if
    demlik never gets to the issues.

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
