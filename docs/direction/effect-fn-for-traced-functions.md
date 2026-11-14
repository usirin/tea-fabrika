---
state: "decided 2026-11-07; rule off"
summary: "`next/`. Every exported function that returns an Effect is `Effect.fn(\"<piece>.<verb>\")`, so each call gets a named span and a stack frame; internal helpers and hot loops use `Effect.fnUntraced`. Effect's `effectFnOpportunity` rule blocks once its false alarms are about 0%; the first count was 11 of 17, so it stays off."
---

# A function that returns an Effect is written with `Effect.fn`

**Decided 2026-11-07 by the owner.** This is about `next/`. Today's code is not changed.

Its decided rules are in: [0252](../../.decisions/0252-effect-fn-for-exported-effects.md).

```ts
import { Effect } from "effect";

// Exported, so traced: each call opens one span named "ledger.append",
// and a failure's stack shows this frame.
export const append = Effect.fn("ledger.append")(function* (stream: string, id: string, line: Line) {
	yield* Effect.annotateCurrentSpan({ "fab.stream": stream, "fab.id": id });
	const placed = yield* place(stream, id, line);
	return placed;
});

// Internal helper or hot loop: the same shape, no span, no stack frame.
const place = Effect.fnUntraced(function* (stream: string, id: string, line: Line) {
	// ...
});

// A span, as a tracer shows it:
//   ledger.append   { fab.stream: "counter:1/inbox", fab.id: "m-7" }   1.4 ms
```

`Line`, `place`, the attribute keys and the 1.4 ms in the first block are made up, a sketch.

## The rule

- **Every exported function that returns an Effect** is written with
  `Effect.fn("<piece>.<verb>")(function* ...)`. Each call gets a named span and an Effect
  stack frame, so a failure says which function it came through.
- **Internal helpers and hot loops** use `Effect.fnUntraced(function* ...)`: the same shape,
  no span and no stack frame.
