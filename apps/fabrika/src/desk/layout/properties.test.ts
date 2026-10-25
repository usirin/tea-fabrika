import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {
	createStack,
	createTile,
	createTree,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type Orientation,
	type StackId,
	type StackNode,
} from "./node.ts";
import {findSibling, remove, resize, split, tiles} from "./tree.ts";

// Ported from Tuval's layout properties (kamp-us/phoenix,
// apps/tuval/src/shell/layout/properties.unit.test.ts), on fast-check.

interface SplitStep {
	readonly at: number;
	readonly orientation: Orientation;
}

const orientation = fc.constantFrom<Orientation>("horizontal", "vertical");

const splitStep = fc.record({at: fc.nat(), orientation});

const splitSteps = fc.array(splitStep, {maxLength: 12});

const seed = () => createTree(createStack("root", "horizontal", [createTile("t0")]));

function build(steps: readonly SplitStep[]): LayoutTree {
	let tree = seed();
	steps.forEach((step, index) => {
		const open = [...tiles(tree.root)];
		const target = open[step.at % open.length];
		if (!target) return;
		tree = split(tree, target.id, step.orientation, {
			tile: `t${index + 1}`,
			stack: `s${index + 1}`,
		});
	});
	return tree;
}

const trees = splitSteps.map(build);

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
 * A stack holding one child is drawn the same whichever orientation it has, so `split`'s turn of a
 * single-child stack cannot be seen and `remove` cannot restore it. Shares compare to 6 decimals:
 * the scaling in `resolveSizes` is float arithmetic.
 */
function normalise(node: LayoutNode): LayoutNode {
	if (node.tag === "tile") return node;
	const sizes: Record<string, number> = {};
	for (const [id, value] of Object.entries(node.sizes)) {
		sizes[id] = Number(value.toFixed(6));
	}
	return {
		...node,
		orientation: node.children.length === 1 ? "horizontal" : node.orientation,
		children: node.children.map(normalise),
		sizes,
	};
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
});
