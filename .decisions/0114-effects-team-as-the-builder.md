---
id: 0114
title: Code in next/ is judged by how Effect's team would build it, and a guidelines study writes that down
status: accepted
date: 2026-11-11
tags: [effect, style, guidelines, review, plan, next, primitives, comments]
---

# 0114: Code in next/ is judged by how Effect's team would build it, and a guidelines study writes that down

**What this decides:** for code, Effect's team is what Linear's team is for screens: every plan
and review in `next/` asks how they would build this piece, and one guidelines study turns the
answer into principles.

## Context

[0023](0023-next-follows-effects-code-style.md) says `next/` follows the Effect repository's code
style and doc comments. That rule is about how a line and a comment look. It does not ask the
larger question: would Effect's maintainers pick this primitive, cut the file here, name it this
way, and document it like this? An audit on 2026-11-11 checked `next/` against our own decisions
and never asked it. Screens already have this question, with Linear as the builder
([AGENTS.md](../AGENTS.md#changing-the-product)), and a guidelines study that makes it concrete.
The owner asked for the same for Effect code on 2026-11-11.

## Decision

**Effect's team is the builder we measure `next/` code against, never a template to copy.**

- The question is how Effect's maintainers would build this piece if it were a module of theirs:
  which primitive they would reach for, how they would cut the files, what the service and its
  layers look like, how they would name and document it.
- The answer comes from reading their source at the version in the lockfile, with a path and line,
  never from memory. The nearest thing they built is named in the plan.
- One guidelines study for Effect code writes the answer down as a few principles. Each principle
  has a kind: **lint** (a rule can hold it), **type** (the compiler can), **law** (a test can) or
  **taste** (only a reviewer's read beside Effect's source checks it). How many principles there
  are comes from what the read finds, never from a target number.
- What holds a principle is picked in this order: a check Effect's own tooling already ships
  (`@effect/tsgo` and its lint presets), then a lint rule of ours, then a pattern doc in
  `.patterns/` with a real code block an agent can copy, such as which Effect module to reach for.
  Prose is left for judgment only. A rule of ours that repeats a shipped check gives way to it
  ([0040](0040-existing-tools-before-hand-written.md)).
- A plan for `next/` code names the nearest Effect module and says where the plan differs and why.
  A review reads the diff beside it.
- A difference we keep on purpose is written down with its reason, as 0023 already asks. A recorded
  difference is not a gap.

**Binding constraints**

- Never copy Effect's code across. Read it, then write ours.
- A decision here still wins over Effect's habit where the two differ (0023 lists them).

## Consequences

- The study starts with a full read of every `next/` file beside Effect's source, module by module.
- Plans and reviews get one more question. Its cost is a read of one Effect module per plan.
- What can become a lint rule or a type leaves the prose once the rule exists.
- Not decided here: the principles themselves. They come to the owner as a proposed note, after a
  walk.
