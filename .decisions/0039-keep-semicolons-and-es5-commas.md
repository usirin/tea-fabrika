---
id: 0039
title: The repo keeps semicolons and trailing commas, function parameters and call arguments included
status: amended-in-part by [0094](0094-lines-are-100-columns.md)
date: 2026-11-09
tags: [style, format, oxfmt, semicolons, trailing-commas, effect]
---

# 0039: The repo keeps semicolons and trailing commas, function parameters and call arguments included

**What this decides:** two of the format settings that
[0029](0029-format-and-names-follow-effect.md) took from Effect go back: statements end with a
semicolon, and every multi-line list ends with a comma.

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

// 0039: semicolons, and a trailing comma in the object and in the call
import { Effect } from "effect";
const lease = {
  id,
  holder,
};
const made = make(
  lease,
  options,
);
```

```jsonc
// .oxfmtrc.json, the two settings this decides
{
  // "semi" is left out: oxfmt's default is true
  "trailingComma": "all"
}
```

## Context

0029 set the whole format to Effect's `dprint.json`: 2 spaces, 120 columns, no semicolons, no
trailing commas, spaces inside braces. Ticket 466's sweep, which applies those settings to every
file, had not landed yet. Later on 2026-11-09 the owner picked these two settings back. The reason
is the owner's reading taste.

This amends 0029 in part, and with it the semicolon and trailing comma rows of
[0023](0023-next-follows-effects-code-style.md)'s table. Ticket 498 is this record, and ticket 503
its amendment. Ticket 466's sweep takes the settings.

## Decision

**Code in this repo ends statements with a semicolon, and puts a trailing comma in every multi-line
list, function parameters and call arguments included.**

- In oxfmt's settings: `semi` is `true`, its default, so the key is left out, and `trailingComma`
  is `"all"`. These are the two values the repo had before 0029.
- The installed oxfmt, 0.75.0, says in its `configuration_schema.json` that `trailingComma` prints
  "trailing commas wherever possible in multi-line comma-separated syntactic structures", and that
  a single-line array never gets one. `"all"` is its default.
- Everything else in 0029's format stays: 2 spaces, 120 columns, spaces inside braces, and JSON
  keeps its own settings, with no trailing comma.

Binding constraints:

- A pull request formats with these settings; `pnpm lint` fails a file that is not formatted.

## Consequences

- These two settings differ from Effect's own. Code copied from Effect's docs or source is
  reformatted by `pnpm format`: it gains semicolons and trailing commas. That is the cost the owner
  accepted.
- `.oxfmtrc.json` does not change in this record's pull requests. Ticket 466's sweep changes it
  and reformats every file once, with these settings.
- 0023's table gets two kept differences: semicolons, and trailing commas.
- Not decided here: any other format setting, and anything 0023 still marks open.

## Amendments

- 2026-11-09: trailing commas stay everywhere, function parameters and call arguments included, so
  `trailingComma` is `"all"`. This record first said `"es5"`: a comma in objects and arrays, none
  in function parameters or call arguments
  ([PR 704](https://github.com/usirin/tea-fabrika/pull/704)). The owner changed that part the same
  day, after reading that pull request. The title and the text above now say the new rule (ticket
  503).
