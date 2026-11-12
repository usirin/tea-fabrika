---
id: 0479
title: A pipe's focus edge is step a8 in dark and in light the lowest step from a8 up that reads 3:1 on the ground and the focused wash, while a plain tile's edge is slate a9 in both looks
status: accepted
date: 2026-11-01
tags: [ui, pipes, focus, contrast, today]
---

# 0479: A pipe's focus edge is step a8 in dark and in light the lowest step from a8 up that reads 3:1 on the ground and the focused wash, while a plain tile's edge is slate a9 in both looks

**What this decides:** the focused tile's edge color per pipe and per look, in today's version.

## Context

A focus edge must read 3:1 against what it sits on (WCAG 1.4.11). From
[pipe colors](../docs/direction/pipe-colors.md#the-values), with plain tiles changed 2026-11-08.

## Decision

**The focus edge is the lowest step that reads 3:1.**

- In dark, a pipe's focus edge is step a8 of its color.
- In light, it is the lowest step from a8 up that reads 3:1 on both the ground and the focused
  wash: sky and lime take a11, teal a10, pink, violet and plum a9.
- A plain tile's edge is slate a9 in both looks, the one `--focus` token
  ([0452](0452-a-token-means-one-thing.md)), since 2026-11-08.

## Consequences

- The note's tables hold each value and its measured contrast.
