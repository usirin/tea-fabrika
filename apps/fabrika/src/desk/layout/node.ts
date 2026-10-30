import {Predicate} from "effect";

// The layout tree's nodes and the size arithmetic every operation shares. Ported from Tuval's
// layout tree (kamp-us/phoenix, apps/tuval/src/shell/layout/node.ts), with its leaf called a
// tile, not a window, and with what a tile shows in place of Tuval's process binding.
//
// A container lays its children out in a row (`"horizontal"`) or a column (`"vertical"`), as an
// AeroSpace or i3 container does. There are no tabs. Any tile can be folded into a thin strip
// instead (docs/direction/fold-not-tabs.md). Ids are plain strings, minted by the desk
// (desk.ts); this module never makes one. The one `effect` import is `Predicate.isObject`, a
// pure guard.
//
//   createContainer("c1", "horizontal", [a, b])         a and b side by side
//   createContainer("c1", "horizontal", [a, folded])    a fills the row, and a strip beside it
//   isFolded(createContainer("c1", "vertical", [f, g])) true when f and g are both folded

/** A tile's id. The desk mints it. */
export type TileId = string;

/** A container's id. */
export type ContainerId = string;

export type NodeId = TileId | ContainerId;

/** `"horizontal"`: children side by side. `"vertical"`: children top to bottom. */
export type Orientation = "horizontal" | "vertical";

/** The other orientation: what a container nested in this one has. */
export const across = (orientation: Orientation): Orientation =>
	orientation === "horizontal" ? "vertical" : "horizontal";

export type Direction = "left" | "right" | "up" | "down";

/** Which end of a container's children a descent enters from, in reading order. */
export type Edge = "start" | "end";

/** A run of a program with a view: its id, and its program's name, which picks how it is drawn. */
export interface Shown {
	readonly id: string;
	readonly program: string;
}

/** One colour of the line palette (window.css, `--line-0` to `--line-5`). */
export type Tint = 0 | 1 | 2 | 3 | 4 | 5;

/** Every tint, in the order a new line takes the first one free. */
export const TINTS: readonly Tint[] = [0, 1, 2, 3, 4, 5];

/**
 * A tsh line whose windows opened together, as `tracker | ticket | runs`: its id (its first
 * window's run), the tile it was typed in, and its tint. Only a line of two windows or more has
 * one: a run alone gets no tint.
 */
export interface Line {
	readonly id: string;
	readonly from: TileId;
	readonly tint: Tint;
}

/**
 * What a tile shows.
 *
 * - `tsh`: its own tsh. A run with a view in its foreground covers it while it runs. A run
 *   started with `&` shows nowhere, as a job in bash's background, until `attach`.
 * - `line`: its own tsh, covered by the first window of a line typed in it.
 * - `window`: one more window of a line typed in another tile. It has no tsh of its own, and it
 *   goes when its run ends.
 */
export type Shows =
	| {readonly kind: "tsh"; readonly run: Shown | null}
	| {readonly kind: "line"; readonly run: Shown; readonly line: Line}
	| {readonly kind: "window"; readonly run: Shown; readonly line: Line};

/** The line a tile shows a window of, or none. */
export const lineOf = (node: LayoutNode): Line | null =>
	node.tag === "tile" && node.shows.kind !== "tsh" ? node.shows.line : null;

/**
 * A tile. `folded`: drawn as a thin strip along its parent's direction, in its own place. Its
 * share in `sizes` stays, so it comes back at the size it had; the open tiles beside it share the
 * space while it is folded.
 */
export interface TileNode {
	readonly tag: "tile";
	readonly id: TileId;
	readonly shows: Shows;
	readonly folded: boolean;
}

/**
 * A row or a column of children. `sizes` is percent of the container's own extent, never pixels.
 * Every operation in this module leaves `sizes` keyed by exactly `children` and summing to 100,
 * folded children included, and leaves a nested container the other orientation from its parent's
 * (`checkTree` says so).
 */
export interface ContainerNode {
	readonly tag: "container";
	readonly id: ContainerId;
	readonly orientation: Orientation;
	readonly children: readonly LayoutNode[];
	readonly sizes: Readonly<Record<NodeId, number>>;
}

export type LayoutNode = TileNode | ContainerNode;

/** `zoomed` names the one tile drawn alone. Zooming never writes `sizes`, so unzoom restores. */
export interface LayoutTree {
	readonly root: ContainerNode;
	readonly zoomed: TileId | null;
}

/** A tile running its own tsh, with nothing over it. */
export const TSH: Shows = {kind: "tsh", run: null};

export function createTile(id: TileId, shows: Shows = TSH, folded = false): TileNode {
	return {tag: "tile", id, shows, folded};
}

/**
 * `sizes` may be partial or absent: a child the map does not name takes an even share of what the
 * named ones leave, and the result is scaled to 100.
 */
export function createContainer(
	id: ContainerId,
	orientation: Orientation,
	children: readonly LayoutNode[],
	sizes: Readonly<Record<NodeId, number>> = {},
): ContainerNode {
	return {tag: "container", id, orientation, children, sizes: resolveSizes(children, sizes)};
}

export function createTree(root: ContainerNode, zoomed: TileId | null = null): LayoutTree {
	return {root, zoomed};
}

/**
 * Is this node folded? A tile says so itself. A container is folded when every tile in it is, so
 * a whole column or row gives its space back and is drawn as one strip. Worked out, never kept,
 * so a container can never disagree with its tiles.
 */
