---
id: 0436
title: In today's version, one program waits on another by an ask and an answer under the asker's id, as plain inputs and outputs, until enough programs need a helper
status: accepted
date: 2026-10-17
tags: [tea-program, ask, answer, coordination, todays-version]
---

# 0436: In today's version, one program waits on another by an ask and an answer under the asker's id, as plain inputs and outputs, until enough programs need a helper

```ts
yield* tell(run, "ask", { id: intent, pr: url }); // asked again after a crash: answered again, nothing runs twice
yield* tell(run, "forget", { id: intent });       // the answer is saved: ship drops its copy
```

**What this decides:** how two of today's programs wait on each other.

## Context

From [tea-program](../docs/direction/tea-program.md#parts-already-decided). In `next/`, a program
mails another's named mailbox and gets a reply
([0103](0103-a-program-may-mail-another-by-name.md)), which is the helper this rule waited for.

## Decision

**An ask and its answer are plain inputs and outputs, keyed by an id the asker keeps.**

- An ask sent again after a crash is answered again, and nothing runs twice.
- A helper comes only once enough programs need it.

## Consequences

- Each pair of programs wires its own ask and answer in today's version.
