---
id: 0212
title: In next/, a name, field or type has one meaning in its bounded context, there is only one way to do each thing, and a hard-to-read API is changed before more code builds on it
status: accepted
date: 2026-11-08
tags: [api, names, one-way, bounded-context, readability, next]
---

# 0212: In next/, a name, field or type has one meaning in its bounded context, there is only one way to do each thing, and a hard-to-read API is changed before more code builds on it

**What this decides:** how much a `next/` API may say the same thing twice.

```ts
// A sketch from the note.
// No: two ways to make one thing.
const a = Program.make({ name: "counter", machine: counterMachine, view, inputs });
const b = defineProgram({ name: "counter", machine: counterMachine, view, inputs });
// Yes: one way.
const counter = Program.make({ name: "counter", machine: counterMachine, view, inputs });
```

## Context

Decided by the owner on 2026-11-08, first for the study of Program.make's shape. See
[one meaning, one way](../docs/direction/one-meaning-one-way.md). It extends
[use the industry's names](../docs/direction/use-the-industrys-names.md)'s "one word per idea" to
an API's parts.

## Decision

**In `next/`, one thing means one thing only, and there is only one way to do each thing.**

- A name, a field or a type has one meaning in its bounded context.
- No second constructor, no optional shortcut beside the long form, and no two shapes that mean the
  same.
- A `next/` API shape that is hard to read is changed before more code is built on it, even after
  it merged.
- Every API a `next/` plan adds is checked against this.

## Consequences

- Today's version is not changed by it.
- Not decided here: whether a helper built on top of the one way is fine. The first plans that hit
  that line decide it, one case at a time.
