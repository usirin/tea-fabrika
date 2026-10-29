# Fold, not tabs

**Decided 2026-10-28.** The desk has no tabs. A container in the layout tree
runs one of two ways, horizontal or vertical, as in AeroSpace. Any tile can
fold into a thin strip that keeps its place. This replaces
[tabbed is an orientation](./tabbed-is-an-orientation.md).

```ts
// apps/fabrika/src/desk/layout/node.ts
type Orientation = "horizontal" | "vertical";

interface TileNode { tag: "tile"; id: TileId; shows: Shows; folded: boolean }
interface ContainerNode {
  tag: "container"; id: ContainerId; orientation: Orientation;
  children: readonly LayoutNode[]; sizes: Readonly<Record<NodeId, number>>;
}

// Worked out, never stored: a container is folded when every tile in it is.
const isFolded = (node: LayoutNode): boolean =>
  node.tag === "tile" ? node.folded : node.children.every(isFolded);
```

## What changed

- **Two directions only.** `"tabbed"` is gone, and so is `active`. What used
  to be a "stack" in the code is a "container" now, the word i3 and AeroSpace
  use.
- **The split rule stays.** A split in the container's own direction adds a
  sibling. A split the other way nests a new container.
- **Nested containers alternate.** A container never holds a child container
  running the same way. Every change ends in one tidy step, `settle`, which
  flattens such a child into its parent and keeps each tile's share of the
  space. It also drops empty containers and replaces a one-child container
  with its child. `checkTree` refuses a tree that breaks this.
- **A fold is stored on the tile, nowhere else.** A folded tile keeps its
  stored size. The open tiles beside it share the space the strips leave
  (`openShares`), so an unfold puts every size back as it was.
- **A folded container is worked out.** When every tile in a container is
  folded, it draws as one strip labelled with its tiles' names, such as
  "map · runs". A click on it unfolds them all.
- **The last open tile cannot fold.** `fold` gives back the same tree when it
  would leave a workspace with only strips, and `checkTree` refuses a saved
  tree with nothing open. Closing the last open tile unfolds the first tile
  left.
- **Focus is always on an open tile.** Moving focus onto a strip opens it,
  which is the keyboard way to unfold. Folding the focused tile moves focus to
  its neighbour. Zoom still draws one tile alone; folding the zoomed tile ends
  the zoom.
- **Programs know nothing about folds.** A strip shows its program's name.

The ways in, after Ctrl-B:

```text
f       fold the focused tile into a strip
Space   turn the focused tile's container: horizontal, then vertical
```

A double-click on a tile's title bar folds it too. A single click there only
focuses the tile, as a click anywhere on it does. A click on a strip opens it.

One tree, before and after Ctrl-B f on `t3`, then on `t2`:

```ts
// before: the ticket beside a column of the map over the runs
{tag: "container", id: "c1", orientation: "horizontal", sizes: {t1: 42, c2: 58}, children: [
  t1,
  {tag: "container", id: "c2", orientation: "vertical", sizes: {t2: 50, t3: 50}, children: [t2, t3]},
]}
// after f on t3: the map fills the column, the runs are a strip under it.
// t3 is {tag: "tile", id: "t3", folded: true, ...}; no size changed.
// after f on t2 too: isFolded(c2) is true, so the column draws as one upright strip,
// "map · runs", and the ticket fills the row. c1's sizes are still {t1: 42, c2: 58}.
```

## Why

