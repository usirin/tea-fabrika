---
id: 0527
title: A law checked only by the compiler is titled type:, a fifth label beside 0093's four, and lint accepts it only on a body of type assertions
status: accepted
date: 2026-11-14
tags: [tests, laws, labels, lint, types, next]
---

# 0527: A law checked only by the compiler is titled type:, a fifth label beside 0093's four, and lint accepts it only on a body of type assertions

**What this decides:** a test that checks only types at compile time gets the title label `type:`,
and the law-shape lint accepts that label only when the test's body asserts types and nothing at run
time.

```ts
// Kept: a type law. The compiler checks it; there are no samples to draw.
it("type: no service of access/ fails with an error tagged LedgerError", () => {
  expectTypeOf<FromLedger<Sessions>>().toBeNever();
});
// Refused by lint: a runtime check under the type label.
it("type: the session opens", () => {
  expect(open()).toBe(true);
});
```

## Context

[0093](0093-laws-walk-plants-run-once.md) says each law is a property, or a fixed example whose
title starts with `vector:`, `format:`, `pinned:` or `scenario:` and its reason. About seven tests
in `next/` check only types with `expectTypeOf`, for example
`next/packages/libfabrika/src/access/Access.types.test.ts`. They cannot be properties, since the
compiler checks them and nothing is drawn. None of the four labels describes them truthfully.
`pinned:` means a named past bug
([five steps for every check](../docs/direction/five-steps-for-every-check.md)). When
[PR 1199](https://github.com/kamp-us/tea-fabrika/pull/1199) made the law-shape rule block in
`access/`, one such law had to be titled `pinned:` with its reason, as a stopgap. The advice lane
for that PR raised the question, and the owner said yes to a fifth label.

## Decision

**A law that only the compiler checks is titled `type:` with its reason, and the law-shape rule
accepts `type:` only on a body made of type assertions.**

- **The label:** `type:`, after the optional ticket or law id, as for the other four
  (`T952 type: ...`).
- **Its body:** only compile-time assertions: Vitest's `expectTypeOf` and `assertType`, and type
  declarations. A body with a runtime `expect(...)`, `fc.assert` or any other call fails lint under
  the `type:` label. That way the label cannot become a way out for a law that should be a property.
- **The other four labels and the property rule do not change.**

**Binding constraints**

- `type:` never excuses a runtime check. A test that mixes a type assertion with a runtime one is a
  property or one of the other four labels.
- The rule that checks the body lives in `oxlint-plugins/law-shape.ts`, beside the label list, with
  its laws and plants, as 0093's rule does.

## Consequences

- `oxlint-plugins/law-shape.ts` adds `type` to its labels and checks a `type:` body. Its message
  names the fifth label.
- The type laws titled `pinned:` as a stopgap, starting with `Access.types.test.ts:29`, move to
  `type:`.
- [0093](0093-laws-walk-plants-run-once.md)'s four labels become five. Its other rules hold.
- Not decided here: whether `.test-d.ts` files or `vitest typecheck` mode would be the better home
  for type laws. Today they run as plain tests.

## Records

- `.glossary/TERMS.md`: a `type (label)` row beside the other labels.
- `docs/direction/five-steps-for-every-check.md`: the label table gains its `type:` row.
