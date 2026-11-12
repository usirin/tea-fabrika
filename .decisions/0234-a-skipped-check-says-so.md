---
id: 0234
title: A skipped check never looks like a clean one, so the record says it was skipped and why
status: accepted
date: 2026-10-05
tags: [checks, skipped, records, honesty]
---

# 0234: A skipped check never looks like a clean one, so the record says it was skipped and why

**What this decides:** what a check writes when it did not really run.

## Context

Decided 2026-10-05, and written down with
[make the mistake impossible](../docs/direction/make-the-mistake-impossible.md).

## Decision

**If a limit or a failed reader switches a check off, the record says the check was skipped and the
reason, so it never reads as a pass.**

## Consequences

- The same holds for a person's or an agent's report: AGENTS.md's Checks section asks it to say
  which checks ran, and which could not run and why.
