---
id: 0344
title: GitHub stays the code host behind CodeHost and never holds a ticket, so no copy goes there and a step reads its ticket from the lane's own fact
status: accepted
date: 2026-10-24
tags: [tracker, github, codehost, ticket, pull-request]
---

# 0344: GitHub stays the code host behind CodeHost and never holds a ticket, so no copy goes there and a step reads its ticket from the lane's own fact

**What this decides:** GitHub keeps the code and its pull requests, reached through `CodeHost`,
while tickets stay in our tracker only.

## Context

The owner decided this on 2026-10-24
([tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md#what-was-decided),
and its [still open](../docs/direction/tickets-start-in-our-tracker.md#still-open) section, where
the copy question was settled the same day). Experiment 138 found no outsider ever wrote a demlik
issue, so a copy on GitHub would reach nobody.

## Decision

**GitHub is the code host, never the tracker.**

- Pull requests and checks stay on GitHub, reached through `CodeHost`. The merge queue is
  fabrika's own ([0107](0107-fabrika-provides-the-merge-queue.md)).
- No copy of a ticket goes to GitHub. A target repo that asks each pull request to close a GitHub
  issue changes that rule instead.
- A step reads its ticket from the lane's own fact, never from a pull request's body.

## Consequences

- Which tickets a merge closes is [0015](0015-a-pr-phrase-closes-its-tickets.md)'s phrase, read by
  code at merge. That is a separate question from how a step finds its own ticket.
- A maintainer reading only GitHub cannot see the ticket behind a pull request unless the pull
  request says so.
