# Experiment 176: modern React, tried on today's real app

Every claim here is about **today's version** of fabrika (`apps/fabrika`, `programs/*`), not `next/`.

```text
keep      store hook, memo per tile, flat keyed list, Strict Mode, Activity (a soak: no memory cost)
keep      a short ViewTransition, only with its press fix: 0 of 10 presses land without it
drop      a Relay-style tile store: no gain in any number, and a new way to lose a whole desk
change    React Compiler: it works after the store hook, and then tile memo is not needed
not yet   native dialog and popover under Manti: it works, as a small opt-in; no need today
keep      a paced feed in a tea Sub: 5 times fewer renders, and the newest text still shows
drop      useDeferredValue on the markdown window: keys got slower, no long frame to fix
```

The answer: **stable references and a list keyed by id did almost all the work.** A focus move went from 2553 renders to 67, and its time from 7.8 ms to 2.5 ms. The rest of the picks are correctness or feel, not speed.

Numbers come from one machine (Apple M2 Max, 12 cores, 96 GB), Electron 45 on Chromium 156, React 19.3.1, the real built app, on a temp `FABRIKA_HOME`. Other agents shared the machine, so load was often high; a difference under a few milliseconds means nothing. Each number is from one or two runs unless it says otherwise.

**All numbers came from a see-through window.** During this work the bench's windows were made fully transparent and click-through, so they would not flash at the owner. That fix is not on this branch; it lands in its own pull request. Whether a see-through window changes frame timing has not been measured. Cold-start numbers from before that fix are not used here.

## The bench

All of it is one script, `176-bench.ts`, with one output shape, so the coming `perf` program can start from it.

```sh
node experiments/176-bench.ts build p5 --root .        # a copy of the app under runs/exp-176
node experiments/176-bench.ts run p5 keystroke-echo    # a moment on that copy
```

```ts
// One real row of experiments/results/176-bench.jsonl, shortened.
{
	moment: "workspace-switch", variant: "p5-activity", commit: "7e2b27d...", at: "2026-11-01T02:59:29Z",
	machine: {cpu: "Apple M2 Max", cores: 12, memGb: 96, electron: "45.0.0", chrome: "156.0.8078.48"},
	desk: {tiles: 6, programs: ["tracker", "ticket", "markdown", "map", null, null], workspaces: 2},
	ms: {n: 20, p50: 27.2, p95: 32.2, max: 32.2},
	loaf: {count: 1, worstMs: 339.5},       // long animation frames
	processes: [{type: "renderer", cpuPct: 1.8, memMb: 389.66}, ...],  // app.getAppMetrics()
	mainLoop: {p50Ms: 1.21, p99Ms: 4.49},   // the main process's event loop delay
	renders: {total: 4839, perTile: {t1: 19, t4: 3940}},
}
```

Moments: cold start, keystroke echo, workspace switch, open ticket, focus move, one patch, split, turn, reveal, overlays, moves, feed, plus `soak`. It reads renders per tile from React's devtools hook in the production build. Today's desk has no "move" key, so `turn` (`C-b space`) stands in for a tile move.

## Pick 1: Strict Mode on. Keep.

- 0 warnings on a walk through the dev build, and the end-to-end test still passes (81 checks).
- It found one real bug shape (asks sent twice) and one test race. Production is unchanged.
- Terminals survive the double effect because they live outside React.
- **Against the study:** it said Strict Mode would catch `useMachine`'s death. Today's window files do not use `useMachine`, so that claim does not apply to today's version.
- **Sure:** 95%. Cost: nothing in production.

## Pick 2: one store hook for the desk's reads. Keep.

```ts
const useModel = () => useSyncExternalStore(subscribe, readModel, readModel);
```

- Speed did not change: focus move p50 7.8 against 8 ms.
- It was about 30 small edits. **Against the study,** which called it a real rewrite.
- What it buys is correctness, and it unlocks picks 3 and 6. See pick 6: without it the Compiler freezes the app.
- **Sure:** 95%.

