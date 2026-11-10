---
id: 0039
title: The repo keeps semicolons, and trailing commas in objects and arrays, never in function parameters or call arguments
status: accepted
date: 2026-11-09
tags: [style, format, oxfmt, semicolons, trailing-commas, effect]
---

# 0039: The repo keeps semicolons, and trailing commas in objects and arrays, never in function parameters or call arguments

**What this decides:** two of the format settings that
[0029](0029-format-and-names-follow-effect.md) took from Effect go back: statements end with a
semicolon, and a multi-line object or array ends with a comma.

```ts
// Short lines are broken here only to show the commas.
// 0029: no semicolons, no trailing commas
import { Effect } from "effect"
const lease = {
  id,
  holder
}
const made = make(
  lease,
  options
)

// 0039: semicolons, and a trailing comma in the object but not in the call
import { Effect } from "effect";
const lease = {
  id,
  holder,
};
const made = make(
  lease,
  options
);
```

```jsonc
// .oxfmtrc.json, the two settings this decides
{
  // "semi" is left out: oxfmt's default is true
  "trailingComma": "es5"
}
```

## Context

0029 set the whole format to Effect's `dprint.json`: 2 spaces, 120 columns, no semicolons, no
trailing commas, spaces inside braces. Ticket 466's sweep, which applies those settings to every
file, had not landed yet. Later on 2026-11-09 the owner picked these two settings back. The reason
is the owner's reading taste.

This amends 0029 in part, and with it the semicolon and trailing comma rows of
[0023](0023-next-follows-effects-code-style.md)'s table. Ticket 498 is this record. Ticket 466's
sweep takes the new settings.

## Decision

**Code in this repo ends statements with a semicolon, and puts a trailing comma in multi-line
objects and arrays but not in function parameters or call arguments.**

- In oxfmt's settings: `semi` is `true`, its default, so the key is left out, and `trailingComma`
  is `"es5"`.
- What `"es5"` does was checked on the installed oxfmt, 0.75.0, by formatting a sample file. A
  multi-line object, array, import list, export list, destructuring pattern, enum, tuple type and
  type parameter list each end with a comma. A multi-line function parameter list and a multi-line
  call's arguments do not.
- oxfmt's `configuration_schema.json` lists the values `all`, `es5` and `none` and says nothing
  more about each. The name comes from Prettier, whose
  [docs](https://prettier.io/docs/options#trailing-commas) read it as "trailing commas where valid
  in ES5 (objects, arrays, etc.)". The sample run is the proof for this version.
- Everything else in 0029's format stays: 2 spaces, 120 columns, spaces inside braces, and JSON
  keeps its own settings, with no trailing comma.

Binding constraints:

- A pull request formats with these settings; `pnpm lint` fails a file that is not formatted.

## Consequences

- These two settings now differ from Effect's own. Code copied from Effect's docs or source is
  reformatted by `pnpm format`: it gains semicolons and trailing commas. That is the cost the owner
  accepted.
- `.oxfmtrc.json` does not change in this record's pull request. Ticket 466's sweep changes it and
  reformats every file once, with these settings.
- 0023's table gets two kept differences: semicolons, and trailing commas.
- Not decided here: any other format setting, and anything 0023 still marks open.
