---
id: 0390
title: Every run records its ticket and its pull request as two fields, with its start, its end and its parent run, and the main session logs a row of its own
status: accepted
date: 2026-11-01
tags: [field, records, agent-hours]
---

# 0390: Every run records its ticket and its pull request as two fields, with its start, its end and its parent run, and the main session logs a row of its own

**What this decides:** which facts a run row keeps from the moment it is written.

## Context

From [agent hours, what a run records](../docs/direction/agent-hours.md#what-a-run-records),
decided by the owner 2026-11-01. These facts exist only when the run happens.
[`field/README.md`](../field/README.md) lists the fields; [0090](0090-each-field-row-is-a-file.md)
says each row is its own file.

## Decision

**A run row names its work as two fields and places itself in time and under its parent.**

- `ticket` and `pr` are two fields, never one `lane` that holds either.
- `started` and `ended` are on the writer's own clock. An open run has `ended: null`, never zero.
- `parent` is the run that started this one, or `null`, so a driver is never summed with its
  children.
- The main session logs a row of its own.

## Consequences

- Old rows keep `lane` and stay readable.
