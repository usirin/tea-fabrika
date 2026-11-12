---
id: 0250
title: Code uses Effect's own modules where they exist and checks Effect before building its own, and Node is touched only at a thin edge with a comment naming what and why
status: accepted
date: 2026-10-17
tags: [effect, platform, node, edge, both-versions]
---

# 0250: Code uses Effect's own modules where they exist and checks Effect before building its own, and Node is touched only at a thin edge with a comment naming what and why

**What this decides:** before reaching for Node or writing our own piece, code uses what Effect
already has, and every place that still touches Node says so in a comment.

## Context

Decided in [build on Effect](../docs/direction/build-on-effect.md), for the whole repo. AGENTS.md
repeats the `next/` half (owner, 2026-11-09), and the lint rule `fabrika/no-node-imports` checks it
in `next/`. [0040](0040-existing-tools-before-hand-written.md) covers checks and tools; this file
covers product code.

## Decision

**Use Effect's own module where one exists, and touch Node only at a thin, named edge.**

- Effect's modules come first: `FileSystem`, `Path`, `ChildProcess`, the platform layers,
  `KeyValueStore`. A test then swaps the real one for a fake through its Layer.
- Where Node is touched, a comment right there names what is used and why Effect's module does not
  cover it, as in `// Node at the edge: readline, because Effect's Terminal has no line editing.`
- Before building our own piece, check what Effect has (2026-10-18). Take the module when it fits,
  or copy its design when it does not, as cluster's `MessageStorage` was copied for pipe acks.
- In `next/`, one exception: a module that would replace a tea machine never comes in
  ([0254](0254-tea-is-the-one-engine.md)).

## Consequences

- One way to do a job across the repo, so code reads the same everywhere.
- What would change it: a job where Effect's module keeps falling short, so the Node edge keeps
  growing.
