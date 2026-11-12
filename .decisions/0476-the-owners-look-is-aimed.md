---
id: 0476
title: The owner's look is aimed at the shots no law explains, new screens and critical tasks, and each look ends in a fix or noise rating per finding
status: accepted
date: 2026-11-07
tags: [ui, verification, owner, ratings]
---

# 0476: The owner's look is aimed at the shots no law explains, new screens and critical tasks, and each look ends in a fix or noise rating per finding

**What this decides:** what the person looks at once the laws have run, in both versions.

## Context

Numbers check and eyes pick (color principles 8). From
[UI verification](../docs/direction/ui-verification.md#u7-a-person-looks-at-what-no-law-explains-and-at-the-critical-tasks),
U7.

## Decision

**A person looks at what no law explains, and at the critical tasks.**

- The look covers the shots no layer explained, each with the layer that flagged it; every new
  screen; and a short list of critical tasks, where a slip does harm: approving the wrong pull
  request, missing an ask, typing into the wrong tile.
- Each look ends in a rating per finding, `fix` or `noise`, recorded as a fact.
- A screen reader run is a person's job too, once per change to status messages or to what a
  region says on entering.

## Consequences

- The ratings are what later lets a check earn a block ([0470](0470-a-ui-check-advises-until-measured.md)).