- **AeroSpace does it this way.** Its containers have a layout, `tiles` or
  `accordion`, and an orientation, horizontal or vertical. Two normalizations
  are on by default: a container with one child is flattened, and nested
  containers have opposite orientations
  ([AeroSpace guide, normalization](https://nikitabobko.github.io/AeroSpace/guide#normalization)).
  The desk takes the second rule as an invariant, so a tree has one shape for
  one picture.
- **i3 has tabs as a layout.** i3's `layout` is one of `splith`, `splitv`,
  `stacked` and `tabbed` ([i3 user guide](https://i3wm.org/docs/userguide.html),
  [i3 IPC](https://i3wm.org/docs/ipc.html)). That was the model of the old
  note. It hides a tile completely, and a hidden tile's place in the tree can
  only be read from the tab bar.
- **Ableton Live folds devices in place.** In Live's device chain, a
  double-click on a device's title bar folds it into a thin strip that keeps
  its place in the chain
  ([Live manual, working with instruments and effects](https://www.ableton.com/en/manual/working-with-instruments-and-effects/)).
  The desk does the same, with a double-click too. A first draft folded on one
  click; that was dropped, since one click on a title bar should focus the
  tile, as a click anywhere else on it does.
- **A fold keeps the picture.** A strip stays where the tile was, so the
  layout reads the same with a tile folded or open. A tab moves the tile out of
  sight and into a bar.
- **It is smaller than tabs.** One boolean on a tile, no new kind of
  container, no `active` to keep in step with the children.

**Cost:** two messages from the page, `fold` and `unfold`. Every tile now has a
20px title bar. A desk saved in the old shape (a `stack`, a `tabbed` stack, or
a tile without `folded`) is not read back, so the desk starts fresh once.
"Nothing open" is refused by `fold` and `checkTree`, not by the type: a type
that made it impossible would have to count open tiles, and TypeScript cannot.

**How sure: 85%.** The doubts:

- **The key.** `f` is free after Ctrl-B, and AeroSpace and i3 use it for
  fullscreen, which the desk calls zoom (`z`, as tmux does). Daily use settles
  it.
- **A strip's width.** 22px upright, 20px lying down. Long names cut off with
  an ellipsis. It has been looked at in screenshots only.
- **Turn after a fold.** Space can flatten a container into its parent, which
  mixes its folded tiles into the parent's row. That is right by the rules, but
  it may surprise.

## A line opens in place

**Decided 2026-10-28.** A tsh line with several windowed programs, such as
`tracker | ticket | runs`, opens its windows in the tile it was typed in, by
the split rule above. They share that tile's space evenly. When a window
would be too small, all but the first open folded. One faint tint marks the
line's tiles and strips.

```ts
// apps/fabrika/src/desk/layout/node.ts
interface Line { id: string; from: TileId; tint: Tint }   // Tint: 0..5

type Shows =
  | { kind: "tsh"; run: Shown | null }               // a tile with its own tsh
  | { kind: "line"; run: Shown; line: Line }         // the typed-in tile: tsh, first window on top
  | { kind: "window"; run: Shown; line: Line };      // another window of the line: no tsh

// apps/fabrika/src/desk/layout/line.ts
const MIN_WINDOW = { width: 220, height: 120 };       // title bar included
openLine(tree, "t2", {
  runs: [tracker, ticket, runs],
  tint: freeTint(allTrees),                          // the first tint no line has
  orientation: "horizontal",                         // a line runs left to right
  ids: { tiles: ["t3", "t4"], container: "c3" },
  area: { width: 1432, height: 868 },                // the page says it; null opens all
});
```

One example, a desk of `t1 | t2` in a row, the line typed in `t2`:

| The tile's spot | What opens |
|---|---|
| In a row, room for each | `t1 | t2 | t3 | t4`; t2, t3, t4 each a third of t2's old share |
| In a column (runs across) | a new row `c3` in t2's place, holding t2, t3, t4 |
| Each would be under 220px | t2 open with the whole share; t3 and t4 as strips beside it |
| One run only | t2 is covered by it, as before; no line, no tint |

- **The typed-in tile keeps its tsh.** The first window covers it, as a run
  always covered its tile. Focus stays there. The other windows are new tiles
  with no tsh of their own: Ctrl-C in one goes to the typed-in tile's tsh.
- **Shares stay inside the line.** Unfolding a window takes its share from the
  line's other open windows (`shareLine`), and closing one gives its share back
  to them (`freeShare`). Tiles outside the line keep their size.
- **The tint is on tiles and strips, not in the tree.** The tree holds which
  line a tile is in; the page mixes `--line-N` into the border at 30% and into
  the ground at a sixth of that. Six tints, in oklch at close lightness, so no line
  stands out over another.
- **When the run ends, its window goes.** The typed-in tile goes back to its
  tsh. A desk kept and read back holds no windows (`quiet`): their runs did not
  live through the restart.

**Why:** a line is one thing the person asked for, so it lands where they
asked, not spread over the workspace. The split rule already says where a
second tile goes; a line is the same rule for n tiles. Folding past the
minimum keeps every window readable and still in the picture, as a strip.

**Cost:** a page message, `area`, with the workspace's size in pixels, and
the desk's own copy of the page's strip and border sizes to work out what fits
(`extents`). Those can drift from the CSS. A window tile has no tsh, so
closing it with `y` takes the tile away but its run goes on until the line
ends.

**How sure: 75%.** The doubts:

- **No real line has run yet.** The app's programs have no outputs, so
  `tracker | ticket | runs` cannot pipe today. The desk path is tested
  straight and in the screenshots; tsh's side has only run single windows.
- **Closing one window.** Whether `y` on a window should stop its run, or the
  whole line. One real use settles it.
- **The minimum.** 220 by 120 comes from the prototype. A desk on a laptop
  screen will show whether it folds too much.

## What it cannot tell us

- Whether people fold, or close and reopen. No one has used it on a real desk
  yet.
- How a workspace reads with many strips side by side.
- Whether some program's windows should open folded, apart from a line's
  windows past the minimum.
- How a line reads once its programs truly pipe into each other.