## Pick 3: `memo` per tile. Keep, with `share`.

Does tea's update copy only what changed, so `memo` skips? Yes, and then the wire erases it.

| Where | Tiles that keep their reference, on a focus move |
|---|---|
| In the host, after tea's update | 16 of 16 |
| In the page, after the wire | 0 of 16 |
| In the page, after `share(old, next)` | 16 of 16 |

`share` costs about 0.02 ms on a 2821-byte desk.

| Copy | Renders per focus move | Focus move p50 | One patch p50 |
|---|---|---|---|
| Before | 2553 | 7.8 ms | 25.7 ms |
| `memo` on the view only | 83 | 2.4 ms | 8.2 ms |
| `memo` and `share` | 67 | 2.5 ms | 8 ms |

- **My guess was wrong:** I expected plain `memo` not to skip at all. It skips a lot, since most of a tile's props are its view, and views keep their reference.
- Split went from 59345 renders per 6 to 1832.
- `memo(function X)` becomes an arrow under format, so the display name is lost. Pick 10 sees that too.
- **Sure:** 95%. **`next/`:** the lesson is that a wire erases references. Bring them back at the door, or send deltas.

## Pick 4: a flat keyed list of tiles. Keep.

Nested `Container` loses the element whenever a split wraps a tile.

| Moment | Nested | Flat |
|---|---|---|
| A split wraps the tile: same element, scroll | no, 0 | yes, 1269 |
| A close unwraps it: same element, scroll | no, 0 | yes, 646 |
| Zoom in and out: a draft in the input | lost | kept |
| Turn: elements kept | 4 of 6 | 6 of 6 |
| Turn: renders per 10 | 1937 | 468 |

Rectangles are identical at 1280x800, and the end-to-end test passes. **Cost:** DOM order is id order, so tab order and screen reader order can differ from the picture. That needs its own answer before it lands. Shots: `p4-*.png` beside this file. At 1024x700 the tracker's footer clips in a 2x2 grid.

**Sure:** 90%. **`next/`:** tree for where a tile goes, flat list for what element holds it.

## Pick 4b: a Relay-style tile store. Drop.

**How close today is.** Not close. `frame.ts`'s `tiles` map is row id to tile id (`JobsList.tiles`), for the jobs list. The record itself lives inside the tree.

**What we tried.** Saved desks and the page read `{layout: tree of ids, tiles: {id: record}}`. The host's own operations stayed on the tree. Commit c524b0f holds it, and the copy `p4b-store` still runs.

```ts
checkStore(store) // each id appears exactly once, with a record, with the same id, and no orphan
```

**1. What we lose.**

- Restart works, and old files still read: `{"made":["t1","t2","t3"],"back":["t1","t2","t3"],"oldTreeFileGives":["t1","t2","t3"]}`.
- **One break in the law loses the whole kept desk:** `brokenFileGives: ["t1"]`, a fresh desk. A tree cannot have that break at all. The law has planted breaks for `twice`, `no-record`, `orphan` and `wrong-id`.
- Two parts must now agree, where one could not disagree.
- The saved file is 18% bigger (2738 against 3242 bytes).
- Code reading a tile through the tree: a full host rewrite would touch `desk.ts` 25 uses, `frame.ts` 18, `tree.ts` 13, `line.ts` 10, `node.ts` 9, `desk.tsx` 10, and tests about 60 (grep counts, some false hits). `isFolded`, `shareLine`, `openShares`, `flat` and `extents` need the folded record.

**2. Performance, two alternating runs.** No gain.

| Moment, p50 ms | Flat list, tree | Store |
|---|---|---|
| Focus move | 5.8, 2.9 | 3.5, 2.5 |
| One patch | 13.8, 11 | 11.9, 10.1 |
| Turn | 6.4, 7.6 | 7.6, 5.3 |
| Workspace switch | 27.5, 29.7 | 30.4, 29.4 |
| Open ticket | 123.2, 121.6 | 117.5, 110.5 |
| Split | 14.8, 14 | 17.1, 13.5 |