export const isFolded = (node: LayoutNode): boolean =>
	node.tag === "tile" ? node.folded : node.children.every(isFolded);

const isShown = (value: unknown): value is Shown =>
	Predicate.isObject(value) && typeof value.id === "string" && typeof value.program === "string";

const isLine = (value: unknown): value is Line =>
	Predicate.isObject(value) &&
	typeof value.id === "string" &&
	typeof value.from === "string" &&
	(TINTS as readonly unknown[]).includes(value.tint);

export function isShows(value: unknown): value is Shows {
	if (!Predicate.isObject(value)) return false;
	if (value.kind === "tsh") return value.run === null || isShown(value.run);
	return (
		(value.kind === "line" || value.kind === "window") && isShown(value.run) && isLine(value.line)
	);
}

export function isTileNode(value: unknown): value is TileNode {
	return (
		Predicate.isObject(value) &&
		value.tag === "tile" &&
		typeof value.id === "string" &&
		isShows(value.shows) &&
		typeof value.folded === "boolean"
	);
}

export function isContainerNode(value: unknown): value is ContainerNode {
	return (
		Predicate.isObject(value) &&
		value.tag === "container" &&
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
	return isTileNode(value) || isContainerNode(value);
}

/** `sizes` is checked for number values and not for its sum: `resolveSizes` works that out again. */
export function isLayoutTree(value: unknown): value is LayoutTree {
	return (
		Predicate.isObject(value) &&
		isContainerNode(value.root) &&
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

/** The tiles of `container`, its own children, that show a window of this line. */
const membersOf = (container: ContainerNode, line: string): readonly TileNode[] =>
	container.children.flatMap((child) =>
		child.tag === "tile" && lineOf(child)?.id === line ? [child] : [],
	);

/** `sizes` with these tiles' shares scaled to add up to `total`: by their own shares, or evenly if they have none. */
const scaled = (
	sizes: Record<NodeId, number>,
	tiles: readonly TileNode[],
	total: number,
): Record<NodeId, number> => {
	const now = tiles.reduce((sum, tile) => sum + (sizes[tile.id] ?? 0), 0);
	for (const tile of tiles)
		sizes[tile.id] = now > 0 ? ((sizes[tile.id] ?? 0) * total) / now : total / tiles.length;
	return sizes;
};

/**
 * The line's windows in `container` share their space among themselves, after the tile `id` of
 * that line folded or opened: the open ones split the line's total, the folded ones hold none.
 * A tile that opens takes an even share from the line's other open windows, never from an
 * unrelated tile; one that folds hands its share to them. The line's total stays the same, so
 * the other children keep theirs. With every window of the line folded nothing moves, and the
 * last one folded keeps the total for the next to open. A tile in no line, or alone in its line
 * here, changes nothing.
 */
export function shareLine(container: ContainerNode, id: TileId): ContainerNode {
	const tile = container.children.find((child) => child.id === id);
	const line = tile === undefined ? null : lineOf(tile);
	if (tile?.tag !== "tile" || line === null) return container;
	const members = membersOf(container, line.id);
	const open = members.filter((member) => !member.folded);
	if (members.length < 2 || open.length === 0) return container;
	const total = members.reduce((sum, member) => sum + (container.sizes[member.id] ?? 0), 0);
	const sizes: Record<NodeId, number> = {...container.sizes};
	for (const member of members) if (member.folded) sizes[member.id] = 0;
	if (tile.folded) return {...container, sizes: scaled(sizes, open, total)};
	const share = total / open.length;
	sizes[id] = share;
	const rest = open.filter((member) => member.id !== id);
	return {...container, sizes: rest.length === 0 ? sizes : scaled(sizes, rest, total - share)};
}

/**
 * `container` with the tile `id`'s share handed to its line's other windows here, as it goes:
 * to the open ones, by their shares, or else to the first of them. The tile is left with none.
 * A tile in no line, or alone in its line here, changes nothing.
 */
export function freeShare(container: ContainerNode, id: TileId): ContainerNode {
	const tile = container.children.find((child) => child.id === id);
	const line = tile === undefined ? null : lineOf(tile);
	if (line === null) return container;
	const others = membersOf(container, line.id).filter((member) => member.id !== id);
	const open = others.filter((member) => !member.folded);
	const heirs = open.length > 0 ? open : others.slice(0, 1);
	if (heirs.length === 0) return container;
	const total =
		heirs.reduce((sum, heir) => sum + (container.sizes[heir.id] ?? 0), 0) +
		(container.sizes[id] ?? 0);
	return {...container, sizes: scaled({...container.sizes, [id]: 0}, heirs, total)};
}

/**
 * The open children's shares, scaled to add up to 1, for drawing: a folded child is a strip of
 * fixed size and takes none. Their stored `sizes` are not changed, so a child unfolded later gets
 * its old share back.
 */
export function openShares(container: ContainerNode): Readonly<Record<NodeId, number>> {
	const open = container.children.filter((child) => !isFolded(child));
	const total = open.reduce((sum, child) => sum + (container.sizes[child.id] ?? 0), 0);
	const shares: Record<NodeId, number> = {};
	for (const child of open)
		shares[child.id] = total > 0 ? (container.sizes[child.id] ?? 0) / total : 1 / open.length;
	return shares;
}
