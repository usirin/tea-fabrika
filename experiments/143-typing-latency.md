# 143. How long does a key take to reach the screen?

The question: in the fabrika app, a key typed in a tile goes from the page to tsh's line editor,
comes back as an echo, and is drawn by ghostty-web on the tile's canvas. Where does the time go
on that path, at 60 Hz and 120 Hz, idle and busy? Which cheap fix buys how much? And does pull
request 90, which moves the host into its own process, cost a typist anything?

**Answer: in a fresh tile today, a key takes 44 ms at 60 Hz and 27 ms at 120 Hz (median; 63 and
36 ms at p95). That is from when Chromium makes the key event to when it says the frame is on
screen. About 23 ms of it (14 ms at 120 Hz) is Chromium and macOS: an empty Electron page that
draws a key in the next frame takes 26 ms (15 ms). The trip to the line editor and back costs
0.4 ms. Pull request 90's host adds about 0.5 ms. Our own big cost is the terminal's draw, 8.4 ms
a key: the line editor's redraw clears every row under the prompt, and ghostty-web then draws
every one of them. Two cheap changes bring a key to 31 ms (17 ms at 120 Hz) at the median and
39 ms (23 ms) at p95, within 5 ms (2 ms) of the empty page. One: redraw only the typed row. Two:
turn off a Chromium feature that holds the echo for a frame, which at 60 Hz hits about 1 key in
10. Confidence 85% on where the time goes and on the row fix, 75% on the Chromium switch.**

```ts
// The whole idea, as the script runs it (a sketch; the real code is 143-typing-latency.ts).
for (const copy of ["main", "pr90", "main-f2", "main-f123+nodefer", "floor" /* and more */]) {
	const app = await launch(copy, {FABRIKA_HOME: freshHome()}); // a patched copy (quiet: see below)
	await tracing.start(["benchmark", "blink.user_timing"]); // one clock for every process
	for (const key of lettersWithCtrlUEvery25(250)) {
		await press(key); // through Chromium (CDP), not the keyboard
		await frameAfterTheEcho(); // the page's own probe says the echo was drawn
		await wait(30 + seededRandom(0, 60)); // every copy gets the same gaps
	}
	// Per key, from the trace: the key event's start, the end of the echo's draw, the frame shown.
	// Per key, from probes in each process: every hop, on that process's own clock.
}
```

## Who did what

- **This repo's code:** all of it. Copies of the app (`apps/fabrika`) at two pinned commits,
  built by the script with timing probes patched in, driven by Playwright's Electron support.
- **Today's fabrika:** nothing. No agent, no model, no Jev, no network while measuring, and the
  Jev key unset. $0.

## Setup

- One Apple M2 Max laptop (12 cores), macOS 14. Electron 45.0.0, which is Chromium 156 and
  Node 24.22. Window 1200 by 760 at scale 2.
- 60 Hz is an external display. 120 Hz is the laptop's own ProMotion display, and Electron does
  draw at 120 Hz there: a frame every 8.3 ms. So here the rate and the display change together.
- Two builds:
  - main at `27f6afa`;
  - pull request 90 at `23327b0`: the host runs in its own process, and the app talks to it
    over a Unix socket.
- Each copy is made with `git archive` under `runs/exp-143/build/`, which git ignores. The
  probes are patched in, and each fix is patched on top. The app itself is not changed. Each
  copy uses the app's installed ghostty-web 0.4.0 with the app's own pnpm patch, and the script
  checks the built page holds it.
- Three conditions:
  - **idle-fresh:** a new tile. The prompt is on the top row, and every row under it is empty.
  - **idle-full:** after `seq --to 300`. The prompt is on the last row.
  - **busy4:** four tiles. One runs `seq --to 3000000` the whole time; keys go to another.
- Keys: 250 letters a run, typed at tsh's prompt, with Ctrl-U every 25 to keep the line on one
  row (Ctrl-U is not timed). The next key goes only after the frame that follows the echo's
  draw, and then a seeded gap of 30 to 90 ms.
