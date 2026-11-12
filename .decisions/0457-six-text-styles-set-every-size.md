---
id: 0457
title: Every text size comes from one of six text styles in the design package, applied with Manti's own props, and no program's CSS sets a size, weight or text color
status: accepted
date: 2026-11-02
tags: [design, typography, text-styles, manti, design-package]
---

# 0457: Every text size comes from one of six text styles in the design package, applied with Manti's own props, and no program's CSS sets a size, weight or text color

```ts
// text-styles.ts in @kampus/fabrika-design (a sketch: not built yet)
export const textStyles = { title, heading, strong, body, quiet, label } satisfies Record<TextStyle, TextProps>;

<Text {...textStyles.label}>#117</Text> // Manti's own size and emphasis props, as they are
```

| Text style | Size | macOS |
|---|---|---|
| `label` | 12 | Callout |
| `body`, `quiet`, `strong` | 13 | Body, Headline |
| `heading` | 15 | Title 3 |
| `title` | 22 | Title 1 |

**What this decides:** where every text size comes from, in both versions: today's windows first,
and `next/`'s first window from the start.

## Context

Program CSS set sizes and weights by hand, so ranks drifted. From
[typography](../docs/direction/typography.md#t1-every-size-comes-from-a-text-style), T1 and the
smaller calls.

## Decision

**Six text styles carry every size, and they live in `@kampus/fabrika-design`.**

- The six are `title`, `heading`, `strong`, `body`, `quiet` and `label`, exported as `textStyles`
  and the type `TextStyle` from `text-styles.ts`. They are text styles, never roles.
- No program's CSS sets a `font-size`, `font-weight` or text color. A seventh style is a change to
  the package, never a local rule.
- A program applies a text style by spreading Manti's own size and emphasis props. No new Manti
  prop and no wrapper of ours.
- Every heading takes a text style, never the size Manti picks from its level.
- A label and its value are `DescriptionList`, `DescriptionTerm` and `DescriptionDetails` in our
  package, HTML's names, never Radix's `DataList`.
- The title is 22, macOS's Title 1, not Linear's 24.
- Line height is Manti's own, and numbers take `tabular-nums` from `.view`.
- The lint that holds "every size comes from a text style" has its false alarms measured before it
  blocks.

## Consequences

- `text-styles.ts` is not built yet; the text styles land in their own row.
- The six names go to Manti's issue 135 as a real case for named styles.
