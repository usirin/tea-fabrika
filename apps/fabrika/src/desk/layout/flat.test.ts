import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Box, flat, inPx, WHOLE} from "./flat.ts";
import {BORDER, extents, STRIP} from "./line.ts";
import {
	createContainer,
	createTile,
	createTree,
	type LayoutTree,
	type Orientation,
} from "./node.ts";
import {fold, split, tiles, turn} from "./tree.ts";

const rect = (box: Box, w: number, h: number) => ({
	left: inPx(box.x, w),
	top: inPx(box.y, h),
	width: inPx(box.w, w),
	height: inPx(box.h, h),
});

const AREA = {width: 1200, height: 800};
/** Room for any tree the law builds: `extents` stops at nothing left, a calc() goes on below it. */
const ROOMY = {width: 200_000, height: 200_000};

const two = createTree(createContainer("c1", "horizontal", [createTile("t1"), createTile("t2")]));

describe("flat", () => {
	it("gives two tiles side by side the row, less the border between them", () => {
		const got = flat(two);
		const [a, b] = got.tiles.map((t) => rect(t.box, AREA.width, AREA.height));
		expect(a).toEqual({left: 0, top: 0, width: 598, height: 800});
		expect(b).toEqual({left: 602, top: 0, width: 598, height: 800});
		expect(got.borders.map((x) => [x.a, x.b])).toEqual([["t1", "t2"]]);
	});

	it("puts a strip in its place, at its fixed size, and the open tiles share the rest", () => {
		const folded = fold(two, "t1");
		const got = flat(folded);
		expect(got.strips.map((s) => s.node.id)).toEqual(["t1"]);
		expect(rect(got.strips[0]?.box ?? WHOLE, AREA.width, AREA.height).width).toBe(
			STRIP.horizontal - 4,
		);
		expect(rect(got.tiles[0]?.box ?? WHOLE, AREA.width, AREA.height)).toEqual({
			left: STRIP.horizontal,
			top: 0,
			width: AREA.width - STRIP.horizontal,
			height: 800,
		});
		expect(got.borders).toEqual([]);
	});

	it("draws a zoomed tile alone, over all of it", () => {
		const got = flat({...two, zoomed: "t2"});
		expect(got.tiles.map((t) => [t.tile.id, t.box])).toEqual([["t2", WHOLE]]);
		expect(got.strips).toEqual([]);
		expect(got.borders).toEqual([]);
	});

	it("draws a container being dragged at the sizes of the drag", () => {
		const got = flat(two, {container: "c1", sizes: {t1: 25, t2: 75}});
		const width = (AREA.width - BORDER) * 0.25;
		expect(rect(got.tiles[0]?.box ?? WHOLE, AREA.width, AREA.height).width).toBe(width);
	});

	it("keeps the tiles in id order, numbers as numbers, whatever the tree's order", () => {
		const tree = createTree(
			createContainer("c1", "vertical", [createTile("t10"), createTile("t2"), createTile("t1")]),
		);
		expect(flat(tree).tiles.map((t) => t.tile.id)).toEqual(["t1", "t2", "t10"]);
	});
});

// The law that keeps this honest: on any tree a person can make, each open tile has one box, at
// the size the desk's own arithmetic says (extents), and no two tiles overlap.
const step = fc.record({
	at: fc.nat(40),
	kind: fc.constantFrom("split", "split", "turn", "fold"),
	orientation: fc.constantFrom<Orientation>("horizontal", "vertical"),
});

const build = (steps: readonly {at: number; kind: string; orientation: Orientation}[]) => {
	let tree: LayoutTree = createTree(createContainer("c1", "horizontal", [createTile("t1")]));
	let next = 2;
	for (const s of steps) {
		const all = [...tiles(tree.root)];
		const id = all[s.at % all.length]?.id ?? "t1";
		if (s.kind === "split") {
			tree = split(tree, id, s.orientation, {tile: `t${next}`, container: `c${next}`});
			next += 1;
		} else if (s.kind === "turn") tree = turn(tree, id);
		else tree = fold(tree, id);
	}
	return tree;
};

describe("flat, on any tree", () => {
	it("draws each open tile once, at the size extents says, overlapping none", () => {
		fc.assert(
			fc.property(fc.array(step, {maxLength: 14}), (steps) => {
				const tree = build(steps);
				const got = flat(tree);
				const open = [...tiles(tree.root)].filter((t) => !t.folded).map((t) => t.id);
				expect(got.tiles.map((t) => t.tile.id).sort()).toEqual([...open].sort());
				const sizes = extents(tree, ROOMY);
				const rects = got.tiles.map((t) => ({
					id: t.tile.id,
					...rect(t.box, ROOMY.width, ROOMY.height),
				}));
				for (const r of rects) {
					const want = sizes.get(r.id);
					expect(r.width).toBeCloseTo(want?.width ?? -1, 6);
					expect(r.height).toBeCloseTo(want?.height ?? -1, 6);
				}
				for (const a of rects)
					for (const b of rects) {
						if (a.id >= b.id) continue;
						const apart =
							a.left + a.width <= b.left + 1e-6 ||
							b.left + b.width <= a.left + 1e-6 ||
							a.top + a.height <= b.top + 1e-6 ||
							b.top + b.height <= a.top + 1e-6;
						expect(apart).toBe(true);
					}
			}),
		);
	});
});
