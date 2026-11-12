---
id: 0408
title: A skill's mechanical instruction leaves the skill once code holds it, only reading, judgment and writing stay in prose, and nothing leaves before its check has landed
status: accepted
date: 2026-11-08
tags: [skills, lead, checks, tooling]
---

# 0408: A skill's mechanical instruction leaves the skill once code holds it, only reading, judgment and writing stay in prose, and nothing leaves before its check has landed

```text
skill: read the plan -> judge the work -> report what happened
code:  check leaks -> cap workers -> share one typecheck lock -> choose a safe test home
```

**What this decides:** what a skill may hold, and when an instruction may leave it.

## Context

From [skills keep judgment](../docs/direction/skills-hold-only-judgment.md#the-rule), decided
2026-11-08 for today's hand-run tooling, used for work in either version. AGENTS.md states the same
rule; no decision file held it.

## Decision

**A skill holds judgment; code holds the steps.**

- A rule in a skill that code checks leaves the skill. A rule that code could check becomes a check,
  then leaves.
- Only reading, judgment and writing stay in prose.
- An instruction stays in the skill until the check that replaces it has landed.

## Consequences

- The first checks it moved out are [0409](0409-one-leak-check-for-push-and-plan.md),
  [0410](0410-the-machine-caps-live-in-code.md) and
  [0411](0411-property-data-comes-from-schemas.md).
- `skillscheck.sh` is the skills' one reader in `pnpm lint`.
