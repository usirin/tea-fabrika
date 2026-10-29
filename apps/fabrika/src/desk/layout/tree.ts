import {
	type Axis,
	arrange,
	createStack,
	createTile,
	type Direction,
	type Edge,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type Orientation,
	type Shows,
	type StackId,
	type StackNode,
	type TileId,
	type TileNode,
	turned,
} from "./node.ts";

// The pure layout tree: split, remove, focus by direction, resize, zoom and tabs, each a total
// function on immutable data addressed by id. Ported from Tuval's (kamp-us/phoenix,
// apps/tuval/src/shell/layout/tree.ts) as it is: a window there is a tile here, and `setProcess`
// is `setShows`. Tabs are i3's. Nothing here imports React, tea or Effect.
//
//   const tree = createTree(createStack("s0", "horizontal", [createTile("t1")]));
//   split(tree, "t1", "horizontal", {tile: "t2", stack: "s2"})   t1 and t2 side by side, 50 and 50
//   findSibling(next, "t2", "left")                              t1
//   remove(next, "t2")                                           the tree we started with
//   turn(next, "t2")                                             s0 vertical; again, tabbed on t2
//   findTab(tabbed, "t2", "next")                                t1, the tab after t2, wrapping
//   reveal(tabbed, "t1")                                         s0 shows t1

