import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {
	type ContainerNode,
	createContainer,
	createTile,
	createTree,
	isContainerNode,
	isFolded,
	isLayoutTree,
	isTileNode,
	type LayoutTree,
	openShares,
} from "./node.ts";
import {
	find,
	findChildTile,
	findContainer,
	findSibling,
	findTile,
	fold,
	layoutSignature,
	remove,
	resize,
	setShows,
	settle,
	split,
	turn,
	unfold,
	unzoom,
	zoom,
} from "./tree.ts";

// Ported from Tuval's layout tests (kamp-us/phoenix, apps/tuval/src/shell/layout/tree.unit.test.ts).

const ids = (tile: string, container: string) => ({tile, container});

/** root(horizontal)[a, s(vertical)[b, c]]: one row whose right half is a column. */
const threeTiles = () =>
	createTree(
		createContainer("root", "horizontal", [
			createTile("a"),
			createContainer("s", "vertical", [createTile("b"), createTile("c")]),
		]),
	);

describe("layout.find", () => {
	it("reaches a later sibling that follows a nested container", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [
				createContainer("s", "vertical", [createTile("a"), createTile("b")]),
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
	it("turns a single-child container instead of nesting one", () => {
		const tree = createTree(createContainer("root", "horizontal", [createTile("a")]));

		const next = split(tree, "a", "vertical", ids("a2", "s1"));

		expect(next.root.orientation).toBe("vertical");
		expect(next.root.children.map((child) => child.id)).toEqual(["a", "a2"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("nests a container when the orientation differs and the parent holds siblings", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b")]),
		);

		const next = split(tree, "a", "vertical", ids("a2", "s1"));
		const nested = next.root.children[0];

		expect(nested?.tag).toBe("container");
		expect(nested?.id).toBe("s1");
		expect(next.root.orientation).toBe("horizontal");
		expect(checkTree(next)).toEqual([]);
	});

	it("adds in place when the orientation already matches", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b")]),
		);

		const next = split(tree, "a", "horizontal", ids("a2", "s1"));

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "a2", "b"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("adds to a nested column when the split runs down it, so containers never repeat a direction", () => {
		const next = split(threeTiles(), "b", "vertical", ids("d", "s2"));

		expect(findContainer(next, "s")?.children.map((child) => child.id)).toEqual(["b", "d", "c"]);
		expect(findContainer(next, "s2")).toBeNull();
		expect(checkTree(next)).toEqual([]);
	});

	it("gives the new tile half the split tile's share", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b")], {a: 60, b: 40}),
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

	it("puts a fresh tsh in the new tile, open", () => {
		const next = split(threeTiles(), "a", "horizontal", ids("d", "s2"));

		expect(find(next, (tile) => tile.id === "d")).toEqual(createTile("d"));
	});
});

describe("layout.remove", () => {
	it("drops an emptied container", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [
				createTile("a"),
				createContainer("s", "vertical", [createTile("b")]),
			]),
		);

		const next = remove(tree, "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("replaces a container left holding one child with that child", () => {
		const next = remove(threeTiles(), "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "c"]);
		expect(checkTree(next)).toEqual([]);
	});

	it("hands a lone container's children to the parent of its direction, with their shares", () => {
		// root(h)[a 50, s(v)[b 50, t(h)[c 40, d 60] 50] 50]: b goes, and t's c and d join root's row.
		const tree = createTree(
			createContainer("root", "horizontal", [
				createTile("a"),
				createContainer("s", "vertical", [
					createTile("b"),
					createContainer("t", "horizontal", [createTile("c"), createTile("d")], {c: 40, d: 60}),
				]),
			]),
		);

		const next = remove(tree, "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "c", "d"]);
		expect(next.root.sizes.a).toBeCloseTo(50, 5);
		expect(next.root.sizes.c).toBeCloseTo(20, 5);
		expect(next.root.sizes.d).toBeCloseTo(30, 5);
		expect(checkTree(next)).toEqual([]);
	});

	it("hands the removed tile's share to the sibling it sat against", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b"), createTile("c")], {
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
		const tree = createTree(createContainer("root", "horizontal", [createTile("a")]));

		expect(remove(tree, "a")).toBe(tree);
	});

	it("clears a zoom on the tile it removes", () => {
		const zoomed = zoom(threeTiles(), "b");

		expect(remove(zoomed, "b").zoomed).toBeNull();
		expect(remove(zoomed, "c").zoomed).toBe("b");
	});

	it("opens a folded tile when the last open one goes, so a workspace is never only strips", () => {
		const folded = fold(fold(threeTiles(), "b"), "c");

		const next = remove(folded, "a");

		expect(isFolded(next.root)).toBe(false);
		expect(findTile(next, "b")?.folded).toBe(false);
		expect(checkTree(next)).toEqual([]);
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

	it("climbs past an ancestor laid out along the other direction", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [
				createTile("a"),
				createContainer("s", "vertical", [
					createContainer("t", "horizontal", [createTile("b"), createTile("c")]),
					createTile("d"),
				]),
			]),
		);

		expect(findSibling(tree, "c", "down")?.id).toBe("d");
		expect(findSibling(tree, "b", "left")?.id).toBe("a");
	});

	it("lands on a folded tile as on any other", () => {
		expect(findSibling(fold(threeTiles(), "b"), "a", "right")?.id).toBe("b");
	});

	it("answers null for a tile the tree does not hold", () => {
		expect(findSibling(threeTiles(), "nope", "left")).toBeNull();
	});
});

describe("layout.findChildTile", () => {
	it("reads the tile at each end of a node's subtree", () => {
		const tree = threeTiles();

		expect(findChildTile(tree, "root", "start")?.id).toBe("a");
		expect(findChildTile(tree, "root", "end")?.id).toBe("c");
		expect(findChildTile(tree, "s", "start")?.id).toBe("b");
		expect(findChildTile(tree, "c", "start")?.id).toBe("c");
		expect(findChildTile(tree, "nope", "start")).toBeNull();
	});
});

describe("layout.turn", () => {
	it("turns the container holding a tile to the other orientation, keeping its sizes", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b")], {a: 70, b: 30}),
		);

		const once = turn(tree, "b");

		expect(once.root.orientation).toBe("vertical");
		expect(once.root.sizes).toEqual({a: 70, b: 30});
		expect(turn(once, "b")).toEqual(tree);
	});

	it("hands a container turned to its parent's orientation over to the parent, as AeroSpace does", () => {
		const next = turn(threeTiles(), "b");

		expect(next.root.children.map((child) => child.id)).toEqual(["a", "b", "c"]);
		expect(next.root.sizes.b).toBeCloseTo(25, 5);
		expect(checkTree(next)).toEqual([]);
	});
});

describe("layout.fold", () => {
	it("folds a tile in its place and keeps its share for when it opens", () => {
		const tree = threeTiles();

		const folded = fold(tree, "b");

		expect(findTile(folded, "b")?.folded).toBe(true);
		expect(findContainer(folded, "s")?.sizes).toEqual(findContainer(tree, "s")?.sizes);
		expect(isFolded(findContainer(folded, "s") ?? folded.root)).toBe(false);
		expect(unfold(folded, "b")).toEqual(tree);
		expect(checkTree(folded)).toEqual([]);
	});

	it("counts a container folded when every tile in it is, and a click on it opens them all", () => {
		const column = fold(fold(threeTiles(), "b"), "c");
		const s = findContainer(column, "s");

		expect(s === null ? null : isFolded(s)).toBe(true);
		expect(isFolded(column.root)).toBe(false);
		expect(unfold(column, "s")).toEqual(threeTiles());
	});

	it("gives the open children the space the strips leave, in their own proportions", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [createTile("a"), createTile("b"), createTile("c")], {
				a: 20,
				b: 30,
				c: 50,
			}),
		);

		const shares = openShares(fold(tree, "c").root);

		expect(shares.a).toBeCloseTo(0.4, 5);
		expect(shares.b).toBeCloseTo(0.6, 5);
		expect(shares.c).toBeUndefined();
	});

	it("refuses the last open tile, a folded tile and an unknown one", () => {
		const two = fold(fold(threeTiles(), "b"), "c");

		expect(fold(two, "a")).toBe(two);
		expect(fold(two, "b")).toBe(two);
		expect(fold(two, "nope")).toBe(two);
		const lone = createTree(createContainer("root", "horizontal", [createTile("a")]));
		expect(fold(lone, "a")).toBe(lone);
	});

	it("clears a zoom on the tile it folds, and keeps the fold through a run covering the tile", () => {
		const folded = fold(zoom(threeTiles(), "b"), "b");

		expect(folded.zoomed).toBeNull();
		const covered = setShows(folded, "b", {
			kind: "tsh",
			run: {id: "counter:1", program: "counter"},
		});
		expect(findTile(covered, "b")?.folded).toBe(true);
	});

	it("unfolds nothing for an open node or an unknown one", () => {
		const tree = threeTiles();

		expect(unfold(tree, "s")).toBe(tree);
		expect(unfold(tree, "nope")).toBe(tree);
	});
});

