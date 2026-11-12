---
id: 0362
title: In today's app, the status bar's job line follows the tracker's filter, so it says how to get back to where the job is now, not what was typed
status: accepted
date: 2026-11-04
tags: [tracker, areas, status-bar, filter, jobs, tsh, todays-version]
---

# 0362: In today's app, the status bar's job line follows the tracker's filter, so it says how to get back to where the job is now, not what was typed

**What this decides:** as the filter changes, the tracker tells the host its line, and the status
bar's job item shows that line.

```text
filter {area: 1}    status bar job item: tracker --area pipeline | ticket
[ (All open tab)    the chip goes; status bar: tracker | ticket
```

## Context

The owner decided this on 2026-11-04, option a, as fix 1 of the areas walk
([areas, call 5](../docs/direction/areas.md#5-the-status-bars-line-follows-the-filter-fix-1)). The
line is the tracker's URL: Linear's URL holds the filter, and ours is the shell line. Today's
version, where the host is the process that runs programs.

## Decision

**A job's line says how to get back to where it is now.**

- The tracker tells the host its line each time the filter changes, and the job item shows it.
- The status bar never names an area filter that is not on.
- It changes what tsh's `jobs` prints: the line now, not what was typed.

## Consequences

- The job item is the frame's, and no frame note gives it an owner yet
  ([the frame](../docs/direction/the-frame.md)).
