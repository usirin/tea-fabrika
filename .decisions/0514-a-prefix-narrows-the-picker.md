---
id: 0514
title: A program's prefix and a space narrow the picker to its rows, @ lists people and summoned agents, and a line fabsh accepts is a Run row that runs only on Enter
status: accepted
date: 2026-11-07
tags: [ui, picker, prefix, fabsh, agents, next]
---

# 0514: A program's prefix and a space narrow the picker to its rows, @ lists people and summoned agents, and a line fabsh accepts is a Run row that runs only on Enter

```text
t <space>      a chip "tracker": only the tracker's rows; Backspace on an empty box drops it
?              lists every prefix
@sc            people and summoned agents; Tab completes @scout
> or a line    "Run: trace --ticket 1", ranked like any row
```

**What this decides:** how the person narrows the picker and reaches people, agents and the shell
from it, in `next/`.

## Context

Search, asking an agent and running a line were three boxes. From
[pickers](../docs/direction/picker-guidelines.md#q4-a-prefix-narrows-the-box), Q4 to Q6.

## Decision

**One box narrows by prefix, and every kind of row is a source.**

- A program's prefix and a space turn into a chip with the program's name, and the box shows only
  its rows.
- The load refuses a prefix two programs claim, a prefix that is a tsh word, and one of the four
  symbols.
- `@` lists people and summoned agents. The plain Ask row asks your default agent only on a press,
  never on typing.
- fabsh is a picker source: a line fabsh's parser accepts shows a "Run" row, ranked like any row,
  never forced first, and run only on Enter (the owner's call).

## Consequences

- "Prefix" here and `C-b` as the frame's prefix key share a word; the note leaves that open.
