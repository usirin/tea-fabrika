---
id: 0118
title: Doc comments in next/ carry no @since tag until libfabrika has a released version
status: accepted
date: 2026-11-11
tags: [doc-comments, effect, style, since, libfabrika, next]
---

# 0118: Doc comments in next/ carry no @since tag until libfabrika has a released version

```ts
/**
 * The runner refused an input before the program saw it.
 *
 * @stability unstable
 * @category errors
 */
export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
  reason: Schema.Literals(["bad_input", "bad_client"]),
}) {}
```

**What this decides:** a doc comment in `next/` is written without `@since` for now, and the tag
comes back when `libfabrika` first ships a version.

## Context

[0023](0023-next-follows-effects-code-style.md) asks for Effect's doc comments on every public
export, with `@stability`, `@category` and `@since`, and leaves one item open: what `@since` holds
while `libfabrika` is `0.0.0`. No file in `next/` has the tag today. The owner settled it on
2026-11-11, in the walk of the Effect code guidelines: a tag that would say `0.0.0` on every export
tells a reader nothing.

This amends 0023 in part: its doc comment rule stands, minus the one tag.

## Decision

**No `@since` in `next/` until `libfabrika` has a released version.**

- A module block carries `@stability`. A public export carries `@stability` and `@category`.
- The docs lint rule that 0023 plans to copy from Effect does not ask for `@since`.
- When `libfabrika` first ships a version, the tag is added in one sweep, with that version on
  everything that exists then.

## Consequences

- One fewer line on every doc block, and no made-up value to keep in step.
- The cost: the first release adds the tag to every export at once, so "since when" is lost for
  anything written before it. That is true today as well.
- [The doc comments pattern](../.patterns/doc-comments.md) shows Effect's own blocks, which keep
  the tag; its note on our tree now points here.