Renders match too (focus move 861, 854 against 854, 854). Turn is 484 against 829 per 10: the map drew once more, 394 fibers, not a cost of the store. Renderer memory is noise (403, 381 against 402, 403 MB). `toStore` costs 0.012 ms.

**What `next/` should do.** `next/` plans this shape, so this is the finding that matters most. **For rendering, the store gives nothing that `share` and a list keyed by id do not.** Keep the tree on disk unless sync needs records. What this run did not test: the wire here carries the whole desk in both copies, so per-record deltas are unmeasured. If `next/` wants records for sync, that is where a gain could be, and it should be measured there. **Sure:** 85% for rendering, no opinion for sync.

## Pick 5: `<Activity>` for tiles out of sight. Keep.

| After | Unmounted | Activity |
|---|---|---|
| Workspace there and back: draft, scroll | lost, 0 | kept, 700 |
| Zoom in and out: draft | lost | kept |
| After zoom, focus | tracker's button (a bug today) | the model's tile |
| Fold and unfold: scroll | 0 | 700 |
| Hidden tile, 30 patches: its renders | none | 0 |
| Workspace switch p50, renders per 20 | 31.8 ms, 14082 | 27.2 ms, 4839 |

- **Real terminals:** the canvas keeps its size and bytes sent while hidden draw on reveal, both ways.
- **0x0:** nothing to fix. `FitAddon` already ignores a zero size, and `tellArea` observes only `.workspace`, which stays.
- **Focus from the model on reveal:** program windows run their focus effects again on reveal, after a layout effect. So a passive effect gives the desk the last word. Focus inside a window goes to its start, not the exact inner element: inner focus is not in the model.
- **`memo` is required.** Without it, a hidden tile rendered 7380 fibers over 30 patches.
- **Cost:** any DOM read must filter hidden tiles. `e2e.ts` now uses `:visible`.
- A 339 ms long frame showed once on a switch. I did not trace it.
- **My first reading was wrong:** 1037 and 3114 ms on reveal looked like Activity's cost. It was a backlog in the host, in both copies.

**The soak: Activity costs no memory against the unmounted way.** One hour of each, side by side at low priority: 16 real terminals on 4 workspaces, one folded, plus a markdown window of 200 blocks, a tracker and a map. A line to every terminal and a tour of the workspaces each minute. Heap is after a forced garbage collection.

| At minute | Heap, Activity | Heap, unmounted | Renderer, Activity | Renderer, unmounted |
|---|---|---|---|---|
| 0 | 15.67 MB | 13.68 MB | 298 MB | 289 MB |
| 30 | 16.74 MB | 15.85 MB | 332 MB | 331 MB |
| 59 | 17.01 MB | 16.08 MB | 328 MB | 336 MB |

- Nodes and listeners stayed exactly flat in both for the hour (2139 and 789, 2662 and 847). So nothing leaks with each tour.
- Heap grows about 1.3 MB against 2.4 MB in the hour, and the renderer settles after about 30 minutes. An hour cannot say whether that slow heap growth ever stops.
- Why no gap: terminals live outside React and stay alive either way, so Activity keeps only what is cheap. It even held fewer nodes than the unmounted copy; I did not trace why.
- One tour draws 687 fibers with Activity and 1468 unmounted.

**Sure:** 90%. **`next/`:** hidden, not gone. Inner focus goes in the model if it should survive.

## Pick 6: React Compiler. Yes, after pick 2.

Does the freeze appear on the real file? **Yes.** Compiled before pick 2, the app never reaches its first prompt, even in 60 s. Compiled after pick 2, the first prompt comes in 883 ms.

| Copy | Compiled | Failed |
|---|---|---|
| Before pick 2 | 99 | 5 |
| After pick 2 | 100 | 5 |
| With Activity | 98 | 5 |

All 5 failures are in `pop.tsx`: `Palette` reassigns a variable after render, and `useTip` reads refs during render. Pick 10's rules find the same lines.

