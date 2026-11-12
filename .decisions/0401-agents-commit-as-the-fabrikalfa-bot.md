---
id: 0401
title: An agent commits and pushes as the fabrikalfa[bot] GitHub App identity, never as the person's account, and the person it works for rides along in a Co-authored-by trailer
status: accepted
date: 2026-11-05
tags: [agents, git, github, identity]
---

# 0401: An agent commits and pushes as the fabrikalfa[bot] GitHub App identity, never as the person's account, and the person it works for rides along in a Co-authored-by trailer

```text
A sketch, from the note. The host writes every line below the subject.

author     fabrikalfa[bot] <353269643+fabrikalfa[bot]@users.noreply.github.com>
subject    map: take a ticket from a pipe

Co-authored-by: <the person> <their noreply address>
```

**What this decides:** whose name an agent's commit carries, in both versions.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), whose direction the
owner decided 2026-11-05; the bot was named `fabrikalfa` on 2026-11-06. GitHub's own coding agent
commits as Copilot, with the person who asked as co-author.

## Decision

**An agent's commit is authored by a GitHub App's bot identity, and the person is its co-author.**

- The author is `fabrikalfa[bot]`, never the person's account, so GitHub shows a person's work
  apart from an agent's.
- The person the agent works for is named in a `Co-authored-by` trailer, so the commit still shows
  as theirs too.
- The agent never names itself: the host stamps who did what.

## Consequences

- Every commit an agent made in this repo before stays as it is; history is not rewritten.
- Not decided here: the trailer keys for which agent and which input caused the commit, and who
  writes them when the agent runs plain `git` in its box.
