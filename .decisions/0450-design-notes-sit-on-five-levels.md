---
id: 0450
title: Design notes sit on five levels, and each one splits into a decision note and a guideline page synced from the package, never written by hand
status: accepted
date: 2026-11-07
tags: [design, design-language, guidelines, claude-design]
---

# 0450: Design notes sit on five levels, and each one splits into a decision note and a guideline page synced from the package, never written by hand

```text
principles     one page, a few lines; plus one line of rules at the top of every page
foundations    the materials: color, type, motion, icons, layering, keys, words
tokens         the named values foundations publish, which code reads and themes change
components     parts with props, states and keys
patterns       how parts combine, plus guides: accessibility, content, contributing, agents
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
product        a program's own note (tracker, ticket): it uses the system, it is not it
```

**What this decides:** where each design note sits and what shape a design note takes, in both
versions.

## Context

The design notes had grown one by one with no map. From
[design language](../docs/direction/design-language.md#the-owners-calls), calls 1 and 2.

## Decision

**The design language has five levels, and a design note is a decision plus a page made from the
code.**

- The five levels are principles, foundations, tokens, components and patterns.
- A program's own note (the tracker, the ticket) is product: it uses the system and sits off the
  map. Runtime and pipeline notes are engineering, outside the design language too.
- Each design note splits in two: a decision note, and a guideline page written from doc tags on
  the part itself.
- The guideline page is read in Claude Design's fabrika design system. A sync writes it from
  `@kampus/fabrika-design`, never a person or an agent by hand.

## Consequences

- A new design note names its level first.
- The guideline pages wait on the doc tags and the sync; until then the notes stay whole.
