import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {
	type Axis,
	createStack,
	createTile,
	createTree,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type StackId,
	type StackNode,
	type TileId,
} from "./node.ts";
import {findSibling, findTab, remove, resize, reveal, split, tiles, turn} from "./tree.ts";

// Ported from Tuval's layout properties (kamp-us/phoenix,
// apps/tuval/src/shell/layout/properties.unit.test.ts), on fast-check. The trees are made by
// splits, turns and tab moves, so tabbed stacks are in them too.

/** One step of building a tree, on the tile at `at` (mod the tiles there are). */
type BuildStep =
	| {readonly kind: "split"; readonly at: number; readonly orientation: Axis}
	| {readonly kind: "turn"; readonly at: number}
	| {readonly kind: "tab"; readonly at: number; readonly to: "next" | "previous"};

const orientation = fc.constantFrom<Axis>("horizontal", "vertical");

const splitStep = fc.record({kind: fc.constant("split" as const), at: fc.nat(), orientation});

const buildStep: fc.Arbitrary<BuildStep> = fc.oneof(
	{arbitrary: splitStep, weight: 3},
	{arbitrary: fc.record({kind: fc.constant("turn" as const), at: fc.nat()}), weight: 1},
	{
		arbitrary: fc.record({
			kind: fc.constant("tab" as const),
			at: fc.nat(),
			to: fc.constantFrom("next" as const, "previous" as const),
		}),
		weight: 1,
	},
);

const buildSteps = fc.array(buildStep, {maxLength: 16});

const seed = () => createTree(createStack("root", "horizontal", [createTile("t0")]));

/** A tab move is what the desk does with one: focus lands on a tile, and the tree reveals it. */
function build(steps: readonly BuildStep[]): LayoutTree {
	let tree = seed();
	steps.forEach((step, index) => {
		const open = [...tiles(tree.root)];
		const target = open[step.at % open.length];
		if (!target) return;
		if (step.kind === "split")
			tree = split(tree, target.id, step.orientation, {
				tile: `t${index + 1}`,
				stack: `s${index + 1}`,
			});
		else if (step.kind === "turn") tree = turn(tree, target.id);
		else tree = reveal(tree, findTab(tree, target.id, step.to)?.id ?? target.id);
	});
	return tree;
}

const trees = buildSteps.map(build);

/** A tree and one of its tiles. */
const picks = fc.tuple(trees, fc.nat()).map(([tree, pick]) => {
	const open = [...tiles(tree.root)];
	const tile = open[pick % open.length]?.id ?? "t0";
	return {tree, tile};
});

/** Is `id` drawn: does every tabbed stack above it show the tab that holds it? */
function drawn(node: LayoutNode, id: TileId): boolean | null {
	if (node.tag === "tile") return node.id === id ? true : null;
	for (const child of node.children) {
		const below = drawn(child, id);
		if (below === null) continue;
		return below && (node.orientation !== "tabbed" || node.active === child.id);
	}
	return null;
}

function* stacks(node: LayoutNode): Generator<StackNode> {
	if (node.tag === "tile") return;
	yield node;
	for (const child of node.children) yield* stacks(child);
}

interface Resize {
	readonly tree: LayoutTree;
	readonly stack: StackNode;
	readonly sizes: Readonly<Record<NodeId, number>>;
}

/**
 * A tree, one of its stacks, and a size map keyed by that stack's own child ids: a key naming no
 * child is dropped by `resolveSizes`, so a map of any strings would never reach a named share. At
 * least one split makes sure a stack holds two children.
 */
const resizeOf = (
	draw: (stack: StackNode) => fc.Arbitrary<Readonly<Record<NodeId, number>>>,
): fc.Arbitrary<Resize> =>
	fc
		.array(splitStep, {minLength: 1, maxLength: 12})
		.map(build)
		.chain((tree) =>
			fc
				.constantFrom(...[...stacks(tree.root)].filter((stack) => stack.children.length > 1))
				.chain((stack) => draw(stack).map((sizes) => ({tree, stack, sizes}))),
		);

const childIds = (stack: StackNode): readonly NodeId[] => stack.children.map((child) => child.id);

/** Any subset of the stack's children, each named with any share in `value`'s range. */
const resizes = (value: fc.Arbitrary<number>) =>
	resizeOf((stack) =>
		fc
			.subarray([...childIds(stack)])
			.chain((ids) => fc.tuple(...ids.map((id) => value.map((share) => [id, share] as const))))
			.map((entries) => Object.fromEntries(entries)),
	);

/** A strict, non-empty subset of the children, named with shares that leave room for the rest. */
const partialResizes = resizeOf((stack) =>
	fc
		.subarray([...childIds(stack)], {minLength: 1, maxLength: stack.children.length - 1})
		.chain((ids) =>
			fc.tuple(
				...ids.map((id) =>
					fc
						.double({min: 0, max: 100 / ids.length, noNaN: true})
						.map((share) => [id, share] as const),
				),
			),
		)
		.map((entries) => Object.fromEntries(entries)),
);

/** Every child named, each above 100 on its own, so the map always sums over 100. */
const overfullResizes = resizeOf((stack) =>
	fc
		.tuple(
			...childIds(stack).map((id) =>
				fc.double({min: 101, max: 1000, noNaN: true}).map((share) => [id, share] as const),
			),
		)
		.map((entries) => Object.fromEntries(entries)),
);

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const sizesOf = (tree: LayoutTree, id: StackId): Readonly<Record<NodeId, number>> => {
	const stack = [...stacks(tree.root)].find((candidate) => candidate.id === id);
	if (stack === undefined) throw new Error(`test setup: no stack "${id}"`);
	return stack.sizes;
};

