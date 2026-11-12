---
id: 0369
title: The tracker ships no ticket-kind label (bug, feature, chore), and a kind group a person makes never routes work
status: accepted
date: 2026-11-06
tags: [tracker, labels, kind, triage, routing]
---

# 0369: The tracker ships no ticket-kind label (bug, feature, chore), and a kind group a person makes never routes work

**What this decides:** what a ticket needs next is triage's answer, never a type label, and a
person who wants a "Kind" group for finding work may make one that nothing reads.

## Context

Three notes say this, the latest on 2026-11-06:
[sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md#what-it-means-for-the-work)
(2026-10-18, from experiment 88: no route miss needed a kind label),
[a ticket says where it came from](../docs/direction/a-ticket-says-where-it-came-from.md#what-was-decided)
(2026-11-03, no type label for now), and
[label guidelines, call 3](../docs/direction/label-guidelines.md#3-does-a-kind-group-bug-feature-chore-ship)
(2026-11-06, lean 60%), which lets a person make one.

## Decision

**No kind label routes work, and the tracker ships none.**

- The tracker ships Area as its only label group ([0368](0368-area-is-the-first-label-group.md)).
- A person may make a "Kind" group for finding work. Like every label, it never routes
  ([0364](0364-nothing-decides-on-a-label.md)).
- What a ticket needs next is said by triage: `plan`, `ruling` or `research`
  ([0372](0372-triage-answers-yes-or-no.md)).
- A shipped type label is added only if the owner misses it.

## Consequences

- A person scanning the list sees no type. Whether that is missed shows only after weeks of use.
