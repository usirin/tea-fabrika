---
id: 0421
title: Every part of the pipeline is built from the existing primitives and combos, a new special rule is the last resort, and each part first answers whether it is needed, already ours or belongs elsewhere
status: accepted
date: 2026-10-18
tags: [pipeline, primitives, design]
---

# 0421: Every part of the pipeline is built from the existing primitives and combos, a new special rule is the last resort, and each part first answers whether it is needed, already ours or belongs elsewhere

**What this decides:** how a part of the pipeline is rebuilt, side parts included.

## Context

From [reuse before special rules](../docs/direction/reuse-before-special-rules.md#what-was-decided),
decided 2026-10-18. Special rules in today's fabrika grew from single incidents, each with its
writer's taste.

## Decision

**A part is built from the six pipeline primitives and their combos before anything new.**

- Each part, side parts such as milestones, campaigns, priorities and labels included, answers three
  questions before it is rebuilt: do we need it at all, is it something we already have, does it
  belong elsewhere?
- Before adding a field, label, step or rule, name the existing primitive or combo it could be, and
  write down why none fits if you add something new.
- A write-up that adds a special rule says which of the three questions it failed.

## Consequences

- A part moved into code is how it gets reused: another step can use it as it is.
