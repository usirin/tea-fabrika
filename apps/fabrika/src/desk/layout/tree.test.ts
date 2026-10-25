import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {createStack, createTile, createTree, type LayoutTree, type StackNode} from "./node.ts";
import {
	find,
	findChildTile,
	findSibling,
	layoutSignature,
	remove,
	resize,
	setShows,
	split,
	unzoom,
	zoom,
} from "./tree.ts";

// Ported from Tuval's layout tests (kamp-us/phoenix, apps/tuval/src/shell/layout/tree.unit.test.ts).

const ids = (tile: string, stack: string) => ({tile, stack});

/** root(horizontal)[a, s(vertical)[b, c]]: one row whose right half is a column. */
const threeTiles = () =>
	createTree(
		createStack("root", "horizontal", [
			createTile("a"),
			createStack("s", "vertical", [createTile("b"), createTile("c")]),
		]),
	);

describe("layout.find", () => {
	it("reaches a later sibling that follows a nested stack", () => {
		const tree = createTree(
			createStack("root", "horizontal", [
				createStack("s", "vertical", [createTile("a"), createTile("b")]),
				createTile("target"),
			]),
		);

		expect(find(tree, (tile) => tile.id === "target")?.id).toBe("target");
	});

	it("walks every tile in reading order", () => {
		const seen: string[] = [];
		find(threeTiles(), (tile) => {
			seen.push(tile.id);
			return false;
		});

		expect(seen).toEqual(["a", "b", "c"]);
	});
});

