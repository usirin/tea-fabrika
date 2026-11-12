---
id: 0386
title: The test writer, never the verify writer, is its own agent that writes one test per property on the plan's base after approval, and the builder never changes those tests
status: accepted
date: 2026-10-24
tags: [pipeline, tests, test-writer, names]
---

# 0386: The test writer, never the verify writer, is its own agent that writes one test per property on the plan's base after approval, and the builder never changes those tests

```ts
// A sketch, from the note. In its box, never the builder's.
const written = draft("tests_write", { input: PlanAndCode, ok: TestFiles });
const onBase = checkRun("tests_on_base", { input: TestFiles, verdict: Results });
// new: the test must fail on the base. existing: it must pass.
```

**What this decides:** who writes a ticket's tests, when, and what the step and its words are
called.

## Context

From [the test writer](../docs/direction/the-test-writer.md#what-was-decided), decided 2026-10-24.
In experiment 122 an agent that was not the builder wrote one test per promise on three tickets;
all failed on the base and passed after the merge.

## Decision

**The test writer is a step of its own, run by its own agent, between the approved plan and the
build.**

- It is never the builder. The builder works until these tests pass and never changes them.
- After the plan is approved and before any code is written, it writes one test per property
  ([0380](0380-a-property-lasts-a-criterion-ends.md)) and runs each on the plan's base commit: a
  `new` property's test must fail there, an `existing` one's must pass.
- Its names: the test writer (never the verify writer), `tests_write` (was `checks_write`),
  `tests_on_base` (was `checks_today`), `already_passes` (was `already_kept`), `fails_on_base`
  (was `not_kept`) and `cannot_test`.

## Consequences

- Today's hand-run tests step follows the same order: laws after the approved plan, before the
  build, and the builder may not touch them (the tests skill).
- Each law is written as [0093](0093-laws-walk-plants-run-once.md) says.
