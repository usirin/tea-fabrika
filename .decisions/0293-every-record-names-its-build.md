---
id: 0293
title: In next/, every record a process writes carries the build that wrote it, each load, refusal and failure is a code.loaded, code.refused or code.failed event, and a swap shows a quiet word and icon on its tile
status: accepted
date: 2026-11-01
tags: [hot-reload, build, events, ledger, record-wide, accessibility, next]
---

# 0293: In next/, every record a process writes carries the build that wrote it, each load, refusal and failure is a code.loaded, code.refused or code.failed event, and a swap shows a quiet word and icon on its tile

**What this decides:** what a code change leaves on the record, and what a person sees.

```ts
// A sketch. Effect Schema writes `_tag`.
const From = Schema.Literals(["watch", "deploy", "boot", "restart"]);
const CodeLoaded = Schema.TaggedStruct("code.loaded", { program: Schema.String, hash: Hash, was: Schema.NullOr(Hash), from: From });
const CodeRefused = Schema.TaggedStruct("code.refused", { program: Schema.String, hash: Hash, was: Hash, reason: Schema.String });
const CodeFailed = Schema.TaggedStruct("code.failed", { program: Schema.String, hash: Schema.NullOr(Hash), reason: Schema.String });
```

## Context

Decided by the owner in [hot reload](../docs/direction/hot-reload.md) (H6 and what is lost if not
recorded now). The note's sketch says `why`; [0081](0081-no-question-word-names.md) makes it
`reason`. The ledger entry's `build` field landed in Tier 1's P6.

## Decision

**Which code made each record is the one fact that cannot come back later.**

- Every record a process writes carries the `build` that wrote it: each step, Cmd and job record
  (90%).
- Each load, refusal and failure is a `code.loaded`, `code.refused` or `code.failed` event, so every
  `build` has an earlier `code.loaded`. A window's hello carries its own build.
- A swap shows a quiet word and icon on that tile's title bar, never color alone, gone at the next
  key. A refusal or an error stays until acted on (65%).
- An agent sees the same events through its tools.

## Consequences

- A result can always say which code judged it, which a pinned lane needs
  ([0295](0295-where-hot-reload-is-off.md)).