describe("layout.settle", () => {
	it("flattens a nested container of its parent's orientation and a container of one child", () => {
		const raw = createContainer("root", "horizontal", [
			createTile("a"),
			createContainer("s", "horizontal", [createTile("b"), createTile("c")], {b: 25, c: 75}),
			createContainer("t", "vertical", [createTile("d")]),
		]);

		const settled = settle(raw);

		expect(settled.children.map((child) => child.id)).toEqual(["a", "b", "c", "d"]);
		expect(settled.sizes.b).toBeCloseTo(100 / 12, 5);
		expect(settled.sizes.c).toBeCloseTo(25, 5);
		expect(checkTree(createTree(settled))).toEqual([]);
	});

	it("leaves a tree in normal form as it is, in shape and sizes", () => {
		expect(settle(threeTiles().root)).toEqual(threeTiles().root);
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
			folded: false,
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
		const tree = fold(threeTiles(), "b");
		const back = readBack(tree);

		expect(back).not.toBe(tree);
		expect(layoutSignature(back)).toBe(layoutSignature(tree));
		expect(isLayoutTree(back)).toBe(true);
	});

	it("changes on a split, a close, a resize, a zoom, a fold, a reorder and a run covering a tile", () => {
		const tree = threeTiles();
		const base = layoutSignature(tree);

		expect(layoutSignature(split(tree, "a", "vertical", ids("d", "s2")))).not.toBe(base);
		expect(layoutSignature(remove(tree, "b"))).not.toBe(base);
		expect(layoutSignature(resize(tree, "root", {a: 70, s: 30}))).not.toBe(base);
		expect(layoutSignature(zoom(tree, "a"))).not.toBe(base);
		expect(layoutSignature(fold(tree, "a"))).not.toBe(base);
		expect(
			layoutSignature(
				setShows(tree, "a", {kind: "tsh", run: {id: "counter:1", program: "counter"}}),
			),
		).not.toBe(base);
		expect(
			layoutSignature(
				createTree(
					createContainer("root", "horizontal", [
						createContainer("s", "vertical", [createTile("b"), createTile("c")]),
						createTile("a"),
					]),
				),
			),
		).not.toBe(base);
	});
});

