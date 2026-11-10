---
id: 0025
title: Every if, else, for, while and do body has braces, and a blank line stands before and after each block statement, held by lint and pnpm format
status: accepted
date: 2026-11-09
tags: [lint, format, oxlint, readability, curly, padding, effect]
---

# 0025: Every if, else, for, while and do body has braces, and a blank line stands before and after each block statement, held by lint and pnpm format

**What this decides:** a control statement's body always sits in braces, and an `if`, loop,
`switch` or `try` is set apart from its neighbors by a blank line, both checked by `pnpm lint` and
both added by `pnpm format`, never by hand.

```ts
// before: refused
const read = (rows: readonly Row[]) => {
	const out: Row[] = [];
	for (const row of rows) if (row.ok) out.push(row);
	if (out.length === 0) return null;
	return out;
};

// after: what pnpm format writes
const read = (rows: readonly Row[]) => {
	const out: Row[] = [];

	for (const row of rows) {
		if (row.ok) {
			out.push(row);
		}
	}

	if (out.length === 0) {
		return null;
	}

	return out;
};
```

## Context

The owner read swept code on 2026-11-09 and found it hard to read: one-statement bodies with no
braces, and `if` and loop blocks packed against the lines around them. Readability for a human comes
first ([0023](0023-next-follows-effects-code-style.md)). Tracker ticket 439 first asked for `curly`
set to `multi-line` with braces on every loop; the owner then chose braces on every body.

This amends two decisions in part:

- [0021](0021-a-blank-line-between-top-level-statements.md) put a blank line between top-level
  statements and left blank lines inside a function body undecided. This decides one case of that,
  in the same direction: around block statements, at any depth.
- [0023](0023-next-follows-effects-code-style.md) follows Effect's style and lists each difference
  with its reason. Effect has no `curly` rule: `packages/effect/src` at `effect@4.1.2` has 2,228
  one-statement `if` lines with no braces. This is a named difference; the reason is the owner's
  readability call.

A first count on main with `eslint/curly` set to `all`: 8,741 hits in 909 files, 1,485 of them in
`next/`.

## Decision

**Every `if`, `else`, `for`, `for in`, `for of`, `while` and `do` body is a block in braces, and a
blank line stands before and after each `if`, loop, `switch` and `try` statement, unless it is the
first or last statement of its block.**

- Braces: oxlint's `eslint/curly` set to `["error", "all"]`. Its fix writes the braces; oxfmt then
  breaks the lines.
- Blank lines: ESLint's `padding-line-between-statements` with `{blankLine: "always", prev: "*",
  next: ["if", "for", "while", "do", "switch", "try"]}` and the same with `prev` and `next`
  swapped. Oxlint 1.90.0 has no such rule, so `fabrika/padding-line-between-statements` (0021's rule)
  grows to cover it, with a whitespace fix.
- It holds in every statement list: a file's top level, a function or block body, a `case`, and a
  class's static block. A labeled loop counts as a loop.
- An `else if` chain is one `if` statement: no blank line goes before `else`.
- A comment above a statement belongs to it, as in 0021: the blank line may sit above the comment.
- Both rules block, in today's code and in `next/` alike.

Binding constraints:

- Never add a brace or a blank line by hand to pass review: run `pnpm format`.
- No disable comment for either rule. A new exception goes in the rule with a measured count.

## Consequences

- The sweep that turns both rules on touches most files in the repo. Open branches need
  `pnpm format` after merging main, since the new lines conflict.
- `path:line` citations in `.patterns/` and notes drift in swept files.
- `next/` keeps one more named difference from Effect, listed in 0023's table.
- Other blank lines inside a function body, such as before a `return`, are not decided here.
- Long reasoning: [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).
