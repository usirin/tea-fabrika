import {isTile, type Split, type Tile, tilesIn} from "./desk.ts";

// Size belongs to the viewer (W4). The desk keeps percents; each window turns them into pixels for
// its own size, and folds what does not fit into a thin strip. The tile focus is on stays open.
//
//   a row of t1 and t2, 50% each, focus on t1
//   fold(layout, {w: 1280, h: 800}, "t1")   t1 x=0 w=640, t2 x=640 w=640
//   fold(layout, {w: 420, h: 800}, "t1")    t1 x=0 w=384, t2 x=384 w=36, folded

export type Size = {readonly w: number; readonly h: number};

/** A tile as one window draws it, in that window's pixels. */
export type Placed = {
	readonly id: string;
	readonly shows: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly folded: boolean;
};

/** Under this a tile cannot show its program. */
export const MIN_W = 240;
export const MIN_H = 140;
/** A folded tile is a strip this thick. */
export const STRIP = 36;

type Rect = {readonly x: number; readonly y: number; readonly w: number; readonly h: number};

const holds = (part: Split | Tile, focus: string): boolean =>
	isTile(part) ? part.id === focus : tilesIn(part).some((t) => t.id === focus);

/** The least a part needs along one axis to stay open. */
const least = (part: Split | Tile, along: "row" | "column"): number => {
	if (isTile(part)) return along === "row" ? MIN_W : MIN_H;
	const sizes = part.parts.map((p) => least(p.inner, along));
	return part.dir === along ? sizes.reduce((a, b) => a + b, 0) : Math.max(...sizes);
};

/** A whole part as a strip: its tiles side by side across the strip. */
const foldAll = (part: Split | Tile, rect: Rect, dir: "row" | "column"): readonly Placed[] => {
	const tiles = isTile(part) ? [part] : tilesIn(part);
	const share = (dir === "row" ? rect.h : rect.w) / tiles.length;
	return tiles.map((tile, i) => ({
		id: tile.id,
		shows: tile.shows,
		x: dir === "row" ? rect.x : rect.x + share * i,
		y: dir === "row" ? rect.y + share * i : rect.y,
		w: dir === "row" ? rect.w : share,
		h: dir === "row" ? share : rect.h,
		folded: true,
	}));
};

/**
 * Which parts of a split fold at this length. While an open part is under its least, the smallest
 * part that does not hold the focus folds, and the rest share what is left by their percents.
 */
const foldedParts = (split: Split, length: number, focus: string): ReadonlySet<number> => {
	const folded = new Set<number>();
	const open = () => split.parts.map((_, i) => i).filter((i) => !folded.has(i));
	const sizeOf = (i: number): number => {
		const total = open().reduce((sum, j) => sum + (split.parts[j]?.percent ?? 0), 0);
		const part = split.parts[i];
		return part === undefined ? 0 : ((length - folded.size * STRIP) * part.percent) / total;
	};
	for (;;) {
		const tooSmall = open().some((i) => {
			const part = split.parts[i];
			return part !== undefined && sizeOf(i) < least(part.inner, split.dir);
		});
		if (!tooSmall) return folded;
		const candidates = open().filter((i) => {
			const part = split.parts[i];
			return part !== undefined && !holds(part.inner, focus);
		});
		const next = candidates.sort(
			(a, b) => (split.parts[a]?.percent ?? 0) - (split.parts[b]?.percent ?? 0),
		)[0];
		if (next === undefined) return folded;
		folded.add(next);
	}
};

const place = (split: Split, rect: Rect, focus: string): readonly Placed[] => {
	const row = split.dir === "row";
	const length = row ? rect.w : rect.h;
	const folded = foldedParts(split, length, focus);
	const openPercent = split.parts.reduce(
		(sum, part, i) => (folded.has(i) ? sum : sum + part.percent),
		0,
	);
	const room = length - folded.size * STRIP;
	let at = row ? rect.x : rect.y;
	return split.parts.flatMap((part, i) => {
		const isFolded = folded.has(i);
		const size = isFolded ? STRIP : (room * part.percent) / openPercent;
		const here: Rect = row
			? {x: at, y: rect.y, w: size, h: rect.h}
			: {x: rect.x, y: at, w: rect.w, h: size};
		at += size;
		if (isFolded) return foldAll(part.inner, here, split.dir);
		if (isTile(part.inner)) {
			return [{id: part.inner.id, shows: part.inner.shows, ...here, folded: false}];
		}
		return place(part.inner, here, focus);
	});
};

/** A layout in this window's pixels. The layout itself does not change. */
export const fold = (layout: Split, size: Size, focus: string): readonly Placed[] =>
	place(layout, {x: 0, y: 0, w: size.w, h: size.h}, focus);
