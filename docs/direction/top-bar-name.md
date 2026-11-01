# The top bar carries the icon and the name, and they give way first

**Decided by the owner on 2026-11-01. Today's version, and built.** The bar across the top of the
app's window shows [Tile F](./app-icon.md) and the word "fabrika" in its middle, on macOS. They take
no room, do nothing, and go when the bar needs the space.

```tsx
// apps/fabrika/src/window/frame.tsx. It sits over the bar, so nothing else moves for it.
<div className="brand" data-free={free} aria-hidden="true">
	<Mark /> {/* the icon's 16-grid drawing, one tile lit */}
	<span>fabrika</span>
</div>

// apps/fabrika/src/window/frame.ts. The one rule the bar measures.
middleFree({left: 500, right: 560}, [{left: 0, right: 476}]); // true: 24 of room
middleFree({left: 500, right: 560}, [{left: 0, right: 477}]); // false: gone, whole
```

This note is about the window's top bar. A tile has its own title bar, with
[its own rules](./tile-guidelines.md#title-bar), and that one never carries the icon: nine tiles
would mean nine logos.

## The rules

- **Where.** Centered on the window, never on the free space. The name stays put when a pipe opens.
- **It takes no room.** Nothing in the bar moves or gets cut because of it.
- **It goes first.** When any item of the bar comes within 24px, it disappears whole. It never
  slides or gets clipped.
- **It does nothing.** No press, no tab stop, no hover. The window drags through it, as through the
  rest of the bar.
- **Quiet.** The icon's small drawing, and the name in the app's sans at regular weight, in
  `--text-faint`. The stem and middle tile are `--wire`, the lit tile `--text-muted`.
- **Sans, in a mono bar.** Nobody types this word, and
  [monospace is only for what a person types](./popovers.md). The bar's other words stay mono, as
  that note says.
- **Hidden from screen readers.** The window's title already says "fabrika". Reading it twice adds
  nothing, and it holds no action.
- **macOS only.** There the app draws the top of its own window. On Windows and Linux, the system's
  title bar says "fabrika" right above this bar, so it would say it twice.

## What we saw

Shots are in `apps/fabrika/docs/top-bar/`, from the built app.

| Layout | Window | Result |
|---|---|---|
| One tile, side by side, stacked, 2x2 | 1440 wide | Plenty of room. The tiles below never change the bar. |
| 2x2 | 1024x700 | Fits. |
| A pipe | 1024 wide | Fits, with room. |
| Six workspaces and a pipe | 1024 wide | Gone, and nothing is cut. |
| A pipe | 720 wide | Just fits, about 25px from the pipe. |

## Why, the cost, and how sure

**Why:** the middle of the bar is empty anyway, and this gives the icon a home in the app itself.

**The cost:** it clashes with Linear's written advice, and we differ on purpose. Their
[design refresh](https://linear.app/now/behind-the-latest-design-refresh) says parts that "support
orientation and navigation should recede", and this mark tells you nothing you need. The faint gray
is how it keeps the peace. I found nothing written about Linear's own title bar. It also adds a
small piece of measuring code to the bar.

**How sure:** about 60% on adding it, since this is a taste call. The owner saw it in a real window
and picked it. About 55% on Tile F over the factory roof here. At this size the roof's teeth stay
close to the `|` of a pipe.

## What this cannot tell us

- **The real window's corner.** A page capture holds only the page, so no shot shows macOS's window
  buttons next to the bar.
- **A real drag.** The check reads the name's style (`app-region: drag`, `pointer-events: none`), and
  nobody dragged the window by the name in a test.
- **A crowded right side.** The shots have little on the right. Asks and agents make it longer, so
  the name goes sooner. The rule covers it, and no shot shows it.
- **A screen reader.** `aria-hidden` is read from the code, with no real screen reader run.
