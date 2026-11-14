---
date: "2026-11-03"
summary: "Library probes for `next/`, tea 0.23.0 (demlik PRs 856 and 859). 20 Chromium runs per row, both engines, compiled and plain: three tiles that pick `m.views[id]` with tile b clicked three times draw a0 b3 c0, with 0 console errors, Strict Mode too; a parent reading the whole model redraws every tile (a3 b3 c3), compiled too; a selector that builds a new object is refused, \"Maximum update depth exceeded\"; a selector over a changing prop never draws the old part. So `useRuntime` with a selector is the window's hook and no stand-in is written; a selector picks, never builds. 400 of 400 trials on tea 0.23.0 from npm, through Babel's Compiler, not oxc's. No model, $0."
---

# tea 0.23.0's selector under the React Compiler

**A tile that reads its part through `useRuntime`'s selector redraws only when that part
changes, on both engines, compiled by the React Compiler or not, and under Strict Mode.** A
selector that builds a new object on every read is not slow, it is refused: React stops with
"Maximum update depth exceeded". So the rule for `next/` is: pick a part, never build one.

```tsx
// The whole idea. The window is handed a run booted outside React.
function Tile({run, id}) {
	const [view, send] = useRuntime(run, (m) => m.views[id]); // redraws only when views[id] changes
	return <button onClick={() => send({type: "inc", id})}>{view.n}</button>;
}
// Three tiles, tile b clicked three times: a draws 0 times, b 3, c 0. Every row, 20 of 20.
```

Read and checked 2026-11-03. Library probes for `next/`'s React boundary, not changes to
today's app or `next/`. They run tea 0.23.0's `useRuntime`, from
[demlik PR 856](https://github.com/kamp-us/demlik/pull/856) (a `send` that returns nothing,
and Effect-engine runs) and [demlik PR 859](https://github.com/kamp-us/demlik/pull/859) (the
selector, closing [demlik 853](https://github.com/kamp-us/demlik/issues/853)). It follows
[experiment 202](./202-tea-react-hooks.md), which ran tea 0.22.0 and did not test a selector.
No model, no key, no deploy, $0.

Headless Chromium **153.0.8010.12**, React and React DOM **19.3.1**, Effect **4.1.1**, and
`babel-plugin-react-compiler` **1.0.0** at 202's settings, and `@demlik/tea` **0.23.0** from
npm ([demlik PR 863](https://github.com/kamp-us/demlik/pull/863)). Every row ran **20 times**:
400 of 400 trials gave the wanted answer. The
scripts and exact dependencies are in [`213-tea-react-select/`](https://github.com/usirin/tea-fabrika/tree/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/213-tea-react-select/); the
saved run is in [`results/213-tea-react-select/`](https://github.com/usirin/tea-fabrika/tree/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/213-tea-react-select/).
`compile.mjs` fails the run if the Compiler skips any component: it compiled all six.

Each component counts its own commits in an effect with no dependency list, so nothing is
written during render and the Compiler has no reason to skip it.

## What ran, and what came back

Each probe ran on the Promise and the Effect engine, compiled and plain.

| Probe | Want | Got, 20 of 20 on every engine and kind |
|---|---|---|
| S1: three tiles each pick `m.views[id]`; tile b clicked 3 times | shows 0 3 0; draws a0 b3 c0; 0 console errors | as wanted, and the same under `<StrictMode>` |
| S2: the parent reads the whole model and hands each tile plain values | shows 0 3 0 | as wanted, but every tile redraws: a3 b3 c3, compiled too |
| S3: a selector that builds `{n: m.views[id].n}` | React refuses it | "Maximum update depth exceeded" on every row |
| S4: a selector over a prop; b moves to 2, then the id changes from a to b | commits a:0, then b:2 | as wanted: no commit ever showed a stale part |

```tsx
// S3, the shape the docs warn about. A new object on every read never settles.
const [view] = useRuntime(run, (m) => ({n: m.views[id].n})); // Maximum update depth exceeded
```

- **S1 is issue 853's point, held.** One tile changing wakes one tile. The Compiler changes
  nothing here: the selector, not memoizing, keeps a and c still.
- **S2 is the baseline, and the Compiler does not rescue it.** The parent's tile list is
  rebuilt from the new model, so every tile gets a new element and redraws. 195 counted the
  same shape in renders per patch.
- **S3 is a crash, not a slowdown.** On the compiled Promise run, one row of 20 also logged
  React's "The result of getSnapshot should be cached" warning before the throw; React logs it
  once per page. The throw came on every row.
- **S4:** a selector closing over a prop never draws the old id's part.

## What it means for `next/`

- `useRuntime` with a selector is the window's hook, as [Elm first](../docs/direction/elm-first.md)
  says from 2026-11-03. No stand-in `useSyncExternalStore` file is written. Sure: 90%.
- The model keeps references for parts that did not change, or every tile redraws. A reducer
  that spreads a new `views` object but keeps the untouched entries, as S1's does, is enough.
- A selector picks; it never builds. A built value comes from picked parts, in render.

## What it cannot tell us

- Babel's Compiler, as in 202. `next/` builds with oxc's port (195); 195 found it matched
  Babel's verdict on all 108 functions, but this file was not run through it.
- Counter tiles, three of them. Not 60 real tiles; 195's bench measured those.
- No `<Activity>` hide and show with a selector, and no hand-built handle in Chromium (tea's
  own `select.test.tsx` covers that one).
- Nothing here measures time; it counts commits.
