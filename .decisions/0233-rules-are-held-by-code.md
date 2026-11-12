---
id: 0233
title: A rule future work must keep is held by code and ships with what it guards, never by a warning, a doc line, a log line or a prompt, and an agent is fenced only by what it can reach
status: accepted
date: 2026-10-12
tags: [poka-yoke, guards, checks, agents, prompts, tools]
---

# 0233: A rule future work must keep is held by code and ships with what it guards, never by a warning, a doc line, a log line or a prompt, and an agent is fenced only by what it can reach

**What this decides:** what counts as protection, in both versions.

```ts
// From the note, a sketch. Not protection: "Only pass inputs that ack to workQueue."
// Protection: the wrong call does not compile.
workQueue(machines.queue, inputs.pr, shipOne, clearOne); // pr acks: fine
workQueue(machines.queue, inputs.note, noteOne, clearOne); // note does not ack: type error
```

## Context

Decided 2026-10-12; the prompt rules were set on 2026-10-04 and 2026-10-05. Today's fabrika had
rules in prose against its review text growing, and the text grew anyway (experiment 59). Agents
told in their prompt not to read deleted tests read them through the shell anyway, in most
sessions, until the shell was taken away. See
[make the mistake impossible](../docs/direction/make-the-mistake-impossible.md).

## Decision

**A rule future work must keep is held by code: a type, a refusal at run time, or a test that
fails.**

- A warning, a doc line, a log line or a prompt is not protection. Notes are where a rule starts;
  a rule that matters ends up in code.
- A guard ships with what it guards, never after it. A risky form ships only in a version that
  cannot fail that way.
- A prompt is not a fence. An agent is limited by what it can reach: its real tool list and its
  folder. Anything it must not read must not be anywhere it can reach, history included. What it
  did is checked in the session log, not in the config.

## Consequences

- What would change it: a guard that costs more to build and keep than the harm it stops, on a
  mistake that has never happened.
