---
id: 0021
title: A blank line stands between top-level statements, between class members and around every control statement, every body has braces, and pnpm format adds both
status: accepted
date: 2026-11-09
tags: [lint, format, oxlint, oxfmt, readability]
---

# 0021: A blank line stands between top-level statements, between class members and around every control statement, every body has braces, and pnpm format adds both

**What this decides:** every top-level statement, every class member and every `if`, loop, `switch`
and `try` is set apart by a blank line, every `if`, `else` and loop body has braces, lint blocks
when either is missing, and `pnpm format` adds them.

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

Added the same day (owner, 2026-11-09, ticket 439):

- **A blank line before and after every `if`, `for`, `for..of`, `for..in`, `while`, `do`, `switch`
  and `try`,** in any block, unless it is the first or last statement there. An `if` with its whole
  `else` chain is one statement, and so is a labeled loop. The same rule,
  `fabrika/padding-line-between-statements`, holds it.
- **Braces on every body:** oxlint's own `eslint/curly` set to `"all"`, so `if (x) return y;` is
  refused too. Its fix runs in `pnpm format`.
- The owner first asked for `curly` `"multi-line"` plus a rule of ours that braces every loop, then
  chose `"all"` instead: one built-in rule, no split by statement kind.

```ts
// Refused.
const ready = check(x);
if (!ready) return;
for (const y of ys) total += y;
return total;

// Allowed.
const ready = check(x);

if (!ready) {
	return;
}

for (const y of ys) {
	total += y;
}

return total;
```

## Consequences

- The first sweep added 2,920 blank lines to 566 files and nothing else. Open branches need
  `pnpm format` after merging main, since the blank lines conflict.
- `path:line` citations in `.patterns/` and notes drift by a few lines in swept files.
- The second sweep (ticket 439) touched 928 files, +37,705 and -8,330 lines; each file parses to the
  same tree with a one-statement block read as its statement. Runs of guard clauses now stand apart.
- `pnpm format` may need more than one run on a file with deeply nested brace-less bodies: oxlint
  applies one fix per overlapping range a pass. The first sweep took 8 runs; new code rarely needs two.
- Blank lines between other statements inside a function body are not decided here.
- Long reasoning: [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).