- Two measures:
  - **trace:** Chromium's own tracing, one clock for every process. A key starts at its
    `EventLatency` begin, when Chromium's browser process made the key event. It ends at the
    end of the `PipelineReporter` of the frame that drew the echo: when Chromium is told the
    frame is on screen.
  - **probes:** rows of `performance.now()` inside each process: the page, the main process,
    and pull request 90's host. Every hop is a difference inside one process. A hop that
    crosses processes is a round trip seen from one side, less the time the other side says it
    spent. No two clocks are ever compared.
- The copies took turns inside each condition and rate, so a machine that got busier over the
  hour moved them all alike.
- Measuring never ran under `nice`. Builds and checks did.
- **The floor** is no copy of the app. It is one canvas that draws a key in the next frame, with
  no bridge and no terminal (`143-typing-latency/floor/`). It is the least an Electron page
  takes on this machine.

## Where the time goes

Idle-fresh, 250 keys a run, p50 / p95 in ms. The last row adds p99.

| Hop | main 60 Hz | PR 90 60 Hz | main 120 Hz | PR 90 120 Hz |
|---|---|---|---|---|
| Key event to the page's key handler | 0.2 / 0.3 | 0.2 / 0.3 | 0.2 / 0.3 | 0.2 / 0.3 |
| Round trip to the line editor and back | 0.4 / 6.4 | 0.9 / 8.8 | 0.4 / 0.7 | 0.9 / 2.6 |
| ... of it, the main process's work | 0.21 / 0.31 | 0.73 / 1.21 | 0.21 / 0.33 | 0.74 / 1.12 |
| ... of it, the host's work | none | 0.32 / 0.58 | none | 0.31 / 0.59 |
| The terminal reads the echo | 0.1 / 0.2 | 0.1 / 0.2 | 0.1 / 0.2 | 0.1 / 0.2 |
| Wait for the terminal's next frame | 0.8 / 16.5 | 0.9 / 16.4 | 0.2 / 7.7 | 0.2 / 8.1 |
| The terminal draws | 8.4 / 10.2 | 8.3 / 9.0 | 8.2 / 9.2 | 8.3 / 9.1 |
| Key event to the end of the draw (trace) | 10.8 / 32.2 | 11.1 / 34.7 | 9.4 / 17.3 | 10.0 / 19.6 |
| End of the draw to on screen (trace) | 31.2 / 33.8 | 31.9 / 35.2 | 17.1 / 20.2 | 17.4 / 20.0 |
| **Key event to on screen, p50 / p95 / p99** | **43.6 / 62.7 / 71.6** | **45.4 / 65.9 / 71.3** | **26.7 / 36.5 / 41.7** | **27.6 / 38.8 / 44.9** |

Each row is its own median, so the rows do not add up.

- **Most of a key's time comes after the draw:** 31 of 44 ms at 60 Hz, 17 of 27 ms at 120 Hz.
  Most of that, Chromium and macOS take on any page. The floor takes 24 ms (15 ms at 120 Hz)
  from its draw to the screen.
