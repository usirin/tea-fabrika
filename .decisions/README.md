# Decisions

Every decision the owner makes lands here, one file per decision, the turn it is made
([0001](./0001-decisions-live-in-the-repo.md)). Long design notes stay in
[`docs/direction/`](../docs/direction/README.md); a decision file links its note when one exists.

## When to write one

Whenever the owner settles something: a rule, a name, a shape, a yes or no on a plan's question.
Write it the same turn, in its own docs pull request. Never batch two decisions, and never wait for
a code pull request. A docs-only decision PR merges on green CI with a clean leak grep.

## The file

`NNNN-slug.md`: the next free four-digit number, then a kebab-case slug of at most five words.

```markdown
---
id: 0002
title: <the decision in one clause, not the topic>
status: accepted
date: YYYY-MM-DD
tags: [a, few, words]
---

# 0002: <the same title>

**What this decides:** one plain sentence.

## Context

Why it came up. Link the note, ticket or pull request.

## Decision

**One bold sentence first.** Then the rules, as short bullets.

## Consequences

What changes, what it costs, what is not decided here.
```

- `status` is `accepted`, `superseded` or `amended`. A later decision that replaces one sets the
  old file's status to `superseded by NNNN`; nobody deletes a decision.
- Keep it short. The long reasoning goes in a `docs/direction/` note.
- Never quote what a person typed. Record the decision.

## Search before you ask

Before an agent asks the owner anything or writes a plan, it searches `.decisions/`, `.glossary/`
and `docs/direction/` for the topic.

## The governance check

```sh
sh .agents/skills/lead/scripts/governance.sh [base]
```

It lists the decision files whose title, tags or slug words show up in the diff from `base`
(default `origin/main`) to `HEAD`, and every decision file the diff edits. The review step and the
lead read each one listed and say whether the diff walks it back. For now it only lists and always
exits 0. It blocks later, once its false alarms are measured.
