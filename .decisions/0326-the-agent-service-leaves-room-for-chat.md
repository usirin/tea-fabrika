---
id: 0326
title: The agent service leaves room for a chat, with streamed text, many turns on one warm session, a person's answer to an ask and the history
status: accepted
date: 2026-10-26
tags: [agents, chat, service, streaming, sessions]
---

# 0326: The agent service leaves room for a chat, with streamed text, many turns on one warm session, a person's answer to an ask and the history

```ts
// A sketch. A chat pane calls the same service a step does; the run is the pane's Sub.
const run = Agents.run({ provider, session: chat.session, folder, prompt: typed });
// said_part { text }                                   streamed text, a bit at a time
// asked { id, options } -> Agents.answer(run, id, "allow")   a person answers
// Agents.history(chat.session)                         the turns so far
```

**What this decides:** what the agent interface of
[0325](0325-agents-behind-one-service-of-ours.md) must allow, so a chat later is one more caller,
never a rewrite.

## Context

No chat is built yet. From
[agents sit behind one service](../docs/direction/agents-behind-one-service.md#what-a-chat-window-will-need).
T3 Code's adapters behind one registry are the evidence for the shape.

## Decision

**The interface must allow four things a chat needs.**

- Streamed text: the updates carry a part kind for text as it comes.
- Many short turns on one warm session. A per-turn process and a long-lived one can both be rows in
  the provider table.
- A person's answer to an ask goes back to the run.
- The turns are kept, so a pane that opens again shows the history.

## Consequences

- Each addition is built when the chat is, not before.
- Not decided here: how a warm session sits beside the hard stop that ends an agent's processes.
