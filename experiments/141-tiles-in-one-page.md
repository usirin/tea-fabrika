# 141. How many ghostty-web terminals does one page hold?

The question: the fabrika app now draws every tile in one window, and each tile is a
ghostty-web terminal on its own canvas, all in one renderer. Before this, each window had one
terminal. Does a page with 4, 8 or 16 terminals still type and draw well, and what does each
one cost?

**Answer: 16 is fine on this machine. Each terminal costs about 2.8 MB of renderer memory
(151 MB with one tile, 193 MB with 16). Idle frames stay at 16.7 ms at every count. With every
tile printing 2,000 lines at once, frames stay at 16.7 ms median and 34 ms at worst, after one
fix. Typing delay does not grow with the count. The first run found a real problem: one tile
printing 2,000 lines froze the whole page for 7.8 s, because the page read the screen back as
text after every write. Reading it back once a frame fixed it. Confidence 80% for "16 is
fine"; 60% for the typing number, which measures the text copy, not the canvas.**

```ts
// The whole idea, as the script runs it.
for (const count of [1, 4, 8, 16]) {
	const app = await launch({FABRIKA_HOME: freshHome});       // the real app, a fresh home
	while (tiles < count) { click(biggestTile); press("Ctrl-B", longSide ? "|" : "-"); }
	app.getAppMetrics();                                     // renderer and main memory
	frames(3000);                                            // idle frame gaps
	for (const t of tiles) send(`tile:${t}`, "seq --to 2000\r");
	frames(3000);                                            // frame gaps while every tile prints
	for (let i = 0; i < 30; i++) press("a");                 // keydown to the echo, in the page
}
```

## Who did what

- **This repo's code:** all of it. The app (`apps/fabrika`), built with `pnpm --filter
  @kampus/fabrika-app build`, driven by Playwright's Electron support.
- **Today's fabrika:** nothing. No agent, no model, no key, no network. $0.

## Setup

- One Apple laptop, macOS, Electron 45 (Chromium 140), the window at 1200 by 760.
- A fresh home for each count. Tiles are made with the desk's own keys. The biggest tile is
  split each time, along its long side, so 16 tiles are a 4 by 4 grid of about 300 by 190
  pixels. Splitting the newest tile each time made the 8th tile too small to hold the prompt
  on one row, so that layout was dropped.
- Memory: Electron's `app.getAppMetrics()`, working set of the renderer (`Tab`) and the main
  process (`Browser`), 2 s after the last tile's prompt. macOS reports no private bytes.
- Frames: the gaps between `requestAnimationFrame` calls over 3 s.
- Busy: every tile is sent `seq --to 2000` on its own port at the same instant.
- Typing: 30 presses of `a` in the focused tile. In the page: the time from keydown (capture
  phase) to the change in the tile's screen text, and to the frame after it. That text is the
  copy the page keeps for a screen reader and the tests. It is not the canvas.

## Results

Two runs after the fix gave the same numbers to within 2 MB and 5 ms; the table is the second.

| Tiles | Renderer MB | Main MB | JS heap MB | Idle frame median / max ms | Busy frame median / max ms | Keydown to text median / p95 ms |
|---|---|---|---|---|---|---|
| 1 | 150.9 | 200.7 | 11.1 | 16.7 / 18.7 | 16.7 / 18.6 | 52.9 / 58.8 |
| 4 | 162.9 | 198.8 | 11.8 | 16.7 / 18.7 | 16.7 / 18.7 | 48.9 / 51.2 |
| 8 | 176.9 | 199.0 | 12.1 | 16.7 / 18.6 | 16.7 / 33.3 | 47.8 / 50.5 |
| 16 | 193.5 | 203.4 | 17.0 | 16.7 / 18.6 | 16.7 / 33.4 | 47.6 / 50.8 |

- **Memory grows by about 2.8 MB a terminal in the renderer.** The main process stays near
  200 MB at every count, so one tsh per tile costs little there.
- **Idle drawing does not care about the count.**
- **Busy drawing holds up.** At 8 and 16 tiles, 2 to 8 frames of about 180 took 33 ms: one
  frame missed now and then.

### Before the fix (marked wrong)

The first run read the screen back as text after every write (`term.write(data, mirror)`):

| Tiles | Busy frame max ms | Keydown to text median ms |
|---|---|---|
| 1 | 7,768 | 40.6 |
| 4 | 5,367 | 31.9 |
| 8 | 5,967 | 31.7 |
| 16 | 3,800 | 30.9 |

- **One busy tile froze the whole page for seconds.** The page read 200 rows back as text after
  each of 2,000 writes. In one page, that freezes every tile, not only the busy one. With one
  window per terminal, the same cost froze only that window.
- The guess going in was that ghostty-web's canvases would be the cost. That was wrong: the
  cost was our own text copy.
- The fix: read the screen back at most once a frame (`mirrorSoon`, in
  `apps/fabrika/src/window/terminal.ts`).

```ts
let mirroring = false;
const mirrorSoon = () => {
	if (mirroring) return;
	mirroring = true;
	requestAnimationFrame(() => {
		mirroring = false;
		mirror();
	});
};
term.write(read.msg.data, mirrorSoon);
```

- **The typing number grew by about one frame with the fix: 31 ms to 48 ms.** The text copy now
  waits for the next frame, so this measure includes that wait. It says nothing about when the
  canvas shows the key. The before numbers are closer to that.

## What we take from it

- 16 tiles in one page is fine on this machine. Nothing here says to cap the tile count.
  Confidence 80%: one machine, one window size, and the busy load is short.
- Anything the page does per write is paid by every tile. A new per-write step needs this
  check again.
- Typing delay is flat from 1 to 16 tiles. The number itself, 30 to 50 ms, is mostly the round
  trip to the main process and its line editor, which this did not split up.

## What this cannot tell us

- The canvas paint time. The typing number reads the text copy. A test that reads pixels, or
  Chromium's tracing, would settle when the key shows.
- A slower machine, a bigger window, or a 4K screen, where each canvas holds more pixels.
- Long runs: memory after hours, or a tile that prints without end.
- Program views in many tiles. Every tile here ran tsh.
- More than 16. The script takes `COUNTS=24,32` to try.
