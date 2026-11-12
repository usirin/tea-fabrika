---
id: 0295
title: In next/, a cloud instance never watches files and takes new code only by a deploy the owner said yes to after alchemy plan, and a live lane pins its own step programs' build for its life
status: accepted
date: 2026-11-01
tags: [hot-reload, cloud, deploy, alchemy, lanes, build, next]
---

# 0295: In next/, a cloud instance never watches files and takes new code only by a deploy the owner said yes to after alchemy plan, and a live lane pins its own step programs' build for its life

**What this decides:** the two places where a save does not swap code.

## Context

Decided by the owner in [hot reload](../docs/direction/hot-reload.md#where-it-is-off). The cloud
instance is [0080](0080-a-running-copy-is-an-instance.md)'s word; the note says stage programs for
a lane's steps.

## Decision

**Hot reload is off where a change must be chosen.**

- A cloud instance never watches files. New code reaches it only by a deploy the owner said yes to
  after `alchemy plan`, and the swap is the same as on the laptop (80%).
- A live lane pins its own step programs' build for the lane's life, so its result says which code
  judged it. Other programs, such as `trace`, still reload (70%; not in Tier 1).

## Consequences

- A person who just fixed a step may expect a running lane to take the fix; it does not.
