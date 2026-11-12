---
id: 0409
title: One leak check reads added push text and plan text, names the kind and line of a hit without printing it, and keeps the private words outside the repo
status: accepted
date: 2026-11-08
tags: [leak-check, security, lead, plan]
---

# 0409: One leak check reads added push text and plan text, names the kind and line of a hit without printing it, and keeps the private words outside the repo

**What this decides:** which tool checks pushed and planned text for leaks, and what it may print.

## Context

From [skills keep judgment, K6](../docs/direction/skills-hold-only-judgment.md#the-rule), decided
2026-11-08. A replay of the last 20 merged hand-run pull requests refused 0 of 20.
[0011](0011-leak-check-allows-plain-tmp-paths.md), [0047](0047-respaced-line-is-old-text.md) and
[0048](0048-leak-check-reads-each-commit.md) shape what it reads.

## Decision

**There is one leak check, today `leakgrep.sh`, for every added text that leaves.**

- It reads the text a push adds and the text a plan adds.
- A hit names its kind and its line, never the matched text.
- The private word list lives outside the repo. Without it, only the built-in shapes run.

## Consequences

- The script moves to TypeScript and Effect under [0113](0113-no-shell-or-python-scripts.md); its
  rules stay.
