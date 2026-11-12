---
id: 0387
title: A test writer's surprise on the base is an ask with three picks, already_passes, fails_on_base or cannot_test, and a pick that changes the plan approves its new version
status: accepted
date: 2026-10-24
tags: [pipeline, tests, test-writer, asks]
---

# 0387: A test writer's surprise on the base is an ask with three picks, already_passes, fails_on_base or cannot_test, and a pick that changes the plan approves its new version

```ts
// A sketch, from the note: the step's answers and each ask's three picks.
done                     // every test fails or passes as the plan says; build starts
ask:owner:already_passes // [ It already works: drop it ] [ The test is too weak: write it again ] [ Reword it ]
ask:owner:fails_on_base  // [ It is a bug today: make it new ] [ The test is wrong: write it again ] [ Drop it ]
ask:owner:cannot_test    // [ Make it a criterion ] [ Reword it ] [ Drop it ]
stuck                    // out of tries
```

**What this decides:** what the test writer does when a test does not fail or pass as the plan
said.

## Context

From [the test writer](../docs/direction/the-test-writer.md#what-was-decided), decided 2026-10-24.
Built in today's `packages/pipeline` (`stages/test-writer/`).

## Decision

**The agent never decides anything about the plan; a surprise goes to a person as one ask with
three picks.**

- `already_passes`: a new property's test passes on the base. `fails_on_base`: an existing one's
  fails. `cannot_test`: no test can check it.
- The ask shows on the ticket's timeline, and the person picks one of its three answers.
- A pick that changes the plan counts as the approval of the plan's new version, so nobody
  approves twice.

## Consequences

- Today's hand-run tests skill sends a wrong plan back to the plan step instead of raising this
  ask; the skill is lead tooling, and this file is the step's own rule.
- How the test writer answers a mutant that lived is no longer its job: mutation is no step of a
  pull request ([0066](0066-mutation-runs-on-a-schedule.md)).
