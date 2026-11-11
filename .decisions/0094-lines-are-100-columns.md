---
id: 0094
title: A line of code is at most 100 columns, in the whole repo, never Effect's 120
status: accepted
date: 2026-11-11
tags: [style, format, oxfmt, line-width]
---

# 0094: A line of code is at most 100 columns, in the whole repo, never Effect's 120

**What this decides:** the formatter's line width is 100 columns for both versions.

```jsonc
// before (.oxfmtrc.json, 0029)
"printWidth": 120,
// after
"printWidth": 100,
```

## Context

[0029](0029-format-and-names-follow-effect.md) set the whole format to Effect's settings, 120
columns among them, and [0039](0039-keep-semicolons-and-es5-commas.md) kept that width when it
brought semicolons and trailing commas back. The owner reads the code daily and wants it to be a
pleasure to read: 120 columns is too wide for that. This is a second place where the repo leaves
Effect's format on purpose, after 0039.

## Decision

**The line width is 100 columns, for every file the formatter touches, in `next/` and in today's
version.**

- `.oxfmtrc.json` says `"printWidth": 100`. Nothing else in the format changes: 2 spaces, spaces
  inside braces, semicolons and trailing commas stay as 0029 and 0039 have them.
- The change lands as one pull request that holds the setting and the reformat it causes, and
  nothing else, so a reader can trust that its diff is only line breaks. It follows the lead
  tooling fast track: no plan, tests or review, merged on green CI with a clean leak grep.
- That pull request also updates the width where prose states it: `AGENTS.md`'s Checks section and
  the comment at the top of `.oxfmtrc.json`.
- A branch in flight when it lands merges main and runs `pnpm format`. A conflict that is only line
  breaks is settled by taking either side and formatting again.
- A code block in a write-up or a page follows the same width.

## Consequences

- One large diff of line breaks, once. `git blame` on a rewrapped line points at that pull request;
  its commit goes in `.git-blame-ignore-revs` so blame skips it.
- The 600-line cap of [0087](0087-a-pull-request-caps-product-lines.md) counts product lines a
  person must read. A formatter-only diff is not that, so the cap does not apply to this one pull
  request.
- Code copied from Effect's own sources wraps differently here. That is accepted.
- Not decided here: a width for Markdown. The formatter does not touch Markdown in this repo.
