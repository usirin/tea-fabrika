# Tabbed is an orientation

**Proposed 2026-10-28.** A stack in the desk's layout tree can be tabbed: its
children lie one over another, and one shows. Tabbed is a third value of the
stack's `orientation`, beside `horizontal` and `vertical`, as in i3. Nothing
else about the tree changes.

```ts
// apps/fabrika/src/desk/layout/node.ts
type Axis = "horizontal" | "vertical";
type Orientation = Axis | "tabbed";

interface SplitStack { tag: "stack"; id; orientation: Axis; children; sizes }
interface TabbedStack { tag: "stack"; id; orientation: "tabbed"; active: NodeId; children; sizes }
type StackNode = SplitStack | TabbedStack;
```

## What changed

- **One field, only where it means something.** A tabbed stack names the child
  it shows in `active`. A split has no `active`, so the type cannot hold one
  there.
- **`active` is always a child.** Every operation builds stacks through one
  function, `arrange`, which picks a child when the old one is gone. `checkTree`
  refuses a saved layout whose `active` names no child, and the tests try any
  sequence of splits, turns, tab moves and closes on it.
- **`sizes` stays.** A tabbed stack keeps its children's shares, so turning it
  back to a split gives the old sizes, as i3 does.
- **Programs know nothing about tabs.** Any tile can sit in a tabbed stack. The
  tab shows its program's name.
- **The focused tile is always drawn.** When focus moves, every tabbed stack
  above the focused tile shows the tab that holds it (`reveal`). This is one of
  the desk's laws now.

The keys, after Ctrl-B:

```text
Space   turn the focused tile's stack: tabbed, then horizontal, then vertical
] [     the next or previous tab of the nearest tabbed stack, wrapping
h l     in a tabbed stack, the tab to the left or right, as i3 does
j k     leave the tabbed stack, up or down
```

One tree, before and after Ctrl-B Space twice on `t2`:

```ts
// before: t1 and t2 side by side, 70 and 30
{tag: "stack", id: "s1", orientation: "horizontal", children: [t1, t2], sizes: {t1: 70, t2: 30}}
// after, the first Space made it vertical: two tabs, "tsh" and "tsh", and t2 under them.
// The sizes are still there.
{tag: "stack", id: "s1", orientation: "tabbed", active: "t2", children: [t1, t2], sizes: {t1: 70, t2: 30}}
```

## Why

- **i3 does it this way.** A tabbed container is a layout value of a container,
  beside `splith` and `splitv` (i3's IPC lists `layout` as one of `splith`,
  `splitv`, `stacked`, `tabbed`), and `layout toggle all` cycles through them
  ([i3 user guide](https://i3wm.org/docs/userguide.html),
  [i3 IPC](https://i3wm.org/docs/ipc.html)). Moving focus left or right walks
  the tabs; up and down leave them.
- **tmux has tabs only at the top.** Its windows are tabs, and its panes split a
  window, but a pane cannot hold tabs. A tab anywhere in the tree is what the
  desk lacked.
- **It is the smallest change.** No new node kind, no new message: a click on a
  tab is a click on the tile it shows.
- **The notebook may be the next case.** i3 also has `stacked`: the same thing,
  with the titles in a column. A notebook, cells one under another and one
  open, may later be that value. It is left out until something needs it.

**Cost:** one more case in every function that walks a stack, and a type with
two shapes where there was one. A turn of a stack with one child changes
nothing you can see between the two splits, and a split of a lone tab turns
the stack back to a split, as i3 does.

**How sure: 80%.** The doubts:

- **The keys.** `[` and `]` are free here, but tmux uses them for copy mode,
  which the desk may get later. `n` and `p` match tmux's next and previous
  window better, but Tuval kept `p` for its process board. Daily use settles it.
- **The order of a turn.** From a fresh side-by-side split, Space goes to
  vertical first and tabbed second. If tabbed is what people want most, it may
  belong first.
- **A tab's name.** A tab holding a split shows its programs joined, such as
  "tsh, counter". It may need a shorter name once real desks have them.

## What it cannot tell us

- Whether people reach for tabs inside a split, or only at the top, as tmux
  users do. No one has used it yet.
- How the strip reads with many tabs or long names. It has not been looked at in
  the built app.