| p5 copy | Focus move renders, p50 | One patch renders, p50 | Split p50 |
|---|---|---|---|
| Plain | 854, 4.3 ms | 2785, 10.8 ms | 24.9 ms |
| Compiled | 774, 3 ms | 1609, 8 ms | 13.8 ms |
| Compiled, no tile `memo` | 774, 2.8 ms | 1609, 8.8 ms | 14.2 ms |
| Plain, no tile `memo` | 50763, 8.6 ms | 42440, 32.8 ms | 25.2 ms |

- **Against the study:** it said a compiled tile function still runs per patch, so `memo` stays needed. On the real file, in one run, the Compiler makes tile `memo` unnecessary (`tileShell`: t2 30, t1 3, t4 2, the same as with `memo`).
- **Build time:** `desk.js` takes 4.0 to 5.1 s compiled against 0.39 to 0.48 s plain, three runs each under load, so about ten times slower. Quieter runs earlier gave 1.5 to 2.2 s against 0.3 to 0.8 s. The Compiler ran only on the 11 window files, through Babel inside the bench, and the Compiler itself sits outside the lockfile on this branch.
- End-to-end test on compiled, dev and Strict: 81 checks pass.
- **Cost:** a slower build, and code the Compiler silently skips (5 here). **Sure:** 80%. Doubt: one run on the memo finding; a second run on another machine would settle it. **`next/`:** turn it on from day one, with the rules from pick 10 blocking.

## Pick 7: native `showModal` and `popover` under Manti. Works as an opt-in. Not needed today.

The app goes all in on Manti, so the question is what Manti would change. Today's desk popovers are not Manti: `pop.tsx` is hand-built, and Manti's `Dialog`, `Popover` and `Menu` are unused by the app. Neither Manti nor Zag uses `showModal` or `popover` today. The proof is a `pnpm patch` on `@manti-ui/react` 0.13.0 with `@zag-js/menu` 1.47.0, commit ea1f3aa, undone in the next commit. Nothing needed a `@zag-js` patch. The copies `p7-manual` and `p7-auto` still run.

```tsx
// The whole change, as a user of Manti sees it. Default off: nothing changes for anyone else.
<Dialog native open title="Commands" onOpenChange={...} />
<Popover native="manual" open onOpenChange={...} persistentElements={[() => opener]} />
```

| Check | Hand-built today | Native under Manti |
|---|---|---|
| Palette open, key to DOM p50, p95 | 4.8, 7.4 ms | 12, 16.1 ms |
| Focus trap after 6 Tabs | stays | stays |
| Typing "fold" | lands | lands |
| Esc through the model, focus back to t1 | yes | yes |
| Press outside the palette | closes, focus on body | closes, focus back on t1 |
| Press outside the panel | closes, press lands on t1 | same |
| Press on the opener | closes, does not reopen | same, with `persistentElements` |
| `desk.js` | 3034 KB | 3155 KB, 4% more |

The bigger open time (about 7 ms) comes with Manti and Zag's machine, not with `showModal`; the app did not use them before.

**`popover="auto"` or `manual`: `manual`.** In this run they behaved the same in all 10 checks. `auto` lets the browser close the panel first and tell the model after, through `toggle`. `manual` keeps the model the only one who closes it, which is what the desk's rule wants. **Sure:** 85%.

**Zag's menu keys inside a popover: they work, after two fixes.**

