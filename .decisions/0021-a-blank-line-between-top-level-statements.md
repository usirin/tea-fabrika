---
id: 0021
title: A blank line stands between top-level statements and between class members, added by pnpm format
status: amended-in-part by [0025](0025-braces-always-and-blank-lines-around-blocks.md)
date: 2026-11-09
tags: [lint, format, oxlint, oxfmt, readability]
---

# 0021: A blank line stands between top-level statements and between class members, added by pnpm format

**What this decides:** every top-level statement and every class member is set apart by a blank
line, a lint rule blocks when one is missing, and `pnpm format` adds it.

```ts
// Refused: a multi-line statement with no blank line above or below it.
type Rows = Parameters<Part["write"]>[0];
const part = Effect.fnUntraced(function* () {
	return yield* read;
});
export const recordWrite = Effect.fn(function* () {});

// Allowed: one-line statements stay a group, and so do imports, overloads and a schema's type.
const A = 1;
const B = 2;
export const Row = Schema.Struct({
	id: Schema.String,
});
export type Row = typeof Row.Type;
```

## Context

Builders wrote files such as `next/packages/libfabrika/src/workers/record.ts` with no blank line
between declarations. `oxfmt --check` passed them, since a formatter keeps blank lines but never
adds one, and they were hard to read. Oxlint 1.90.0 has neither ESLint's
`padding-line-between-statements` nor `lines-between-class-members` (ticket 437).

## Decision

**A blank line goes between two top-level statements, and between two class members, unless both
are one line each.**

- The rule is `fabrika/padding-line-between-statements` in `oxlint-plugins/`, ESLint's
  `{blankLine: "always", prev: "*", next: "*"}` with three exceptions: two one-line statements
  (ESLint's `exceptAfterSingleLine`, asked of both sides), two imports or re-exports, and one
  declaration written twice (function or method overloads, or a value followed by its same-name type).
- A comment above a statement belongs to it; the blank line may sit anywhere between the two.
- It blocks. Its whitespace fix runs in `pnpm format`.

Binding constraints:

- Never add a blank line by hand to pass review: run `pnpm format`.
- A new exception goes in the rule with a measured count, never as a disable comment.

## Consequences

- The first sweep added 2,920 blank lines to 566 files and nothing else. Open branches need
  `pnpm format` after merging main, since the blank lines conflict.
- `path:line` citations in `.patterns/` and notes drift by a few lines in swept files.
- Blank lines inside a function body are not decided here, except around block statements:
  [0025](0025-braces-always-and-blank-lines-around-blocks.md) puts one before and after each `if`,
  loop, `switch` and `try`. The rest of this file still holds.
- Long reasoning: [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).
