---
id: 0068
title: Each tier carries and updates a working slice of every core idea, so hands, outside programs, programs working together, a person starting a program, an agent fabrika starts and a flow fabrika runs start early, never in a late tier
status: amended-in-part by [0075](0075-cold-author-checks-outside-programs.md), [0078](0078-agent-and-flow-slices-start-early.md), [0088](0088-six-slices-in-tier-1.md), [0159](0159-fabsh-summon-join-come-first.md)
date: 2026-11-10
tags: [tiers, plan, next, hands, programs, packs, pipes, slice, client]
---

# 0068: Each tier carries and updates a working slice of every core idea, so hands, outside programs, programs working together, a person starting a program, an agent fabrika starts and a flow fabrika runs start early, never in a late tier

**What this decides:** a tier is a whole small vehicle across fabrika's core ideas too, not only
across the five layers, so four core ideas that start late today each get a thin slice in an early
tier and are updated in every tier after it.

## Context

[The tiers](../docs/plan/tiers.md) already say each tier is one pass across all five layers, ends
with something a person can use, and finishes no layer alone. Only Tier 1 is committed (37 rows);
Tiers 2 to 7 are "a first sorting, and they will change". AGENTS.md says the first slice works and
later slices harden, and that tier size never pushes work out.

In a design talk on 2026-11-10 about what a program builder needs, the owner named four core ideas
with no early slice, and called that wrong:

- **Hands.** [Three things dial the brain](../docs/direction/brain-hands-window-agent.md): hands, a
  window and an agent. Tier 1 puts each host's capabilities in the hello from day one, but hands
  themselves sit in Tier 4. So nothing before Tier 4 can run a command a program asked for.
- **Programs written outside fabrika's own source.** Repo programs in `.fabrika/programs` wait for
  Tier 5 (a lean of about 60%) and packs for Tier 7 ([packs are
  programs](../docs/direction/packs-are-programs.md), [one fabrika.toml per
  repo](../docs/direction/one-fabrika-toml-per-repo.md), the glossary's `pack` row). Today
  `next/apps/fabrika/src/table.ts` is a fixed list with one row, `counter`. The app's build already
  takes more programs by name and module path (`next/apps/fabrika/src/build.ts`, its `programs`
  option, used by `stage-records.test.ts`), but `next/apps/fabrika/dev.ts` has no flag or file for
  it, so only test code can reach it.
- **Programs working together.** Typed pipes between programs first appear in Tier 2, and a program
  that starts another in Tier 4, since Tier 1 has no process that starts another. In Tier 1 every
  program is alone.
- **A person starting a program.** The set of programs is fixed when the app is built, until
  `fabsh` arrives in Tier 2.

This adds to the tier rules; it supersedes no decision.

## Decision

**Each tier carries and updates a working slice of every core idea, and later tiers harden that
slice.**

- "Whole vehicle" covers fabrika's core ideas, not only the five layers. A core idea does not wait
  for the tier that finishes it.
- Four core ideas are named now, and each gets a thin slice in an early tier:
  - **Hands:** a program can ask for a command and see it run, before Tier 4.
  - **Programs written outside fabrika's own source:** a person can run a program the app's source
    does not list, before Tier 5.
  - **Programs working together:** one program can reach another, before Tier 2's pipes and Tier
    4's program that starts another.
  - **A person starting a program:** a person can start a program while the app runs, before
    Tier 2's `fabsh`.
  - *Amended in part 2026-11-10 by [0078](0078-agent-and-flow-slices-start-early.md):* two more
    join the list, an agent fabrika starts and a flow fabrika runs, each with a slice from Tier 1.
- The tiers that held these ideas still build them for real: pipes and `fabsh` in Tier 2; the
  queue, claims, leases and a program that starts another in Tier 4; repo programs, packs and the
  lock file in Tiers 5 and 7. They harden and update the slice; they no longer start the idea.

**Binding constraints**

- A tier plan names, for each core idea, what its slice gains in that tier, or says why it gains
  nothing.
- A thin slice works: no stub, no dead path. Thin means small, never absent.
- A thin slice records now every fact a later hardening needs, so nothing written before it is lost.

*Amended in part 2026-11-10 by [0075](0075-cold-author-checks-outside-programs.md):* the slice for
programs written outside fabrika's source is checked each tier by a cold agent as the author. The
rest of this file still holds.

## Consequences

- [The tiers](../docs/plan/tiers.md), [packs are programs](../docs/direction/packs-are-programs.md),
  [one fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md) and [brain, hands,
  window, agent](../docs/direction/brain-hands-window-agent.md) each get a dated pointer to this
  file. No tier table row moves here.
- Not decided here: which tier each thin slice lands in. Tier 1 is approved at 37 rows, so adding
  any slice to it is the owner's call. *Decided 2026-11-10 in [0088](0088-six-slices-in-tier-1.md):*
  all four land in Tier 1.
- Not decided here: the shape of each slice. For hands, the lead's sketch is one host, one command,
  and no queue or leases yet. Its plan also says what it records now so later leases lose nothing,
  and how it squares with the glossary's `hands` row, which says hands take jobs from the queue
  with a lease. For outside programs, the lead's sketch is that `dev` reads a program list from
  `fabrika.toml` into the build's existing `programs` option, with the lock file later. Both are
  sketches, not rulings. Programs working together and a person starting a program have no sketch.
- Not decided here: whether the lead's flow runner becomes a program. Decided for now in
  [0070](0070-flow-runner-stays-a-machine.md): it stays a tea machine.
- Open, not decided: whether the pipeline itself (Tier 6) and an agent that fabrika starts (Tier 5)
  are core ideas too. *Decided 2026-11-10 in [0078](0078-agent-and-flow-slices-start-early.md):*
  yes, as an agent fabrika starts and a flow fabrika runs.
- Each of these needs its own plan and the owner's walk.
