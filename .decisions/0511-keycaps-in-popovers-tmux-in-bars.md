---
id: 0511
title: Inside a popover keys are keycaps in the sans with the Mac's glyphs while the bars keep tmux's C-b a, and the close-tile question stays in the status bar and the tile's bar, never a popover
status: accepted
date: 2026-10-30
tags: [ui, popovers, keys, frame, today]
---

# 0511: Inside a popover keys are keycaps in the sans with the Mac's glyphs while the bars keep tmux's C-b a, and the close-tile question stays in the status bar and the tile's bar, never a popover

```text
inside a popover    ⌃B  A        the product, as the Mac and Linear say keys
in the bars         C-b a        the frame, as tmux says keys
```

**What this decides:** how a key is spelled and where the frame's own question is asked, in
today's version.

## Context

One key had two spellings with no rule. From
[popovers](../docs/direction/popovers.md#9-what-the-build-decided).

## Decision

**Two spellings of one key, on purpose.**

- Inside a popover a key is a keycap in the sans, with the Mac's glyphs: `⌃B` `A`. A key that
  belongs to a row sits on that row; a key no row shows sits in the footer.
- The bars keep tmux's spelling, `C-b a`.
- The close-tile question (`close t2? (y/n)`) stays in the status bar and the tile's bar, where
  tmux asks it. It is not a popover.

## Consequences

- The keycaps become Manti's `Kbd` ([0461](0461-every-ui-part-is-on-manti.md)).