- A menu portalled to `body` draws under the top layer (`p7x-body-portal-menu.png`: the panel hides the menu's top). So the patch adds a `TopLayer` context, and Manti's portal mounts inside the open layer.
- The desk's key capture then took the arrow key, because the menu's target looked outside the box: the menu closed. The desk must treat anything in the box's top layer as inside. That one is an app change. ArrowDown, typeahead and Enter then work.
- Esc with a menu open closes menu and panel together, because the model takes Esc first.

**The change to Manti, written as a pull request.**

> **Dialog and Popover: an opt-in `native` prop, drawing in the browser's top layer.**
>
> Why: the top layer ends z-index fights, and `showModal` gives inertness and focus return from the browser. Default off, so nothing changes.
>
> 1. `src/internal/Portal`: add a `TopLayer` context. When set, a portal mounts there, not on `body`. Anything portalled to `body` under `showModal` is inert and under the top layer, so Menu, Select and Tooltip inside a native Dialog break without this.
> 2. A small internal helper `useTopLayer(show, hide)`: a ref callback that calls `showModal` or `showPopover`, and hides on cleanup. Plus a reset for the browser's own `dialog` and `popover` styles (`background`, `border`, `color`, `margin`, `max-width`, `max-height`), which could live in `@manti-ui/styles`.
> 3. `src/components/Dialog/Dialog.tsx`: props `native` and `persistentElements`. When native, pass the machine `modal: false, trapFocus: false, restoreFocus: false`, render the positioner as `<dialog>`, keep the backdrop as a div inside it, wrap content in `TopLayer.Provider`, and `onCancel={e => e.preventDefault()}` so Esc still goes through the machine.
> 4. `src/components/Popover/Popover.tsx`: props `native: "manual" | "auto"`, `persistentElements`, and `trigger` optional. The positioner gets `popover={native}`, and `onToggle` closes the machine if the browser closed it.
>
> What it could break: nothing with the prop off. With it on: toasts or a global portal outside the dialog are inert under `showModal`; Manti's positioner CSS meets the browser's dialog styles, hence the reset; `::backdrop` is not used. Not tested: placement. A Popover opened by a model has no anchor, and the app placed its panel itself. An `anchor` prop may be a further change. WebKit and Firefox are not tested here.

Hunk by hunk, the built file in the patch maps to items 1 to 4 in order, with the type files as the props above. `pnpm typecheck` passed on the patch, so the older `.js` fixes in it survive.

**Why not now:** nothing is broken today. The app's hand-built palette holds focus and returns it. Native gets Manti's whole machine too, for 4% more code and 7 ms. **Sure:** 75%. Doubt: whether a real use of Manti's Menu inside a palette appears; when it does, the top layer fix pays for itself. A review by Manti's maintainers would settle the shape. **`next/`:** build overlays on Manti with `native` once the pull request lands there.

## Pick 8: a short `<ViewTransition>` on tile moves. Keep, only with the press fix.

```tsx
// The page's model counts moves: a new shape in the same workspace. Only that count is deferred.
const movesDrawn = useDeferredValue(m.moves);
const layout = movesDrawn === m.moves || m.movedFrom === null ? ws.layout : m.movedFrom;
```

**What starts one.** Each number is transitions started.

| Moment | Runs |
|---|---|
| Turn, zoom, fold, unfold, split, close | 1 each |
| Dragging a border, resizing the window | 0 |
| A program opening in a tile | 0 |
| Workspace switch | 0 |

**My first try was wrong.** Deferring the layout itself started a transition on a program opening and on a workspace switch. Only deferring a count of real moves stopped that.

**The press.**

| 10 presses during a move | Plain transition | With the fix | No transition |
|---|---|---|---|
| Reached a tile | 0 | 10 | 10 |
| Focused it | 0 | 10 | 10 |
| Focus fell to `body` | 4 | 0 | 0 |

The study was right: the browser's picture takes every press. The fix is about 15 lines: a `mousedown` whose target is the page root, during a transition, keeps focus, ends the transition and hands the press to what lies under it. **It is a replayed press,** so a text selection or a drag begun in that 150 ms does not start, and an input is clicked but not focused. Keys need no fix: 5 of 5 land.

**The old picture over new text: fixed.** The study left this untested. With the browser's default, a stretched ghost of the old tile shows over the new one (`p8-old-image-text-during.png`). With `::view-transition-old { display: none }` and the new picture unstretched, new text shows live during the move (`p8-vt-replay-text-during.png`). Both shots are slowed to 2 s to catch them.

**Frames during a move:** gap p50 16.6 ms, p95 17.7, worst 33. No long frames over ten turns.

**The cost:** key to changed layout goes from about 5 ms to about 20 ms: the move waits a frame for the browser's picture. A key held through a split still lands on the new tile. **A move pressed soon after another waits for it:** the closing bench turns every 180 ms or so, and there key to layout is 74 to 94 ms against 5 to 7 without a transition. Someone who rearranges fast would feel that first.

**Sure:** 70%. Doubt: how the motion feels, and how Linear would feel about it. No probe says, and the owner should try it. Reduced motion has a CSS rule that I did not run. **`next/`:** if the owner likes it, a move is a fact the model counts, not something inferred from a layout change.

## Pick 9: a throttled feed, keep. `useDeferredValue`, drop.

**Against the study,** which said to use `useDeferredValue` for a heavy window (85% sure). On today's markdown window it made a key in another tile slower, and there was no long frame for it to fix.

The setup: a 200-block page (17 KB) with every block changed by each text, fed to the real window through the program's own `text` input, while keys go to a terminal in another tile. Two runs of each. No long frames in any of these.

| Copy | Gap 50 ms: key echo p50, p95 | Texts drawn of 100 | Renders | Gap 300 ms: key echo p50, p95 |
|---|---|---|---|---|
| Direct, today | 29, 49 ms | 100 | 83500 | 16.6, 36 ms |
| Deferred | 48, 58 ms | 18 | 16760 | 47, 55 ms |
| Paced | 16, 40 ms | 20 | 16700 | 16.8, 34 ms |
| Paced and deferred | 47, 52 ms | 18 | 15160 | 45, 54 ms |

With no feed at all, key echo is the same in all four copies (about 28 ms p50). So the deferred copy's 30 ms shows only while a feed runs. I did not trace the cause. Echo times land on frames (16, 30, 47 ms), so read this as "one or two frames later", not as exact numbers.

**The pace, as a tea Sub.** The first text of a burst shows at once, and the newest shows a pace later. Older ones are dropped. It is on while the page is cooling.

```ts
told: (s, m) => (s.cool ? [{...s, waiting: m.text}, []] : read(s, m.text, true)),
cooled: (s) => (s.waiting === null ? [{...s, cool: false}, []] : read(s, s.waiting, true)),
subs: [{type: "pace", deps: (s) => (s.cool ? {reads: s.reads} : null)}],  // 250 ms
```

After a burst, the last text shows 59 to 90 ms after the feed ends. Its laws say the newest text is on the page or waiting, with a planted mistake that drops it. A lone text costs nothing. The pace does cut what shows: 20 of 100 texts in a burst. That is the point for a page, and wrong for anything where each step matters.

**A page ten times longer (2000 blocks, 176 KB, gap 500 ms).** I tried this to give `useDeferredValue` its best case. One clean round:

| Copy | Key echo p50, p95 | Long frames, worst |
|---|---|---|
| Direct | 30, 249 ms | 12, 98 ms |
| Deferred | 58, 214 ms | 11, 66 ms |
| Paced | 28, 267 ms | 12, 96 ms |
| Paced and deferred | 49, 160 ms | 10, 79 ms |

So on a very long page deferred trims the worst frame and the slowest keys by about a third, and keeps the 20 to 30 ms cost on a typical key. A second round ran under heavy load from other agents and was far worse for every copy (p95 650 ms to 5.8 s, up to a 4.6 s wait for the last text). I do not trust it either way. It does show that at this size the time goes to the host and the wire: the host's cost of about 100 ms per 15 KB text is what a page cannot defer away.

**Sure:** 80% on the pace, 70% on dropping `useDeferredValue`. Doubt: the unexplained 30 ms, and a window whose render truly takes hundreds of ms. A map fed live would settle it; I tested markdown only. **`next/`:** pace at the source, in the Sub. Reach for `useDeferredValue` only with a measured long frame.

## Pick 10: oxlint's other React rules

`176-rules.ts` runs 42 rules on the 11 window files (`.tsx`). I read every finding by hand. The bar: about 0% false alarms to block, up to 10% to advise.

| Rule | Findings | False alarms |
|---|---|---|
| `react-in-jsx-scope` | 1005 | 100% |
| `jsx-no-new-function-as-prop` | 94 | 100% |
| `jsx-no-new-object-as-prop` | 26 | 100% |
| `no-unescaped-entities` | 10 | 100% |
| `no-array-index-key` | 9 | 100% |
| `jsx-no-new-array-as-prop` | 7 | 86% |
| `exhaustive-effect-dependencies` | 6 | 100% |
| `set-state-in-effect` | 2 | 50% |
| `purity` | 8 | 0% |
| `refs` | 1 | 0% |
| `immutability` | 1 | 0% |
| `display-name` | 2 | 0% |

- **Meet the block bar:** `purity`, `refs`, `immutability`, `display-name`. But the counts are small, and the findings need fixing first. I did not change `.oxlintrc.json`.
- The first three predict the Compiler's failures in pick 6, so turn them on together with it.
- `display-name` conflicts with format's safe fix, which turns `memo(function X)` into an arrow. Fix that first.
- The other rules that ran had no finding, so I cannot rate them.
- **Sure:** 75%, since n is small. Running them over `programs/` and `next/` as it grows would settle it.

## The closing bench

The same moments, same hour, alternating. Five tiles, see-through window, under load from other agents. `base` is before all picks. `final` is this branch's last commit. Each cell is the p50 of two runs in ms, then renders of one run.

| Moment | Base | Activity copy | Compiled | Final |
|---|---|---|---|---|
| Cold start | 1015, 1330 | 825, 1191 | 1028, 1501 | 928, 831 |
| Keystroke echo | 28.7, 24.7 | 28.5, 25.5 | 28.7, 26.3 | 25.3, 28.8 |
| Focus move | 6.9, 7.8; 51054 | 2.1, 2.6; 854 | 2.5, 2.4; 770 | 2.2, 2.2; 854 |
| One patch | 21.7, 24; 48537 | 7.3, 8.6; 2785 | 8.8, 7.2; 1707 | 7.3, 7.9; 2396 |
| Split | 31.7, 28.8; 57150 | 14.5, 16.5; 937 | 18.1, 12.9; 827 | 12.3, 12.1; 1439 |
| Turn | 44.7, 20.3; 25930 | 4.8, 6.9; 436 | 3.9, 4.4; 399 | 74, 94; 583 |
| Open ticket | 136, 135; 49940 | 109, 111; 1003 | 109, 112; 925 | 112, 111; 1003 |
| Workspace switch | 61, 27; 26880 | 23, 25; 4820 | 23, 25; 3410 | 24, 24; 4820 |

- Cold start and key echo do not move with any pick. Key echo goes around React: terminals live outside it.
- `base` swings on turn and workspace switch (with 21 long frames, up to 78 ms, in the 61 ms run). I do not know if that is load.
- Every copy has one long frame of 170 to 240 ms in split, likely a new terminal being made. No pick touches it. I did not trace it.
- Compiled and plain with `memo` are about equal in time. The Compiler saves renders, not milliseconds you can feel.
- Final's turn is the transition (pick 8), pressed faster than it ends.
- Renderer memory in the later moments runs about 50 to 70 MB higher in `base` than in the others.
- The end-to-end test passes on `final` (81 checks), and so does the full test suite (4042 tests in 307 files).

## What it cannot tell us

- How any of this feels. Headless, with synthetic presses, a see-through window.
- Whether a see-through window changes frame timing.
- Other machines. Load from other agents ran through most runs.
- WebKit or Firefox: Chromium only, and the app ships Chromium.
- Sixteen real tiles across all moments: most moments use five.
- Per-record deltas on the wire (pick 4b).
- Placement of a native Popover with no anchor (pick 7).
- Who causes the 339 ms long frame (pick 5), and the extra map render on a turn (pick 4b).
