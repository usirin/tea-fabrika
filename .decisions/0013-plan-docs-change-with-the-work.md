---
id: 0013
title: A pull request that builds or finishes a Tier 1 row or a tracked plan item updates the plan docs in the same pull request
status: accepted
date: 2026-11-09
tags: [plan, docs, tier-1, status]
---

# 0013: A pull request that builds or finishes a Tier 1 row or a tracked plan item updates the plan docs in the same pull request

**What this decides:** the plan docs stay true, because the pull request that moves a piece of
work also writes that move into the plan.

## Context

By 2026-11-09, 18 rows of [Tier 1's table](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time)
were on main, but many rows had no status, one said "in review" after its merge, and
[Where we are now](../docs/plan/README.md#where-we-are-now) still said nothing from `next/` was on
main. [PR 631](https://github.com/usirin/tea-fabrika/pull/631) (ticket 398) caught them up by hand.
AGENTS.md already asked for the plan README to change "in the same pull request or the same day",
but nobody owned the update, so it slipped. Ticket 400 records this decision.

## Decision

**A pull request that builds or finishes a Tier 1 row, or a tracked plan item, updates that row in
`docs/plan/tier-1.md` and "Where we are now" in `docs/plan/README.md` in the same pull request
(owner, 2026-11-09).**

- The row gets a bold status at its start, in the style of the done rows: `Done` or `Built`, the
  date, the tracker ticket and the pull request link, or the open pull request.
- "Where we are now" gets one short dated line for the change: what landed and what is next.
- If the step's file-owner list does not let that pull request touch the plan docs, the lead
  updates them the same day, in a docs pull request of its own.

## Consequences

- The plan's state is read from the plan, not rebuilt from `gh` each time.
- Every build pull request touches two more files, which can conflict when lanes land the same
  day; catch-up merges main in, so such a conflict is a small text merge.
- Not decided here: a check in code that a merged row's status names its pull request. Until one
  exists, the lead reads it at merge.
