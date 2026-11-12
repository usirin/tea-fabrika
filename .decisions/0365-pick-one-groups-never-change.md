---
id: 0365
title: In next/'s tracker, a label group is made pick-one or pick-many and never changes, and the fold refuses a fact that leaves two labels of a pick-one group
status: accepted
date: 2026-11-06
tags: [tracker, labels, groups, fold, accessibility, next]
---

# 0365: In next/'s tracker, a label group is made pick-one or pick-many and never changes, and the fold refuses a fact that leaves two labels of a pick-one group

**What this decides:** a pick-one group holds at most one label per ticket, and the fold, not the
writer's care, keeps it so.

```ts
// A sketch from the note, next/.
group_made: { group: GroupNumber, name: LabelName, pick: Schema.Literals(["one", "many"]), guess: Schema.Boolean }
{ _tag: "labeled", add: [2], drop: [] } // refused into problems: two in a pick-one group
```

## Context

The owner decided L4 on 2026-11-06, lean 80%
([label guidelines, L4](../docs/direction/label-guidelines.md#l4-pick-one-is-a-group-and-the-fold-holds-it)).
Linear: "only one label from each group may be applied". `next/`.

## Decision

**`pick` is fixed when the group is made.**

- A group is `one` or `many`. Labels outside any group are `many`. There is no `group_repicked`:
  changing one to many would make old picks mean something else.
- The fold refuses, into `problems`, a `labeled` that would leave two labels of a pick-one group.
  The writer names the replaced label in `drop`, so the fact says what the person did.
- Picking in a one-group replaces; in a many-group a pick toggles.
- A one-group shows as a radio group and a many-group as checkboxes, each with its name.

## Consequences

- A law over generated timelines: for every one-group, the fold gives at most one label.
- To change a group's kind, a person makes a new group and merges labels across.
