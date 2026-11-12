---
id: 0399
title: Every agent reads a repository's rule files itself, the way its maker ships it, with the nearest AGENTS.md winning, and the reviewer is also handed main's copy of the rules
status: accepted
date: 2026-10-26
tags: [agents, rules, review, agents-md]
---

# 0399: Every agent reads a repository's rule files itself, the way its maker ships it, with the nearest AGENTS.md winning, and the reviewer is also handed main's copy of the rules

```ts
// A sketch, from the note.
const built = yield* Agents.run({ prompt, folder: workingCopy, provider }); // reads ./AGENTS.md, packages/x/AGENTS.md, ...
const rules = yield* readRules({ repo, ref: "main" }); // the rules the pull request is judged by
const verdict = yield* Agents.run({ prompt: reviewBrief(pr, rules), folder: prCopy, provider });
```

**What this decides:** how an agent fabrika starts gets a repository's rules, and which rules a
pull request is judged by.

## Context

From [agents read rules the normal way](../docs/direction/agents-read-rules-the-normal-way.md#what-was-decided),
decided by the owner 2026-10-26. Built in today's version: Codex reads rule files natively, and
Claude moved over in experiment 155 (`packages/fabrika/src/agents/claude/rules.ts`).

## Decision

**An agent loads the rule files itself, as the AGENTS.md standard says, not pasted into its prompt.**

- A rule file inside a subfolder is for agents working there, and the nearest one wins.
- A pull request can change an `AGENTS.md`, so the reviewer is also handed main's copy, marked as
  the rules the change is judged by. A pull request is never judged by rules it changed.

## Consequences

- Today's ACP paths whose adapter was not tested still paste the rules into the prompt, as the note
  records.
