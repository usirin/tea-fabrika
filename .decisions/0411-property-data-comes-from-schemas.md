---
id: 0411
title: A new property draws its data from an existing Schema or its Effect Arbitrary, with tea's machine-law tools kept and fast-check only for unsupported data, and the lint for it only advises
status: accepted
date: 2026-11-08
tags: [tests, property-tests, effect, schema, lint]
---

# 0411: A new property draws its data from an existing Schema or its Effect Arbitrary, with tea's machine-law tools kept and fast-check only for unsupported data, and the lint for it only advises

**What this decides:** where a property's generated data comes from in `next/` tests.

## Context

From [skills keep judgment, K20](../docs/direction/skills-hold-only-judgment.md#the-rule), decided
2026-11-08, also in [five steps for every check](../docs/direction/five-steps-for-every-check.md).
[0093](0093-laws-walk-plants-run-once.md) holds that a law walks the machine.

## Decision

**Effect's own data comes first.**

- A new property uses an existing Schema, or its own Effect Arbitrary exported beside it.
- tea's machine-law tools stay.
- fast-check data is for what Effect cannot generate, and for edge cases.
- A law moved onto a Schema's Arbitrary keeps its old size, run count and reach of the real limit.
- The lint for it, `fabrika/prefer-schema-arbitrary`, only advises. It scanned 71 `next/` test files
  with six useful hits and no false ones, which does not prove complete recall.

## Consequences

- A reason beside a declaration keeps an edge-case or unsupported generator.
