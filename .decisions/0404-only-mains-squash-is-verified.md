---
id: 0404
title: Only main's squash commit is Verified in the first version, never a replay of pushes through GitHub's API or a machine user holding keys
status: accepted
date: 2026-11-06
tags: [agents, git, github, signing]
---

# 0404: Only main's squash commit is Verified in the first version, never a replay of pushes through GitHub's API or a machine user holding keys

**What this decides:** which commits carry GitHub's Verified badge when agents commit as the bot.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), decided by the owner
2026-11-06, from [experiment 212](../experiments/212-fabrika-bot-commits.md), calls 2 and 4.

## Decision

**What lands on main is GitHub's squash commit, which GitHub signs; a pull request's own commits
carry no badge.**

- Replaying pushes through GitHub's API is turned down: it rewrites the agent's commits under new
  hashes.
- A machine user holding the keys is turned down: every person would need a second GitHub account.

## Consequences

- Every pull request squash-merges ([0004](0004-squash-merges-and-native-stacks.md)), so main stays
  Verified.
