---
id: 0213
title: Data with behavior is a Schema.Opaque with static helpers named as Effect names them, never a Schema.Class, an instance method or an Of name
status: accepted
date: 2026-10-29
tags: [schema, effect-schema, opaque, names, statics, domain-objects]
---

# 0213: Data with behavior is a Schema.Opaque with static helpers named as Effect names them, never a Schema.Class, an instance method or an Of name

**What this decides:** how a data type and its helpers are written, so values stay plain objects.

```ts
// From the note. The class gives the struct a name and a place for helpers; nobody calls `new`.
export class OpenTicket extends Schema.Opaque<OpenTicket>()(
  Schema.Struct({ ready: Schema.Boolean, ticket: Schema.NullOr(Ticket), now: Schema.Finite }),
) {
  static fromTracker(s: Tracker): OpenTicket {
    return OpenTicket.make({ ready: s.ready, ticket: s.ticket, now: s.now });
  }
}
const t = OpenTicket.fromTracker(state); // a plain object, so a spread still encodes and saves
```

## Context

Decided 2026-10-29, and changed the same day from `Schema.Class` to `Schema.Opaque` after a test:
`Schema.Class` makes real instances, so a spread such as tea's `{...s, now}` fails to encode when
the state is saved. See [schema classes, not Of helpers](../docs/direction/schema-classes-not-of-helpers.md).
[0029](0029-format-and-names-follow-effect.md) already bans `xOf` names and a bare `of` in `next/`.

## Decision

**Data with behavior is a `Schema.Opaque` with static helpers; the value stays a plain object.**

- Domain logic lives on the domain object, as statics.
- Helpers are statics, never instance methods or getters: one instance method makes every plain
  literal and spread fail to typecheck.
- Export the class itself, never an `.annotate()` copy, which drops the statics.
- Names follow Effect: a builder from fields is `make`; turning an A into this is `fromA`, like
  `Option.fromNullable`; turning this into a B is `toB`, like `Duration.toMillis`; a reader of one
  part is a plain name.
- A name with no data type to own it is a plain named function, never an `Of` name.
- No new `somethingOf` name in either version. Today's existing ones stay until that code goes.

## Consequences

- `make` checks the value and throws where today's `somethingOf` builders copied fields with no
  check, so a swap to `make` is a behavior change.
- Which of `make`, `makeEffect` and `decodeResult` to call is
  [0215](0215-untrusted-input-never-throws.md).
- Errors are not part of this rule.
