---
id: 0385
title: The planner picks a property's tool, tla only for a design with no code yet, and code that exists gets no TLA+ spec, only property tests
status: accepted
date: 2026-10-25
tags: [pipeline, plan, tla, property-tests, scheduled-jobs]
---

# 0385: The planner picks a property's tool, tla only for a design with no code yet, and code that exists gets no TLA+ spec, only property tests

```ts
// A sketch, from the note.
type Tool = "test" | "tla";
const toolFor = (p: { code: "exists" | "none"; about: "order" | "end" | "value" }): Tool =>
  p.code === "none" && p.about !== "value" ? "tla" : "test";
```

**What this decides:** when a property is checked by a TLA+ spec, and what happens to a spec once
its code lands.

## Context

Decided 2026-10-25 from [experiment 139](../experiments/139-tla-trace-validation.md): TLC found the
hosted lane's hang from its design alone, but on code that exists two spec checks caught none of 46
planted bugs the tests missed. Recorded in [the plan stage](../docs/direction/the-plan-stage.md#2-a-propertys-shape),
[the test writer](../docs/direction/the-test-writer.md#still-open) and
[scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md).

## Decision

**`tla` is for a design with no code yet; everything else is `test`.**

- The planner picks a property's `tool`. `tla` fits only a design with no code yet, about the
  order things happen in between actors or about "it ends".
- A Check sends back to the planner a property that names code that exists and says `tla`.
- There is no TLA+ for code that exists. A property about machines working together is a property
  test on the running host.
- Once a design's code lands, its property is checked by `test`. A spec is kept after that only if
  the drift job checks it, and that check only advises. Otherwise the spec is a record.

## Consequences

- The drift job is not one of the two scheduled jobs [0108](0108-a-job-lives-in-a-lane-a-queue-or-a-scheduled-job.md)
  allows for now; adding it is the owner's call there.
- Not decided here: how the test writer writes a spec for a design with no code, and how that spec
  shows it can fail.
