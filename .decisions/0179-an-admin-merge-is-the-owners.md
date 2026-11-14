---
id: 0179
title: An admin merge is started only by the owner, on the pull requests the owner names, and the lead says so when one qualifies
status: accepted
date: 2026-11-13
tags: [merge, admin, queue, lead, owner, main]
---

# 0179: An admin merge is started only by the owner, on the pull requests the owner names, and the lead says so when one qualifies

**What this decides:** who may land a pull request past the merge queue, and what the lead does about it.

## Context

[0162](0162-no-friction-before-a-merge.md) says no `--admin`. On 2026-11-13 the queue was slow: a
full run took about an hour, most of it waiting for runners, and the fix for that was itself stuck
behind it. The owner gave the repository admin role a bypass on main's rules and landed four pull
requests by admin merge that afternoon (1147, 1139, 1148 and 1128). The owner keeps the bypass
open: this is a research project, and landing speed matters more than a queue run on every merge.

This amends 0162's "no `--admin`" for the owner only. The rest of 0162 holds. The same line stands
in [0056](0056-lead-runs-a-refused-step-itself.md),
[0097](0097-a-green-pull-request-lands-without-catching-up.md),
[0164](0164-the-bot-stays-without-signing.md) and
[0166](0166-owed-work-needs-no-owner-read.md). There it still binds every agent that acts on its
own; only the owner's word opens it.

## Decision

**An admin merge is started only by the owner.**

- The owner runs it, or names the pull request and tells the lead to run it
  ([0163](0163-the-lead-acts-on-the-owners-word.md)). The lead then runs
  `gh pr merge <n> --squash --admin --match-head-commit <sha>` on that pull request and no other.
- No agent starts one on its own judgment, the lead included. A yes for one pull request does not
  cover the next.
- The lead tells the owner, unasked, when a pull request qualifies, with its full URL, why it is
  safe and what the risk is. The owner then says yes or no.
- The leak check still runs before every merge, an admin merge included.
- Still never: a force push, auto-merge, or a change to the bypass list by an agent.

**The lead's test for "qualifies"** (a working test, not a ruling): the pull request's own checks
are already green on its head, or it holds only text and tooling and its local checks are green.
Never code whose checks have not run.

## Consequences

- A fix that the queue itself is holding can land in minutes.
- An admin merge skips the queue's run, so the push run on main is the only run on the merged
  commit. [0175](0175-every-run-follows-its-paths.md) keeps that run, picked from the changed paths.
- The cost: a pull request can reach main with a red or missing check. The owner carries that call.
- Not decided here: when the bypass closes, and whether a kind of pull request may ever be admin
  merged without the owner's word.
