---
id: 0383
title: The plan step runs in a box on a read-only copy, reads its ticket from our tracker, and writes only its planned fact, never posting markdown
status: accepted
date: 2026-10-24
tags: [pipeline, plan, box, tracker, ledger]
---

# 0383: The plan step runs in a box on a read-only copy, reads its ticket from our tracker, and writes only its planned fact, never posting markdown

**What this decides:** where the plan step runs, what it reads, and what it writes.

## Context

From [the plan stage, decisions 8 to 10](../docs/direction/the-plan-stage.md#8-plan-runs-in-a-box),
decided 2026-10-24. The planner reads text a person wrote, so the box goes around the program, not
inside a harness.

## Decision

**The plan step's program is boxed, and its only write is the `planned` fact.**

- Inside the box, on a read-only copy of the code: the planner, its Check and the code reading.
- Outside the box, each a Cmd passed out to the parent: reading the ticket, the fetch at main, and
  the ledger write ([0028](0028-the-parent-holds-every-right.md)).
- It writes only its `planned` fact. It posts no markdown anywhere: the readable plan is a view
  of that fact, on the ticket's timeline.
- It reads its ticket as a fact from our tracker, never a GitHub issue.

## Consequences

- This is the plan step as a program, in either version. Today's hand-run plan skill returns a
  Markdown plan that the lead keeps beside the lane's state
  ([0128](0128-a-write-up-is-born-in-the-repo.md)); that is lead tooling, not this program.
- Today's `packages/pipeline` plan stage reads the ticket from GitHub; nothing here is built there.
