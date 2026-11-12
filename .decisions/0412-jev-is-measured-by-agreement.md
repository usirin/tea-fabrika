---
id: 0412
title: A Jev use is measured by agreement with the big model on the same narrow question plus the time and money saved, never by accuracy against an ideal, and Jev never removes a person by itself
status: accepted
date: 2026-10-10
tags: [jev, judge, measurement, cost]
---

# 0412: A Jev use is measured by agreement with the big model on the same narrow question plus the time and money saved, never by accuracy against an ideal, and Jev never removes a person by itself

**What this decides:** what Jev, the classifier behind the Judge primitive, is for and how a use of
it is judged.

## Context

From [Jev: the same answer, cheaper](../docs/direction/jev-same-answer-cheaper.md#what-was-decided),
decided 2026-10-10. In experiment 51, at 0.8 and above, Jev matched the big model on every real case
seen, at about 1/220 of the cost.

## Decision

**Jev gives the same answer as an agent, faster and for far less money.**

- A use is sized by how often it agrees with the big model at or above its floor, how many cases
  clear the floor, and the time and money saved.
- Jev never removes a person from a decision by itself. A question whose wrong answer skips a person
  needs more text, a second check, or a person.
- Send Jev the least text that answers the question, and record the text's size.

## Consequences

- The win is biggest where one call replaces a whole agent turn.
