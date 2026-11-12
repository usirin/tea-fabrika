---
id: 0488
title: A stop a step can fix never reaches the inbox, one that does shows as a stop and never a yes or no, and a design that adds an ask kind says what it costs a person a week
status: accepted
date: 2026-11-02
tags: [asks, stops, jidoka, cost]
---

# 0488: A stop a step can fix never reaches the inbox, one that does shows as a stop and never a yes or no, and a design that adds an ask kind says what it costs a person a week

**What this decides:** what may reach a person as an ask, in both versions.

## Context

A rote ask trains a person to press yes without reading. From
[the ask desk](../docs/direction/ask-desk.md#a6-code-answers-what-code-can-a-stop-shows-as-a-stop),
A6.

## Decision

**Code answers what code can.**

- A stop a step can fix never reaches the inbox.
- A stop that does is drawn as a stop, with its reason and where the lane goes on, never as a yes
  or no: "#117 stopped at exam_merge: no review at this head", with `↵` to open the lane.
- A change that adds an ask kind says why only a person can answer it, and its weekly cost: asks a
  week times the person's minutes per ask.

## Consequences

- The inbox's asks are judgment asks only.
