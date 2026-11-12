---
id: 0133
title: No push waits on a local typecheck, because CI's check job runs it on every push
status: accepted
date: 2026-11-11
tags: [checks, typecheck, ci, lead, laptop]
---

# 0133: No push waits on a local typecheck, because CI's check job runs it on every push

```sh
# before: the lead's merge push
pnpm typecheck && commit && sign && leak grep && push   # then CI runs the typecheck again
# after
commit && sign && leak grep && push                     # CI's check job is the typecheck
```

**What this decides:** where the typecheck runs for a push, and that the laptop does not run it
first.

## Context

`pnpm typecheck` takes about 8 of the laptop's 12 cores, so only one runs at a time and every other
push waits its turn (AGENTS.md, "Go easy on the machine"). On 2026-11-11 three merge pushes stood in
that line while CI's `check` job would run the same command the moment each was pushed. A warm run
on main took about 20 s; a fresh worktree after a large merge took minutes, most of it waiting. The
owner decided this the same day.

## Decision

**A push does not wait on a local typecheck. CI's `check` job runs it on every push, and a pull
request merges only when that job is green.**

- The lead's pushes (a merge of main, a fix after a review, a docs or tooling change) go out after
  format, lint, the narrow tests, the sign and the leak grep.
- A red typecheck in CI is read and fixed forward on the same branch.
- Running `pnpm typecheck` locally stays allowed when someone wants the answer sooner. It is never a
  step a push must pass.
- Nothing else about a merge changes: CI green, the leak grep clean, and `loosening.sh` read
  ([0014](0014-the-lead-merges-when-every-step-passed.md)).

## Consequences

- The one-at-a-time wait on `tsgo` leaves the lead's landing path.
- The cost: a type error is found a few minutes later, in CI, and costs one more push.
- AGENTS.md's Checks section says so in the same pull request.

## Amendments

- 2026-11-11, the same day: the lane's own typecheck goes too. The lane script ran one on the laptop
  after the review and before it opened the pull request. Now the lane opens the pull request and
  reads CI's `check` job: red sends the work back to tests or to the build with the error lines, as
  the laptop run did. No step between build and review ran a typecheck before, and none does now.
