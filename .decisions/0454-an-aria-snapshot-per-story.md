---
id: 0454
title: Each story and each layout gets an ARIA snapshot law that advises first, on today's app first
status: accepted
date: 2026-11-07
tags: [design, accessibility, aria, laws, today]
---

# 0454: Each story and each layout gets an ARIA snapshot law that advises first, on today's app first

**What this decides:** how the accessibility tree of each part is held, starting in today's app.

## Context

Nothing held what a screen reader is given for each part and layout. From
[design language](../docs/direction/design-language.md#the-owners-calls), call 8.

## Decision

**Every story and every layout has an ARIA snapshot law.**

- The law advises first. It blocks only once its own false alarms are measured, as every blocking
  check is ([0470](0470-a-ui-check-advises-until-measured.md)).
- It starts in today's app (`apps/fabrika`), and `next/` takes it for every window.
- An approved snapshot is exam ([0474](0474-ui-goldens-are-exam.md)).

## Consequences

- A change to a part's roles or names shows in a snapshot diff before a person hears it.
- What a real screen reader says still needs a person's run.
