import {
	across,
	type ContainerId,
	type ContainerNode,
	createContainer,
	createTile,
	type Direction,
	type Edge,
	isFolded,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type Orientation,
	resolveSizes,
	type Shows,
	type TileId,
	type TileNode,
} from "./node.ts";

// The pure layout tree: split, remove, focus by direction, resize, turn, fold and zoom, each a
// total function on immutable data addressed by id. Ported from Tuval's layout tree: a window there is a tile here, and `setProcess` is
// `setShows`. After every change of shape the tree is put back in AeroSpace's normal form
// (`settle`): no container of one child, and nested containers alternate orientation. Nothing
// here imports React, tea or Effect.
//
//   const tree = createTree(createContainer("s0", "horizontal", [createTile("t1")]));
//   split(tree, "t1", "horizontal", {tile: "t2", container: "s2"})   t1 and t2 side by side
//   findSibling(next, "t2", "left")                                  t1
//   fold(next, "t2")                                                 t2 a strip, t1 fills the row
//   fold(folded, "t1")                                               the same tree: t1 is the last open tile
//   unfold(folded, "t2")                                             t2 back, at the size it had
//   remove(next, "t2")                                               the tree we started with

/** The ids the desk mints for one split. `container` is spent only when the split nests one. */
export interface SplitIds {
	readonly tile: TileId;
	readonly container: ContainerId;
}

/** Every tile under `node`, left to right, top to bottom. */
export function* tiles(node: LayoutNode): Generator<TileNode> {
	if (node.tag === "tile") {
		yield node;
		return;
	}
	for (const child of node.children) {
		yield* tiles(child);
	}
}

/** The first tile the predicate accepts, reading every sibling. */
export function find(tree: LayoutTree, predicate: (tile: TileNode) => boolean): TileNode | null {
	for (const tile of tiles(tree.root)) {
		if (predicate(tile)) return tile;
	}
	return null;
}

export function findTile(tree: LayoutTree, id: TileId): TileNode | null {
	return find(tree, (tile) => tile.id === id);
}

/** The node of this id, a tile or a container, or `null`. */
export function findNode(tree: LayoutTree, id: NodeId): LayoutNode | null {
	return findIn(tree.root, id);
}

function findIn(node: LayoutNode, id: NodeId): LayoutNode | null {
	if (node.id === id) return node;
	if (node.tag === "tile") return null;
	for (const child of node.children) {
		const found = findIn(child, id);
		if (found) return found;
	}
	return null;
}

export function findContainer(tree: LayoutTree, id: ContainerId): ContainerNode | null {
	const node = findNode(tree, id);
	return node?.tag === "container" ? node : null;
}

/** The tile at one end of a node's subtree, in reading order: a tile is its own. */
export function findChildTile(tree: LayoutTree, id: NodeId, edge: Edge): TileNode | null {
	const node = findNode(tree, id);
	return node ? edgeTile(node, edge) : null;
}

function edgeTile(node: LayoutNode, edge: Edge): TileNode | null {
	if (node.tag === "tile") return node;
	const child = edge === "start" ? node.children[0] : node.children[node.children.length - 1];
	return child ? edgeTile(child, edge) : null;
}

const orientationOf = (direction: Direction): Orientation =>
	direction === "left" || direction === "right" ? "horizontal" : "vertical";

const isBackward = (direction: Direction): boolean => direction === "left" || direction === "up";

/**
 * The tile focus lands on when it moves `direction` out of `id`: climb to the nearest ancestor laid
 * out along that direction that has a neighbour on that side, then enter the neighbour's subtree at
 * the edge nearest the tile we left. `null` at the edge of the tree. A folded tile is landed on
 * like any other: the desk unfolds the tile focus is on.
 */
