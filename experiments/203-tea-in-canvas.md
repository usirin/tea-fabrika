---
date: "2026-11-03"
scripts: "none; the spike and its bundle stayed outside the repo"
summary: "Today's version. `programs/counter`'s real `init`, `update`, view and schema ran on tea 0.22.0's Effect engine in one canvas tile, read through one `useSyncExternalStore` hook, keys through `onKeyDown` on the tile; the owner clicked it in Claude Design and it works. A happy-dom smoke test on React 18.3.1 and 19.3.1: 3, then 5, `x` ignored, 6, ended at 6. The bundle grows 903 KB to 1,546 KB (+643 KB; 253 to 459 KB gzipped), Effect 485 KB of it. The canvas's React 18 is the only React: the build maps `react` to `window.React`. In the outline round's canvas the keys were dead (no page-wide keydown) until each tile ran the `commands` table, `refuse` and `update` itself; the owner checked every key and both themes. Manti's `TreeView` has no controlled rows and string labels only, so the status word sits in an icon slot hidden from screen readers. Lean: real program code for the logic, canvas HTML for the looks, programs with no outside data first, 70%. Load time at 20 artboards, Safari, screen readers and real Cmds are untested. $0."
---

# Claude Design canvases run tea and real program code

**A Design canvas can run a real tea program.** The counter program's own `init`, `update`, view
and state schema ran on tea's Effect engine inside one artboard tile, and the owner clicked it in
Claude Design: it works. The cost is size: the bundle grows by 643 KB, and most of that is Effect.

```jsx
// A sketch, cut down from the spike. One hook reads the run; keys come in on the tile itself.
function useRun(open) {
	const ref = React.useRef(null);
	if (ref.current === null) ref.current = open(); // one tea run per tile
	const handle = ref.current;
	React.useEffect(() => () => handle.close(), [handle]);
	return [React.useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot), handle];
}

const keys = {"+": "plus", "=": "plus", d: "done"};

function CounterTile({start = 0}) {
	const [shown, handle] = useRun(() => openCounterRun({n: start}));
	const onKeyDown = (event) => {
		const press = keys[event.key];
		if (press === undefined || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		handle.send({type: "press", value: press}); // plus folds through the real update
	};
	return <section tabIndex={0} onKeyDown={onKeyDown}>{/* CounterWindow, from the program */}</section>;
}
// Boot at 3, press + twice: 5. Press x: nothing. Click the window's +1: 6.
// Press d: "Ended. It said 6." Later keys do nothing.
```

Run 2026-11-03. **Today's version**: `programs/counter` and `@kampus/fabrika-old` as they are on
main, with `@demlik/tea` 0.22.0. It follows [designs are drawn on Claude
Design](../docs/direction/design-on-claude-design.md), which put prototypes on a canvas but drew
them in plain markup. No model, no key, $0. The spike and its bundle stayed outside the repo; the
canvases are private and are named here by what they hold, never by link.

## What was built

- **The bundle.** The design system already ships one script, an IIFE (a script that runs once and
  sets a global) on `window.Fabrika`, with all of Manti and our pieces. The spike added
  `@demlik/tea` 0.22.0 with its Effect engine, plus `programs/counter`'s real `init`, `update`,
  view, state schema and window.
- **The tile.** One canvas artboard mounts it as a tile. State is read through one
  `useSyncExternalStore` hook, since tea's `useMachine` does not take the Effect engine yet
  ([demlik 852](https://github.com/kamp-us/demlik/issues/852)). Keys come through `onKeyDown` on
  the tile. The start number goes in as the run's saved state and is read back through the
  program's own schema.

## What came back

**A Node smoke test** in happy-dom, on React 18.3.1 and on React 19.3.1, gave the same answers on
both:

- boot at 3
- `+` twice gave 5
- `x` was ignored
- the window's +1 button gave 6
- `d` ended the run: "Ended. It said 6."
- keys after that were ignored

**In Claude Design,** the owner clicked the tile and pressed its keys. It works.

**One React.** The canvas's runtime ships React 18 as a UMD script on `window.React`. A second
React in the bundle would throw "Invalid hook call". So the build maps `react` and `react-dom` to
`window.React` and `window.ReactDOM`, and `react/jsx-runtime` to a tiny stand-in over
`createElement`.

**Browser-safe.** esbuild found no `node:` imports in the counter program or in
`@kampus/fabrika-old`'s top level.

**Size.**

| Part | Size |
|---|---|
| Bundle before | 903 KB (253 KB gzipped) |
| Bundle after | 1,546 KB (459 KB gzipped) |
| Added | +643 KB |
| Effect | 485 KB |
| `@kampus/fabrika-old`'s top level | 111 KB |
| tea | 24 KB |
| counter | 1 KB |

tea's Effect engine alone pulls in 438 KB of Effect. The program itself is almost nothing.

**Found along the way.** The main checkout's `node_modules` held tea 0.21.0 while the lockfile said
0.22.0. That was a stale install, not a bug in the repo.

## The second canvas: the outline round

- **The keys were dead at first.** ⌘. did nothing, because a canvas has no page-wide keydown
  handler (the direction note's second limit).
- **The fix: a small state machine per tile.** Each tile's `onKeyDown` runs the same `commands`
  table, `refuse` and `update`, so the keys line and what a key does come from one place.
- **Manti's `TreeView` reads its open and selected rows only on its first draw.** It has no
  controlled props for them. So the tree is rebuilt after each command.
- **`TreeView` labels are strings only.** The status word goes in the icon slot instead, moved to
  the row's right end with CSS.
- **That icon slot is hidden from screen readers.** So the status word may not be read aloud. This
  needs a real screen reader run before anyone trusts it.
- **The owner checked every key** (⌘., Esc, ⌘↓ and ⌘↑, y, the notes keys), the status column, and
  the dark and light themes. All good.

## Possible Manti gaps

Two gaps, worth upstream issues. None is filed yet: that waits on the owner's yes.

- `TreeView` with controlled open and selected rows, so a tile can redraw from its own state
  without a rebuild.
- A slot at the row's end, so a status word is not pushed into the icon slot and hidden from screen
  readers.

## Lean

- **Use real program code for the logic in prototypes.** Keep the looks in canvas HTML, so a
  designer can still edit them.
- **Start with programs whose `update` does not wait on outside data,** like counter. A machine
  with real Cmds needs fake handlers.
- **Why:** the keys and what they do cannot drift from the program, the same reason the direction
  note mounts real parts instead of look-alikes.
- **What it costs:** 643 KB more in every artboard, and a bundle build that maps React by hand.
- **How sure:** about 70%. Two doubts, and what would settle each:
  - Load time on a 20-artboard canvas. One timed load of the outline round's canvas with the bigger
    bundle settles it.
  - The canvas type has a rule against mounting our own components. Whether a program's window,
    shipped inside the system's bundle, breaks that rule is open, and the owner's call settles it.

## What it cannot tell us

- **Load time at scale.** Nothing was timed. A 20-artboard canvas with the bigger bundle was not
  tried.
- **Safari's ⌘.** The owner tested in one browser. ⌘. was not tried in Safari.
- **Screen readers.** None was run. The status word in the hidden icon slot is the known risk.
- **Programs with real Cmds.** Counter needs no outside data. A program that reads a ticket or a
  ledger needs fake handlers, and nobody has built one in a canvas yet.
