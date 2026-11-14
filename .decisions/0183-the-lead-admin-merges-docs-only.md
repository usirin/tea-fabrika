---
id: 0183
title: The lead admin-merges a docs-only pull request without asking, after it checks that the change is not broken
status: accepted
date: 2026-11-13
tags: [merge, admin, docs, queue, lead, owner, main]
---

# 0183: The lead admin-merges a docs-only pull request without asking, after it checks that the change is not broken

**What this decides:** which pull requests the lead may land past the merge queue on its own.

```sh
# The whole rule, as the lead runs it on a docs-only pull request.
pnpm lint                                                  # the check a docs change owes
git diff origin/main...HEAD | sh .agents/skills/lead/scripts/leakgrep.sh
gh pr merge <n> --squash --admin --match-head-commit <sha> # only when both are clean
```

## Context

[0179](0179-an-admin-merge-is-the-owners.md) decided that an admin merge is started only by the
owner, on the pull requests the owner names. It left one thing open: whether a kind of pull request
may ever be admin merged without the owner's word.

On 2026-11-13 the day's decisions, plans and write-ups each waited on a queue run that tests code
they do not change. The owner ruled: the lead goes ahead and admin-merges any docs-only pull
request, and makes sure, each time, that it is not broken.

## Decision

**The lead admin-merges a docs-only pull request on its own, with no owner yes for each one.**

- **Docs only** is the first row of the checks table in [AGENTS.md](../AGENTS.md#checks): every
  changed file is Markdown that no program or skill reads, or a field row. A decision, a plan, a
  direction note, an experiment write-up and a glossary row are docs. Code, config, a workflow, a
  lock file, a skill's prose and a script are not, however small.
- **The lead checks that it is not broken, every time, before the merge:**
  - it reads the whole diff;
  - `pnpm lint` passes on the head;
  - the leak check is clean on the change and on the title and description;
  - where CI's own `changes` job has run on the head, it agrees that the change is docs only.
- **After the merge** the lead reads the push run on main, and fixes a red one the same turn.
- One changed file that is not docs puts the whole pull request back under 0179.

This amends 0179 for docs-only pull requests. Everything else in 0179 holds: for any other pull
request an admin merge is started only by the owner, and no agent but the lead starts one at all.
Still never: a force push, auto-merge, or a change to the bypass list by an agent.

## Consequences

- A decision reaches main in minutes, so the next agent reads it there and not in a branch.
- The queue keeps its runs for changes that can break a test.
- The cost: a docs change lands with no CI run before it. What can still break is a link, a table
  or a lint rule on prose, which the lead's own lint run covers; the push run on main is the second
  look.
- Not decided here: whether lead tooling or instruction text
  ([0180](0180-instruction-files-take-quick-edits.md)) may land the same way. Today it may not.