/**
 * A stack holding one child is drawn the same whichever way it is split, so `split`'s turn of a
 * single-child stack cannot be seen and `remove` cannot restore it. A tabbed one adds a strip of
 * one tab, and `split` turns it too, as i3 does: a split never keeps a lone tab. Shares compare to 6
 * decimals: the scaling in `resolveSizes` is float arithmetic.
 */
function normalise(node: LayoutNode): unknown {
	if (node.tag === "tile") return node;
	const sizes: Record<string, number> = {};
	for (const [id, value] of Object.entries(node.sizes)) {
		sizes[id] = Number(value.toFixed(6));
	}
	const children = node.children.map(normalise);
	if (node.children.length === 1) return {tag: "stack", id: node.id, children, sizes};
	return {...node, children, sizes};
}

const same = (left: LayoutTree, right: LayoutTree) =>
	expect(normalise(left.root)).toEqual(normalise(right.root));

describe("layout properties", () => {
	it("keeps every invariant under any sequence of splits", () => {
		fc.assert(
			fc.property(trees, (tree) => {
				expect(checkTree(tree)).toEqual([]);
			}),
		);
	});

	it("keeps every invariant under any removal", () => {
		fc.assert(
			fc.property(trees, fc.nat(), (tree, pick) => {
				const open = [...tiles(tree.root)];
				const target = open[pick % open.length];
				if (!target) return;
				expect(checkTree(remove(tree, target.id))).toEqual([]);
			}),
		);
	});

	it("round-trips a removal after the split that made the tile", () => {
		fc.assert(
			fc.property(trees, fc.nat(), orientation, (tree, pick, splitOrientation) => {
				const open = [...tiles(tree.root)];
				const target = open[pick % open.length];
				if (!target) return;
				const grown = split(tree, target.id, splitOrientation, {tile: "fresh", stack: "nest"});
				same(remove(grown, "fresh"), tree);
			}),
		);
	});

	it("keeps every invariant under any resize of any stack", () => {
		fc.assert(
			fc.property(resizes(fc.double({min: 0, max: 200, noNaN: true})), ({tree, stack, sizes}) => {
				expect(checkTree(resize(tree, stack.id, sizes))).toEqual([]);
			}),
		);
	});

	it("keeps the shares a partial size map names and splits what is left over the rest", () => {
		fc.assert(
			fc.property(partialResizes, ({tree, stack, sizes}) => {
				const resized = sizesOf(resize(tree, stack.id, sizes), stack.id);
				const named = Object.keys(sizes);
				const rest = stack.children.filter((child) => !named.includes(child.id));
				const left = (100 - sum(Object.values(sizes))) / rest.length;
				for (const id of named) expect(resized[id]).toBeCloseTo(sizes[id] ?? Number.NaN, 6);
				for (const child of rest) expect(resized[child.id]).toBeCloseTo(left, 6);
			}),
		);
	});

	it("scales a size map summing over 100 back to 100, keeping its proportions", () => {
		fc.assert(
			fc.property(overfullResizes, ({tree, stack, sizes}) => {
				const total = sum(Object.values(sizes));
				expect(total).toBeGreaterThan(100);
				const resized = sizesOf(resize(tree, stack.id, sizes), stack.id);
				expect(sum(Object.values(resized))).toBeCloseTo(100, 6);
				for (const child of stack.children) {
					expect(resized[child.id]).toBeCloseTo(((sizes[child.id] ?? 0) * 100) / total, 6);
				}
			}),
		);
	});

	it("only ever moves focus to a tile the tree holds", () => {
		fc.assert(
			fc.property(
				trees,
				fc.nat(),
				fc.constantFrom("left" as const, "right" as const, "up" as const, "down" as const),
				(tree, pick, direction) => {
					const open = [...tiles(tree.root)];
					const target = open[pick % open.length];
					if (!target) return;
					const landed = findSibling(tree, target.id, direction);
					if (landed === null) return;
					expect(open.map((tile) => tile.id)).toContain(landed.id);
					expect(landed.id).not.toBe(target.id);
				},
			),
		);
	});

	it("keeps every invariant, a tabbed stack's shown child included, under any removal from a revealed tile", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				expect(checkTree(remove(reveal(tree, tile), tile))).toEqual([]);
			}),
		);
	});

	it("draws a revealed tile, and reveals nothing more when it is drawn already", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				const shown = reveal(tree, tile);
				expect(drawn(shown.root, tile)).toBe(true);
				expect(checkTree(shown)).toEqual([]);
				expect(reveal(shown, tile)).toBe(shown);
			}),
		);
	});

	it("comes back to the same tree, sizes and all, after three turns", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				const shown = reveal(tree, tile);
				const thrice = turn(turn(turn(shown, tile), tile), tile);
				expect(thrice).toEqual(shown);
			}),
		);
	});

	it("keeps a tile drawn through a turn of the stack holding it", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				expect(drawn(turn(reveal(tree, tile), tile).root, tile)).toBe(true);
			}),
		);
	});

	it("moves to a tab only to another tile the tree holds, one that is drawn once revealed", () => {
		fc.assert(
			fc.property(picks, fc.constantFrom("next" as const, "previous" as const), (pick, to) => {
				const tree = reveal(pick.tree, pick.tile);
				const landed = findTab(tree, pick.tile, to);
				if (landed === null) return;
				expect([...tiles(tree.root)].map((t) => t.id)).toContain(landed.id);
				expect(landed.id).not.toBe(pick.tile);
				expect(drawn(reveal(tree, landed.id).root, landed.id)).toBe(true);
			}),
		);
	});
});
