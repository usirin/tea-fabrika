# Data is a `Schema.Opaque` with its helpers on it; no `somethingOf`

Decided 2026-10-29. Changed the same day from `Schema.Class` to `Schema.Opaque`,
after a test showed the trap below.

```ts
// Before: a struct, and a loose function named after what it returns.
export const One = Schema.Struct({ready: Schema.Boolean, ticket: Schema.NullOr(Ticket), now: Schema.Finite});
export const oneOf = (s: Tracker): One => ({ready: s.ready, ticket: ..., now: s.now});

// After: the struct wrapped in Schema.Opaque. The class gives it a name and a place for
// helpers; nobody calls `new` on it. Values stay plain objects.
export class OpenTicket extends Schema.Opaque<OpenTicket>()(
	Schema.Struct({ready: Schema.Boolean, ticket: Schema.NullOr(Ticket), now: Schema.Finite}),
) {
	static fromTracker(s: Tracker): OpenTicket {
		return OpenTicket.make({ready: s.ready, ticket: ..., now: s.now}); // make checks the value
	}
}

const t = OpenTicket.fromTracker(state); // {ready, ticket, now}, a plain object
Schema.encodeSync(OpenTicket)({...t, now: 3}); // a spread still encodes, so a kept state still saves
```

## What is decided

- **No new `somethingOf` names.** 443 of them exist today, declared about 800
  times, with about 3,300 calls. They do not read like Effect, and the name says
  what comes out, not where it lives.
- **Data with behavior is a `Schema.Opaque` with static helpers.** Domain logic
  lives on the domain object, and the value stays a plain object.
- **Helpers are statics, never instance methods or getters.** One instance
  method makes every plain literal and every spread fail to typecheck.
- **A member of a union is a `Schema.TaggedStruct` wrapped the same way.**
  Every union we define uses `_tag`, written by Effect Schema and never by hand.
  tea's Msgs and Cmds keep `type`, and third-party shapes keep theirs. `kind` on
  ledger entries stays open under ticket 32. A tagged member inside a
  `Schema.Union` was tested and works. *(Changed 2026-11-01; it used to say `_tag`
  earns its place only where something switches on it. Today's code is not changed
  by this.)*
- **Export the class itself.** `.annotate()` makes a new schema without the
  statics.
- **A name with no data type to own it is a plain named function,** with no
  `Of` (about 105 of them).
- **Names follow Effect:**
  - builds from fields: `make`;
  - turns an A into this: `fromA`, like `Option.fromNullable`;
  - turns this into a B: `toB`, like `Duration.toMillis`;
  - reads one part: a plain name, no `Of`.
- **Errors are not part of this sweep.** Every error a person or an agent sees
  becomes a `Schema.TaggedError` in the error pass
  ([errors are diagnostics](./errors-are-diagnostics.md)).
- **A lint keeps the old name from coming back.** It fails a declared name that
  ends in `Of`, never an import, and is turned on folder by folder as each sweep
  pull request lands. Measured on today's code: one false alarm in about 1,400
  hits.

## Why not `Schema.Class`

`Schema.Class` makes real class instances. Tested on Effect 4.0.6, with tsc and
vitest:

| On a plain object or a spread | `Schema.Class` | `Schema.Opaque` |
|---|---|---|
| typechecks where the type is expected | yes, if only statics | yes |
| `Schema.is` | false | true |
| `Schema.encode` | throws "Expected X" | works |
| JSON, `structuredClone`, spread | drops the class | nothing to drop |
| `toStrictEqual` with a plain object | fails | passes |

tea's `update` returns spreads (`{...s, now}`), and the host encodes every kept
state through its schema when it saves (`packages/fabrika/src/program/storage.ts`).
With `Schema.Class` inside a kept state, an ordinary spread becomes a failed
save, and the types do not warn.

## What it costs

- **`make` checks the value and throws** when it does not fit; `makeOption`
  gives none instead. Today's `somethingOf` builders copy fields with no check.
  So every swap to `make` is a behavior change, kept in its own pull request
  with its tests, apart from plain renames. Example: a window given a `NaN`
  time draws slightly off today; after the swap it throws.
- 18 pull requests, package by package: 13 plain renames and 5 swaps to `make`.
  `OpenTicket` goes first among the swaps, after `runs` becomes `timeline`.
- About 68 names belong to a plain interface today (`Grid`, `Desk`). Making
  each one a schema is more than a rename.

## Doubts

- **Opaque stays structural (85% sure).** Effect's docs call it "nominally
  distinct". With its default brand it tested structural: a plain literal
  typechecks as `OpenTicket`. One type test in the first pull request pins it.

## Sources

- Effect 4.0.6, `Schema.d.ts`: `Opaque`, `Class`, `TaggedStruct`, `make`, `makeOption`.