/** The ids the desk mints for one split. `stack` is spent only when the split nests a new stack. */
export interface SplitIds {
	readonly tile: TileId;
	readonly stack: StackId;
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

export function findStack(tree: LayoutTree, id: StackId): StackNode | null {
	return findStackIn(tree.root, id);
}

function findStackIn(stack: StackNode, id: StackId): StackNode | null {
	if (stack.id === id) return stack;
	for (const child of stack.children) {
		if (child.tag !== "stack") continue;
		const found = findStackIn(child, id);
		if (found) return found;
	}
	return null;
}

/** The tile at one end of a stack's subtree, in reading order. */
export function findChildTile(tree: LayoutTree, id: StackId, edge: Edge): TileNode | null {
	const stack = findStack(tree, id);
	return stack ? edgeTile(stack, edge) : null;
}

/** A tabbed stack is entered through the child it shows, from either side, as i3 enters one. */
function edgeTile(node: LayoutNode, edge: Edge): TileNode | null {
	if (node.tag === "tile") return node;
	const child =
		node.orientation === "tabbed"
			? node.children.find((each) => each.id === node.active)
			: edge === "start"
				? node.children[0]
				: node.children[node.children.length - 1];
	return child ? edgeTile(child, edge) : null;
}

const axisOf = (direction: Direction): Axis =>
	direction === "left" || direction === "right" ? "horizontal" : "vertical";

/** The axis focus moves along in a stack: tabs lie in a row, so left and right walk them, as in i3. */
const alongOf = (orientation: Orientation): Axis =>
	orientation === "tabbed" ? "horizontal" : orientation;

const isBackward = (direction: Direction): boolean => direction === "left" || direction === "up";

/**
 * The tile focus lands on when it moves `direction` out of `id`: climb to the nearest ancestor laid
 * out along that axis that has a neighbour on that side, then enter the neighbour's subtree at the
 * edge nearest the tile we left. `null` at the edge of the tree.
 */
export function findSibling(tree: LayoutTree, id: TileId, direction: Direction): TileNode | null {
	const ancestors = ancestorsOf(tree.root, id);
	if (!ancestors) return null;

	const axis = axisOf(direction);
	const step = isBackward(direction) ? -1 : 1;
	const entryEdge: Edge = isBackward(direction) ? "end" : "start";

	let childId: NodeId = id;
	for (let i = ancestors.length - 1; i >= 0; i--) {
		const stack = ancestors[i];
		if (!stack) return null;
		const index = stack.children.findIndex((child) => child.id === childId);
		if (index < 0) return null;
		if (alongOf(stack.orientation) === axis) {
			const neighbour = stack.children[index + step];
			if (neighbour) return edgeTile(neighbour, entryEdge);
		}
		childId = stack.id;
	}
	return null;
}

/**
 * The tile focus lands on when it goes to the next or previous tab: in the nearest tabbed stack
 * holding `id`, the tab after or before the one holding it, wrapping at the ends, entered where it
 * shows. `null` when no tabbed stack holds the tile, or it has one tab.
 */
export function findTab(tree: LayoutTree, id: TileId, to: "next" | "previous"): TileNode | null {
	const ancestors = ancestorsOf(tree.root, id);
	if (!ancestors) return null;

	let childId: NodeId = id;
	for (let i = ancestors.length - 1; i >= 0; i--) {
		const stack = ancestors[i];
		if (!stack) return null;
		if (stack.orientation === "tabbed") {
			const n = stack.children.length;
			const index = stack.children.findIndex((child) => child.id === childId);
			const tab = stack.children[(index + (to === "next" ? 1 : -1) + n) % n];
			return n < 2 || index < 0 || !tab ? null : edgeTile(tab, "start");
		}
		childId = stack.id;
	}
	return null;
}

/**
 * Turn the stack holding `id` to its next orientation (`turned`): tabbed, horizontal, vertical.
 * Turned tabbed, it shows `id`. Its sizes stay, so a split turned tabbed and back has them again.
 */
export function turn(tree: LayoutTree, id: TileId): LayoutTree {
	const parent = ancestorsOf(tree.root, id)?.at(-1);
	if (!parent) return tree;
	const root = withStack(tree.root, parent.id, (stack) =>
		arrange(stack, {orientation: turned(stack.orientation), show: id}),
	);
	return root ? {...tree, root} : tree;
}

/**
 * Make `id` drawn: every tabbed stack above it shows the tab that holds it, as focus moving into a
 * tab does in i3. The same tree when it is drawn already, or is not in the tree.
 */
export function reveal(tree: LayoutTree, id: TileId): LayoutTree {
	const root = revealIn(tree.root, id);
	return root === null || root === tree.root ? tree : {...tree, root};
}

/** `stack` with the tile drawn, the same object when it was, or `null` when the tile is not under it. */
function revealIn(stack: StackNode, id: TileId): StackNode | null {
	for (const child of stack.children) {
		const next = child.tag === "tile" ? (child.id === id ? child : null) : revealIn(child, id);
		if (next === null) continue;
		const held = next === child ? stack : replaceChild(stack, child.id, next);
		const shown = held.orientation !== "tabbed" || held.active === child.id;
		return shown ? held : arrange(held, {show: child.id});
	}
	return null;
}

/** The stacks from the root down to the tile's parent, or `null` when there is no such tile. */
function ancestorsOf(stack: StackNode, id: TileId): StackNode[] | null {
	for (const child of stack.children) {
		if (child.tag === "tile") {
			if (child.id === id) return [stack];
			continue;
		}
		const deeper = ancestorsOf(child, id);
		if (deeper) return [stack, ...deeper];
	}
	return null;
}

/**
 * Split `id` along `orientation`, giving the new tile half the split tile's share. A stack holding
 * one child turns to the new orientation instead of nesting; otherwise a different orientation
 * nests a stack under `ids.stack`. An unknown tile, or new ids already taken, leave the tree as it
 * is: `checkTree` is what proves a tree's ids unique. The new tile shows a fresh tsh.
 */
export function split(tree: LayoutTree, id: TileId, orientation: Axis, ids: SplitIds): LayoutTree {
	const taken = new Set<NodeId>(idsOf(tree.root));
	if (taken.has(ids.tile) || taken.has(ids.stack)) return tree;
	const root = splitIn(tree.root, id, orientation, ids, createTile(ids.tile));
	return root ? {...tree, root} : tree;
}

function splitIn(
	stack: StackNode,
	id: TileId,
	orientation: Axis,
	ids: SplitIds,
	created: TileNode,
): StackNode | null {
	const index = stack.children.findIndex((child) => child.tag === "tile" && child.id === id);
	const target = index < 0 ? undefined : stack.children[index];
	if (target?.tag === "tile") {
		if (stack.orientation === orientation || stack.children.length === 1) {
			const children = [
				...stack.children.slice(0, index + 1),
				created,
				...stack.children.slice(index + 1),
			];
			const share = stack.sizes[id] ?? 100 / stack.children.length;
			const sizes = {...stack.sizes, [id]: share / 2, [ids.tile]: share / 2};
			return arrange(stack, {orientation, children, sizes});
		}
		return replaceChild(stack, id, createStack(ids.stack, orientation, [target, created]));
	}

	for (const child of stack.children) {
		if (child.tag !== "stack") continue;
		const next = splitIn(child, id, orientation, ids, created);
		if (next) return replaceChild(stack, child.id, next);
	}
	return null;
}

function idsOf(node: LayoutNode): NodeId[] {
	if (node.tag === "tile") return [node.id];
	return [node.id, ...node.children.flatMap(idsOf)];
}

/**
 * Remove `id`, handing its share to the sibling it sat against. An emptied stack folds into its
 * grandparent, a stack left with one child is replaced by that child, and the root takes in a lone
 * stack child. Removing the tree's last tile is refused: the desk, not the tree, decides what
 * closing the last tile means.
 */
export function remove(tree: LayoutTree, id: TileId): LayoutTree {
	const result = removeIn(tree.root, id);
	if (!result.found || result.stack === null) return tree;

	let root = result.stack;
	let onlyChild = root.children.length === 1 ? root.children[0] : undefined;
	while (onlyChild?.tag === "stack") {
		root = {...onlyChild, id: root.id};
		onlyChild = root.children.length === 1 ? root.children[0] : undefined;
	}

	return {root, zoomed: tree.zoomed === id ? null : tree.zoomed};
}

interface RemoveResult {
	readonly found: boolean;
	/** `null` when the stack lost its last child and its own parent must drop it. */
	readonly stack: StackNode | null;
}

function removeIn(stack: StackNode, id: TileId): RemoveResult {
	const direct = stack.children.some((child) => child.tag === "tile" && child.id === id);
	if (direct) {
		const next = withoutChild(stack, id);
		return {found: true, stack: next.children.length === 0 ? null : next};
	}

	for (const child of stack.children) {
		if (child.tag !== "stack") continue;
		const result = removeIn(child, id);
		if (!result.found) continue;
		if (result.stack === null) {
			const next = withoutChild(stack, child.id);
			return {found: true, stack: next.children.length === 0 ? null : next};
		}
		return {found: true, stack: replaceChild(stack, child.id, collapse(result.stack))};
	}
	return {found: false, stack};
}

/** A stack holding a single child is that child; its share moves with it at the parent. */
function collapse(stack: StackNode): LayoutNode {
	const only = stack.children.length === 1 ? stack.children[0] : undefined;
	return only ?? stack;
}

/**
 * The freed share goes to the neighbour the removed child sat against, as the pane beside it grows
 * in tmux. That is also what makes `remove` the exact inverse of the `split` that made the child.
 */
function withoutChild(stack: StackNode, childId: NodeId): StackNode {
	const index = stack.children.findIndex((child) => child.id === childId);
	const children = stack.children.filter((child) => child.id !== childId);
	const heir = children[index - 1] ?? children[0];
	const sizes: Record<NodeId, number> = {};
	for (const child of children) {
		const freed = child.id === heir?.id ? (stack.sizes[childId] ?? 0) : 0;
		sizes[child.id] = (stack.sizes[child.id] ?? 0) + freed;
	}
	// A tabbed stack that loses the tab it showed shows the heir, as a closed tab shows its neighbour.
	const show = stack.orientation === "tabbed" && stack.active === childId ? heir?.id : undefined;
	return arrange(stack, {children, sizes, show});
}

function replaceChild(stack: StackNode, childId: NodeId, node: LayoutNode): StackNode {
	const children = stack.children.map((child) => (child.id === childId ? node : child));
	const sizes: Record<NodeId, number> = {};
	for (const [id, size] of Object.entries(stack.sizes)) sizes[id === childId ? node.id : id] = size;
	const show = stack.orientation === "tabbed" && stack.active === childId ? node.id : undefined;
	return arrange(stack, {children, sizes, show});
}

/**
 * Record a resize of one stack. `sizes` is percent of that stack's extent, as a dragged border
 * reports it, and is made back into a total map summing to 100.
 */
export function resize(
	tree: LayoutTree,
	id: StackId,
	sizes: Readonly<Record<NodeId, number>>,
): LayoutTree {
	const root = withStack(tree.root, id, (stack) => arrange(stack, {sizes}));
	return root ? {...tree, root} : tree;
}

/** Change what a tile shows. An unknown tile leaves the tree as it is. */
export function setShows(tree: LayoutTree, id: TileId, shows: Shows): LayoutTree {
	const root = mapTile(tree.root, id, (tile) => createTile(tile.id, shows));
	return root ? {...tree, root} : tree;
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
 * orientation, the tab shown, sizes, what a tile shows or the zoomed tile gives another string.
 */
export function layoutSignature(tree: LayoutTree): string {
	return JSON.stringify([tree.zoomed, nodeShape(tree.root)]);
}

function nodeShape(node: LayoutNode): unknown {
	if (node.tag === "tile") return ["t", node.id, node.shows];
	return [
		"s",
		node.id,
		node.orientation,
		node.orientation === "tabbed" ? node.active : null,
		node.children.map((child) => [nodeShape(child), node.sizes[child.id] ?? null]),
	];
}

function withStack(
	stack: StackNode,
	id: StackId,
	f: (stack: StackNode) => StackNode,
): StackNode | null {
	if (stack.id === id) return f(stack);
	for (const child of stack.children) {
		if (child.tag !== "stack") continue;
		const next = withStack(child, id, f);
		if (next) return replaceChild(stack, child.id, next);
	}
	return null;
}

function mapTile(stack: StackNode, id: TileId, f: (tile: TileNode) => TileNode): StackNode | null {
	for (const child of stack.children) {
		if (child.tag === "tile") {
			if (child.id !== id) continue;
			return replaceChild(stack, id, f(child));
		}
		const next = mapTile(child, id, f);
		if (next) return replaceChild(stack, child.id, next);
	}
	return null;
}