describe("layout.checkTree", () => {
	it("names a container, not the root, holding one child, and lets the root hold one", () => {
		const tree = createTree({
			tag: "container",
			id: "root",
			orientation: "horizontal",
			children: [
				{
					tag: "container",
					id: "s",
					orientation: "vertical",
					children: [createTile("a")],
					sizes: {a: 100},
				},
			],
			sizes: {s: 100},
		});

		expect(checkTree(tree)).toEqual([{kind: "redundant-container", id: "s"}]);
	});

	it("names an empty container, an unknown size key and a missing zoomed tile", () => {
		const tree = createTree(
			{
				tag: "container",
				id: "root",
				orientation: "horizontal",
				children: [
					createTile("a"),
					{tag: "container", id: "s", orientation: "vertical", children: [], sizes: {}},
				],
				sizes: {a: 50, s: 50, ghost: 0},
			},
			"nope",
		);

		expect(checkTree(tree)).toEqual([
			{kind: "sizes-key-unknown", container: "root", id: "ghost"},
			{kind: "empty-container", id: "s"},
			{kind: "zoomed-tile-missing", id: "nope"},
		]);
	});

	it("names a container nested in one of its own orientation", () => {
		const tree = createTree(
			createContainer("root", "vertical", [
				createTile("a"),
				createContainer("s", "vertical", [createTile("b"), createTile("c")]),
			]),
		);

		expect(checkTree(tree)).toEqual([{kind: "same-orientation", id: "s", parent: "root"}]);
	});

	it("names a tree whose every tile is folded", () => {
		const tree = createTree(
			createContainer("root", "horizontal", [
				createTile("a", undefined, true),
				createTile("b", undefined, true),
			]),
		);

		expect(checkTree(tree)).toEqual([{kind: "all-folded"}]);
	});
});

describe("layout guards", () => {
	it("reads a tile only with its fold, and a container only by its new name and two orientations", () => {
		const container = createContainer("s", "vertical", [createTile("a")]);

		expect(isTileNode({tag: "tile", id: "a", shows: {kind: "tsh", run: null}})).toBe(false);
		expect(isContainerNode(container)).toBe(true);
		expect(isContainerNode({...container, tag: "stack"})).toBe(false);
		expect(isContainerNode({...container, orientation: "tabbed"})).toBe(false);
	});
});

const sum = (container: ContainerNode) =>
	Object.values(container.sizes).reduce((total, value) => total + value, 0);