- **On macOS, Chromium's "on screen" time is an estimate.** The GPU process takes the time macOS
  reports for a frame and adds about one and a half frames: "params.display_time ~=
  params.callback_time + 1.5x |frame_interval|"
  ([`image_transport_surface_overlay_mac.mm`](https://source.chromium.org/chromium/chromium/src/+/main:gpu/ipc/service/image_transport_surface_overlay_mac.mm)).
  That is about 25 ms at 60 Hz and 12.5 ms at 120 Hz in every number here. It is the same in
  every copy, so the differences hold. The absolute numbers carry Chromium's estimate.
- **Our one big cost is the draw: 8.4 ms a key.**
  - The line editor redraws the prompt line by going back to its start and clearing to the end
    of the screen (CSI J).
  - In a fresh tile, that marks every empty row under the prompt as changed.
  - ghostty-web draws every changed row. For each row, it also reads the whole screen out of
    WebAssembly again.
  - In idle-full, with no rows under the prompt, the same draw takes 0.4 ms.
- **The big draw also makes the frame miss a screen refresh.** At 60 Hz, from the end of the
  draw to the screen takes 31.2 ms with the big draw and 23.4 ms with a one-row draw (fix 2
  below). The frame's GPU work grows too: 1.55 ms against 0.28 ms.
- **The trip to the line editor is 0.4 ms.** On main, the editor runs in the main process and
  works 0.2 ms there. The rest is Electron's message ports, both ways.
- **Pull request 90 adds about 0.5 ms a key to the round trip.**
  - Main side: 0.14 ms up to the socket, 0.51 ms on the socket and in the host, 0.07 ms back.
  - The host's own work is 0.3 ms. The kernel's share (the socket round trip less the host's
    work) is 0.2 ms.
  - End to end it is 1 to 2 ms at p50 (45.4 against 43.6, 27.6 against 26.7). That is at the
    edge of the run-to-run noise below.
- **The p95 is mostly waiting for a frame.** A key that comes just after a frame waits up to one
  frame for the next. On top of that, about 1 key in 10 at 60 Hz waits one frame more: see
  "The Chromium feature that holds the echo".
- **Run-to-run noise.** Main at 60 Hz, run again in an earlier session: 44.6 / 66.9 / 72.3,
  against 43.6 / 62.7 / 71.6. Treat about 1 ms at p50 and 4 ms at p95 as noise.

## The floor

- The empty page takes 26.2 / 35.9 / 39.4 ms at 60 Hz and 15.2 / 19.1 / 20.7 ms at 120 Hz
  (p50 / p95 / p99, 250 keys, launched quiet). That is the best an Electron page can do on
  this machine, by this measure.
- From its draw to the screen: 23.8 / 34.1 ms at 60 Hz, 14.6 / 18.5 ms at 120 Hz.
- On macOS a native app can ask for a shorter queue to the display
  ([`CAMetalDisplayLink.preferredFrameLatency`](https://developer.apple.com/documentation/quartzcore/cametaldisplaylink/preferredframelatency)).
  A page cannot. Chromium's `desynchronized` canvas hint, which does this on some systems, does
  nothing on Mac (fix 5 below).

## Fixes: which buys how much

Idle-fresh, 250 keys a run, key event to on screen, p50 / p95 / p99 in ms. "f123" is fixes 1,
2 and 3 together.

| Copy | 60 Hz | 120 Hz |
|---|---|---|
| main, no fix | 43.6 / 62.7 / 71.6 | 26.7 / 36.5 / 41.7 |
| fix 1, read the screen once a write | 43.4 / 66.4 / 72.0 | 22.2 / 27.9 / 33.6 |
| fix 2, redraw only the typed row | 32.2 / 49.4 / 53.6 | 16.8 / 21.5 / 27.8 |
| fix 3, read the text back when idle | 43.2 / 68.1 / 72.0 | 26.9 / 37.0 / 40.6 |
| fixes 1 and 2 | 32.4 / 51.5 / 55.4 | 17.1 / 23.3 / 29.8 |
| f123 | 32.6 / 49.8 / 55.7 | 17.1 / 22.2 / 29.7 |
| main, the Chromium feature off | 43.8 / 55.8 / 57.2 | 26.4 / 33.4 / 37.2 |
| f123, the Chromium feature off | 31.4 / 39.1 / 40.5 | 16.8 / 22.8 / 27.9 |
| f123 and fix 4, local echo | 30.9 / 38.7 / 40.0 | 16.0 / 20.7 / 27.1 |
| f123, fix 4, the Chromium feature off | 30.6 / 38.6 / 40.4 | 16.5 / 20.8 / 25.6 |
| f123 and fix 5, a desynchronized canvas | 32.1 / 49.1 / 54.1 | 17.3 / 24.0 / 30.0 |
| PR 90, no fix | 45.4 / 65.9 / 71.3 | 27.6 / 38.8 / 44.9 |
| PR 90, f123 | 32.5 / 51.7 / 55.6 | 17.8 / 25.6 / 32.3 |
| PR 90, f123, the Chromium feature off | 32.2 / 40.4 / 41.8 | 17.1 / 23.0 / 29.7 |
| PR 90, f123 and fix 4 | 31.5 / 38.5 / 40.5 | 16.2 / 20.3 / 24.8 |
| the floor | 26.2 / 35.9 / 39.4 | 15.2 / 19.1 / 20.7 |

1. **Redraw only the typed row** (`fix2-erase-row.patch`, in `apps/fabrika/src/editor/editor.ts`).
   When the line fits its row before and after, the editor goes to the row's start, clears to
   the row's end (CSI K), and writes the line. A line that wraps keeps the old way.
   - Gain: at 60 Hz, 43.6 to 32.2 ms at p50 and 62.7 to 49.4 ms at p95. At 120 Hz, 26.7 to
     16.8 ms and 36.5 to 21.5 ms. The draw goes from 8.4 to 0.4 ms.
   - Cost: about 20 lines. The editor's test grid (`apps/fabrika/src/editor/grid.ts`) does not
     know CSI K yet, so it has to learn it too. A wrapped line still pays the old cost. A
     fuller fix clears only the rows the old line used.
   - Confidence 85%. The gain repeats at both rates and matches the draw it removes. The doubt:
     only short lines were typed, so the fall-back for long lines was not measured.
2. **Turn off Chromium's `DeferRendererTasksAfterInput`** ("the Chromium feature off" above). One
   line in `main.ts` before the app is ready: add the name to `--disable-features`, joined to
   any list already there.
   - Gain, with f123 in: at 60 Hz, p95 49.8 to 39.1 ms and p99 55.7 to 40.5 ms; p50 32.6 to
     31.4 ms. At 120 Hz, no gain we can see. In busy4, with f123 in, the round trip drops from
     11 ms to 1.7 ms (40-key smokes).
   - Cost: one line. Chromium made the feature to bring the frame after an input sooner, by
     holding tasks that can wait. Turned off for the whole app, it may slow other views' first
     frame after an input under load. That was not measured. It is also a Chromium feature
     name, which a later Electron may rename or drop: it needs a check at each upgrade.
   - Confidence 75%. The trace shows the hold, and turning the feature off removes it. The
     doubt: one machine, the 60 Hz display is the external one, and the app's other views were
     not measured. A run of the program views with the feature off, and a check at the next
     Electron upgrade, would settle it.
3. **Read the screen once a write** (`fix1-viewport-cache.patch`, in ghostty-web). ghostty-web
   keeps the screen it read out of WebAssembly until the next write or resize.
   - Gain: the draw halves, 8.4 to 4.2 ms. At 120 Hz, 26.7 to 22.2 ms at p50. At 60 Hz,
     nothing: the frame still misses the same refresh. With fix 2 in, nothing more (32.4
     against 32.2).
   - Cost: a patch on a package the app already patches. ghostty-web 0.4.0 is its newest release.
     Its JavaScript changes the screen only through write and resize, so the patch clears the
     kept screen there; 75% sure nothing else changes it.
   - Confidence 60% that it is worth taking. It should matter where many rows change in each
     frame, as with heavy output, but fix 2 with and without it was not measured under load.
     It fits better as a fix in ghostty-web itself.
4. **Local echo** (`fix4-local-echo.patch`), as [mosh](https://mosh.org/mosh-paper.pdf) does it.
   A printable key, typed at the end of a `tsh$` line, is drawn at once. tsh's own redraw of the
   line comes after and writes the same cells.
   - Gain, with f123 in: at 60 Hz, 32.6 to 30.9 ms at p50 and 49.8 to 38.7 ms at p95. That is
     about what the Chromium switch buys (31.4 / 39.1). Both together: 30.6 / 38.6.
   - Risk: a guess is wrong where a program does not echo: a password prompt, vi, a search.
     The patch guesses only at the end of a `tsh$` line, and tsh's next redraw writes over a
     wrong guess. mosh underlines a guess it is unsure of, and was wrong on 0.9% of keys.
   - Do not take it now. Confidence 80%. With the round trip at 0.4 ms, it buys what the
     Chromium switch buys, with more risk. It would matter if the line editor moved far away,
     to a remote host.
5. **Read the screen text back when idle** (`fix3-mirror-idle.patch`): no gain (43.2 against
   43.6). The read back takes 0.2 ms. Drop it.
6. **A desynchronized canvas** (`fix5-desynchronized.patch`): no gain (32.1 against 32.6). The
   canvas reports itself desynchronized, but on Mac the hint does not change how frames reach
   the screen ([graphics-dev](https://groups.google.com/a/chromium.org/g/graphics-dev/c/20qDm3ZD2f8),
   [the intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/nxjWgMIeC1Q/m/GfwjbzeVAwAJ)).
   Drop it.

## The Chromium feature that holds the echo

- Chromium 156 turns `DeferRendererTasksAfterInput` on by default
  ([`features.cc`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/common/features.cc)).
  After an input event, the page's tasks that can wait are held until the next frame. Under the
  default policy almost every kind of task can wait, posted messages included
  ([`frame_scheduler_impl.cc`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/scheduler/main_thread/frame_scheduler_impl.cc)).
- The echo comes back to the page on a message port, so it is one of them.
- One key in a deeper trace (main with f123, 60 Hz): the echo reached the page's process about
  1 ms after the key. It ran only at 12.9 ms, just after a frame that drew nothing (12.7 ms).
  Its draw then waited for the frame at 29.8 ms.
- At 60 Hz this hits about 1 key in 10: 10% of keys in main and 12% with f123 have a round trip
  over 2 ms. A held key takes about 20 ms more (64.7 against 43.2 ms on average, main). At
  120 Hz, 3 to 4% of keys. With the feature off, 0 to 1%.
- Playwright switched this feature off in its own Chromium until April 2025, then stopped,
  saying it was fixed upstream
  ([microsoft/playwright#35573](https://github.com/microsoft/playwright/pull/35573)). Playwright's
  Electron launch adds no Chromium switches at all, so these runs saw the feature as the app
  ships it.

## Idle-full and busy

Busy4, 40 keys a run, 60 Hz, p50 / p95 in ms.

| Copy | Key to screen (p99 too) | Round trip | Wait for frame | Draw | Draw to screen |
|---|---|---|---|---|---|
| main | 63.5 / 68.3 / 69.1 | 11.0 / 15.5 | 15.9 / 17.1 | 1.9 / 2.1 | 35.7 / 36.4 |
| PR 90 | 64.7 / 70.3 / 79.9 | 11.5 / 16.6 | 16.0 / 16.8 | 1.9 / 2.1 | 35.7 / 36.6 |
| main, f123, the feature off | 35.5 / 42.1 / 44.0 | 1.7 / 4.1 | 9.2 / 15.3 | 0.1 / 0.3 | 22.5 / 23.2 |
| PR 90, f123, the feature off | 35.6 / 42.6 / 43.8 | 2.3 / 6.3 | 9.6 / 16.3 | 0.1 / 0.2 | 22.4 / 23.3 |

- **These busy runs are 40-key smokes,** launched normally, once each. A p95 of 40 keys is the
  38th key, so it is rough.
- **Idle-full is already fast.** With the prompt on the last row, main takes 32.6 / 47.3 /
  52.0 ms at 60 Hz and PR 90 33.6 / 49.6 / 55.2 ms; the draw is 0.4 ms. Fixes 1, 2 and 3 change
  nothing there (33.5, 33.2 and 32.4 ms at p50): there is nothing under the prompt to clear.
  At 120 Hz, main took 16.7 / 21.0 / 25.0 ms (earlier session). So today's app is slow only on a
  tile with empty rows under the prompt: a new tile, or after `clear`.
- **Busy: the round trip is 11 ms, but not because the main process is busy.** Its work for the
  key is still 1.0 ms on main, and the host's 1.3 ms on PR 90. The other 10 ms is on the way
  between the processes. With f123 and the Chromium feature off, that part is 0.7 ms, so it is
  most likely the feature holding the echo again. These runs do not split the two.
- **The busy tile makes every frame heavier:** 5.6 ms of main-thread work a frame on main, 2.0 ms
  with f123. The heavier frame reaches the screen later (35.7 against 22.5 ms).
- The earlier session's 250-key busy run (probes only, main, normal launch) agrees: page total
  43.4 / 50.5 ms, round trip 12.7 / 16.1 ms.
- No fix was tried alone under load, so which of them buys the 28 ms there is not known.

## Quiet launches

Partway through, the launches were found to take focus from whoever was using the machine. From
then on, every copy opened quiet:

- `app.setActivationPolicy("accessory")` before the window is made: no Dock icon, never the
  active app;
- the window made hidden (`show: false`, `paintWhenInitiallyHidden: true`,
  `backgroundThrottling: false`), shown with `showInactive()`, kept on top and never focusable;
- three Chromium switches so a covered window keeps drawing
  (`disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`,
  `disable-background-timer-throttling`), and CDP's focus emulation so the page acts focused;
- keys and clicks through CDP, as before.

Which runs are which (each run's `launch` in the results file says it too):

- **Launched normally:** every 250-key run of the copies and fixes in the tables above, the
  earlier session's runs (named `.m1`), and the busy4 smokes.
- **Launched quiet:** the floor, the pairs below, the profiler check, and the first quiet check.

Main, idle-fresh, 60 Hz. Load is the one-minute load average at the start, on 12 cores.

| Run | Launch | Keys | Load | Draw p50 | Key to screen p50 / p95 |
|---|---|---|---|---|---|
| earlier session | normal | 250 | 12.0 | 8.3 | 44.6 / 66.9 |
| the main table | normal | 250 | 7.0 | 8.4 | 43.6 / 62.7 |
| pair 1 | quiet | 30 | 5.5 | 8.3 | 43.0 / 62.0 |
| pair 1, App Nap blocked | quiet | 30 | 5.5 | 8.4 | 42.6 / 62.8 |
| pair 2 | quiet | 60 | 6.2 | 8.4 | 46.2 / 66.0 |
| pair 2, App Nap blocked | quiet | 60 | 6.4 | 8.3 | 45.2 / 65.2 |
| first quiet check | quiet | 30 | 16.7 | 54.8 | 96.7 / 114.5 |

- **Quiet mode is not the cause of the slow first quiet check.** Quiet and normal launches give
  the same draw (8.3 to 8.4 ms), and the same key to screen within the noise of short runs.
- **The page's CPU is not slowed.** The same fixed loop (30 times 5 million `Math.imul`) ran in
  the page and in plain Node at the same moment: 6.2 to 6.4 ms in the page, 6.1 to 6.9 ms in
  Node, a ratio of 0.93 to 1.03. `ps` gave the main, GPU and page processes priority 46 to 47
  and Node 31, with nice 0 for all.
- **App Nap is not the cause.** The copy's own main process asked macOS not to nap it
  (`powerSaveBlocker.start("prevent-app-suspension")`; no system setting was written).
  `pmset -g assertions` showed its assertion only when it was on. The draw was the same with it
  and without it.
- So nothing here belongs in the app's own quiet launch (pull request 96).
- **The first quiet check stays unexplained.** The machine's load was 16.7 then, against 5.5 to
  7 for the others, and the window server used 61% of a core. Our guess is a busy machine. That
  is a guess.
- **What the quiet question touches:** only how a copy was opened. Every comparison of fixes is
  between normal launches, opened the same way, taking turns. The floor and the profiler check
  were quiet. Comparing them with the normal runs leans on the pairs above, which agree within
  about 3 ms at p50.

## The bar: published numbers

None of these measure what we measured. Each has its own start and end.

| What | ms | How | Source |
|---|---|---|---|
| Terminal.app, Alacritty, iTerm2, Hyper; macOS 10.12, 2014 MacBook Pro | idle median 6, 31, 44, 32; p99.9 25, 36, 60, 49 | key press to an internal screen capture, 10,000 presses | [danluu.com, 2017](https://danluu.com/term-latency/) |
| Chrome's text input, Terminal.app, kitty, Alacritty, iTerm2; macOS, 4K screen at 60 Hz | mean 34.2, 35.8, 36.1, 50.4, 50.5 to 53.1 | a USB key press sent by a microcontroller, to a light sensor at the top of the screen | [thume.ca, 2020](https://thume.ca/2020/05/20/making-a-latency-tester/) |
| kitty, Terminal.app, WezTerm, Alacritty, iTerm2; M1 Pro, 4K at 60 Hz | 37.5, 45.4, 45.8, 57.9, 62.5 to 87.5 | slow-motion phone video; the author says "this data is not accurate" | [lkhrs.com, 2022](https://www.lkhrs.com/blog/2022/07/terminal-latency/) |
| GVim, Sublime Text, IDEA, Atom; Windows 7 | mean 0.9, 8.2, 24.7 (2.9 in its zero-latency mode), 49.4 | Typometer: a made key event to a screen capture | [pavelfatin.com, 2015](https://pavelfatin.com/typing-with-pleasure/) |
| xterm, Alacritty; Linux, X11 | mean 5.3, 6.9 | Typometer | [beuke.org, 2024](https://beuke.org/terminal-latency/) |
| xterm, Zutty, kitty, Alacritty; Linux, X11, no compositor, 60 Hz | median 1.96, 6.42, 8.99, 17.11 | Typometer | [tomscii.sig7.se, 2021](https://tomscii.sig7.se/2021/01/Typing-latency-of-Zutty) |
| Keyboards alone | 15 to 60 | key starts to move to its USB packet | [danluu.com, 2017](https://danluu.com/keyboard-latency/) |

- **Where we sit, roughly.** Our numbers leave out the keyboard, USB, macOS's input path and the
  panel, so a hardware number for the same app would be higher, by an amount not measured here.
  With that said: today's app (44 ms at 60 Hz, before those parts) is near what thume.ca found
  for iTerm2 and Alacritty with everything in (about 50 ms). The fixed app (31 ms) is near
  Chrome's text input, Terminal.app and kitty (34 to 36 ms with everything in). Confidence 50%
  on this placing: the parts we leave out could be a few ms or ten.
- Ghostty itself: no published end-to-end number was found.
- **What people notice.** No study we found gives one number for typing. Ink & Switch say they
  are "not aware of studies specifically measuring least noticeable end-to-end typing
  latencies", and estimate the threshold is "below ~100ms for many users, and perhaps well below
  it" ([slow software](https://www.inkandswitch.com/slow-software/)). Studies on touch put it
  lower for dragging than for tapping:
  - dragging on a touch screen: about 6 ms (2 to 11), Ng et al. 2012, as reported in
    [Ng et al. 2014](https://sites.ualberta.ca/~wfb/publications/C-2014-SIGCHI-Latency.pdf);
  - tapping on a touch screen: 64 ms, Jota et al. 2013, as reported there too;
  - on a touchpad: 55 ms dragging, 96 ms tapping, and a cut of 8.3 ms can be noticed, Deber et
    al. 2015, as reported in [this 2024 review](https://arxiv.org/html/2408.02525);
  - for typing, fast typists notice more ([Schmid 2023](https://epub.uni-regensburg.de/55007/1/text-input-latency.pdf)).
- A key press is closer to tapping than to dragging. So a 12 ms cut, from 44 to 32 ms, may or may
  not be noticed by everyone. The p95 cut at 60 Hz, from 63 to 39 ms, is the likelier one to be
  felt. That is a guess.

## What we take from it

- **Take fix 2: redraw only the typed row.** It is the one big cost that is ours: 11 ms at p50 at
  60 Hz and 10 ms at 120 Hz, from about 20 lines. Confidence 85%.
- **Take the Chromium switch, with a check.** It cuts the 60 Hz tail by 10 ms at p95 and 15 ms at
  p99, and most of the busy wait. One line, but it changes Chromium for every view; measure the
  program views with it before it ships. Confidence 75%.
- **Leave fixes 1, 3, 4 and 5.** Fix 1 adds nothing with fix 2 in, fixes 3 and 5 add nothing at
  all, and fix 4 buys what the switch buys, with wrong guesses possible.
- **Pull request 90 is fine for typing.** It costs about 0.5 ms on the round trip and 1 to 2 ms
  end to end, near the noise. Confidence 85%.
- **After both fixes, the rest is Chromium and macOS.** The app would be within 5 ms of an empty
  Electron page at 60 Hz and 2 ms at 120 Hz. Going lower would need a different way to show
  frames, outside Electron.

## Surprises and wrong guesses

- **The round trip was not the cost.** 141 said its 30 to 50 ms was "mostly the round trip to the
  main process and its line editor". Wrong: the round trip is 0.4 ms. The time is the draw and
  the display.
- **Electron 45 is Chromium 156, not 140.** 141 said 140. Wrong: 140 is only the build target in
  the app's esbuild settings.
- **Playwright adds no Chromium switches to Electron.** The guess going in was that it sets the
  same switches it sets for its own Chromium. Wrong: the app's command line had none of them, so
  the harness passes the three keep-drawing switches itself.
- **The profiler guess was wrong.** A first look with Chromium's profiler showed the terminal's
  frame callback at about 46 ms, and the guess was that the profiler slows WebAssembly. With the
  profiler on (100 µs samples, quiet, 60 keys), the draw is 9.2 ms against 8.3, and a key 44.4 /
  66.3 ms. Why the first look saw 46 ms is not known.
- **Two 120 Hz launches typed at the 60 Hz pace.** In the earlier session, main idle-fresh at
  120 Hz was opened twice in a row (probes, then trace). In both, the wait for a frame reached
  16.4 to 16.7 ms at p95, though idle frames came every 8.3 ms. The traced one took 43.5 ms a
  key, with 31.8 ms from draw to screen. The other 18 launches at 120 Hz did not do this. Cause
  not known.
- **Our own report step had a pairing bug, found while writing this.** In the trace, Ctrl-U is
  two key events (Control's and u's), so the trace's list of keys ran ahead of the plan's. From
  the 26th key on, a key's end-to-end time came from a key up to 9 places earlier, and 8 keys a
  run were paired with a Control key event and left out. The report step now pairs them right.
  The numbers here are after the fix. They moved by up to 0.7 ms at p50 and 1 ms at p95 for
  250-key runs, and 3 ms at p95 for one 60-key run.

## What this cannot tell us

- **The keyboard and macOS's input path.** Keys came through Chromium (CDP), not a keyboard. A
  hardware tester would add them.
- **Light on the panel.** "On screen" is Chromium's estimate on macOS. A light sensor or a fast
  camera would settle the absolute numbers.
- **Other machines and sizes.** One M2 Max, one window size, one font, scale 2. A bigger tile has
  more rows under the prompt, so we guess today's draw cost grows with it, and fix 2 matters
  more there.
- **A quiet machine.** Other work ran at the same time (load 5 to 17 on 12 cores), and a screen
  recorder kept the window server at 30 to 60% of a core. Taking turns spreads that across the
  copies; it does not remove it.
- **60 Hz against 120 Hz on the same display.** Here 60 Hz is the external display and 120 Hz the
  built-in one.
- **Load, properly.** The busy runs are 40-key smokes of two copies each, so which fix buys what
  under load is not known.
- **Long lines, programs and wide characters.** Every key was a letter on a short tsh line. A
  wrapped line, vi or less in a tile, or wide characters were not typed.
- **The app's other views with the Chromium feature off.**
- **The editor's tests with fix 2.** They were not run against it; the test grid needs CSI K
  first.
- **Pull request 90 later.** It was measured at one head. A later host may cost more or less.
- **The app after `27f6afa`.** Main has moved on since (the still cursor, for one). Those changes
  were not measured.
