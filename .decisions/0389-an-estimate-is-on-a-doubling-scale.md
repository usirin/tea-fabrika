---
id: 0389
title: A ticket's estimate is 0.25, 0.5, 1, 2, 4 or 8 agent hours, written by the planner as an estimated fact with each plan version, and nothing overwrites an old one
status: amended-in-part by [0139](0139-no-split-at-8-agent-hours.md)
date: 2026-11-01
tags: [size, agent-hours, plan, estimate]
---

# 0389: A ticket's estimate is 0.25, 0.5, 1, 2, 4 or 8 agent hours, written by the planner as an estimated fact with each plan version, and nothing overwrites an old one

```ts
// A sketch, from the note (today's tracker says `type`; next/ says `_tag`).
const Hours = Schema.Literals([0.25, 0.5, 1, 2, 4, 8]);
const Estimated = Schema.Struct({
  type: Schema.Literal("estimated"),
  plan: Count, // the plan version it sizes
  hours: Hours,
  lines: Schema.Struct({ code: Count, test: Count, docs: Count }),
  rate: Count, // the lines per agent hour it used
  sure: Count, // 0 to 100
});
```

**What this decides:** the scale an estimate uses, who writes it, and where its rate comes from.

## Context

From [agent hours](../docs/direction/agent-hours.md#h4-an-estimate-is-a-step-on-a-doubling-scale-and-too-big-means-split),
H4's scale, H6, H7 and H8, decided by the owner 2026-11-01. The unit is
[0388](0388-an-agent-hour-is-wall-clock.md).

## Decision

**An estimate is a step on a doubling scale, written once per plan version and kept.**

- An estimate is one of 0.25, 0.5, 1, 2, 4 or 8 agent hours, nothing between.
- The planner's draft carries the hours, the lines by kind it expects, the rate it used and how
  sure it is. The lane writes it as an `estimated` fact with each plan version, before the build.
  A person may write a new one; nothing overwrites an old one.
- The rate is lines per agent hour over the last ten merged tickets with both an estimate and a
  `spent`, for the same builder model. Before ten exist for a model it starts at 602 and says so.
  An unestimated ticket is left out of the rate, never counted as small.
- Lines by kind check an estimate. The size is hours, never lines.

## Consequences

- Not decided here: what happens past 8. The note splits such work before the build; how that
  sits with [0099](0099-no-number-caps-a-pull-request.md) is left open.
  *Settled 2026-11-11 by [0139](0139-no-split-at-8-agent-hours.md): nothing splits at 8, and 8 is
  only the top step.*
