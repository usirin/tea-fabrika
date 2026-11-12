---
id: 0391
title: The ledger holds a change's commit hash, never the change, and review reads that commit from the local repo in its own box, never a pull request from the code host
status: accepted
date: 2026-10-24
tags: [pipeline, ledger, review, build, box]
---

# 0391: The ledger holds a change's commit hash, never the change, and review reads that commit from the local repo in its own box, never a pull request from the code host

```ts
// A sketch, from the note. The code stays in a git repo on this machine.
{ fact: "built", ticket: "demlik-1", task: 1, commit: "a1b2c3…" } // build, in its box
{ fact: "reviewed", ticket: "demlik-1", task: 1, commit: "a1b2c3…", ok: true } // review, in its box
```

**What this decides:** where a change lives between build and review, and what review reads.

## Context

From the note "nothing is pushed before review", since removed,
decided 2026-10-24. The ledger syncs to other people's machines, so code on it would leave this
machine before anyone reviewed it.

## Decision

**A change stays in git on the person's machine, and the ledger carries only its hash.**

- The change never goes on the ledger. Only its commit hash does: the claim-check pattern.
- A commit hash names the exact files, so what is pushed later is the very commit review read.
- Review reads that commit from the local repo, in its own box. It does not need the code host to
  see a change.

## Consequences

- A crash is picked up on the same machine, where the commit still is. Another machine that takes
  over runs build again.
- Not decided here: where the local repo lives and how build's and review's boxes see it.
