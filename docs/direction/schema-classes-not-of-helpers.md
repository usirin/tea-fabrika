# Data is a Schema class with its helpers on it; no `somethingOf`

Decided 2026-10-29. The full rename list is still being drawn up.

```ts
// Before: a struct, and a loose function named after what it returns.
export const One = Schema.Struct({ready: Schema.Boolean, ticket: Schema.NullOr(Ticket), now: Schema.Finite});
export const oneOf = (s: Tracker): One => ({ready: s.ready, ticket: ..., now: s.now});

// After: a class. Its helpers are statics on it, and `make` comes with it.
export class OpenTicket extends Schema.Class<OpenTicket>("OpenTicket")({
	ready: Schema.Boolean,
	ticket: Schema.NullOr(Ticket),
	now: Schema.Finite,
}) {
	static fromTracker(s: Tracker): OpenTicket {
		return OpenTicket.make({ready: s.ready, ticket: ..., now: s.now});
	}
}
```

## What is decided

- **No new `somethingOf` names.** About 475 of them exist today, with about
  3,100 calls. They do not read like Effect, and the name says what comes out,
  not where it lives.
- **Data with behavior is a `Schema.Class`.** Its helpers are statics or
  methods on the class, so domain logic lives on the domain object.
- **A member of a union is a `Schema.TaggedClass`.** `_tag` earns its place only
  where something switches on it. A shape that is never in a union has no tag.
- **Names follow Effect:**
  - builds from fields: the class's own `make` (or `new`);
  - turns an A into this: `fromA`, like `Option.fromNullable`;
  - turns this into a B: `toB`, like `Duration.toMillis`;
  - reads one part: a plain name, no `Of`.
- **Errors are not part of this sweep.** Every error a person or an agent sees
  becomes a `Schema.TaggedError` in the error pass
  ([errors are diagnostics](./errors-are-diagnostics.md)). Today: 43
  `Schema.TaggedError`, 86 plain `new Error(...)` and 4 hand-written
  `extends Error` in source files.
- **A lint keeps the old name from coming back,** after the sweep.

## Why

- **It is Effect's own shape.** Effect 4.0.6 gives every `Schema.Class` a
  constructor, `make` and `makeOption`. Its modules name conversions `fromX`
  and `toX`.
- **One import carries the type, the schema and its helpers.** Today a reader
  imports `One` and `oneOf` and has to guess they belong together.

## What it costs

- **`make` and the class constructor check the value and throw** when it does
  not fit; `makeOption` gives none instead. Today's `somethingOf` builders copy
  fields with no check. So every swap to `make` is a behavior change, kept in
  its own pull request with its tests, apart from plain renames.
- One sweep, package by package, after the `runs` to `timeline` rename lands.

## Doubts

- **Class instances next to plain objects (70% sure it is fine).** Tests, tea
  state and view data sent to a window may hold plain objects where the class
  is expected. Whether that still typechecks, and whether a test's `toEqual`
  treats an instance and a plain object as equal, is being checked. Moving
  `OpenTicket` first and running the tests settles it.

## Sources

- Effect 4.0.6, `Schema.d.ts`: `Class`, `TaggedClass`, `make`, `makeOption`.
