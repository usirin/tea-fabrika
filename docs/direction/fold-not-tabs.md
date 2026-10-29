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
  "map · trace". A click on it unfolds them all.
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
// before: the ticket beside a column of the map over the trace
{tag: "container", id: "c1", orientation: "horizontal", sizes: {t1: 42, c2: 58}, children: [
  t1,
  {tag: "container", id: "c2", orientation: "vertical", sizes: {t2: 50, t3: 50}, children: [t2, t3]},
]}
// after f on t3: the map fills the column, the trace is a strip under it.
// t3 is {tag: "tile", id: "t3", folded: true, ...}; no size changed.
// after f on t2 too: isFolded(c2) is true, so the column draws as one upright strip,
// "map · trace", and the ticket fills the row. c1's sizes are still {t1: 42, c2: 58}.
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

## What it cannot tell us

- Whether people fold, or close and reopen. No one has used it on a real desk
  yet.
- How a workspace reads with many strips side by side.
- Whether some program's windows should open folded. That, and opening a
  line's windows in place, are left for later work.
