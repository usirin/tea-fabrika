---
id: 0008
title: Decision discovery is the AGENTS.md contract alone, with no committed index and no startup hook
status: accepted
date: 2026-11-09
tags: [decisions, discovery, agents-md, adr]
---

# 0008: Decision discovery is the AGENTS.md contract alone, with no committed index and no startup hook

**What this decides:** agents find decisions by listing `.decisions/` and reading frontmatter, as the "Decision discovery" section of `AGENTS.md` says. Nothing else is committed or run to help them.

## Context

We copy what [kamp-us/phoenix](https://github.com/kamp-us/phoenix) does, as the owner asked on 2026-11-09. Phoenix first made discovery ambient, then dropped its startup hook
([ADR 0129](https://github.com/kamp-us/phoenix/blob/main/.decisions/0129-adr-discovery-is-the-claude-md-contract.md)):
the hook was a second discovery path to keep honest, for a map a reader can produce with one `ls`.
Our `.decisions/README.md` was an index of the same kind, so it goes.

## Decision

**Decision discovery is the `AGENTS.md` contract alone.**

- `AGENTS.md` has a "Decision discovery" section: list `.decisions/`, filenames identify records, frontmatter gives `id`, `title` and `status`, read applicable records when changing the choice they govern or resolving conflicting guidance, record new ones with `/adr`.
- No committed decision index, no startup hook, no compact-map command.
- `.decisions/README.md` is deleted. Its rules (when to write one, file shape) live in [the adr skill](../.agents/skills/adr/SKILL.md).
- `AGENTS.md` keeps one pointer row for `.decisions/` in its read/write table.

## Consequences

- A decision PR edits no index, so two PRs never collide on a row. A pull request that still adds a `.decisions/README.md` row drops it when it catches up with main.
- The `title` must carry the decision: it is the only summary a lister sees.
- Not decided here: a validator for frontmatter or number clashes.
