---
id: 0251
title: Types are inferred from the code that knows them, never written by hand, except a service's type in its contract file
status: accepted
date: 2026-10-13
tags: [types, inference, effect, schema, services, both-versions]
---

# 0251: Types are inferred from the code that knows them, never written by hand, except a service's type in its contract file

**What this decides:** a type that the code already knows, such as a schema's, is read off it, and
spelling it out again is a smell; the one exception is a service's contract.

## Context

Decided in [build on Effect](../docs/direction/build-on-effect.md). In `next/`,
[0095](0095-a-service-file-holds-only-its-contract.md) later made a service file hold its type
written out, never inferred from an implementation. This file states the rule in that current form.

```ts
// Yes: the type comes from the schema.
type Ticket = typeof Ticket.Type;
```

## Decision

**Let a type come from the code that already knows it.**

- A schema's type is `typeof X.Type`; a machine's model, Msg and view types come from the machine.
- Writing out by hand a type that the code already knows is a smell, in both versions.
- **Exception, `next/`:** a service's type is written out in its contract file, never inferred from
  a layer, as [0095](0095-a-service-file-holds-only-its-contract.md) says.

## Consequences

- One source for each type, so a change to a schema changes its type everywhere.
- A contract can be read and imported without its implementation.
