---
id: 0406
title: The repo's rules hold the bot to fabrikalfa branches and to main only through a pull request, the bot may change CI files, and which folders an agent may edit is a setting, never a wall
status: accepted
date: 2026-11-06
tags: [agents, github, branches, ci, settings]
---

# 0406: The repo's rules hold the bot to fabrikalfa branches and to main only through a pull request, the bot may change CI files, and which folders an agent may edit is a setting, never a wall

**What this decides:** what limits where the bot may write.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), decided by the owner
2026-11-06. The app gained GitHub's `workflows` permission on 2026-11-07.

## Decision

**The code host's branch rules limit the bot's key, and the repo's settings limit the agent.**

- The repo's rules let the bot reach `main` only through a pull request, and only people may push
  outside `fabrikalfa/*`.
- The bot may change CI files: the app holds `workflows`, so an agent's pull request can change
  `.github/workflows/`.
- Which folders an agent may edit is a setting in the repo's `.fabrika/fabrika.toml`
  ([0069](0069-choices-are-settings.md)), never a wall in the app. A wall was weighed and turned
  down: nothing merges without passing review, and a wall would stop every ticket that touches CI.

## Consequences

- A workflow runs with the repo's secrets, so an agent that edits one could reach them; review is
  what stands there.
- Not decided here: the branch rules on a repo other than this one.
