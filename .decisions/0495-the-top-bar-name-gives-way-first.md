---
id: 0495
title: The top bar's icon and name sit centered on the window, take no room, do nothing, hide from screen readers and disappear whole when an item comes within 24px, on macOS only
status: accepted
date: 2026-11-01
tags: [ui, top-bar, icon, accessibility, today]
---

# 0495: The top bar's icon and name sit centered on the window, take no room, do nothing, hide from screen readers and disappear whole when an item comes within 24px, on macOS only

```tsx
// apps/fabrika/src/window/frame.tsx. It sits over the bar, so nothing else moves for it.
<div className="brand" data-free={free} aria-hidden="true">
  <Mark /> {/* the icon's 16-grid drawing, one tile lit */}
  <span>fabrika</span>
</div>

// apps/fabrika/src/window/frame.ts. The one rule the bar measures.
middleFree({ left: 500, right: 560 }, [{ left: 0, right: 476 }]); // true: 24 of room
middleFree({ left: 500, right: 560 }, [{ left: 0, right: 477 }]); // false: gone, whole
```

**What this decides:** how the icon and the word "fabrika" sit in the window's top bar. Today's
version, and built.

## Context

The middle of the top bar is empty, and the icon needed a home in the app. From
[the top bar's name](../docs/direction/top-bar-name.md#the-rules).

## Decision

**The icon and name give way first.**

- Centered on the window, never on the free space. The name stays put when a pipe opens.
- They take no room: nothing in the bar moves or gets cut for them.
- They disappear whole when any bar item comes within 24px, never sliding or clipped.
- They do nothing: no press, no tab stop, no hover. The window drags through them.
- Quiet: the name is the app's sans at regular weight, in the quiet gray, since nobody types it.
  The bar's other words stay mono ([0460](0460-mono-only-for-typed-words.md)).
- Hidden from screen readers (`aria-hidden`), since the window's title already says "fabrika".
- macOS only, where the app draws the top of its own window.
- A tile's title bar never carries the app icon.

## Consequences

- The token names in the note (`--text-faint`, `--wire`) move with the token rename
  ([0451](0451-tokens-take-four-tiers-one-grammar.md)).
