---
id: 0228
title: In next/'s lane, a code step's key is the hash of its recorded reads, never a hand list, and each step lists the fact kinds it writes so a law can check every need is an earlier write
status: accepted
date: 2026-11-01
tags: [lane, steps, keys, reads, writes, laws, saved-state, next]
---

# 0228: In next/'s lane, a code step's key is the hash of its recorded reads, never a hand list, and each step lists the fact kinds it writes so a law can check every need is an earlier write

**What this decides:** how a `next/` lane step knows its inputs did not change, and where a lane
resumes.

```ts
// A sketch from the note: a code step's reads are the Gather Cmds it sent,
// each with its input and answer.
// key = sha256 of [["pull_read", {number: 117}, "sha256:9a1f..."], ["main_read", {}, "92740b74"]]
```

## Context

Decided by the owner on 2026-11-01: the key at 65%, the writes at 60%. Bazel warns that without a
sandbox it cannot know if a tool uses undeclared inputs; a list made by the type system cannot leave
one out. See [saved state](../docs/direction/saved-state.md), S4.

## Decision

**In `next/`'s lane, a code step's key is the hash of its recorded reads; an agent step keeps the
hand list of what its brief named.**

- Effect's requirements list the services a code step may call, and each read's answer is
  recorded, so the key needs no hand list.
- An agent picks its own files, so agent steps keep the hand list.
- Each step lists the fact kinds it writes, and a law checks that every step's needs are some
  earlier step's writes. A resume point is then a lookup.

## Consequences

- It lands with `next/`'s lane, which is designed first from how work gets done
  ([0059](0059-pipeline-starts-from-the-work.md)).
- Listing the steps' needs and writes by hand first settles whether the map is clean.
