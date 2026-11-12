---
id: 0505
title: The desk has no tabs, so a container runs horizontal or vertical, nested containers alternate, and every change ends in settle
status: accepted
date: 2026-10-28
tags: [ui, desk, layout, tiles, fold, today]
---

# 0505: The desk has no tabs, so a container runs horizontal or vertical, nested containers alternate, and every change ends in settle

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

**What this decides:** the shape of the desk's layout tree, in today's version
(`apps/fabrika/src/desk/`).

## Context

A tabbed container hid tiles behind a press. From
[fold, not tabs](../docs/direction/fold-not-tabs.md#what-changed).

## Decision

**Two directions only, and the tree stays tidy.**

- A container runs horizontal or vertical, as in AeroSpace. Never tabbed.
- A split in the container's own direction adds a sibling; a split the other way nests a new
  container.
- Nested containers always alternate direction.
- Every change ends in `settle`, which flattens a same-direction child into its parent keeping each
  tile's share, drops empty containers, and replaces a one-child container with its child.
  `checkTree` refuses a tree that breaks this.

## Consequences

- The fold that replaces tabs is [0506](0506-a-fold-is-stored-on-the-tile.md).
