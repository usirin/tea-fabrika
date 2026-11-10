import {
	type ContainerId,
	type ContainerNode,
	createTile,
	isFolded,
	type KeptLine,
	type LayoutNode,
	type LayoutTree,
	type Line,
	type Orientation,
	openShares,
	type Shows,
	type Shown,
	TINTS,
	type TileId,
	type TileNode,
	type Tint,
	TSH,
} from "./node.ts";
import {findTile, fold, remove, setShows, spread, tiles, unzoom} from "./tree.ts";

// A tsh line with several windows, `tracker | ticket | trace`, opens in place: in the tile it was
// typed in, by the tree's own split rule (docs/direction/fold-not-tabs.md, "A line opens in
// place"). The tile keeps its tsh, covered by the first window, where the data starts; the other
// windows are tiles of their own beside it, with no tsh. When they would be too small to read,
// they open folded, and only the first is open.
//
//   openLine(tree, "t1", {runs: [tracker, ticket, runs], tint: 0, letter: "A",
//     orientation: "horizontal", ids: {tiles: ["t4", "t5"], container: "c4"},
//     area: {width: 1440, height: 860}})
//   // t1 in a row: t1 (tracker), t4 (ticket), t5 (runs), each a third of t1's old share
//   // the same in a 300px column: t4 and t5 folded into strips, t1 open with the whole share

/** A size in px: the workspace the page draws in, or one tile in it. */
export interface Area {
	readonly width: number;
	readonly height: number;
}

/**
 * The smallest a line's window opens at, title bar included: about 26 columns by 5 rows of the
 * terminal's 14px font, under a 20px title bar.
 */
export const MIN_WINDOW: Area = {width: 220, height: 120};

/**
 * What the page draws between tiles, in px, as window.css has it: a strip standing in a row
 * (22px and 2px each side), a strip lying in a column (20px and 2px above and below), and the
 * border between two open children.
 */
export const STRIP: Readonly<Record<Orientation, number>> = {horizontal: 26, vertical: 24};
export const BORDER = 4;

/** The ids the desk mints for one line: a tile for each window after the first, and a container in case it nests. */
export interface LineIds {
	readonly tiles: readonly TileId[];
	readonly container: ContainerId;
}

export interface Opening {
	/** The line's windows, in its order. */
	readonly runs: readonly [Shown, ...Shown[]];
	readonly tint: Tint;
	/** The pipe's letter: the first free in its workspace (`freeLetter`). */
	readonly letter: string;
	/** Which way the line runs: left to right, or top to bottom. */
	readonly orientation: Orientation;
	readonly ids: LineIds;
	/** The workspace's size, or `null` when no page has said it: then every window opens. */
	readonly area: Area | null;
}

/**
 * Open a line in the tile `at`. A run alone covers the tile, as a run always did, with no line
 * and no tint. Several: `at` shows the first, open, and each other run gets a tile of its own
 * from `ids`, all in `at`'s place by `spread`, sharing its space evenly. When any of them would
 * be smaller than `MIN_WINDOW` in `area`, every window but the first opens folded. An unknown
 * tile, a window tile (it has no tsh to type a line in), too few ids, or ids already taken leave
 * the tree as it is. A zoom goes, so the line is seen.
 */
export function openLine(tree: LayoutTree, at: TileId, opening: Opening): LayoutTree {
	const tile = findTile(tree, at);

	if (tile === null || tile.shows.kind === "window") {
		return tree;
	}

	const [first, ...rest] = opening.runs;

	if (rest.length === 0) {
		return setShows(tree, at, {kind: "tsh", run: first});
	}

	const line: Line = {id: first.id, from: at, tint: opening.tint, letter: opening.letter};
	const others: TileNode[] = [];

	for (const [i, run] of rest.entries()) {
		const id = opening.ids.tiles[i];

		if (id === undefined) {
			return tree;
		}

		others.push(createTile(id, {kind: "window", run, line}));
	}

	const head: TileNode = {...tile, folded: false, shows: {kind: "line", run: first, line}};
	const base = unzoom(tree);
	const placed = spread(base, at, opening.orientation, [head, ...others], opening.ids.container);

	if (placed === base) {
		return tree;
	}

	if (opening.area === null || fits(placed, opening.area, [at, ...others.map((t) => t.id)])) {
		return placed;
	}

	return others.reduce((layout, t) => fold(layout, t.id), placed);
}

/** Does every one of these tiles get at least `MIN_WINDOW` in a workspace of `area`? */
export const fits = (tree: LayoutTree, area: Area, ids: readonly TileId[]): boolean => {
	const sizes = extents(tree, area);
	return ids.every((id) => {
		const size = sizes.get(id);
		return size !== undefined && size.width >= MIN_WINDOW.width && size.height >= MIN_WINDOW.height;
	});
};

/**
 * Each open tile's size in px, in a workspace of `area`, as the page lays it out: each
 * container's strips and borders first, and the rest by `openShares`. A folded tile has none.
 */
