---
id: 0022
title: The lead's Codex steps run on gpt-6-astra at medium effort, never gpt-6.1-sol at xhigh by default
status: accepted
date: 2026-11-09
tags: [codex, model, effort, lead, steps, astra, sol, price]
---

# 0022: The lead's Codex steps run on gpt-6-astra at medium effort, never gpt-6.1-sol at xhigh by default

**What this decides:** a Codex step the lead starts (`box.sh run`, `runplan.sh`, drive) runs
`gpt-6-astra` at `medium` effort unless `CODEX_MODEL` or `CODEX_EFFORT` says otherwise.

## Context

Since 2026-11-08 the hand-run steps ran `gpt-6.1-sol` at `xhigh`
([agents run on Codex](../docs/direction/agents-run-on-codex.md)). The owner moved the default on
2026-11-09. This is the owner's call; no experiment compared the two on our steps first. Tracker
ticket 445.

## Decision

**`.agents/skills/lead/scripts/env.sh` defaults to `CODEX_MODEL=gpt-6-astra` and
`CODEX_EFFORT=medium`.**

- Both stay env overrides, so a step can still run sol or another effort on purpose.
- A step already running keeps the model and effort it started with.
- `fieldrow.py` prices both models from OpenAI's standard list price
  (https://developers.openai.com/api/docs/pricing, read 2026-11-09, up to 272K input):
  `gpt-6-astra` $10 in, $1 cached, $50 out per 1M tokens; `gpt-6.1-sol` $2, $0.10, $10. Older sol
  rows keep sol's price. A model with no listed price gets `listUsd: null`, never another's.

## Consequences

- Astra's list price is 5 times sol's per token, so field rows will show higher dollars per step
  even at a lower effort. Runs are on the subscription; the dollars are for comparison.
- What we watch: step pass rate and stuck rate per model, read from `field/runs.jsonl` (its `model`,
  `effort`, `step` and `outcome`) and the drive logs. If astra at medium passes fewer steps or gets
  stuck more than sol at xhigh did, that is the evidence to bring back to the owner.
- Not decided here: which model the product's own stages pick in `fabrika.toml`.
