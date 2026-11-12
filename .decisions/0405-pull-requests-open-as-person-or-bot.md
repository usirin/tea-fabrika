---
id: 0405
title: Pull requests open as the person or as the bot by a setting per person, and commits are always the bot's
status: accepted
date: 2026-11-06
tags: [agents, github, settings, pull-requests]
---

# 0405: Pull requests open as the person or as the bot by a setting per person, and commits are always the bot's

**What this decides:** whose name a pull request an agent opens carries.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), decided by the owner
2026-11-06.

## Decision

**Who opens the pull request is each person's choice; who authors the commits is not.**

- A setting per person picks "as me" or "as the bot" for the pull requests opened for them.
- "As me" opens the pull request with the person's own sign-in token, which the app gets once
  through GitHub's own sign-in.
- Commits are always the bot's ([0401](0401-agents-commit-as-the-fabrikalfa-bot.md)).

## Consequences

- Not decided here: where in `next/` the person's sign-in token is kept, and whether GitHub marks a
  pull request the app opens for a person with the app's name.
