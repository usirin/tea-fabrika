---
id: 0354
title: A program keeps the inputs that write facts apart from the inputs that only read, as CQRS keeps commands from queries
status: accepted
date: 2026-10-27
tags: [programs, inputs, cqrs, commands, queries, mcp]
---

# 0354: A program keeps the inputs that write facts apart from the inputs that only read, as CQRS keeps commands from queries

**What this decides:** no single input of a program both writes data and only moves the view.

## Context

The owner decided this on 2026-10-27, when the tracker's one `do` input mixed `file` and `close`
with `list` and `show`
([tracker views are programs, section 7](../docs/direction/tracker-views-are-programs.md#7-inputs-one-per-command-and-one-query-decided-2026-10-27-changed-2026-10-28)).
Input names become tool names, since an agent drives programs through the shell's MCP server. The
lean of two inputs named `write` and `view` was replaced on 2026-10-28.

## Decision

**A command and a query are never the same input.**

- An input that changes data writes facts. An input that only reads changes the window and writes
  nothing.
- Fowler's CQRS: a different model to update information than the one used to read it.

## Consequences

- An agent's tool list shows which tools change data and which only read.
- How the split is shaped, one input per command and one `query`, was decided the next day
  ([0355](0355-one-input-per-command.md)).
- In `next/` the split holds, with a word change: there "input" means a write, and a read port gets
  its own word, picked with the first program that needs one
  ([a program's shape](../docs/direction/program-shape.md), 2026-11-08).