export function extents(tree: LayoutTree, area: Area): ReadonlyMap<TileId, Area> {
	const out = new Map<TileId, Area>();
	const walk = (node: LayoutNode, size: Area): void => {
		if (node.tag === "tile") {
			if (!node.folded) {
				out.set(node.id, size);
			}

			return;
		}

		lay(node, size, walk);
	};
	walk(tree.root, area);
	return out;
}

function lay(
	container: ContainerNode,
	size: Area,
	walk: (node: LayoutNode, size: Area) => void,
): void {
	const row = container.orientation === "horizontal";
	const open = container.children.filter((child) => !isFolded(child));
	const strips = container.children.length - open.length;
	const along = row ? size.width : size.height;
	const left = Math.max(
		0,
		along - strips * STRIP[container.orientation] - Math.max(0, open.length - 1) * BORDER,
	);
	const shares = openShares(container);

	for (const child of open) {
		const part = left * (shares[child.id] ?? 0);
		walk(child, row ? {width: part, height: size.height} : {width: size.width, height: part});
	}
}

/**
 * The tree with nothing running in it, as after the host stopped: every window tile goes, its
 * share back to its line, and every tile shows its own tsh. A window tile left alone in the tree
 * cannot go, so it becomes a tile with a tsh of its own.
 */
export const quiet = (tree: LayoutTree): LayoutTree => {
	const windows = [...tiles(tree.root)].filter((t) => t.shows.kind === "window");
	const left = windows.reduce((layout, t) => remove(layout, t.id), tree);
	return [...tiles(left.root)]
		.filter((t) => t.shows.run !== null)
		.reduce((layout, t) => setShows(layout, t.id, TSH), left);
};

/** The lines shown in these trees, by id. */
export const linesIn = (trees: readonly LayoutTree[]): ReadonlyMap<string, Line> => {
	const lines = new Map<string, Line>();

	for (const tree of trees) {
		for (const tile of tiles(tree.root)) {
			if (tile.shows.kind !== "tsh") {
				lines.set(tile.shows.line.id, tile.shows.line);
			}
		}
	}

	return lines;
};

/**
 * The tint a new line takes: the first no line shown in these trees has. With every tint taken,
 * they go round again, by how many lines there are.
 */
export const freeTint = (trees: readonly LayoutTree[]): Tint => {
	const lines = [...linesIn(trees).values()];
	const taken = new Set(lines.map((line) => line.tint));
	return TINTS.find((tint) => !taken.has(tint)) ?? TINTS[lines.length % TINTS.length] ?? 0;
};

/** The `n`th letter, from 0: `A` to `Z`, then `AA`, `AB`, as a spreadsheet names its columns. */
const letterAt = (n: number): string =>
	(n >= 26 ? letterAt(Math.floor(n / 26) - 1) : "") + String.fromCharCode(65 + (n % 26));

/** The first letter not in `taken`. Letters never run out, so none is ever given twice. */
const firstFree = (taken: ReadonlySet<string>): string => {
	let n = 0;

	while (taken.has(letterAt(n))) {
		n += 1;
	}

	return letterAt(n);
};

/**
 * The letter a new line takes: the first no line shown in these trees has. Unlike a tint, a
 * letter never goes round again, so a seventh pipe repeats a color and never a letter, and a
 * closed pipe's letter is free for the next.
 */
export const freeLetter = (trees: readonly LayoutTree[]): string =>
	firstFree(new Set([...linesIn(trees).values()].map((line) => line.letter)));

/**
 * A kept tree with a letter on every line. A desk kept before pipes had letters, or sent by a
 * host from before them, has none on its lines: each such line takes the first letter free in its
 * tree, in reading order, so that desk still reads back whole and is never refused for it. A line
 * that has a letter keeps it, and every tile of one line gets the same one.
 *
 *   withLetters(tree)  // lines tracker:1 (no letter) and tracker:5 ("A"): tracker:1 gets "B"
 */
export const withLetters = (kept: LayoutTree<KeptLine>): LayoutTree => {
	const taken = new Set<string>();
	const note = (node: LayoutNode<KeptLine>): void => {
		if (node.tag === "container") {
			node.children.forEach(note);
		} else if (node.shows.kind !== "tsh" && node.shows.line.letter !== undefined) {
			taken.add(node.shows.line.letter);
		}
	};
	note(kept.root);
	const given = new Map<string, string>();
	const letterOf = (line: KeptLine): string => {
		const letter = line.letter ?? given.get(line.id) ?? firstFree(taken);
		taken.add(letter);
		given.set(line.id, letter);
		return letter;
	};
	const shows = (s: Shows<KeptLine>): Shows =>
		s.kind === "tsh" ? s : {...s, line: {...s.line, letter: letterOf(s.line)}};
	const lettered = (node: LayoutNode<KeptLine>): LayoutNode =>
		node.tag === "tile"
			? {...node, shows: shows(node.shows)}
			: {...node, children: node.children.map(lettered)};
	return {root: {...kept.root, children: kept.root.children.map(lettered)}, zoomed: kept.zoomed};
};
