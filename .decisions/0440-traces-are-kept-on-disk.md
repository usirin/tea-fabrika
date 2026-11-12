---
id: 0440
title: In today's version, a program's traces are kept on disk and made as readable as possible
status: accepted
date: 2026-10-18
tags: [tea-program, traces, developer-experience, todays-version]
---

# 0440: In today's version, a program's traces are kept on disk and made as readable as possible

**What this decides:** that seeing what a run did is part of today's runtime, not an extra.

## Context

Seeing what a run did is a main part of the developer experience. From
[tea-program](../docs/direction/tea-program.md#parts-already-decided). Today's host keeps one
record per job under `records/` (`packages/fabrika/src/host/records.ts`), and the `trace` program
reads it.

## Decision

**Every run's trace is kept on disk, and its reading is worked on like a product.**

## Consequences

- A trace that is hard to read is a bug to fix, not a nicety.
