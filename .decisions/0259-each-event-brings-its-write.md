---
id: 0259
title: In next/, a fact is an Event, each event brings its own write Cmd made by libfabrika and names its stream once, and Program.make reads the events off the machine's cmds
status: accepted
date: 2026-11-08
tags: [programs, program-shape, events, cmds, streams, next]
---

# 0259: In next/, a fact is an Event, each event brings its own write Cmd made by libfabrika and names its stream once, and Program.make reads the events off the machine's cmds

**What this decides:** how a program writes to the ledger in `next/`: through each event's own write
Cmd, never a write Cmd of its own.

```mermaid
flowchart LR
  event["Event.make: schema, personOnly, stream"] --> write["answered.write, made by libfabrika"]
  write --> cmds["listed in the machine's cmds"]
  cmds --> make["Program.make reads the events off cmds"]
  update["update: answer"] --> call["answered.write(msg, Answered.make(msg))"]
  call --> answers["answered_ok or answered_err"]
```

```ts
const answered = Event.make(Answered, {
  personOnly: true,
  stream: (e) => ticketStream(e.ticket), // one place picks the stream
});
answered.write(msg, Answered.make(msg)); // no stream here
```

## Context

Decided by the owner in [a program's shape](../docs/direction/program-shape.md). The glossary's
`event` row already carries the rename. P11's one `write` Cmd per program is walked back by name.
Ticket 302 builds it; the prose sweep of the old word is ticket 303.

## Decision

**Each event brings its own write Cmd, and the machine's `cmds` is the one list of what a program
writes.**

- `Fact` becomes `Event`, event sourcing's word, in the program API and the glossary.
- Libfabrika makes each event's write Cmd. No program writes a write Cmd by hand.
- The machine lists each event's write in `cmds`, and `Program.make` reads the events off `cmds`.
  There is no second events list.
- An event names its stream once, in `Event.make`. A step never names a stream.
- An event's two answers per write (`_ok`, `_err`) are accepted as a tea problem for now, and
  nobody works around them.

## Consequences

- Two writes cannot send one event kind to two streams.
- Reopens it: the first event kind that must go to several streams, which would favor a third
  argument on the write.
