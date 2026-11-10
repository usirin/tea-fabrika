---
id: 0010
title: The repo explicitly allows pull_request_target, so the commit check keeps running main's copy
status: accepted
date: 2026-11-09
tags: [ci, github-actions, commits-check, exam]
---

# 0010: The repo explicitly allows pull_request_target, so the commit check keeps running main's copy

**What this decides:** this public repo has an Actions policy that allows `pull_request_target`, and the commit check keeps that trigger instead of moving to `pull_request`.

## Context

GitHub is blocking `pull_request_target` on public repos that have no Actions event policy. It ran
a test block on 2026-11-09 until 18:00 UTC, and its docs say the block is enforced from
2026-12-02. During the test block every run of `.github/workflows/commits.yaml` ended in
`startup_failure`, so no pull request could merge.

The commit check uses `pull_request_target` on purpose: main's copy of the check runs, never the
pull request's, so a pull request cannot edit the check that grades it
([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)). The plain
`pull_request` trigger would run the pull request's copy.

## Decision

**The repo keeps `pull_request_target` for the commit check and allows it by an explicit Actions
policy.**

- The policy is a repository Actions policy with `enforcement: active` and one
  `restrict_action_events` rule. Its `allowed_events` are `push`, `pull_request`,
  `pull_request_target` and `workflow_dispatch`. The list is an allow list, so a workflow on a new
  event needs that event added there first.
- `commits.yaml` stays as it is: it never checks out or runs the pull request's code, its token
  can only read, and it uses no secret. Those three are what make the trigger safe, and a change
  that breaks one of them needs the owner.
- `catchup.sh` does not count a commits run that never started (`startup_failure`) as a run.
  Reopening a pull request starts a fresh one.

## Consequences

- Merges no longer depend on GitHub's default for public repos.
- The policy lives in GitHub's settings, not in the repo. This file is its record.
- Not decided here: moving the check to another trigger or to a GitHub App.
