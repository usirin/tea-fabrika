# Everything in `next/` goes through the pipeline's steps, by hand

**Decided 2026-10-31.** This is about `next/`. A person's session runs the steps
that the rebuilt pipeline will run later.

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
  notes did not foresee is the point of the run. They fix the notes before the
  machine exists.
- **The stage agents here use opus.** The design says Codex
  ([stage agents](./agents-run-on-codex.md)). Each run's report says so.

## Why

- **The first slice skipped all of this.** Its builder wrote its own tests, it had
  no laws, and it broke [no Promises](./no-promises.md). Then the first brief for
  its rewrite handed the builder a lint rule, which is the builder writing its own
  exam.
- **Running the steps by hand tests them cheaply.** Ticket 115's plan alone found 22
  gaps in the notes, six of them contradictions. Better to find them now than inside
  a machine.

## What it costs

- Time: a small change takes several agents. The `next/` slice's rewrite is sized at
  2 to 4 agent hours (50% sure).
- **A hand run has no lane machine holding the order.** Only the session's own
  discipline does, and that has already failed once. This is the weak spot.

**How sure: 85%** that this pays for itself. The doubt: a hand run's speed and its
gaps may not match what a machine run sees. Ticket 115 is the first full try.

## What it cannot tell us

- Whether the steps work with Codex, since the hand run uses opus.
- How much of the cost is the steps and how much is learning them. One run cannot
  separate the two.
