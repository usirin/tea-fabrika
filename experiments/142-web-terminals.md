# 142. Which web terminal library should the app draw its tiles with?

The question: the fabrika app draws every tile with ghostty-web 0.4.0. Sitting idle, its
window keeps a CPU core busy and the fan spins. ghostty-web's `startRenderLoop` draws on every
animation frame, forever, changed or not (upstream:
[coder/ghostty-web#208](https://github.com/coder/ghostty-web/issues/208)). Should the app
switch to wterm, xterm.js 6 or restty, or is a small patch to ghostty-web enough?

**Answer: keep ghostty-web and carry a small patch we own. The idle cost is its render loop and
nothing else. A 28-line patch to its one JS file (11 lines out, 17 in) makes it draw only when
something changed. With 16 tiles, idle drops from 9.8% of a core in the renderer and 22.8% in
the GPU process to 1.5% and 2.3%. That is as low as any other library here. 11 more lines, in
the same JS renderer and with no WebAssembly rebuilt, give it a hollow cursor when a tile is
not focused. No switch is needed for the idle problem. xterm.js 6 with its WebGL renderer is
the best second choice: the cheapest while busy, but it needs the page's style policy relaxed.
Confidence 75%. The doubt: neither this harness nor the real app, driven here, reached the
70% the app shows in daily use. The most I measured was 39% of a core.**

```ts
// The whole idea, as the script runs it: one sandboxed Electron page, one library, N tiles.
for (const lib of ["ghostty-web", "ghostty-web-patched", "wterm", "xterm", "xterm-webgl"])
	for (const n of [1, 4, 16]) {
		const page = open(`page.html?lib=${lib}&n=${n}`);    // N tiles of 300 by 190, as the app's 16
		idle(20);              // CPU seconds of the renderer and the GPU process over 20 s
		burst("seq");          // every tile sent 2,000 lines at once: time to settle, worst frame
		typing(25);            // keydown to the library's own draw that shows the key
	}
```

And the patch, the part that matters (the rest is where it is called from):

```js
// Before: draw, then ask for the next frame, forever.
startRenderLoop() {
  const A = () => { this.renderer.render(/* ... */); this.animationFrameId = requestAnimationFrame(A); };
  A();
}
// After: one frame when something changed. Many changes in one frame make one draw.
requestRender() {
  this.animationFrameId === void 0 && (this.animationFrameId = requestAnimationFrame(() => {
    this.animationFrameId = void 0;
    this.renderer.render(/* ... */);
  }));
}
// Called from: write, scroll, selection, link hover, cursor style, cursor blink (every 530 ms),
// focus and blur. Resize and the scrollbar fade already drew on their own.
```

## Who did what

- **This repo's code:** all of it. A harness page and an Electron main in
  `experiments/142-web-terminals/`, the script `experiments/142-web-terminals.ts`, and for the
  comparison the real app (`apps/fabrika`, unchanged), driven by Playwright's Electron support.
- **Today's fabrika:** nothing. No agent, no model, no key, no network. $0.

## Setup

- One Apple laptop, 12 cores, macOS, Electron 45 (Chromium 140). The window was on a 60 Hz
  external screen at 1200 by 760.
- The page is as safe as the app's: sandboxed, no Node, no preload, every permission refused,
  served from its own scheme with a Content Security Policy.
  - The measurements run under the app's policy plus `style-src 'unsafe-inline'` and
    `connect-src 'self'`, so every library can run. The fit checks also try the app's own
    policy unchanged.
- Every tile is 300 by 190, the size of the app's 16 tiles. Font, size, colors and a 1,000-line
  scrollback are the same for every library. Each tile echoes its keys one task later, as the
  pty does.
- Variants:
  - `ghostty-web`: 0.4.0 as published, set up as the app sets it up.
  - `ghostty-web-patched`: the same, with the two patch files in the harness folder applied to
    a copy at build time. `node_modules` is never changed.
    - *Since 2026-10-25 the workspace patches every `ghostty-web@0.4.0`, this harness's too
      (pull request 89). A rerun of the published baseline must read a pristine copy, such as
      `npm pack ghostty-web@0.4.0` unpacked into a temp folder.*
  - `-steady` (either one): cursor blink off.
  - `wterm`: `@wterm/dom` with its libghostty core, `@wterm/ghostty` 0.5.5.
  - `xterm`: `@xterm/xterm` 6.0.0, its DOM renderer. `xterm-webgl`: with `@xterm/addon-webgl`.
    `xterm-sr`: with `screenReaderMode` on.
  - `restty` 0.3.0, the optional one. It fetches its font from a CDN by default, so the harness
    gives it a local font file.
  - `blank`: no library, a plain `<pre>` per tile. What the page costs without one.
- **Idle:** CPU seconds used over 20 s, divided by wall time, in percent of one core, as Activity
  Monitor shows it. Electron's `percentCPUUsage` on macOS is shared out over all 12 cores, so
  it reads 12 times smaller; a busy loop at about 50% read 4.7. It is saved too.
- **Busy:** the same reading over 10 s while every tile scrolls 200 colored lines a second.
- **Burst:** 2,000 lines to every tile at once, in 4 KiB pieces. Time until the last tile shows
  the last line and its prompt, and the worst gap between frames meanwhile.
- **Typing:** 25 keys into tile 0, from the keydown's time stamp to the library's own draw call
  that first shows the key. It is not light on the screen: that is one frame or more later,
  and this harness cannot see it. The frame after the draw is saved too.

## Results

Idle and busy, 16 tiles, percent of one core: renderer + GPU process. Memory is the renderer's
working set at idle, then after 4,000 lines in every tile.

| Library | Idle | Busy | Draws a second, idle | Memory MB | Page bytes |
|---|---|---|---|---|---|
| no library | 0 + 0 | (not a fair control, see below) | 0 | 97 | 5,633 |
| ghostty-web 0.4.0 | 9.8 + 22.8 | 25.3 + 31.0 | 60 | 150, 180 | 1,207,355 |
| ghostty-web, blink off | 6.1 + 20.0 | not run | 60 | 142, 171 | 1,207,355 |
| ghostty-web, patched | 1.5 + 2.3 | 21.5 + 19.9 | 1.9 | 144, 176 | 1,209,198 |
| ghostty-web, patched, blink off | 0.2 + 0.4 | not run | 0 | 144, 171 | 1,209,198 |
| wterm 0.5.5 | 2.5 + 0.9 | 80.7 + 30.1 | 0 | 143, 269 | 733,844 |
| xterm.js 6, DOM | 2.2 + 0.9 | 45.9 + 4.7 | 0 | 135, 214 | 357,885 |
| xterm.js 6, WebGL | 0.4 + 0.7 | 6.3 + 11.5 | 0 | 152, 192 | 483,248 |
| xterm.js 6, screen reader mode | 2.7 + 1.0 | not run | 0 | 156, 232 | 357,885 |
| restty 0.3.0 | 3.2 + 2.0 | not run | not read | 190, 191 | 3,383,514 |

What the table says, and the rest of the numbers:

- **The loop is the cost.** Published ghostty-web draws 60 times a second per tile at idle, and
  its GPU cost grows with the tiles: 5.3, 8.8 and 22.8% at 1, 4 and 16. Turning blink off
  helps a little (6.1 + 20.0), because the loop draws anyway. Patched, it draws 1.9 times a
  second, the cursor blink, and costs 0.3 + 0.8, 0.8 + 1.2 and 1.5 + 2.3 at 1, 4 and 16.
- **Busy, the patch helps less.** Scrolling text has to be drawn either way. Patched it draws
  about 21 times a second, once per write, not 60, and saves 15 points of the 56. xterm.js with
  WebGL is far the cheapest while busy, at 18 points. wterm and xterm's DOM renderer pay for
  building and laying out rows of HTML: 81 and 46 points of renderer at 16 tiles.
- **The CSS blinkers cost about 2% at idle, flat.** wterm and xterm's DOM renderer blink the
  cursor with a CSS animation. That is 2 to 2.5% of renderer at 1 tile and at 16 alike.
- **Burst:** no library froze. At 16 tiles, the last tile settled after 23 ms (ghostty-web),
  26 ms (patched), 71 ms (xterm), 76 ms (xterm-webgl) and 82 ms (wterm). With colored lines, in
  the same order: 132, 148, 117, 64 and 319 ms. No frame gap was over 50 ms in any run; the worst was wterm's 34 ms.
- **Typing:** keydown to draw, median, 16 tiles: ghostty-web 26 ms, patched 12.5, wterm 26,
  xterm 27, xterm-webgl 12. The two near 12 ms draw in the next animation frame after the
  write; the others draw one loop or one DOM change later. The next frame after the draw lands
  at 27 to 44 ms for all of them.
- **A bigger window does not explain the 70%.** 16 tiles of 600 by 340 in a 2400 by 1360
  window, four times the pixels: ghostty-web 14.3 + 24.2, patched 1.9 + 2.6, wterm 2.7 + 1.0,
  xterm 2.5 + 1.0, xterm-webgl 0.4 + 0.7.
- **Scrollback does not make a frame dearer; time open may.** Two tiles, idle read for 10 s
  fresh, after 1,000 lines each (scrollback full), after 21,000, and 3 minutes later (`STEP=growth`).
  - Published: 4.5 + 6.2, 4.4 + 6.0, 4.7 + 6.4, then 6.6 + 10.0. Time inside one render call:
    0.056, 0.054, 0.059, then 0.105 ms.
  - Patched: 0.6 + 1.0, 0.6 + 1.0, 0.9 + 1.3, then 0.7 + 1.3.
  - So more lines changed nothing. The rise after 3 minutes is one reading, not repeated. It
    fits the daily-use rise from 70% to 100%, but it could be noise.
  - The JS render call is small: 120 calls a second of 0.1 ms is about 1% of a core. The rest
    of the per-frame cost is outside that call, in Chromium drawing the frame. This harness did
    not split it further. The patch removes all of it, because there is no frame.
- **The real app, driven the same way,** with tiles split by the desk's own keys as in
  experiment 141: 6.7 + 6.1, 8.4 + 10.5 and 11.8 + 24.3 at 1, 4 and 16 tiles. The main process,
  where each tile's tsh runs, was 0.1 to 0.6. So the harness matches the app to within about 2
  points: the cost is in the terminal, not in the desk.

## Fit checks

Each is yes or no, read from the page, not from the library's docs.

- **Ctrl-B is the desk's.** Yes for every library. The page's keydown capture caught Ctrl-B and
  `|`, and nothing reached any terminal.
- **Loads in a sandboxed renderer with no Node.** Yes for every library: `process` and
  `require` are `undefined` in the page.
- **Loads under the app's own page policy, unchanged.**
  - ghostty-web, published and patched: yes, nothing refused.
  - wterm: no. Its core fetches its WebAssembly by URL, and the policy has no `connect-src`.
    With `connect-src 'self'` added it loads, but it writes its rows with inline `style`
    attributes, which `style-src 'self'` refuses: colors are lost (a red span reads as the
    default foreground).
  - xterm.js: it loads, but it adds `<style>` elements, which the policy refuses. The DOM
    renderer's text colors are lost (a red span reads `rgb(0, 0, 0)`). The WebGL renderer draws
    on a canvas, so its text is not affected, but its refused styles were not checked one by
    one.
  - restty: no. It crashes with `RuntimeError: unreachable` in its WebAssembly. With
    `connect-src 'self'` added it loads, though its inline styles are still refused.
- **The screen can be read as text.** Yes for ghostty-web (its buffer API), wterm (its rows are
  DOM text) and xterm.js (its buffer API). No for restty: it has no public way to read the
  screen in 0.3.0.
  - The browser's own find (`window.find`) works for wterm, xterm's DOM renderer and screen
    reader mode. Not for the canvases: ghostty-web, xterm-webgl and restty.
- **An unfocused tile can show a hollow cursor.** Read from screenshot pixels in the cursor's
  color: a solid block fills its box (fill 1.0), an outline about a third of it.
  - ghostty-web published: no. Unfocused fill 1.0. Its renderer has block, underline and bar,
    all filled, and does not know about focus.
  - ghostty-web patched: yes. Unfocused fill 0.33, focused 1.0.
  - wterm: yes, a CSS outline (fill 0.34).
  - xterm.js: yes, `cursorInactiveStyle: "outline"` (fill 0.35). It draws no cursor at all until
    the terminal has had focus once.
  - restty: no (fill 1.0).
- **What the accessibility tree shows** (Chromium's `Accessibility.getFullAXTree`):
  - ghostty-web: a canvas and a text box named "Terminal input". No screen text in the tree.
    The app adds its own `.screen-text` copy for this reason (`apps/fabrika/src/window/terminal.ts`).
  - wterm: the rows as 25 static text nodes, and a text box named "Terminal". The screen text
    is in the tree.
  - xterm.js: a text box only, unless `screenReaderMode` is on. Then a list of the rows, with
    the text in the tree.
  - restty: a canvas and two text boxes with no names.

## The patch, and the hollow cursor

- **Size.** `ghostty-web-render-on-change.patch`: 11 lines out, 17 in, in
  `dist/ghostty-web.js`. `ghostty-web-hollow-cursor.patch`, on top: 2 lines out, 11 in. Both are
  JavaScript only. The WebAssembly is not touched.
- **What the render patch changes.** The forever loop becomes `requestRender()`, one frame per
  change. It is called from the places that change what is drawn:
  - a write, a scroll (every scroll goes through `onScroll`), a selection (ghostty-web's
    selection code already calls a `requestRender()` that was left empty), a link hover, a
    cursor style change, the blink timer, and focus and blur.
  - Resize and the scrollbar fade already called `render` themselves.
- **The hollow cursor.** The cursor's shape is drawn in JavaScript (`renderCursor`, with
  `fillRect`). The WebAssembly only says where the cursor is and whether it shows. So a
  `blurred` flag on the renderer, a `strokeRect` branch, and a full redraw on focus and blur are
  enough. The pixel check above shows it working.
- **How it would ship.** `pnpm patch ghostty-web@0.4.0` writes a patch under `patches/` and a
  `patchedDependencies` entry, and the app's own `terminal.ts` does not change at all. The
  patch is against the built file, so a new ghostty-web version means making it again. The
  upstream issue is the place to offer it.

## Recommendation

**Keep ghostty-web 0.4.0 and ship both patches through `pnpm patch`. Confidence 75%.**

- **Why:**
  - It fixes the measured cost. At 16 tiles, idle goes from 32.6 points to 3.8.
  - It is the smallest change: no line of `terminal.ts`, no change to the page policy, no new
    files served. The hollow cursor comes with it.
- **What it costs:** a patch on a minified build file that we own until upstream fixes #208.
  Busy cost stays close to today's (about 41 points at 16 tiles scrolling). The page still has
  no screen text in its accessibility tree, so the app keeps its `.screen-text` copy.
- **The doubt, and what would settle it:**
  - The app in daily use shows about 70% renderer and 25% GPU. One reading from daily use, with
    `ps`, on the same day: two tiles (the tracker and tsh), the renderer at about 100% of one
    core for an hour, up from about 70% earlier that day, and 0.0% within seconds of the window
    being minimized. A minimized window gets no animation frames, so that cost is all the
    per-frame draw; the tracker's poll and tsh cost nothing that shows. Driven here, the app
    reached 12 + 24 with 16 tiles, and the harness at four times the pixels 14 + 24. Something in daily use is not in
    this setup. One guess, not tested: the laptop's own screen runs at 120 Hz, which doubles
    the frames a forever loop draws. Settle it by running the patched app for a day on both
    screens and reading Activity Monitor.
  - A frame the patch forgets to ask for shows up as a stale screen, not a crash. One case is
    not covered: moving the window to a screen with a different pixel ratio. The old loop
    noticed on the next frame; the patched one notices at the next change. The same day of use
    would find others.
- **If ghostty-web is dropped later, xterm.js 6 with WebGL is next.** Cheapest when busy (18
  points at 16 tiles), idle near zero, hollow cursor built in, smallest bundle after plain
  xterm. Switching costs, in `terminal.ts`:
  - The `Terminal` and `FitAddon` imports and options change (about 20 lines). Its
    `onResize` maps to the size message as today's does.
  - The WebAssembly loading goes (about 25 lines), and the `.wasm` import with it.
  - The page policy needs inline styles (`style-src 'unsafe-inline'`), or xterm's colors and
    cursor styles are lost. That is a real step down in the page's safety.
  - The `.screen-text` copy can stay as it is, or `screenReaderMode` can replace it, and the
    end-to-end test (`apps/fabrika/e2e.ts`) reads `.screen-text` today.
- **wterm is not recommended now.** Its idle is fine, and its rows are real DOM text, but it is
  the most expensive while busy (81 points of renderer at 16 tiles), it needs both
  `connect-src` and inline styles, and it is a 0.5 experiment. Switching would cost: a served
  `.wasm` file (a new entry in `apps/fabrika/src/files.ts`), `supportFetchAPI` on the app's
  scheme, the two policy changes, and the mirror code removed.

## Dependencies

- They live in one place: `experiments/142-web-terminals/package.json`, a private workspace
  package listed in `pnpm-workspace.yaml`. Nothing went into `apps/fabrika`, which stays on
  ghostty-web alone until a decision is made.
- New catalog entries, pinned exactly: `@wterm/dom` 0.5.5, `@wterm/ghostty` 0.5.5,
  `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-webgl` 0.19.0, `restty` 0.3.0.
- The patched ghostty-web is made at build time, into `runs/exp-142`, from the published file
  and the two `.patch` files, with the standard `patch` tool.

## What this cannot tell us

- **Why the app shows 70% in daily use.** Not reproduced here, see the doubt above.
- **Light on the screen.** Typing is measured to the library's draw call. The pixels land one
  frame or more later, and this harness cannot see when.
- **One machine, one 60 Hz screen, short runs.** Idle is 20 s per case, busy 10 s, each run
  once in the final pass. An earlier full pass gave idle numbers within about 1 point.
- **The control is not a control when busy.** The blank page's `<pre>` grows with every line
  and is laid out again each time, so it reads 39 to 111% busy. Its busy numbers are saved but
  mean nothing.
- **restty** had no burst, busy or typing numbers: it has no public draw hook or screen read.
- **Growth over time** was read once, for 3 minutes, on two tiles. An hour, as in daily use,
  was not run.
- **Large-window and busy runs** covered ghostty-web (both), wterm, xterm and xterm-webgl only.
- **The patch's correctness** is shown by these checks only: the prompt, both bursts, typing,
  the keys and the cursor. It was not used for real work.

Guesses that turned out wrong:

- **Wrong:** "`seq 1 2000` to every tile will separate the libraries." Every library settled in
  under 100 ms with no frame over 50 ms. The colored burst and the busy run were added for that.
- **Wrong:** "the harness will show the app's 70%." It showed a third of it, and so did the app
  itself when driven here.
- **Wrong:** "a bigger window will close that gap." Four times the pixels added about 6 points.
- **Wrong:** "turning blink off removes most of the idle cost." It saved 6.5 of 32.6 points at
  16 tiles; the loop draws anyway.
