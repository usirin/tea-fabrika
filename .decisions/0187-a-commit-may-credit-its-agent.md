---
id: 0187
title: A commit or a pull request may credit the agent that did the work, as long as the owner is named on it too
status: accepted
date: 2026-11-13
tags: [agents, git, github, identity, credit, commits, pr]
---

# 0187: A commit or a pull request may credit the agent that did the work, as long as the owner is named on it too

**What this decides:** whether an agent's name may stand on its own work, in both versions.

```text
author     <the owner, or fabrikalfa[bot]>
subject    map: take a ticket from a pipe

Co-authored-by: <the agent> <its noreply address>     allowed, beside the owner
```

## Context

[0401](0401-agents-commit-as-the-fabrikalfa-bot.md) says an agent's commit is authored by the bot
with the owner as co-author, and that "the agent never names itself". The pull request skill turned
that into a rule for descriptions: no credit line and no "generated with" footer.

The rule cost work. A commit made in a cloud session is authored by the agent, so GitHub's squash
adds a `Co-authored-by` line for it, and the lead moved each such branch onto a new one by hand to
keep that line out. The owner ruled on 2026-11-13 that the line is welcome: agents do the work and
get the credit, as long as the owner's name is there too.

This amends 0401 in part. Who authors a commit and how the owner rides along stay as 0401 says.

## Decision

**An agent may be credited on a commit and on a pull request, beside the owner and never in place
of the owner.**

- A `Co-authored-by` line for the agent is allowed on any commit, a squash merge included. Nobody
  rewrites a branch or re-authors a commit to remove one.
- The owner is always named on the same commit: as its author, as the one who merged it, or in a
  `Co-authored-by` line of their own.
- A pull request description may end with a credit line or a "generated with" footer.
- **Credit is not proof.** A credit line says who helped. It is never read as the record of who did
  what: that record is the host's stamp, as 0401 and
  [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md) say.
- A session link stays out of commits and descriptions. It is a link into one person's account, not
  credit.

## Consequences

- The pull request skill drops "no credit line" and "no generated-with footer". Its "no session
  link" stays.
- A branch pushed from a cloud session can become a pull request as it is.
- 0401's line "the agent never names itself" now reads: the agent's own word is never the record.
- Not decided here: which name and address an agent's credit line uses when fabrika starts the
  agent itself, and the trailer keys 0401 left open.
