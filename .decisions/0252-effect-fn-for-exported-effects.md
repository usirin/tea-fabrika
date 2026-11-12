---
id: 0252
title: In next/, every exported function that returns an Effect is Effect.fn("<piece>.<verb>"), and helpers, per-item loop functions and test helpers are Effect.fnUntraced
status: accepted
date: 2026-11-07
tags: [effect, spans, tracing, effect-fn, names, next]
---

# 0252: In next/, every exported function that returns an Effect is Effect.fn("<piece>.<verb>"), and helpers, per-item loop functions and test helpers are Effect.fnUntraced

**What this decides:** how a function in `next/` gets its span and its stack frame, and how the span
is named.

## Context

Decided by the owner in [Effect.fn for traced functions](../docs/direction/effect-fn-for-traced-functions.md).
[0024](0024-next-records-with-spans-and-log-lines.md) uses this shape for log lines without stating
the rule. Today's code is not changed.

```ts
export const append = Effect.fn("ledger.append")(function* (stream: string, id: string, line: Line) {
  yield* Effect.annotateCurrentSpan({ "fab.stream": stream, "fab.id": id });
  return yield* place(stream, id, line);
});

const place = Effect.fnUntraced(function* (stream: string, id: string, line: Line) {
  // ...
});
```

## Decision

**An exported function that returns an Effect is `Effect.fn("<piece>.<verb>")`; everything smaller
is `Effect.fnUntraced`.**

- `Effect.fn` gives each call a named span and an Effect stack frame.
- `Effect.fnUntraced` is for a helper that is not exported, a function called once per item in a
  loop, and a test helper.
- A span name is `<piece>.<verb>`: the piece is the glossary's word, lowercase; the verb is spelled
  as the function spells it, two-word verbs included, as `process.isLive` (changed 2026-11-09:
  only the piece is lowercase).
- An attribute that depends on an argument goes in the body with `Effect.annotateCurrentSpan`,
  since `Effect.fn`'s options are fixed when the function is made.
- `Effect.withSpan` stays only for a span around part of a function, or around an Effect that no
  function of ours makes.
- **Named exception, the span sink:** its own functions use an unnamed `Effect.fn` (a stack frame,
  no span), so the sink records no spans about itself. This was the lead's change on 2026-11-07,
  from P37's build.
- Effect's own checker rule `effectFnOpportunity` stays off: its first count on `next/` found 65%
  false alarms, and a blocking check needs about 0%. Our own `fabrika/effect-functions` lint rule
  checks part of this rule.

## Consequences

- One span per call of every exported function; what that costs on a hot path is not measured.
- Not decided: whether an internal helper whose span a test reads keeps `Effect.fn` (the
  `ledger.call` lean, 50%, not looked at by the owner).
