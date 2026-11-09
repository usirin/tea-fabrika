---
id: 0004
title: Every pull request squash-merges, stacked ones included, and a stack moves with `gh stack rebase`, never a merge-only catch-up
status: accepted
date: 2026-11-09
tags: [merge, squash, stacks, rebase, signing]
---

# 0004: Every pull request squash-merges, stacked ones included, and a stack moves with `gh stack rebase`, never a merge-only catch-up

**What this decides:** all pull requests land by squash. Stacks use GitHub's native
[gh-stack](https://github.com/github/gh-stack) extension, and after a parent lands, the child is
rebased onto main.

## Context

On 2026-11-08 the plan said a stacked row catches up only by merging, never a rebase or `gh stack`,
and that a parent lands with a merge commit, so its signed head stays in main's history
([Tier 1](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time)). That kept step signatures safe
but made stacks slow and left merge commits on main. Step signatures sign links from tree to tree
([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md)), and
[experiment 221](../experiments/221-signed-steps-and-rebases.md) showed a rebase can be checked by
replay.

## Decision

**Every PR squash-merges. A stack is a GitHub stack, run with the
[gh-stack](https://github.com/github/gh-stack) commands
([GitHub's docs](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)).**

```sh
gh stack init <bottom> ... <top>   # adopt the existing branches as one stack
gh stack submit                    # push them and open the PRs as one stack (or gh stack link)
gh stack merge <pr> --squash       # land bottom-up, all or nothing, up to <pr>; next PR retargets main
gh stack sync --prune              # fetch, rebase what is left onto main, push
```

- `gh stack merge` cannot skip a middle PR. Branch protection still applies to every PR in the
  stack, and a merge queue picks its own method.
- To rebase by hand, run `gh stack rebase`, then `gh stack push`, locally. Never the web "Rebase
  stack" button: it makes unsigned commits.
- No parent lands with a merge commit any more. `catchup.sh` drops `--merge-method merge` for
  parents.
- Why signatures survive: a step signs a link from one tree to the next. A parent's squash commit has
  the same tree as the parent's head, so rebasing the child onto it leaves the child's trees as
  they were, and its links still hold (experiment 221's replay idea).
- If a rebase does change a child's trees, that child's links are signed again, each by its own
  step.

**Binding constraints.**

- A single PR still catches up with main by merging main in. Only a stacked child is rebased, and
  only with the `gh stack` commands above.
- No step's link is signed again by another step or by the lead.

## Consequences

- This walks back the 2026-11-08 line in Tier 1; that line is now a link to this file.
- Main's history has one commit per PR.
- A rebase that changes a child's trees costs a re-sign round for that child.
