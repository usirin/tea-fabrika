---
id: 0012
title: At most 12 code agents run at once, still with one type check, one Electron app and one Docker box
status: accepted
date: 2026-11-09
tags: [machine, load, agents, laptop]
---

# 0012: At most 12 code agents run at once, still with one type check, one Electron app and one Docker box

**What this decides:** the cap on code agents running at once on the laptop goes from 8 to 12, and
the other caps stay as they are.

## Context

The cap went from 2 to 4 and then 5 on 2026-11-03, and to 8 on 2026-11-08, each time with the owner
asking for more speed. The rule and its history live in the "Under load" bullet of
[AGENTS.md](../AGENTS.md#go-easy-on-the-machine). Ticket 397 records this raise.

Most lane agents spend their time waiting on Codex steps, which are light on the laptop. What froze
the laptop before was two type checks at once, not the number of agents.

## Decision

**At most 12 code agents run at once (owner, 2026-11-09).**

- Still one `pnpm typecheck` at a time across all agents: wait while `pgrep -x tsgo` finds one.
- Still one Electron test app at a time, and one Docker box.
- If the laptop feels slow, drop back to 8.

## Consequences

- Leads may run up to 12 lane agents in parallel; briefs that state the cap say 12.
- The type check stays the bottleneck, so more agents may mean longer waits for it.
- Not decided here: the test caps (`--maxWorkers`, `nice` levels) and the mutation sample size.
