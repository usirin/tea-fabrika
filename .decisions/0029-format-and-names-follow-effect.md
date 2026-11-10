---
id: 0029
title: The repo formats code as Effect does, oxfmt stays, Module.of is allowed and a service that holds many has a plural name
status: amended-in-part by [0039](0039-keep-semicolons-and-es5-commas.md)
date: 2026-11-09
tags: [style, format, oxfmt, names, of, services, effect, next]
---

# 0029: The repo formats code as Effect does, oxfmt stays, Module.of is allowed and a service that holds many has a plural name

**What this decides:** the owner closed most of
[0023](0023-next-follows-effects-code-style.md)'s open differences toward Effect: the format
settings, `of` read through its module, and plural service names.

```ts
// before: tabs, 100 columns, semicolons, trailing commas, no spaces in braces
import {Effect} from "effect";
export const make = (n: number) =>
	Effect.gen(function* () {
		return {n, ok: true};
	});

// after: Effect's settings (2 spaces, 120 columns), oxfmt's generator star
import { Effect } from "effect"
export const make = (n: number) =>
  Effect.gen(function* () {
    return { n, ok: true }
  })

// allowed: `of` read through its module, as Effect has `Chunk.of` and `Array.of`
import * as Lease from "./Lease.ts"
const lease = Lease.of(input)

// a service that holds many is plural, as Effect has `Runners` and `Servers`
class Leases extends Context.Service<Leases>()("Leases", { ... }) {}
```

*[0039](0039-keep-semicolons-and-es5-commas.md) brings back semicolons and trailing commas; the rest of this file still holds.*

## Context

0023 listed each place where our style differs from Effect's at `effect@4.1.2` and left the owner
to pick each one. The owner picked on 2026-11-09, in one walk. The settings come from Effect's
`dprint.json` at that tag, as 0023 reads them. The owner weighed the case for tabs (each reader
sets their own indent width, which helps low-vision readers) and chose to follow Effect anyway.

This amends 0023 in part and the format line of [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).
Tickets: 465 (this record), 466 (the format sweep), 467 (the `no-of` rule), 468 (the service
rename sweep).

## Decision

**The repo's format follows Effect's settings, oxfmt stays the formatter, `Module.of(...)` is
allowed, and a service that holds many is named in the plural.**

- **Format, for the whole repo** (one `.oxfmtrc.json`): 2-space indent, 120 columns, no semicolons,
  no trailing commas, spaces inside braces (`{ a }`). JSON keeps its own settings.
- **The formatter stays oxfmt, not dprint.** So the generator star stays oxfmt's `function* ()`
  where Effect writes `function*()`. That is a kept difference: one space does not pay for a
  formatter swap. No upstream issue.
- **`of` read through its module is allowed,** as Effect does it: a module exports `of` and a reader
  calls `Lease.of(...)` under a namespace import. A bare `of(...)` (imported by name) and any `xOf`
  name (`nameOf`, `outcomesOf`, `colorsOf`) stay banned in `next/`.
- **A service that holds many is named in the plural:** `Leases`, as Effect has `Runners`,
  `Servers` and `Notifications`. This replaces the `<Thing>Manager` rule. Existing `*Manager`
  names in `next/` are renamed by one sweep, ticket 468.
- **Braces on `if` bodies** are a kept difference too: the owner decided them in their own record
  (ticket 439). Effect has no `curly` rule.

Binding constraints:

- A pull request formats with these settings; `pnpm lint` fails a file that is not formatted.
- The `no-of` rule passes a module's top-level `of` and still fires on a named import of `of`, an
  `of` parameter, key or member, and every `xOf` name (ticket 467). Until that lands the rule fires
  on every declared `of`, so nobody adds one first.
- A new service that holds many takes the plural name from today.

## Consequences

- One sweep reformats every file (ticket 466). It lands after the braces sweep for ticket 439,
  since both touch every file. A paused lane runs `pnpm format` after it merges main.
- Lines get longer and indents narrower. A reader who wants a wider indent can no longer set it in
  the editor; that is the cost the owner accepted.
- 0023's table now closes these rows: indent, line width, semicolons, trailing commas, spaces in
  braces, generator star (kept), bare `of`, plural service names.
- Not decided here: anything else 0023 still marks open.

## Records

- `.glossary/TERMS.md`: the `Manager (service)` row becomes a plural service name row.

## Amendments

- 2026-11-09: `func-style: declaration` stays off; arrow consts are fine, as Effect writes them
  (7,693 hits when tried; owner's call). The format sweep, ticket 466, changed no lint rule.
