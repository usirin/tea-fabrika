---
id: 0218
title: Experiment write-ups and field rows stay as files in the repo for now, never moved onto next/'s ledger until a later step says so
status: accepted
date: 2026-10-31
tags: [experiments, field, ledger, clean-slate, next]
---

# 0218: Experiment write-ups and field rows stay as files in the repo for now, never moved onto next/'s ledger until a later step says so

**What this decides:** whether the lab notebook moves into `next/` with everything else.

## Context

Decided in the clean-slate order at 85%. Agents read these files today with tools they already
have, and moving them shows nothing new. The first order put them first because they were
cheapest, which was wrong for what we want: something to see. See
[clean slate](../docs/direction/clean-slate.md).

## Decision

**Experiment write-ups and field rows keep going where they go today, as files, until a later step
says otherwise.**

- Raw experiment results go to the owner's private archive
  ([0027](0027-experiment-results-live-in-a-private-archive.md)).
- Each field row is its own file ([0090](0090-each-field-row-is-a-file.md)).

## Consequences

- Experiment 170 built an importer, if moving them is ever worth it.
