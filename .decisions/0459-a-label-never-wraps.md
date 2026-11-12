---
id: 0459
title: A label never wraps, and a row's meta ends in an ellipsis before its title drops under 16 characters
status: accepted
date: 2026-11-02
tags: [design, typography, rows, truncation]
---

# 0459: A label never wraps, and a row's meta ends in an ellipsis before its title drops under 16 characters

**What this decides:** what gives way first when a row runs out of room, in both versions.

## Context

Narrow tiles cut row titles while their meta stayed whole. From
[typography](../docs/direction/typography.md#t5-a-label-is-one-line-and-meta-gives-way-before-a-rows-title),
T5.

## Decision

**A label is one line, and meta gives way before a row's title.**

- A label never wraps.
- A row's meta ends in an ellipsis before the row's title drops under 16 characters.
- Must-read text is never cut at all ([0472](0472-must-read-text-is-never-cut.md)).

## Consequences

- The smallest-tile shot checks it ([0471](0471-ui-shots-cover-eight-layouts.md)).
