import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {extents, freeLetter, freeTint, linesIn, type Opening, openLine, quiet} from "./line.ts";
import {
	createContainer,
	createTile,
	createTree,
	type LayoutTree,
	type Line,
	TINTS,
	TSH,
} from "./node.ts";
import {findTile, fold, remove, setShows, tiles, unfold} from "./tree.ts";

// A line opens in place (line.ts): the tree's split rule for many tiles, folds when tight, and
// what a desk kept with a line in it comes back as.

const tracker = {id: "tracker:1", program: "tracker"};
const ticket = {id: "ticket:1", program: "ticket"};
const trace = {id: "trace:1", program: "trace"};

/** a beside b, in a row. */
const row = (): LayoutTree =>
	createTree(createContainer("c1", "horizontal", [createTile("a"), createTile("b")]));

const opening = (over: Partial<Opening> = {}): Opening => ({
	runs: [tracker, ticket, trace],
	tint: 2,
	letter: "A",
	orientation: "horizontal",
	ids: {tiles: ["t4", "t5"], container: "c4"},
	area: {width: 1440, height: 860},
	...over,
});

const ids = (tree: LayoutTree) => [...tiles(tree.root)].map((t) => t.id);

describe("openLine", () => {
	it("covers the tile with a run alone, as a run always did: no line, no tint", () => {
		const tree = openLine(row(), "b", opening({runs: [tracker]}));
		expect(ids(tree)).toEqual(["a", "b"]);
		expect(findTile(tree, "b")?.shows).toEqual({kind: "tsh", run: tracker});
	});

	it("puts every window in the tile's place, sharing its space evenly, and keeps the tree whole", () => {
		const tree = openLine(row(), "b", opening());
		const line: Line = {id: "tracker:1", from: "b", tint: 2, letter: "A"};
		expect(ids(tree)).toEqual(["a", "b", "t4", "t5"]);
		expect(findTile(tree, "b")?.shows).toEqual({kind: "line", run: tracker, line});
		expect(findTile(tree, "t5")?.shows).toEqual({kind: "window", run: trace, line});
		expect(tree.root.sizes.a).toBeCloseTo(50);
		expect(tree.root.sizes.t4).toBeCloseTo(50 / 3);
		expect(checkTree(tree)).toEqual([]);
	});

	it("opens every window when no page has said its size", () => {
		const tree = openLine(row(), "b", opening({area: null}));
		expect([...tiles(tree.root)].some((t) => t.folded)).toBe(false);
	});

	it("refuses a window tile, an unknown tile, too few ids and taken ones", () => {
		const opened = openLine(row(), "b", opening());
		expect(openLine(opened, "t4", opening({ids: {tiles: ["t8", "t9"], container: "c8"}}))).toBe(
			opened,
		);
		expect(openLine(row(), "nope", opening())).toEqual(row());
		const short = row();
		expect(openLine(short, "b", opening({ids: {tiles: ["t4"], container: "c4"}}))).toBe(short);
		const taken = row();
		expect(openLine(taken, "b", opening({ids: {tiles: ["a", "t5"], container: "c4"}}))).toBe(taken);
	});

	it("opens the first window open even on a folded tile, and the rest folded when tight", () => {
		const folded = fold(row(), "b");
		const tree = openLine(folded, "b", opening({area: {width: 600, height: 400}}));
		expect(findTile(tree, "b")?.folded).toBe(false);
		expect(findTile(tree, "t4")?.folded).toBe(true);
		expect(findTile(tree, "t5")?.folded).toBe(true);
		expect(checkTree(tree)).toEqual([]);
	});

	it("keeps the line's total while its windows fold and open in any order", () => {
		let tree = openLine(row(), "b", opening());
		for (const step of [
			(t: LayoutTree) => fold(t, "t4"),
			(t: LayoutTree) => fold(t, "b"),
			(t: LayoutTree) => unfold(t, "t4"),
			(t: LayoutTree) => fold(t, "t5"),
			(t: LayoutTree) => unfold(t, "b"),
			(t: LayoutTree) => unfold(t, "t5"),
		]) {
			tree = step(tree);
			expect(tree.root.sizes.a).toBeCloseTo(50);
			expect(checkTree(tree)).toEqual([]);
		}
	});
});

describe("extents", () => {
	it("lays a row out as the page does: strips and borders first, the rest by share", () => {
		const tree = fold(openLine(row(), "b", opening()), "t5");
		const sizes = extents(tree, {width: 1000, height: 500});
		// 1000 less one strip (26) and two borders (8): 966, half to a, a quarter each to b and t4.
		expect(sizes.get("a")?.width).toBeCloseTo(483);
		expect(sizes.get("b")?.width).toBeCloseTo(241.5);
		expect(sizes.get("t5")).toBeUndefined();
		expect(sizes.get("a")?.height).toBe(500);
	});
});