- **Effect's own checker rule `effectFnOpportunity`** becomes an error for `next/` once its
  false alarms are counted and found to be about 0%, as a check that blocks needs
  ([Checks in AGENTS.md](../../AGENTS.md#checks)). The first count is below. It is far from 0%,
  so the rule stays off for now.
- **A named exception, the span sink.** The span sink's own functions use unnamed `Effect.fn`
  (a stack frame, no span), since the sink would otherwise record spans about itself.
  *Changed 2026-11-07 (lead, from P37's build).*

What Effect's docs say each one does
(`node_modules/.pnpm/effect@4.1.1/node_modules/effect/src/Effect.ts`):

- `Effect.fn` (lines 24102 to 24227): "Call `Effect.fn("operationName", options?)(body, ...)`
  when that boundary should have a readable operation name and the returned `Effect` should
  create a tracing span when run." Called without a name, `Effect.fn(body)` makes a stack frame
  and no span.
- `Effect.fnUntraced` (lines 24003 to 24100): "It does not record an Effect stack-frame boundary
  and does not create tracing spans."
- Both, compared to a plain function that returns `Effect.gen`, reuse the generator body
  "instead of allocating a fresh generator closure around the arguments on every call".

## Span names

A span name is `<piece>.<verb>`, the piece's word from the glossary and the
verb the function's own name, spelled as the function spells it, two-word verbs included
(`process.isLive`, `transport.checkSshsig`), as Effect's own docs do. *Changed 2026-11-09 (owner):
"all lowercase" applies to the piece only. It said: "all lowercase".* The names already in `next/` on main follow it:

| Span | Where it is today |
|---|---|
| `ledger.append`, `ledger.read`, `ledger.wait`, `ledger.ring` | `next/packages/libfabrika/src/data/referee.ts:301-410` |
| `ledger.call` | `next/packages/libfabrika/src/data/ledger.ts:91`, the caller's side of a remote call |

`mailbox.send` and `members.write` are the next names in this shape. Neither is on main yet
(checked 2026-11-07), so this note does not say more about them.

Options on `Effect.fn` are fixed when the function is made. An attribute that depends on an
argument, such as the stream, goes in the body with `Effect.annotateCurrentSpan`, as the first
block does.

## How the notes on spans change

Two settled notes say spans come from `Effect.withSpan`:

- [A JobRecord holds its trace](./a-job-record-holds-its-trace.md), line 14: "Its spans come from
  Effect's own `Effect.withSpan` in the runner".
- [A local-first sync engine](./a-local-first-sync-engine.md), line 179: "They come from Effect's
  own `Effect.withSpan`".

Both now say the spans come from `Effect.fn`. `Effect.withSpan` stays for a span around one part
of a function, or around an Effect that no function of ours makes. Every span is still Effect's
own; only how a function gets its span changes. The five `withSpan` calls in `next/` today move
to `Effect.fn` in the pull request that next touches each file.

## When to use `fnUntraced`

- A helper that is not exported, such as `notesOn` in `next/apps/fabrika/src/exam/commits.ts`.
- A function called once per item in a loop, where one span per item would bury the span around
  the loop.
- A test helper.

A lean, owner to check: an internal helper whose span a test already reads keeps `Effect.fn`.
`ledger.call` is the case. It is inside `Ledger.remote`, not exported, and
`next/packages/libfabrika/src/data/spans.test.ts` checks the spans it makes.

## The count: `effectFnOpportunity` on `next/`, 2026-11-07

One run of `@effect/tsgo` 0.63.0 on `next/packages/libfabrika` and `next/apps/fabrika`, with the
rule set to `error` in a throwaway change that was reverted.

**First run, our config with only the rule turned on: 0 findings.** The rule's `effectFn` option
defaults to `["span"]`
(`node_modules/.pnpm/@effect+tsgo@0.63.0/node_modules/@effect/tsgo/README.md:360`), and the
`span` fix is offered only for an `Effect.gen` that already ends in `.pipe(Effect.withSpan(...))`.
With no fix to offer, the rule says nothing
([its source](https://github.com/Effect-TS/tsgo/blob/main/internal/rules/effect_fn_opportunity.go),
`firstAvailableFixName`). A probe file with a plain `export const f = (n) => Effect.gen(...)` was
not flagged either.

**Second run, `effectFn: ["span", "inferred-span", "suggested-span"]`: 17 findings.** Each was
checked by hand.

| Finding | Where | Count | Verdict |
|---|---|---|---|
| An exported function whose body is one `Effect.gen` | `asks`, `exam/edges.ts:69` | 1 | real: `Effect.fn` |
| An internal helper whose body is one `Effect.gen` | `notesOn`, `report`, `loggedAt` in `exam/commits.ts`; `handIn` in `log.test.ts`; `signedThenSwapped` in `sshsig.test.ts` | 5 | real, but the fix is `fnUntraced`, not the `Effect.fn("notesOn")` the rule offers |
| A service method that hands on an Effect another function makes | `append` and two `wait`s in `data/ledger.ts:69-106` | 3 | false: `referee.wait` and `call` already open `ledger.wait` and `ledger.call`, so a wrap adds a second span |
| A fake `Doorbell.ring` in a test, `Effect.void` or one `Effect.sync` | `ledger.test.ts`, `log.test.ts`, `rings.test.ts`, `spans.test.ts` | 7 | false: a test double; in `spans.test.ts` a new span would change the spans the test counts |
| A one-off `onSome` callback inside `Option.match` | `transport/sshsig.ts:201` | 1 | false: a callback made once per call, not a function anyone calls by name |

**6 real, 11 false: 65% false alarms.** The bar to block is about 0%, so the rule stays off for
`next/`, and this pull request does not change `tsconfig.base.json`.

The rule also misses the functions this decision is mostly about:

- **It skips any function with a return type.** `checkSshsig` in `transport/sshsig.ts:184` is
  exported, returns `Effect.Effect<Answer>`, and was not flagged.
- **It flags only a single `Effect.gen` body, or a block of more than five statements.**
  Referee's `append`, an `atomic(...).pipe(Effect.withSpan("ledger.append"))`, was not flagged.
- **Its span names are not ours.** It offers `Ledger.append` (the service's name and the member)
  where we write `ledger.append`.
- **It cannot tell exported from internal**, so it cannot say `fn` or `fnUntraced` the way this
  rule does.

What would settle it: a rule of our own in `oxlint-plugins/` that fires on an exported function
in `next/` returning an Effect and not written with `Effect.fn`, with its false alarms counted
the same way. Or a later `@effect/tsgo` whose rule covers these cases, counted again.

## What it costs

- **One span per call** of every exported function: a span object, its attributes and its trip
  to the tracer. Nobody has measured how much on our code. `fnUntraced` on helpers and loops
  keeps the count down.
- **A stack frame per call** for `Effect.fn`, which is what makes a failure point at a function.
- **A rule of our own since ticket 285.** `fabrika/effect-functions` in `oxlint-plugins/` blocks a
  named function in `next/` whose whole body is wrapped in `Effect.withSpan`. On all of `next/` it
  found 9: 8 real, 1 false alarm in a test helper, so tests were left out, and then 0 false alarms
  (`oxlint-plugins/README.md`). It reads syntax only: it does not check that a helper uses
  `fnUntraced`, so a reader still keeps that part.

**How sure: 90%** on the rule; it is Effect's own documented way, and the spans `next/` already
writes fit it. **50%** on the `ledger.call` lean, which the owner has not looked at.

## What it cannot tell us

- What a span per call costs on a hot path such as a ledger read. Not measured.
- Whether `<piece>.<verb>` holds once more pieces exist. Five names on main is a small sample.
- How the rule behaves on more code. 17 findings on two packages is one small run, and most of
  `next/` is not written yet.
- Whether the 11 false alarms are a fixed shape (service methods and test fakes) that an
  `overrides` entry could leave out. Not tried.
