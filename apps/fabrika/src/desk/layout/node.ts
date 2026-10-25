import {Predicate} from "effect";

// The layout tree's nodes and the size arithmetic every operation shares. Ported from Tuval's
// layout tree (kamp-us/phoenix, apps/tuval/src/shell/layout/node.ts), with its leaf called a
// tile, not a window, and with what a tile shows in place of Tuval's process binding.
//
// `"horizontal"` means the children sit side by side in a row; `"vertical"` means they stack top
// to bottom. Ids are plain strings, minted by the desk (desk.ts); this module never makes one.
// The one `effect` import is `Predicate.isObject`, a pure guard.

/** A tile's id. The desk mints it. */
export type TileId = string;

/** A stack's id. */
export type StackId = string;

export type NodeId = TileId | StackId;

/** `"horizontal"`: children side by side. `"vertical"`: children top to bottom. */
export type Orientation = "horizontal" | "vertical";

export type Direction = "left" | "right" | "up" | "down";

/** Which end of a stack's children a descent enters from, in reading order. */
export type Edge = "start" | "end";

/** A run of a program with a view: its id, and its program's name, which picks how it is drawn. */
export interface Shown {
	readonly id: string;
	readonly program: string;
}

/**
 * What a tile shows: always its own tsh. A run with a view in its foreground covers it while it
 * runs. A run started with `&` shows nowhere, as a job in bash's background, until `attach`.
 */
export type Shows = {readonly kind: "tsh"; readonly run: Shown | null};

export interface TileNode {
	readonly tag: "tile";
	readonly id: TileId;
	readonly shows: Shows;
}

/**
 * A row or column of children. `sizes` is percent of the stack's own extent, never pixels.
 * Every operation in this module leaves `sizes` keyed by exactly `children` and summing to 100.
 */
export interface StackNode {
	readonly tag: "stack";
	readonly id: StackId;
	readonly orientation: Orientation;
	readonly children: readonly LayoutNode[];
	readonly sizes: Readonly<Record<NodeId, number>>;
}

export type LayoutNode = TileNode | StackNode;

/** `zoomed` names the one tile drawn alone. Zooming never writes `sizes`, so unzoom restores. */
export interface LayoutTree {
	readonly root: StackNode;
	readonly zoomed: TileId | null;
}

/** A tile running its own tsh, with nothing over it. */
export const TSH: Shows = {kind: "tsh", run: null};

export function createTile(id: TileId, shows: Shows = TSH): TileNode {
	return {tag: "tile", id, shows};
}

/**
 * `sizes` may be partial or absent: a child the map does not name takes an even share of what the
 * named ones leave, and the result is scaled to 100.
 */
export function createStack(
	id: StackId,
	orientation: Orientation,
	children: readonly LayoutNode[],
	sizes: Readonly<Record<NodeId, number>> = {},
): StackNode {
	return {tag: "stack", id, orientation, children, sizes: resolveSizes(children, sizes)};
}

export function createTree(root: StackNode, zoomed: TileId | null = null): LayoutTree {
	return {root, zoomed};
}

const isShown = (value: unknown): value is Shown =>
	Predicate.isObject(value) && typeof value.id === "string" && typeof value.program === "string";

export function isShows(value: unknown): value is Shows {
	if (!Predicate.isObject(value) || value.kind !== "tsh") return false;
	return value.run === null || isShown(value.run);
}

export function isTileNode(value: unknown): value is TileNode {
	return (
		Predicate.isObject(value) &&
		value.tag === "tile" &&
		typeof value.id === "string" &&
		isShows(value.shows)
	);
}

export function isStackNode(value: unknown): value is StackNode {
	return (
		Predicate.isObject(value) &&
		value.tag === "stack" &&
		typeof value.id === "string" &&
		(value.orientation === "horizontal" || value.orientation === "vertical") &&
		Array.isArray(value.children) &&
		value.children.every(isLayoutNode) &&
		Predicate.isObject(value.sizes) &&
		Object.values(value.sizes).every((size) => typeof size === "number")
	);
}

/**
 * Is this a node of the tree? Total over the union and recursive through `children`, because a
 * saved layout comes back as `unknown` and every reader here walks it without a guard of its own.
 */
export function isLayoutNode(value: unknown): value is LayoutNode {
	return isTileNode(value) || isStackNode(value);
}

/** `sizes` is checked for number values and not for its sum: `resolveSizes` works that out again. */
export function isLayoutTree(value: unknown): value is LayoutTree {
	return (
		Predicate.isObject(value) &&
		isStackNode(value.root) &&
		(value.zoomed === null || typeof value.zoomed === "string")
	);
}

/** Percent values may not sum exactly after division. */
export const SIZE_TOLERANCE = 0.01;

/**
 * The total size map for `children`: named non-negative values are kept, unnamed children split
 * whatever is left evenly, keys naming no child are dropped, and the whole map is scaled to 100.
 * An all-zero or empty input falls back to an even split.
 */
export function resolveSizes(
	children: readonly LayoutNode[],
	sizes: Readonly<Record<NodeId, number>>,
): Readonly<Record<NodeId, number>> {
	if (children.length === 0) return {};

	const named: number[] = [];
	let namedTotal = 0;
	let unnamed = 0;
	for (const child of children) {
		const value = sizes[child.id];
		if (value === undefined || !Number.isFinite(value) || value < 0) {
			named.push(Number.NaN);
			unnamed += 1;
		} else {
			named.push(value);
			namedTotal += value;
		}
	}

	const share = unnamed === 0 ? 0 : Math.max(0, 100 - namedTotal) / unnamed;
	const raw = named.map((value) => (Number.isNaN(value) ? share : value));
	const total = raw.reduce((sum, value) => sum + value, 0);
	const even = 100 / children.length;

	const resolved: Record<NodeId, number> = {};
	children.forEach((child, index) => {
		resolved[child.id] = total > 0 ? ((raw[index] ?? 0) * 100) / total : even;
	});
	return resolved;
}
