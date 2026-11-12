---
id: 0136
title: The lead's Codex steps run on gpt-6.1-sol at high effort, replacing gpt-6-astra at medium
status: accepted
date: 2026-11-11
tags: [codex, model, effort, lead, steps, astra, sol, price]
---

# 0136: The lead's Codex steps run on gpt-6.1-sol at high effort, replacing gpt-6-astra at medium

```sh
# before (0022)
CODEX_MODEL=gpt-6-astra  CODEX_EFFORT=medium
# after
CODEX_MODEL=gpt-6.1-sol  CODEX_EFFORT=high
```

**What this decides:** which model and effort a lane's Codex step uses by default.

## Context

[0022](0022-codex-steps-run-on-astra-at-medium.md) set the default to `gpt-6-astra` at medium on
2026-11-09. On 2026-11-11 every Codex step was off for some hours (a box could not run `volta`),
and the lanes ran on Claude meanwhile. The owner decided the same day that when Codex steps come
back, they run on `gpt-6.1-sol` at high.

## Decision

**`.agents/skills/lead/scripts/env.sh` defaults to `CODEX_MODEL=gpt-6.1-sol` and
`CODEX_EFFORT=high`.**

- Both stay env overrides, so one step can still run another model or effort on purpose.
- A step already running keeps what it started with.
- The price table already holds both models (0022): `gpt-6.1-sol` is $2 in, $0.10 cached and $10
  out per 1M tokens at list price, read 2026-11-09. A run row still records the model and effort
  it used.

## Consequences

- At list price a token on sol costs a fifth of one on astra; high effort spends more tokens per
  step than medium. Which wins per step is not measured yet: the run rows will show it.
- 0022's default is replaced; its pricing rules stay.
- Not decided: which steps, if any, stay on Claude once Codex steps are back.