describe("layout.split", () => {
	it("turns a single-child stack instead of nesting one", () => {
		const tree = createTree(createStack("root", "horizontal", [createTile("a")]));

		const next = split(tree, "a", "vertical", ids("a2", "s1"));

		expect(next.root.orientation).toBe("vertical");
		expect(next.root.children.map((child) => child.id)).toEqual(["a", "a2"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("nests a stack when the orientation differs and the parent holds siblings", () => {
		const tree = createTree(createStack("root", "horizontal", [createTile("a"), createTile("b")]));

		const next = split(tree, "a", "vertical", ids("a2", "s1"));
		const nested = next.root.children[0];

		expect(nested?.tag).toBe("stack");
		expect(nested?.id).toBe("s1");
		expect(next.root.orientation).toBe("horizontal");
		expect(checkTree(next)).toEqual([]);
	});

	it("adds in place when the orientation already matches", () => {
		const tree = createTree(createStack("root", "horizontal", [createTile("a"), createTile("b")]));

		const next = split(tree, "a", "horizontal", ids("a2", "s1"));

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "a2", "b"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("gives the new tile half the split tile's share", () => {
		const tree = createTree(
			createStack("root", "horizontal", [createTile("a"), createTile("b")], {a: 60, b: 40}),
		);

		const next = split(tree, "a", "horizontal", ids("a2", "s1"));

		expect(next.root.sizes.a).toBeCloseTo(30, 5);
		expect(next.root.sizes.a2).toBeCloseTo(30, 5);
		expect(next.root.sizes.b).toBeCloseTo(40, 5);
		expect(sum(next.root)).toBeCloseTo(100, 5);
	});

	it("leaves the tree as it is for an unknown tile or a taken id", () => {
		const tree = threeTiles();

		expect(split(tree, "nope", "vertical", ids("x", "y"))).toBe(tree);
		expect(split(tree, "a", "vertical", ids("b", "y"))).toBe(tree);
		expect(split(tree, "a", "vertical", ids("x", "s"))).toBe(tree);
	});

	it("puts a fresh tsh in the new tile", () => {
		const next = split(threeTiles(), "a", "horizontal", ids("d", "s2"));

		expect(find(next, (tile) => tile.id === "d")?.shows).toEqual({kind: "tsh", run: null});
	});
});

describe("layout.remove", () => {
	it("folds an emptied stack into its grandparent", () => {
		const tree = createTree(
			createStack("root", "horizontal", [
				createTile("a"),
				createStack("s", "vertical", [createTile("b")]),
			]),
		);

		const next = remove(tree, "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("replaces a stack left holding one child with that child", () => {
		const next = remove(threeTiles(), "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "c"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("hands the removed tile's share to the sibling it sat against", () => {
		const tree = createTree(
			createStack("root", "horizontal", [createTile("a"), createTile("b"), createTile("c")], {
				a: 20,
				b: 30,
				c: 50,
			}),
		);

		const next = remove(tree, "c");

		expect(next.root.sizes.a).toBeCloseTo(20, 5);
		expect(next.root.sizes.b).toBeCloseTo(80, 5);
		expect(sum(next.root)).toBeCloseTo(100, 5);
	});

	it("refuses to empty the tree", () => {
		const tree = createTree(createStack("root", "horizontal", [createTile("a")]));

		expect(remove(tree, "a")).toBe(tree);
	});

	it("clears a zoom on the tile it removes", () => {
		const zoomed = zoom(threeTiles(), "b");

		expect(remove(zoomed, "b").zoomed).toBeNull();
		expect(remove(zoomed, "c").zoomed).toBe("b");
	});
});

describe("layout.findSibling", () => {
	it("lands where tmux would from every edge of a three-tile layout", () => {
		const tree = threeTiles();
		const move = (from: string, direction: "left" | "right" | "up" | "down") =>
			findSibling(tree, from, direction)?.id ?? null;

		expect(move("a", "right")).toBe("b");
		expect(move("a", "left")).toBeNull();
		expect(move("a", "up")).toBeNull();
		expect(move("a", "down")).toBeNull();

		expect(move("b", "left")).toBe("a");
		expect(move("b", "down")).toBe("c");
		expect(move("b", "up")).toBeNull();
		expect(move("b", "right")).toBeNull();

		expect(move("c", "left")).toBe("a");
		expect(move("c", "up")).toBe("b");
		expect(move("c", "down")).toBeNull();
		expect(move("c", "right")).toBeNull();
	});

	it("climbs past an ancestor laid out along the other axis", () => {
		const tree = createTree(
			createStack("root", "horizontal", [
				createTile("a"),
				createStack("s", "vertical", [
					createStack("t", "horizontal", [createTile("b"), createTile("c")]),
					createTile("d"),
				]),
			]),
		);

		expect(findSibling(tree, "c", "down")?.id).toBe("d");
		expect(findSibling(tree, "b", "left")?.id).toBe("a");
	});

	it("answers null for a tile the tree does not hold", () => {
		expect(findSibling(threeTiles(), "nope", "left")).toBeNull();
	});
});

describe("layout.findChildTile", () => {
	it("reads the tile at each end of a stack's subtree", () => {
		const tree = threeTiles();

		expect(findChildTile(tree, "root", "start")?.id).toBe("a");
		expect(findChildTile(tree, "root", "end")?.id).toBe("c");
		expect(findChildTile(tree, "s", "start")?.id).toBe("b");
		expect(findChildTile(tree, "nope", "start")).toBeNull();
	});
});

describe("layout.zoom", () => {
	it("never writes sizes", () => {
		const tree = threeTiles();

		const zoomed = zoom(tree, "b");

		expect(zoomed.zoomed).toBe("b");
		expect(zoomed.root).toBe(tree.root);
		expect(unzoom(zoomed)).toEqual(tree);
	});

	it("ignores a tile the tree does not hold", () => {
		const tree = threeTiles();

		expect(zoom(tree, "nope")).toBe(tree);
	});
});

describe("layout.setShows", () => {
	it("covers a tile's tsh with a run and takes it off again, touching nothing else", () => {
		const run = {id: "counter:1", program: "counter"};
		const covered = setShows(threeTiles(), "b", {kind: "tsh", run});

		expect(find(covered, (tile) => tile.id === "b")).toEqual({
			tag: "tile",
			id: "b",
			shows: {kind: "tsh", run},
		});
		expect(covered.root.children[0]).toEqual(createTile("a"));
		expect(
			find(setShows(covered, "b", {kind: "tsh", run: null}), (t) => t.id === "b")?.shows,
		).toEqual({kind: "tsh", run: null});
	});
});

describe("layout.layoutSignature", () => {
	/** A layout as it comes back from disk, where every object is new whatever the tree says. */
	const readBack = (tree: LayoutTree): LayoutTree => JSON.parse(JSON.stringify(tree));

	it("is equal for a tree and the same tree read back, which identity is not", () => {
		const tree = threeTiles();
		const back = readBack(tree);

		expect(back).not.toBe(tree);
		expect(layoutSignature(back)).toBe(layoutSignature(tree));
	});

	it("changes on a split, a close, a resize, a zoom, a reorder and a run covering a tile", () => {
		const tree = threeTiles();
		const base = layoutSignature(tree);

		expect(layoutSignature(split(tree, "a", "vertical", ids("d", "s2")))).not.toBe(base);
		expect(layoutSignature(remove(tree, "b"))).not.toBe(base);
		expect(layoutSignature(resize(tree, "root", {a: 70, s: 30}))).not.toBe(base);
		expect(layoutSignature(zoom(tree, "a"))).not.toBe(base);
		expect(
			layoutSignature(
				setShows(tree, "a", {kind: "tsh", run: {id: "counter:1", program: "counter"}}),
			),
		).not.toBe(base);
		expect(
			layoutSignature(
				createTree(
					createStack("root", "horizontal", [
						createStack("s", "vertical", [createTile("b"), createTile("c")]),
						createTile("a"),
					]),
				),
			),
		).not.toBe(base);
	});
});

describe("layout.checkTree", () => {
	it("names a stack, not the root, holding one child, and lets the root hold one", () => {
		const tree = createTree({
			tag: "stack",
			id: "root",
			orientation: "horizontal",
			children: [
				{
					tag: "stack",
					id: "s",
					orientation: "vertical",
					children: [createTile("a")],
					sizes: {a: 100},
				},
			],
			sizes: {s: 100},
		});

		expect(checkTree(tree)).toEqual([{kind: "redundant-stack", id: "s"}]);
	});

	it("names an empty stack, an unknown size key and a missing zoomed tile", () => {
		const tree = createTree(
			{
				tag: "stack",
				id: "root",
				orientation: "horizontal",
				children: [
					createTile("a"),
					{tag: "stack", id: "s", orientation: "vertical", children: [], sizes: {}},
				],
				sizes: {a: 50, s: 50, ghost: 0},
			},
			"nope",
		);

		expect(checkTree(tree)).toEqual([
			{kind: "sizes-key-unknown", stack: "root", id: "ghost"},
			{kind: "empty-stack", id: "s"},
			{kind: "zoomed-tile-missing", id: "nope"},
		]);
	});
});

const sum = (stack: StackNode) =>
	Object.values(stack.sizes).reduce((total, value) => total + value, 0);
