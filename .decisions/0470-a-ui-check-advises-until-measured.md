---
id: 0470
title: A UI check starts as advice and blocks one kind at a time once its own record shows about 0 false alarms, an incomplete result only advises, and a suppression is a narrow fingerprint that is an exam change
status: accepted
date: 2026-11-07
tags: [ui, verification, false-alarms, exam]
---

# 0470: A UI check starts as advice and blocks one kind at a time once its own record shows about 0 false alarms, an incomplete result only advises, and a suppression is a narrow fingerprint that is an exam change

```text
layer        blocks when
1 tokens     now: deterministic
2 machine    now, when the law is right
3 axe, ARIA  after it is measured here
4 layout     per kind, once measured
5 golden     advises until a run shows about 0
6 judge      never, for now
7 a person   always decides
```

**What this decides:** when a UI check may block a pull request, in both versions.

## Context

The repo's bar is about 0% false alarms to block and up to 10% to advise (AGENTS.md, Google CACM
2018). From [UI verification](../docs/direction/ui-verification.md#u2-block-only-what-is-measured-near-0-the-rest-advises),
U2.

## Decision

**A UI check advises until its own record earns it a block.**

- A check starts as advice. It is promoted to block one kind at a time, when its own record shows
  about 0 false alarms on our app.
- `blocks` is a field on every check's row, set from its measured count, never by the builder.
  Promoting a check is an exam change, the owner's call.
- An incomplete or needs-review result goes to the person as advice, never as a block.
- A known issue is suppressed only by a narrow fingerprint, with just enough to name that one
  issue. A suppression is an exam change.

## Consequences

- No UI check has a counted false alarm rate yet, so only deterministic ones block today.
- How many clean runs make "about 0" is a lean in the note (its C4), not decided here.
