---
id: 0368
title: In next/, Area is the first label group, pick-one and guessable, never a concept of its own, and --area stays as its short form beside --label
status: accepted
date: 2026-11-06
tags: [tracker, labels, areas, filter, fabsh, next]
---

# 0368: In next/, Area is the first label group, pick-one and guessable, never a concept of its own, and --area stays as its short form beside --label

**What this decides:** `next/`'s tracker ships one label group, Area, and today's areas become
its labels when `next/` takes the tracker over.

```text
group_made {group: 1, name: "Area", pick: "one", guess: true}    the tracker ships it
tracker --area pipeline          the short form, for the group the tracker ships
tracker --label area=pipeline    the general form, any group; --label flaky for a groupless one
```

## Context

The owner decided calls 1 and 2 on 2026-11-06, leans 65% and 60%
([label guidelines, call 1](../docs/direction/label-guidelines.md#1-is-an-area-its-own-concept-or-the-first-label-group),
[call 2](../docs/direction/label-guidelines.md#2---area-stays-as-a-short-form)). Linear does it
this way; two systems would double make, rename, merge, pickers and filter doors. It replaces, for
`next/`, the line in [areas](../docs/direction/areas.md#where-this-differs-from-settled-notes) that
says an area is not a label in a group.

## Decision

**Area is a label group, not its own concept.**

- `next/`'s Area is the first label group, pick-one and guessable. Area's best parts, numbers,
  merge and the guess, are what every label gets.
- `--area` stays, as the Area group's short form, beside the general `--label`.
- When `next/` takes the tracker over, each of today's areas becomes a label in the Area group with
  the same number, and that pull request deletes today's area code.

## Consequences

- Today's areas do not change ([0356](0356-an-area-is-a-persons-data.md)).
- If Area later needs an owner or a strategy, it graduates
  ([0367](0367-a-label-that-acts-graduates.md)) and no ticket moves.
- Whether `next/`'s Area group archives like a label or deletes like today's area
  ([0360](0360-an-area-can-be-deleted.md)) is not decided.