describe("quiet", () => {
	it("takes every window away and gives the tile its whole share back", () => {
		const tree = quiet(fold(openLine(row(), "b", opening()), "t4"));
		expect(ids(tree)).toEqual(["a", "b"]);
		expect(tree.root.sizes.b).toBeCloseTo(50);
		expect(findTile(tree, "b")?.shows).toEqual({kind: "tsh", run: null});
	});

	it("keeps a window left alone, as a tile with its own tsh", () => {
		const alone = remove(remove(openLine(row(), "b", opening()), "a"), "b");
		const tree = quiet(remove(alone, "t5"));
		expect(ids(tree)).toEqual(["t4"]);
		expect(findTile(tree, "t4")?.shows).toEqual({kind: "tsh", run: null});
	});
});

describe("freeTint", () => {
	it("takes the first tint no line has", () => {
		expect(freeTint([row()])).toBe(0);
		const two = openLine(row(), "b", opening({tint: 0}));
		expect(freeTint([two])).toBe(1);
	});
});

// A pipe's letter (pipe-colors.md): the second cue, so color is never the only one. It is kept on
// the line, not worked out from reading order, so closing pipe A never renames B while a person
// looks at it. Counted per workspace, as the colors are: these are one workspace's trees.

/** Tiles a0 to a9 in a row, each with its own tsh to type a pipe in. */
const ten = (): LayoutTree =>
	createTree(
		createContainer(
			"c1",
			"horizontal",
			Array.from({length: 10}, (_, i) => createTile(`a${i}`)),
		),
	);

/** Open a pipe of two in tile `at`, with the first free color and letter, as the desk does. */
const openPipe = (tree: LayoutTree, at: string, n: number): LayoutTree =>
	openLine(tree, at, {
		runs: [
			{id: `p${n}:1`, program: "tracker"},
			{id: `p${n}:2`, program: "ticket"},
		],
		tint: freeTint([tree]),
		letter: freeLetter([tree]),
		orientation: "horizontal",
		ids: {tiles: [`w${n}`], container: `c${n + 2}`},
		area: null,
	});

/** Close the pipe typed in tile `at`: its window goes, and the tile shows its tsh again. */
const closePipe = (tree: LayoutTree, at: string): LayoutTree => {
	const line = findTile(tree, at)?.shows;
	if (line === undefined || line.kind !== "line") return tree;
	const windows = [...tiles(tree.root)].filter(
		(t) => t.shows.kind === "window" && t.shows.line.id === line.line.id,
	);
	return setShows(
		windows.reduce((layout, t) => remove(layout, t.id), tree),
		at,
		TSH,
	);
};

const lettersOf = (tree: LayoutTree) => [...linesIn([tree]).values()].map((l) => l.letter);
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("freeLetter", () => {
	it("takes A when no pipe is open, then the first letter no pipe has", () => {
		expect(freeLetter([row()])).toBe("A");
		const one = openLine(row(), "b", opening({letter: "A"}));
		expect(freeLetter([one])).toBe("B");
	});

	it("gives seven pipes in one workspace seven letters, and the seventh repeats a color", () => {
		let tree = ten();
		for (let n = 0; n < 7; n += 1) tree = openPipe(tree, `a${n}`, n);
		const lines = [...linesIn([tree]).values()];
		expect(lines.map((l) => l.letter)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
		expect(lines.map((l) => l.tint)).toEqual([...TINTS, TINTS[0]]);
	});

	it("frees a closed pipe's letter, and keeps every other pipe's", () => {
		let tree = ten();
		for (let n = 0; n < 3; n += 1) tree = openPipe(tree, `a${n}`, n);
		tree = closePipe(tree, "a0");
		expect(lettersOf(tree).sort()).toEqual(["B", "C"]);
		expect(freeLetter([tree])).toBe("A");
		tree = openPipe(tree, "a3", 3);
		expect(lettersOf(tree).sort()).toEqual(["A", "B", "C"]);
	});

	it("never gives two open pipes one letter, whatever opens and closes", () => {
		const step = fc.record({open: fc.boolean(), at: fc.nat({max: 9})});
		fc.assert(
			fc.property(fc.array(step, {maxLength: 40}), (steps) => {
				let tree = ten();
				for (const [n, {open, at}] of steps.entries()) {
					const before = new Set(lettersOf(tree));
					const tile = findTile(tree, `a${at}`);
					if (open && tile?.shows.kind === "tsh") {
						tree = openPipe(tree, `a${at}`, n);
						const first = [...ABC].find((l) => !before.has(l));
						const shown = findTile(tree, `a${at}`)?.shows;
						if (shown?.kind !== "line" || shown.line.letter !== first) return false;
					} else if (!open) tree = closePipe(tree, `a${at}`);
					const letters = lettersOf(tree);
					if (new Set(letters).size !== letters.length) return false;
				}
				return checkTree(tree).length === 0;
			}),
			{seed: 119120, numRuns: 200},
		);
	});
});