export function findSibling(tree: LayoutTree, id: TileId, direction: Direction): TileNode | null {
	const ancestors = ancestorsOf(tree.root, id);
	if (!ancestors) return null;

	const orientation = orientationOf(direction);
	const step = isBackward(direction) ? -1 : 1;
	const entryEdge: Edge = isBackward(direction) ? "end" : "start";

	let childId: NodeId = id;
	for (let i = ancestors.length - 1; i >= 0; i--) {
		const container = ancestors[i];
		if (!container) return null;
		const index = container.children.findIndex((child) => child.id === childId);
		if (index < 0) return null;
		if (container.orientation === orientation) {
			const neighbour = container.children[index + step];
			if (neighbour) return edgeTile(neighbour, entryEdge);
		}
		childId = container.id;
	}
	return null;
}

/** The containers from the root down to the tile's parent, or `null` when there is no such tile. */
function ancestorsOf(container: ContainerNode, id: TileId): ContainerNode[] | null {
	for (const child of container.children) {
		if (child.tag === "tile") {
			if (child.id === id) return [container];
			continue;
		}
		const deeper = ancestorsOf(child, id);
		if (deeper) return [container, ...deeper];
	}
	return null;
}

/**
 * Turn the container holding `id` to the other orientation, as AeroSpace's `layout horizontal
 * vertical`. The tree is settled after: a container turned to its parent's orientation joins the
 * parent, and a child container now of its orientation joins it. Its sizes stay.
 */
export function turn(tree: LayoutTree, id: TileId): LayoutTree {
	const parent = ancestorsOf(tree.root, id)?.at(-1);
	if (!parent) return tree;
	const root = withContainer(tree.root, parent.id, (container) => ({
		...container,
		orientation: across(container.orientation),
	}));
	return root ? {...tree, root: settle(root)} : tree;
}

/**
 * Split `id` along `orientation`, giving the new tile half the split tile's share. The parent's
 * own orientation adds the new tile beside it; the other one nests a container of the two under
 * `ids.container`, so nested containers alternate. A container holding one child (the root, with
 * one tile) turns to the new orientation instead of nesting. An unknown tile, or new ids already
 * taken, leave the tree as it is: `checkTree` is what proves a tree's ids unique. The new tile
 * shows a fresh tsh, open.
 */
export function split(
	tree: LayoutTree,
	id: TileId,
	orientation: Orientation,
	ids: SplitIds,
): LayoutTree {
	const taken = new Set<NodeId>(idsOf(tree.root));
	if (taken.has(ids.tile) || taken.has(ids.container)) return tree;
	const root = splitIn(tree.root, id, orientation, ids, createTile(ids.tile));
	return root ? {...tree, root} : tree;
}

function splitIn(
	container: ContainerNode,
	id: TileId,
	orientation: Orientation,
	ids: SplitIds,
	created: TileNode,
): ContainerNode | null {
	const index = container.children.findIndex((child) => child.tag === "tile" && child.id === id);
	const target = index < 0 ? undefined : container.children[index];
	if (target?.tag === "tile") {
		if (container.orientation === orientation || container.children.length === 1) {
			const children = [
				...container.children.slice(0, index + 1),
				created,
				...container.children.slice(index + 1),
			];
			const share = container.sizes[id] ?? 100 / container.children.length;
			const sizes = {...container.sizes, [id]: share / 2, [ids.tile]: share / 2};
			return remade({...container, orientation}, children, sizes);
		}
		return replaceChild(
			container,
			id,
			createContainer(ids.container, orientation, [target, created]),
		);
	}

	for (const child of container.children) {
		if (child.tag !== "container") continue;
		const next = splitIn(child, id, orientation, ids, created);
		if (next) return replaceChild(container, child.id, next);
	}
	return null;
}

function idsOf(node: LayoutNode): NodeId[] {
	if (node.tag === "tile") return [node.id];
	return [node.id, ...node.children.flatMap(idsOf)];
}

/**
 * Remove `id`, handing its share to the sibling it sat against, then settle the tree: a container
 * left with one child is that child, and one that child now matches joins its parent. Removing
 * the tree's last tile is refused: the desk, not the tree, decides what closing the last tile
 * means. Removing the last open tile leaves only folded ones, so the first of them unfolds.
 */
