---
id: 0407
title: In this repo every agent commit, the lead's own included, is authored by fabrikalfa[bot] with the owner as co-author on a fabrikalfa branch, and pull requests open as the owner
status: accepted
date: 2026-11-08
tags: [lead, git, github, bot]
---

# 0407: In this repo every agent commit, the lead's own included, is authored by fabrikalfa[bot] with the owner as co-author on a fabrikalfa branch, and pull requests open as the owner

**What this decides:** how [0401](0401-agents-commit-as-the-fabrikalfa-bot.md) is used in this
repo today.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), decided by the owner
2026-11-08, after step commits moved to the bot on 2026-11-07.

## Decision

**Every commit an agent makes here is the bot's, not only step commits.**

- Each is authored by `fabrikalfa[bot]`, with the owner as `Co-authored-by`, the lead agent's own
  commits included.
- It goes on a `fabrikalfa/<name>` branch, pushed with a token that lasts one hour
  (`botpush.mjs`, [0056](0056-lead-runs-a-refused-step-itself.md)).
- Pull requests still open as the owner.
- A repo where the app is not installed is not covered.

## Consequences

- None beyond the lead tooling, which already pushes this way.
