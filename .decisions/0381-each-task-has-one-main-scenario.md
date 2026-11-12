---
id: 0381
title: Each task in a plan has one main scenario with a required fixture, a property when a tool can check it and a criterion only when a reader must
status: accepted
date: 2026-10-24
tags: [pipeline, plan, scenario, fixture]
---

# 0381: Each task in a plan has one main scenario with a required fixture, a property when a tool can check it and a criterion only when a reader must

```ts
// A sketch, from the note. The key was `job`.
type Scenario = (Property | Criterion) & { fixture: string };
type Task = { id: TaskId; title: string; ends: "pr" | "answer"; scenario: Scenario };
```

**What this decides:** what every task in a plan must carry.

## Context

From [the plan stage, decision 4](../docs/direction/the-plan-stage.md#4-one-main-scenario-per-task),
decided 2026-10-24 from experiment 86b: in 5 of its 6 plans a test checked the main scenario.

## Decision

**Each task has one main scenario, under `scenario`, and its `fixture` is required.**

- The main scenario is a property ([0380](0380-a-property-lasts-a-criterion-ends.md)) when a tool
  can check it, and a criterion only when a reader must.
- `fixture` says the setup the scenario runs on.

## Consequences

- A chore still pays for a fixture: on one ticket of six it turned a comment reword into work by
  hand ($0.47 against $0.13).
- Not decided here: whether a plan's `goal` gets a scenario too.
