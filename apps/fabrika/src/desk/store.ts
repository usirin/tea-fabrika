import type {Saved} from "./desk.ts";
import {
	type ContainerNode,
	isTileNode,
	type LayoutNode,
	type LayoutTree,
	type TileId,
	type TileNode,
	tiles as tilesUnder,
} from "./layout/index.ts";

// Experiment 176, pick 4b: the tile store, Relay's shape. `tiles` is a flat record by id, and each
// workspace's layout holds only ids, so a split or a move changes a layout and never a tile.
//
//   toStore(saved)
//   {tiles: {t1: {tag: "tile", id: "t1", shows: ..., folded: false}},
//    workspaces: [{id: "w1", focused: "t1", layout: {zoomed: null,
//      root: {tag: "container", id: "c1", ..., children: [{tag: "tile", id: "t1"}]}}}], ...}
//
// What it costs: two parts that must agree. The tree could not disagree with itself; these can, so
// `checkStore` is a law the tree never needed, and a kept desk that breaks it is refused.

export interface TileRef {
	readonly tag: "tile";
	readonly id: TileId;
}

export type RefNode =
	| TileRef
	| (Omit<ContainerNode, "children"> & {readonly children: readonly RefNode[]});

export interface StoreWorkspace {
	readonly id: string;
	readonly focused: string;
	readonly layout: {readonly root: RefNode; readonly zoomed: TileId | null};
}

export interface Store {
	readonly tiles: Readonly<Record<TileId, TileNode>>;
	readonly workspaces: readonly StoreWorkspace[];
	readonly active: string;
	readonly next: number;
}

export type StoreBreak =
	/** The law: every id in a layout appears exactly once, in all of them together. */
	| {readonly kind: "twice"; readonly id: TileId}
	| {readonly kind: "no-record"; readonly id: TileId}
	/** A record no layout names: a tile that exists and can never be drawn or closed. */
	| {readonly kind: "orphan"; readonly id: TileId}
	/** A record filed under another tile's id. */
	| {readonly kind: "wrong-id"; readonly id: TileId};

const refOf = (node: LayoutNode): RefNode =>
	node.tag === "tile" ? {tag: "tile", id: node.id} : {...node, children: node.children.map(refOf)};

/** The tile ids a layout names, once per place it names them. */
const idsIn = (node: RefNode): readonly TileId[] =>
	node.tag === "tile" ? [node.id] : node.children.flatMap(idsIn);

/** What the store breaks. Empty on any store `toStore` made. */
export const checkStore = (store: Store): readonly StoreBreak[] => {
	const out: StoreBreak[] = [];
	const seen = new Set<TileId>();
	for (const ws of store.workspaces)
		for (const id of idsIn(ws.layout.root)) {
			if (seen.has(id)) out.push({kind: "twice", id});
			seen.add(id);
			if (store.tiles[id] === undefined) out.push({kind: "no-record", id});
		}
	for (const [id, tile] of Object.entries(store.tiles)) {
		if (!seen.has(id)) out.push({kind: "orphan", id});
		if (tile.id !== id) out.push({kind: "wrong-id", id});
	}
	return out;
};

export const recordsOf = (trees: readonly LayoutTree[]): Readonly<Record<TileId, TileNode>> => {
	const tiles: Record<TileId, TileNode> = {};
	for (const tree of trees) for (const tile of tilesUnder(tree.root)) tiles[tile.id] = tile;
	return tiles;
};

export const toStore = (saved: Saved): Store => ({
	tiles: recordsOf(saved.workspaces.map((ws) => ws.layout)),
	workspaces: saved.workspaces.map((ws) => ({
		id: ws.id,
		focused: ws.focused,
		layout: {root: refOf(ws.layout.root), zoomed: ws.layout.zoomed},
	})),
	active: saved.active,
	next: saved.next,
});

/** Back to the tree every reader walks. `null` when the two parts do not agree. */
const fromStore = (store: Store): Saved | null => {
	if (checkStore(store).length > 0) return null;
	const nodeOf = (ref: RefNode): LayoutNode | null => {
		if (ref.tag === "tile") return store.tiles[ref.id] ?? null;
		const children = ref.children.flatMap((child) => nodeOf(child) ?? []);
		return {...ref, children};
	};
	const workspaces = store.workspaces.flatMap((ws) => {
		const root = nodeOf(ws.layout.root);
		return root?.tag === "container"
			? [{id: ws.id, focused: ws.focused, layout: {root, zoomed: ws.layout.zoomed}}]
			: [];
	});
	return {workspaces, active: store.active, next: store.next};
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isRef = (v: unknown): v is RefNode => {
	if (!isRecord(v) || typeof v.id !== "string") return false;
	if (v.tag === "tile") return true;
	return v.tag === "container" && Array.isArray(v.children) && v.children.every(isRef);
};

const isStore = (v: unknown): v is Store =>
	isRecord(v) &&
	isRecord(v.tiles) &&
	Object.values(v.tiles).every(isTileNode) &&
	Array.isArray(v.workspaces) &&
	v.workspaces.every((ws) => isRecord(ws) && isRecord(ws.layout) && isRef(ws.layout.root)) &&
	typeof v.active === "string" &&
	typeof v.next === "number";

/**
 * What a kept file holds, for `restore`: a store, turned back into the tree, or `null` when it breaks
 * the law (so the start makes a fresh desk, as for any kept desk that does not read). A file from
 * before the store has no `tiles`, and passes through as it is.
 */
export const fromKept = (raw: unknown): unknown => {
	if (!isRecord(raw) || !("tiles" in raw)) return raw;
	return isStore(raw) ? fromStore(raw) : null;
};
