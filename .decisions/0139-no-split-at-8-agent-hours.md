---
id: 0139
title: A ticket estimated over 8 agent hours is not forced to split before the build, and 8 stays the scale's top step only
status: accepted
date: 2026-11-11
tags: [size, agent-hours, plan, estimate, slice, split]
---

# 0139: A ticket estimated over 8 agent hours is not forced to split before the build, and 8 stays the scale's top step only

```text
before  estimate over 8 agent hours   the ticket splits before the build starts
after   estimate over 8 agent hours   the plan cuts it by what lands whole; if it lands whole, it builds
```

**What this decides:** a big estimate no longer forces a split. The plan's cut by meaning and the
stops at twice the estimate are the size guards.

## Context

[0389](0389-an-estimate-is-on-a-doubling-scale.md) set the scale at 0.25 to 8 agent hours and left
open what happens past 8. Its note,
[agent hours](../docs/direction/agent-hours.md#h4-an-estimate-is-a-step-on-a-doubling-scale-and-too-big-means-split),
said H4: over 8, split before the build. That is a number that caps work, and
[0099](0099-no-number-caps-a-pull-request.md) removed the line cap for the same reason: a count
forces cuts where no clean cut exists, and the note's own doubt was that only one ticket had ever
passed 8. This record amends 0389 in part and settles the question its Consequences left open.

## Decision

**No estimate in agent hours forces a ticket to split: a plan cuts work into slices by what lands
whole with its tests, never to fit under 8, and a ticket whose plan says it lands whole may start
its build unsplit (owner, 2026-11-11).**

- 0099's principle covers hours as it covers lines: no number stops, refuses or holds the work.
- 8 stays the top step of 0389's scale. There is no 16. A larger ticket is written as an 8, and its
  lines by kind and how sure the planner is carry the rest. The step forces nothing.
- The size stops are the ones already decided:
  [0100](0100-a-slice-over-its-own-estimate-goes-back-to-the-plan.md)'s stop at twice a slice's own
  line estimate, and [0076](0076-a-lane-stops-at-its-budget.md)'s backstop at twice the plan's
  estimate in steps and dollars.

## Consequences

- H4's "over 8, split" in the agent-hours note is no longer a rule; the note points here.
- The cost: a big ticket may start its build unsplit when its plan says it lands whole. A plan that
  calls a big slice whole when it is not is caught only by the lead's read of the plan and by the
  stops at twice its estimate.
- An 8 now means "8 or more", so it says less about the biggest tickets. Not decided here: whether
  the scale grows a 16 once real tickets pass 8.
