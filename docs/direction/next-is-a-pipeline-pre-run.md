# Every pull request goes through the pipeline's steps

**Decided 2026-10-31, and widened the same day. Order set 2026-11-01.** This is about
both versions. It was first written for `next/` only, with a person's session running the
steps by hand.

**The deal.** Every pull request, `next/` or today's, goes through today's pipeline
programs. A step that cannot run yet goes by hand for that pull request, and that is logged
in `field/`.

**The order.** Finish the pipeline, run ticket 117 for real, then switch to `next/`
([the plan](../plan/README.md)).

**Where it stands, 2026-11-01: no merged pull request has been built by the pipeline yet.**
Every one so far went by hand or outside the steps. The first real one is ticket 117.

```text
ticket -> triage -> plan (the owner approves its Properties)
       -> exam pull request, when rules change
       -> test writer: new tests red on the base, existing tests green
       -> build: cannot touch the tests
       -> mutation step: StrykerJS, a fixed sample of about 150
       -> one review of the whole diff, by another agent
       -> push -> the owner's yes -> merge
```

- **Each step has its own agent.** The one that writes the code writes no law, no
  lint rule, no CI rule and no mutation skip list
  ([nobody writes their own exam](./nobody-writes-their-own-exam.md)).
- **No builder starts before an approved plan and tests that exist.**
- **Every machine has laws on its real reducer from its real `init`,** with
  `@demlik/tea/pbt`, each seen to fail on a planted break
  ([every machine has laws](./every-machine-has-laws.md)).
- **Each gap in the steps goes to `field/` the same day.** A gap the pipeline's
  notes did not foresee is the point of the run.
- **Which model each step uses is in the code.** See
  [stage agents](./agents-run-on-codex.md). A step done by hand says in its report what
  ran it.

## How a change lands

- **A live run on a target repository:** only through the ship stage.
- **A pull request that went by hand:** the owner's yes, with CI green for code. Then an agent runs
  the merge, after a leak grep.
- **Rows that only record what happened (field logs, index rows):** they merge after the leak grep,
  with no yes.
- **Direction notes and plans:** they still get the owner's yes.

## Changed

- *Changed 2026-10-31:* from "everything in `next/`, by hand" to every pull request, through
  the programs. The by-hand steps are now the exception for a step that cannot run yet.
- *Changed 2026-11-01:* ticket 115 is no longer the first full try. Its plan was replaced by
  [Tier 1](../plan/tier-1.md), which waits for the pipeline.

## Why

- **The first slice skipped all of this.** Its builder wrote its own tests, it had
  no laws, and it broke [no Promises](./no-promises.md). Then the first brief for
  its rewrite handed the builder a lint rule, which is the builder writing its own
  exam.
- **Running the steps by hand tests them cheaply.** Ticket 115's plan alone found 22
  gaps in the notes, six of them contradictions. Better to find them now than inside
  a machine.
- **A pipeline nobody uses teaches nothing.** Building with it is how it gets good.

## What it costs

- Time: a small change takes several agents.
- **A step done by hand has no lane machine holding the order.** Only the session's own
  discipline does, and that has already failed once. This is the weak spot.
- **Some changes do not fit yet.** A docs change cannot go through the pipeline today, so it
  goes by hand.

**How sure: 85%** that this pays for itself. The doubt: whether the steps stay worth it
at the size of real work. Ticket 117 is the first real measure.

## What it cannot tell us

- Whether the pipeline can build its own next version. Nothing has tried it.
- How much of the cost is the steps and how much is learning them. One run cannot
  separate the two.
