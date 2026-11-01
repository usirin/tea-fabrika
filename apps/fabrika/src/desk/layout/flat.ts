import {BORDER, STRIP} from "./line.ts";
import {
	type ContainerId,
	type ContainerNode,
	isFolded,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type Orientation,
	openShares,
	type TileNode,
} from "./node.ts";
import {findTile} from "./tree.ts";

// The layout tree, flat: every tile with the box it is drawn in, one list for the whole workspace.
// The tree says where a tile goes. It does not say what element holds it: a tile's element is a
// child of the workspace for as long as the tile is, wherever a split or a turn puts it, so React
// keeps the element, and what lives in it (scroll, a draft, focus, a map's pan).
//
//   flat({root: row("c1", [t1, t2]), zoomed: null}).tiles
//   [{tile: t1, box: {x: 0, w: 50% - 2px, ...}},
//    {tile: t2, box: {x: 50% + 2px, w: 50% - 2px, ...}}]
//
// Sizes are the two things CSS can add up without measuring: a share of the workspace, and pixels
// (each strip and border takes fixed pixels). So a window resize needs no render, as with flex.

/** A length: `of` the workspace's own extent, plus `px` pixels. */
export interface Span {
	readonly of: number;
	readonly px: number;
}

export interface Box {
	readonly x: Span;
	readonly y: Span;
	readonly w: Span;
	readonly h: Span;
}

export const WHOLE: Box = {
	x: {of: 0, px: 0},
	y: {of: 0, px: 0},
	w: {of: 1, px: 0},
	h: {of: 1, px: 0},
};

export interface Flat {
	/** The open tiles, in id order: an order a split or a turn never changes, so no element moves. */
	readonly tiles: readonly {readonly tile: TileNode; readonly box: Box}[];
	readonly strips: readonly {
		readonly node: LayoutNode;
		/** The way its parent runs. */
		readonly along: Orientation;
		readonly box: Box;
	}[];
	readonly borders: readonly {
		readonly container: ContainerNode;
		/** The open children either side of it. */
		readonly a: NodeId;
		readonly b: NodeId;
		readonly box: Box;
	}[];
	/** Where each open node is: a border's drag measures its two sides from here. */
	readonly boxes: ReadonlyMap<NodeId, Box>;
}

/** The sizes one container is drawn with while a border is dragged, not yet told to the desk. */
export interface Drag {
	readonly container: ContainerId;
	readonly sizes: Readonly<Record<NodeId, number>>;
}

/** What a strip's button leaves clear of its slot on each side, along its parent (window.css). */
const STRIP_GAP = 2;

const plus = (a: Span, b: Span): Span => ({of: a.of + b.of, px: a.px + b.px});
const px = (n: number): Span => ({of: 0, px: n});
const share = (a: Span, k: number): Span => ({of: a.of * k, px: a.px * k});

/** This much of `box`, starting `at` along `along`. The other way it takes all of `box`. */
const part = (box: Box, along: Orientation, at: Span, size: Span): Box =>
	along === "horizontal" ? {...box, x: at, w: size} : {...box, y: at, h: size};

export const byTileId = (a: {readonly tile: TileNode}, b: {readonly tile: TileNode}) =>
	a.tile.id.localeCompare(b.tile.id, undefined, {numeric: true});

const shapeOf = (node: LayoutNode): string =>
	node.tag === "tile"
		? `${node.id}${node.folded ? "-" : ""}`
		: `${node.orientation}(${node.children.map(shapeOf).join()})`;

/** Do two trees differ only by sizes? A dragged border changes sizes; a split or a turn, the shape. */
export const sameShape = (a: LayoutTree, b: LayoutTree): boolean =>
	a === b || (a.zoomed === b.zoomed && shapeOf(a.root) === shapeOf(b.root));

/** Every open tile's, strip's and border's box. A zoomed tile is alone, and has it all. */
export function flat(tree: LayoutTree, drag: Drag | null = null): Flat {
	const shown: {tile: TileNode; box: Box}[] = [];
	const strips: Flat["strips"][number][] = [];
	const borders: Flat["borders"][number][] = [];
	const boxes = new Map<NodeId, Box>();
	if (tree.zoomed !== null) {
		const tile = findTile(tree, tree.zoomed);
		return {tiles: tile === null ? [] : [{tile, box: WHOLE}], strips, borders, boxes};
	}
	const walk = (node: LayoutNode, box: Box): void => {
		boxes.set(node.id, box);
		if (node.tag === "tile") {
			shown.push({tile: node, box});
			return;
		}
		const along = node.orientation;
		const shares = openShares(drag?.container === node.id ? {...node, sizes: drag.sizes} : node);
		const open = node.children.filter((child) => !isFolded(child));
		const fixed =
			(node.children.length - open.length) * STRIP[along] + Math.max(0, open.length - 1) * BORDER;
		const extent = along === "horizontal" ? box.w : box.h;
		const rest = plus(extent, px(-fixed));
		let at = along === "horizontal" ? box.x : box.y;
		let before: NodeId | null = null;
		for (const child of node.children) {
			if (isFolded(child)) {
				strips.push({
					node: child,
					along,
					box: part(box, along, plus(at, px(STRIP_GAP)), px(STRIP[along] - 2 * STRIP_GAP)),
				});
				at = plus(at, px(STRIP[along]));
				continue;
			}
			if (before !== null) {
				borders.push({
					container: node,
					a: before,
					b: child.id,
					box: part(box, along, at, px(BORDER)),
				});
				at = plus(at, px(BORDER));
			}
			const size = share(rest, shares[child.id] ?? 1);
			walk(child, part(box, along, at, size));
			at = plus(at, size);
			before = child.id;
		}
	};
	walk(tree.root, WHOLE);
	return {tiles: shown.toSorted(byTileId), strips, borders, boxes};
}

/** A span in pixels, in a workspace `extent` px long. */
export const inPx = (span: Span, extent: number): number => span.of * extent + span.px;
