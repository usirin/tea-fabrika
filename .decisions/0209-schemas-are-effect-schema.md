---
id: 0209
title: Schemas are written in Effect Schema, and zod stays only in code not yet moved
status: accepted
date: 2026-10-11
tags: [schema, effect-schema, zod, tea]
---

# 0209: Schemas are written in Effect Schema, and zod stays only in code not yet moved

**What this decides:** which schema library new code uses, in both versions.

## Context

Settled on 2026-10-11. `@demlik/tea` takes any Standard Schema, and tea's Effect entry wraps an
Effect schema in its own `Cmd.make`, so no caller writes `Schema.toStandardSchemaV1`. See
[data first, markdown is a view](../docs/direction/data-first-markdown-is-a-view.md). AGENTS.md
says the same.

## Decision

**New schemas are Effect Schema; zod stays only in code that has not moved yet.**

- A Cmd is defined through one of the pipeline primitives or through tea's `Cmd.make` from
  `@demlik/tea/effect`.
- Old code moves when it is touched, or in one pass. A zod schema does not nest inside an Effect
  struct, so a full move goes leaves first.
- A Cmd's schema has the same type on both sides. A schema that changes the type, or needs a
  service, does not compile in tea's `Cmd.make`.

## Consequences

- `next/` has no zod. Today's version still has zod in places, marked to go when zod does.
