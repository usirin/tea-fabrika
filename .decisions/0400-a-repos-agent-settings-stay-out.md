---
id: 0400
title: A repository's own agent settings, hooks, env and .claude folder stay out of every run fabrika starts, and only ownRules says where a Claude run's settings come from
status: accepted
date: 2026-10-26
tags: [agents, security, claude, lint]
---

# 0400: A repository's own agent settings, hooks, env and .claude folder stay out of every run fabrika starts, and only ownRules says where a Claude run's settings come from

```ts
// From today's packages/fabrika/src/agents/claude/rules.ts, as the note gives it.
const options = { ...rest, ...ownRules({ disableClaudeAiConnectors: true }) };
// = { settingSources: ["project"], projectConfigRoot: "/var/empty", settings: { ..., pluginConfigs: AGENTS_MD } }
```

**What this decides:** what of a repository's agent setup reaches the agents fabrika starts.

## Context

From [agents read rules the normal way](../docs/direction/agents-read-rules-the-normal-way.md#what-was-decided),
decided by the owner 2026-10-26. Agents write the repository too, so a hook added by mistake or by
injected text would run on the next agent's run, outside the sandbox.

## Decision

**The rule files come in; the repository's settings, hooks, env and `.claude/` stay out, even where
only trusted people work.**

- A repository's `.claude/` is set up for people's own sessions, not for agents a machine starts.
- Only `ownRules` says where a Claude run's settings come from. `pnpm lint` refuses `settingSources`
  with a source in it, or any `projectConfigRoot`, anywhere else (`fabrika/no-project-settings`).
- A step's options for the Claude adapter cannot name them: its type refuses it. A live run checks
  its options and the empty folder again before Claude Code starts.
- A run that loads the project's settings on purpose says why in an `oxlint-disable-next-line`.

## Consequences

- The repository's own skills and subagents do not load either. Copying only those into the run's
  own root is a later option, untested.
