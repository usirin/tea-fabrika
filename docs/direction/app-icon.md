# The app's icon is three tiles that spell F

**Decided by the owner on 2026-11-01. Today's version, and built.** The app's icon is Tile F: three
tiles, spaced like the app's tiles, in a layout that happens to spell F. One tile is lit, the way
one tile has focus.

```text
1024 canvas, 824 rounded square centered in it

  stem 128 x 500     top 224 x 128, lit
                     middle 150 x 128

gap 28 everywhere, corners 14
```

The source is `apps/fabrika/icon/icon.svg`. `icon.png` beside it is that drawing at 1024, with a
clear background, from a Chromium screenshot.

## The rules

- **Always three tiles.** A fourth stops it reading as an F.
- **The gap never closes.** It is what makes these tiles and not a letter.
- **The middle tile stays narrower than the top one,** or the F becomes a block.
- **Exactly one lit part: the top tile.** Never two, never none.
- **No hue.** In the app, [a color means a pipe](./color-principles.md), so the icon stays gray.
- **No shadow, gradient or gloss.** No letters added, no tilt.

| Part | Value | On the rounded square |
|---|---|---|
| Rounded square | `oklch(0.178 0.004 260)`, the app's window gray | |
| Its edge, 6 wide | `oklch(0.256 0.004 260)`, the app's border gray | |
| Stem and middle tile | `oklch(0.5 0.004 260)` | 3.15:1 |
| Top tile | `oklch(0.94 0.001 260)` | 15.8:1 |

The 3.15:1 clears the 3:1 bar for graphics, and the app's own gray steps sit either side of it. The
shape reads from its outline, never from color alone.

## Small sizes

From 64 up, the one drawing scales down. At 32 and under, a gap of 28 falls under a pixel and blurs
away, so a small icon needs its own drawing on a 16-pixel grid:

```ts
// A sketch for when a packaged app or a menu bar needs it. Nothing uses it yet.
stem   {x: 5, y: 3, w: 2, h: 10}
top    {x: 8, y: 3, w: 4, h: 3}   // lit
middle {x: 8, y: 7, w: 3, h: 3}
```

In a menu bar, that drawing goes with no rounded square, in one color with the dim tiles at half
strength, so macOS can tint it for light and dark.

## How it reaches the screen

```ts
// apps/fabrika/src/main.ts. An unpackaged app has no icon of its own.
if (launch.kind !== "quiet") app.dock?.setIcon(icon); // macOS
new BrowserWindow({icon /* ... */});                  // a window on Windows and Linux
```

A quiet start (`launch.ts`) has no Dock icon, so it sets none.

**Why this one, and how sure:** the owner picked it from nine, and my lean matched, 65% sure. It
stays clear at small sizes and comes from the app's own tiles. **The cost:** letter icons are
common, so it wins by its gaps and not by the idea.

## What this cannot tell us

- **Windows and Linux.** Nobody has looked at it there. The window option is set, and they draw
  icons their own way.
- **A packaged app.** There is none yet, so no `.icns` is made, and macOS shows the Dock icon only
  while the app runs. A packaged app needs the small drawing too.
- **The other eight.** The first round, Whole window, Washed F and the rest stay on a private page.
  Washed F was the close second.