export function remove(tree: LayoutTree, id: TileId): LayoutTree {
	if (findTile(tree, id) === null || [...tiles(tree.root)].length < 2) return tree;
	const root = settle(without(tree.root, id));
	const open = isFolded(root) ? unfoldIn(root, edgeTile(root, "start")?.id ?? id) : root;
	return {root: open ?? root, zoomed: tree.zoomed === id ? null : tree.zoomed};
}

/** `container` without the tile `id`, wherever it is under it. */
function without(container: ContainerNode, id: TileId): ContainerNode {
	if (container.children.some((child) => child.tag === "tile" && child.id === id))
		return withoutChild(container, id);
	return remade(
		container,
		container.children.map((child) => (child.tag === "container" ? without(child, id) : child)),
		container.sizes,
	);
}

/**
 * The freed share goes to the neighbour the removed child sat against, as the pane beside it grows
 * in tmux. That is also what makes `remove` the exact inverse of the `split` that made the child.
 */
function withoutChild(container: ContainerNode, childId: NodeId): ContainerNode {
	const index = container.children.findIndex((child) => child.id === childId);
	const children = container.children.filter((child) => child.id !== childId);
	const heir = children[index - 1] ?? children[0];
	const sizes: Record<NodeId, number> = {};
	for (const child of children) {
		const freed = child.id === heir?.id ? (container.sizes[childId] ?? 0) : 0;
		sizes[child.id] = (container.sizes[child.id] ?? 0) + freed;
	}
	return remade(container, children, sizes);
}

/**
 * The tree in AeroSpace's normal form, from the leaves up: an empty container goes, a container of
 * one child is that child with the container's share, and a container with its parent's
 * orientation hands its children to the parent, each with its part of the container's share. The
 * root keeps its id: a lone container under it lends it its orientation and its children.
 */
export function settle(root: ContainerNode): ContainerNode {
	let settled = tidy(root);
	let only = settled.children.length === 1 ? settled.children[0] : undefined;
	while (only?.tag === "container") {
		settled = {...only, id: settled.id};
		only = settled.children.length === 1 ? settled.children[0] : undefined;
	}
	return settled;
}

function tidy(container: ContainerNode): ContainerNode {
	const children: LayoutNode[] = [];
	const sizes: Record<NodeId, number> = {};
	for (const child of container.children) {
		const share = container.sizes[child.id] ?? 0;
		const node = child.tag === "tile" ? child : lone(tidy(child));
		if (node.tag === "container" && node.children.length === 0) continue;
		if (node.tag === "container" && node.orientation === container.orientation) {
			for (const inner of node.children) {
				children.push(inner);
				sizes[inner.id] = (share * (node.sizes[inner.id] ?? 0)) / 100;
			}
			continue;
		}
		children.push(node);
		sizes[node.id] = share;
	}
	return remade(container, children, sizes);
}

/** A container holding a single child is that child; its share moves with it at the parent. */
const lone = (container: ContainerNode): LayoutNode =>
	container.children.length === 1 ? (container.children[0] ?? container) : container;

/** `container` with these children, and its sizes made total for them again. */
const remade = (
	container: ContainerNode,
	children: readonly LayoutNode[],
	sizes: Readonly<Record<NodeId, number>>,
): ContainerNode => ({...container, children, sizes: resolveSizes(children, sizes)});

/**
 * `container` with one child replaced. The same id keeps every share exactly as it was, so a
 * change inside a child (a fold, what a tile shows) never scales its siblings' sizes again.
 */
function replaceChild(container: ContainerNode, childId: NodeId, node: LayoutNode): ContainerNode {
	const children = container.children.map((child) => (child.id === childId ? node : child));
	if (node.id === childId) return {...container, children};
	const sizes: Record<NodeId, number> = {};
	for (const [id, size] of Object.entries(container.sizes))
		sizes[id === childId ? node.id : id] = size;
	return remade(container, children, sizes);
}

/**
 * Record a resize of one container. `sizes` is percent of that container's extent, as a dragged
 * border reports it, and is made back into a total map summing to 100.
 */
