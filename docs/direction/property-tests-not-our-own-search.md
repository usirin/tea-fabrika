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
- **How sure: 75%.**
  - The doubt: whether tea's pbt catches on ship what the walks of
    experiment 118 caught.
  - The ship port settles it.

## Not decided here

- **How to test between machines, and "it ends" laws.** A test of the
  running host with generated inputs, as in experiment 116, may be the
  answer. fast-check's `scheduler`, which picks the order of async steps, is
  worth an experiment.
- **fast-check or Effect's `Arbitrary`** for the generators. Experiment 120
  is the first evidence.
- **What happens to `walk.ts` and `sample.ts`** (experiment 118). They use
  the engine's shapes and are fenced with it. tea's pbt replaces them where it
  can.

## What would change it

- The ship port missing mutants that the walks or the search caught.
- tea's pbt staying one machine at a time, while the bugs we find keep
  living between machines.
