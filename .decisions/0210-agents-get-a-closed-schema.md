---
id: 0210
title: An agent is handed the inner closed JSON Schema, never Effect's toJsonSchemaDocument as it comes, and its answer's numbers are Schema.Finite, never Schema.Number
status: accepted
date: 2026-10-11
tags: [schema, json-schema, agents, effect-schema, draft]
---

# 0210: An agent is handed the inner closed JSON Schema, never Effect's toJsonSchemaDocument as it comes, and its answer's numbers are Schema.Finite, never Schema.Number

**What this decides:** the shape of the JSON Schema an agent gets for its answer.

```ts
// From the note.
Schema.toJsonSchemaDocument(ShellEnd);
// { dialect: "draft-2020-12", schema: {...}, definitions: {} }   refused: unknown keyword "dialect"
jsonSchema(ShellEnd);
// { type: "object", properties: {...}, required: [...], additionalProperties: false }   accepted
```

## Context

Claude Code checks an output schema strictly before the first turn, and the run dies if it does
not pass. It refuses zod's `$schema` line and the document Effect hands back as it comes. This was
checked at no cost against a closed local port. See
[data first, markdown is a view](../docs/direction/data-first-markdown-is-a-view.md), "The JSON
Schema an agent is handed".

## Decision

**An agent is handed the inner schema, closed, with shared parts under `$defs`, never
`Schema.toJsonSchemaDocument`'s document as it comes.**

- In today's version the helper is `jsonSchema` in `packages/fabrika/src/agents/claude/schema.ts`.
- An agent's answer uses `Schema.Finite` for numbers. `Schema.Number` adds the strings `"NaN"` and
  `"Infinity"` to what the agent may write.
- A Draft may use a schema whose two sides differ, because its answer is outside data read through
  the schema's JSON codec.

## Consequences

- No agent had answered against an Effect-made schema when this was written; the check was of the
  schema, not of a model filling it in.
