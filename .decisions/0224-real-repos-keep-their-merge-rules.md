---
id: 0224
title: In today's pipeline, a live run on a real repository lands a change only through the ship step under that repository's own merge rules, never by a hand merge, auto-merge or a push to its main branch
status: accepted
date: 2026-10-18
tags: [live-runs, demlik, merge-rules, ship, todays-version]
---

# 0224: In today's pipeline, a live run on a real repository lands a change only through the ship step under that repository's own merge rules, never by a hand merge, auto-merge or a push to its main branch

**What this decides:** where the machine meets real rules, and what those rules are.

## Context

Decided 2026-10-18. From 2026-10-17 the machine could write to one sandbox repo only; that lock
was removed on 2026-10-18 (experiment 83), because a sandbox has no real constraints and cannot
show what breaks. It was the note "demlik is the first real repo", since removed.
AGENTS.md's live-run rules say the same.

## Decision

**A live run happens on a real repository, with its branch protection, CI, merge queue and rules
for agents, never on a sandbox-only one.** [kamp-us/demlik](https://github.com/kamp-us/demlik) was
the first; runs on other repositories followed.

- Today's fabrika is the fallback: it can redo anything the machine leaves half done.
- On a real repo, its own merge rules apply. A change lands only through the ship step: never a
  merge by hand, never auto-merge armed, never a push to its main branch.

## Consequences

- Still to do: a protected branch with no merge queue, where the code host's merge pins only the
  head.
- What would change it: a run on demlik that does harm today's fabrika would not have done.
