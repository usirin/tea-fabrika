---
id: 0374
title: Triage is given the repo's bar for what is worth doing and declines only on the bar's listed cases
status: accepted
date: 2026-10-18
tags: [triage, pipeline, bar, decline]
---

# 0374: Triage is given the repo's bar for what is worth doing and declines only on the bar's listed cases

**What this decides:** a decline always names one rule from a fixed list, and anything outside the
list is kept.

## Context

The owner decided the bar on 2026-10-18, from experiment 92, where triage said no once in 160
answers without one
([sort answers yes or no, the bar for a no](../docs/direction/sort-answers-yes-or-no.md#the-bar-for-a-no)).
The rule "already carried by another ticket" was dropped on 2026-10-24 with fold
([0373](0373-triage-answers-by-what-they-do.md)). Today's list is
`packages/pipeline/src/stages/sort/bar.ts`, which still holds `carried` until the rename to triage.

## Decision

**Triage declines a ticket only when it:**

- is already fixed on main;
- is about something that was removed;
- was replaced by a later design;
- asks again what a decision record or ruling already said no to;
- is a bug in the pipeline tool itself, so it belongs in that tool's repo;
- is not a work item.

**Still a yes:** it only looks done; a host's first ask of tea; "not now"; one user's gap that is
still basic. The same work as another ticket is a `duplicate`, not a decline.

## Consequences

- Three more clauses (ceremony, churn, hardening with no incident) wait for experiment 92b on
  another repo.
- Whether rules that need the code to see should send a ticket to research, and whether Jev may say
  no, are open in the note.