export function resize(
	tree: LayoutTree,
	id: ContainerId,
	sizes: Readonly<Record<NodeId, number>>,
): LayoutTree {
	const root = withContainer(tree.root, id, (container) =>
		remade(container, container.children, sizes),
	);
	return root ? {...tree, root} : tree;
}

/** Change what a tile shows. An unknown tile leaves the tree as it is. */
export function setShows(tree: LayoutTree, id: TileId, shows: Shows): LayoutTree {
	const root = mapTile(tree.root, id, (tile) => ({...tile, shows}));
	return root ? {...tree, root} : tree;
}

/**
 * Fold `id` into a strip, in its place. Its share stays, for when it unfolds. Refused, the same
 * tree back, for an unknown tile, a folded one, and the last open tile: a workspace is never only
 * strips. A zoom on it goes, as a folded tile is not drawn alone.
 */
export function fold(tree: LayoutTree, id: TileId): LayoutTree {
	const tile = findTile(tree, id);
	if (tile === null || tile.folded) return tree;
	const root = mapTile(tree.root, id, (t) => ({...t, folded: true}));
	if (root === null || isFolded(root)) return tree;
	return {root, zoomed: tree.zoomed === id ? null : tree.zoomed};
}

/**
 * Unfold `id`: a tile, or every tile under a container, so a folded column opens whole. The same
 * tree when nothing under it is folded, or there is no such node.
 */
export function unfold(tree: LayoutTree, id: NodeId): LayoutTree {
	const root = unfoldIn(tree.root, id);
	return root === null ? tree : {...tree, root};
}

/** `container` with every tile under the node `id` open, or `null` when that changes nothing. */
function unfoldIn(container: ContainerNode, id: NodeId): ContainerNode | null {
	const node = findIn(container, id);
	if (node === null) return null;
	const shut = [...tiles(node)].filter((tile) => tile.folded);
	if (shut.length === 0) return null;
	return shut.reduce(
		(at, tile) => mapTile(at, tile.id, (t) => ({...t, folded: false})) ?? at,
		container,
	);
}

/** Draw `id` alone. Zoom never writes `sizes`, so unzoom restores the layout exactly. */
export function zoom(tree: LayoutTree, id: TileId): LayoutTree {
	return findTile(tree, id) ? {...tree, zoomed: id} : tree;
}

export function unzoom(tree: LayoutTree): LayoutTree {
	return tree.zoomed === null ? tree : {...tree, zoomed: null};
}

/**
 * One tree as one string, so two trees that are equal but not the same object compare equal: a
 * layout read back from disk is a new object whatever it says. Any change to structure, order,
 * orientation, sizes, what a tile shows, a fold or the zoomed tile gives another string.
 */
export function layoutSignature(tree: LayoutTree): string {
	return JSON.stringify([tree.zoomed, nodeShape(tree.root)]);
}

function nodeShape(node: LayoutNode): unknown {
	if (node.tag === "tile") return ["t", node.id, node.shows, node.folded];
	return [
		"c",
		node.id,
		node.orientation,
		node.children.map((child) => [nodeShape(child), node.sizes[child.id] ?? null]),
	];
}

function withContainer(
	container: ContainerNode,
	id: ContainerId,
	f: (container: ContainerNode) => ContainerNode,
): ContainerNode | null {
	if (container.id === id) return f(container);
	for (const child of container.children) {
		if (child.tag !== "container") continue;
		const next = withContainer(child, id, f);
		if (next) return replaceChild(container, child.id, next);
	}
	return null;
}

function mapTile(
	container: ContainerNode,
	id: TileId,
	f: (tile: TileNode) => TileNode,
): ContainerNode | null {
	for (const child of container.children) {
		if (child.tag === "tile") {
			if (child.id !== id) continue;
			return replaceChild(container, id, f(child));
		}
		const next = mapTile(child, id, f);
		if (next) return replaceChild(container, child.id, next);
	}
	return null;
}
