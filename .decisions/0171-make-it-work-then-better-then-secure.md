---
id: 0171
title: Work comes in this order, make it work, then make it better, then make it secure, and a stuck thing gets the smallest change that makes it run while the better or safer version becomes a ticket
status: accepted
date: 2026-11-11
tags: [order-of-work, security, hardening, tickets, isolation, stuck]
---

# 0171: Work comes in this order, make it work, then make it better, then make it secure, and a stuck thing gets the smallest change that makes it run while the better or safer version becomes a ticket

**What this decides:** the order work is done in, in both versions, and what to do when something is stuck.

## Context

The owner decided this on 2026-11-11. It was kept outside the repo until now, and this file moves it
in.

It sits beside three rules that already hold:

- "The first slice works, later slices harden", under
  [Changing the product](../AGENTS.md#changing-the-product) in `AGENTS.md`. That rule is about a
  tier. This one is about any piece of work, a stuck lane or tool included.
- [0324](0324-security-follows-the-goal.md): first settle what the tool should be, then make it
  safe. This file adds the middle step, better, and says what a stuck thing gets.
- [0162](0162-no-friction-before-a-merge.md): no wait, re-run or script of ours stands between a
  passing pull request and its merge. Both remove a step that guards against a risk we do not have
  yet.

## Decision

**Make it work, then make it better, then make it secure, in that order.**

- A stuck thing gets the smallest change that makes it run. That change lands first.
- The better version and the safer version each become a ticket, filed the same day. Neither holds
  up the small change.
- Isolation or strictness whose only reason is other machines or strangers waits while fabrika runs
  on one laptop.
- Small does not mean rough. The change that makes it run still passes its checks.

## Consequences

- A stuck lane or tool runs again sooner. The cost is a ticket to come back to, and a stretch of
  time where the piece is less strict than it will be.
- A plan that puts a guard in front of working code says which risk we have today that the guard
  answers. If the risk is only other machines or strangers, the guard is a ticket.

**Not decided here:**

- It never loosens a law. A change that makes a law narrower still waits on the owner.
- It never skips the leak check. This repo is public today.
- A security hole in something already public is still fixed at once, as 0324 says of a gap this
  repo adds.
- Shapes that make a mistake impossible are still built now (0324). Only new guards wait.
