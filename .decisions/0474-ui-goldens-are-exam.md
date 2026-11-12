---
id: 0474
title: Every file a UI check compares against is exam, which no builder writes, updates or suppresses, and a golden image stays received until the owner approves it
status: accepted
date: 2026-11-07
tags: [ui, verification, exam, goldens]
---

# 0474: Every file a UI check compares against is exam, which no builder writes, updates or suppresses, and a golden image stays received until the owner approves it

```text
file                         who writes it                       who changes it
ARIA snapshot                the test writer, before the build   the owner, in its own change
layout spec, pair list       the test writer                     the owner
golden image                 the run writes "received"           the owner approves it
planted breaks               the test writer                     the owner
judge rule rows              the owner                           the owner
a suppression (fingerprint)  nobody but the owner                the owner
```

**What this decides:** who may change what a UI check compares against, in both versions.

## Context

"Nobody writes their own exam" was decided 2026-10-22; this says how it holds for UI files. From
[UI verification](../docs/direction/ui-verification.md#u5-approved-images-and-snapshots-are-the-exam),
U5.

## Decision

**A UI check's reference files are exam.**

- A builder never writes, updates or suppresses one.
- A golden image the run writes stays "received" until the owner approves it.
- A loosened or removed reference waits on the owner, as any loosened law does
  ([0014](0014-the-lead-merges-when-every-step-passed.md)).

## Consequences

- An "update snapshots" run is never part of a build step.
