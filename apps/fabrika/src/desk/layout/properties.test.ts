import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checkTree} from "./invariants.ts";
import {
	type ContainerId,
	type ContainerNode,
	createContainer,
	createTile,
	createTree,
	isFolded,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	type Orientation,
	openShares,
} from "./node.ts";
import {findSibling, fold, remove, resize, settle, split, tiles, turn, unfold} from "./tree.ts";

// Ported from Tuval's layout properties (kamp-us/phoenix,
// apps/tuval/src/shell/layout/properties.unit.test.ts), on fast-check. The trees are made by
// splits, turns, folds and unfolds, so folded tiles and folded containers are in them too.

/** One step of building a tree, on the tile at `at` (mod the tiles there are). */
type BuildStep =
	| {readonly kind: "split"; readonly at: number; readonly orientation: Orientation}
	| {readonly kind: "turn"; readonly at: number}
	| {readonly kind: "fold"; readonly at: number}
	| {readonly kind: "unfold"; readonly at: number};

const orientation = fc.constantFrom<Orientation>("horizontal", "vertical");

const splitOf = fc.record({kind: fc.constant("split" as const), at: fc.nat(), orientation});
const onTile = <K extends "turn" | "fold" | "unfold">(kind: K) =>
	fc.record({kind: fc.constant(kind), at: fc.nat()});

const buildStep: fc.Arbitrary<BuildStep> = fc.oneof(
	{arbitrary: splitOf, weight: 4},
	{arbitrary: onTile("turn"), weight: 1},
	{arbitrary: onTile("fold"), weight: 2},
	{arbitrary: onTile("unfold"), weight: 1},
);

const buildSteps = fc.array(buildStep, {maxLength: 16});

const seed = () => createTree(createContainer("root", "horizontal", [createTile("t0")]));

function build(steps: readonly BuildStep[]): LayoutTree {
	let tree = seed();
	steps.forEach((step, index) => {
		const all = [...tiles(tree.root)];
		const target = all[step.at % all.length];
		if (!target) return;
		if (step.kind === "split")
			tree = split(tree, target.id, step.orientation, {
				tile: `t${index + 1}`,
				container: `s${index + 1}`,
			});
		else if (step.kind === "turn") tree = turn(tree, target.id);
		else if (step.kind === "fold") tree = fold(tree, target.id);
		else tree = unfold(tree, target.id);
	});
	return tree;
}

const trees = buildSteps.map(build);

/** A tree and one of its tiles. */
const picks = fc.tuple(trees, fc.nat()).map(([tree, pick]) => {
	const all = [...tiles(tree.root)];
	const tile = all[pick % all.length]?.id ?? "t0";
	return {tree, tile};
});

function* containers(node: LayoutNode): Generator<ContainerNode> {
	if (node.tag === "tile") return;
	yield node;
	for (const child of node.children) yield* containers(child);
}

interface Resize {
	readonly tree: LayoutTree;
	readonly container: ContainerNode;
	readonly sizes: Readonly<Record<NodeId, number>>;
}

/**
 * A tree, one of its containers, and a size map keyed by that container's own child ids: a key
 * naming no child is dropped by `resolveSizes`, so a map of any strings would never reach a named
 * share. At least one split makes sure a container holds two children.
 */
const resizeOf = (
	draw: (container: ContainerNode) => fc.Arbitrary<Readonly<Record<NodeId, number>>>,
): fc.Arbitrary<Resize> =>
	fc
		.array(splitOf, {minLength: 1, maxLength: 12})
		.map(build)
		.chain((tree) =>
			fc
				.constantFrom(...[...containers(tree.root)].filter((c) => c.children.length > 1))
				.chain((container) => draw(container).map((sizes) => ({tree, container, sizes}))),
		);

const childIds = (container: ContainerNode): readonly NodeId[] =>
	container.children.map((child) => child.id);

/** Any subset of the container's children, each named with any share in `value`'s range. */
const resizes = (value: fc.Arbitrary<number>) =>
	resizeOf((container) =>
		fc
			.subarray([...childIds(container)])
			.chain((ids) => fc.tuple(...ids.map((id) => value.map((share) => [id, share] as const))))
			.map((entries) => Object.fromEntries(entries)),
	);

/** A strict, non-empty subset of the children, named with shares that leave room for the rest. */
const partialResizes = resizeOf((container) =>
	fc
		.subarray([...childIds(container)], {minLength: 1, maxLength: container.children.length - 1})
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
const overfullResizes = resizeOf((container) =>
	fc
		.tuple(
			...childIds(container).map((id) =>
				fc.double({min: 101, max: 1000, noNaN: true}).map((share) => [id, share] as const),
			),
		)
		.map((entries) => Object.fromEntries(entries)),
);

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const sizesOf = (tree: LayoutTree, id: ContainerId): Readonly<Record<NodeId, number>> => {
	const container = [...containers(tree.root)].find((candidate) => candidate.id === id);
	if (container === undefined) throw new Error(`test setup: no container "${id}"`);
	return container.sizes;
};

/**
 * A container holding one child is drawn the same whichever way it runs, so `split`'s turn of a
 * single-child container cannot be seen and `remove` cannot restore it. Shares compare to 6
 * decimals: the scaling in `resolveSizes` is float arithmetic.
 */
function normalise(node: LayoutNode): unknown {
	if (node.tag === "tile") return node;
	const sizes: Record<string, number> = {};
	for (const [id, value] of Object.entries(node.sizes)) {
		sizes[id] = Number(value.toFixed(6));
	}
	const children = node.children.map(normalise);
	if (node.children.length === 1) return {tag: "container", id: node.id, children, sizes};
	return {...node, children, sizes};
}

const same = (left: LayoutNode, right: LayoutNode) =>
	expect(normalise(left)).toEqual(normalise(right));

const order = (tree: LayoutTree) => [...tiles(tree.root)].map((tile) => tile.id);

describe("layout properties", () => {
	it("keeps every invariant under any sequence of splits, turns, folds and unfolds", () => {
		fc.assert(
			fc.property(trees, (tree) => {
				expect(checkTree(tree)).toEqual([]);
			}),
		);
	});

	it("keeps every invariant under any removal, the last open tile's included", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				expect(checkTree(remove(tree, tile))).toEqual([]);
			}),
		);
	});

	it("round-trips a removal after the split that made the tile", () => {
		fc.assert(
			fc.property(picks, orientation, ({tree, tile}, splitOrientation) => {
				const grown = split(tree, tile, splitOrientation, {tile: "fresh", container: "nest"});
				same(remove(grown, "fresh").root, tree.root);
			}),
		);
	});

	it("leaves a built tree as it is when settled again: every operation leaves the normal form", () => {
		fc.assert(
			fc.property(trees, (tree) => {
				same(settle(tree.root), tree.root);
			}),
		);
	});

	it("keeps every tile, in reading order, through a turn", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				expect(order(turn(tree, tile))).toEqual(order(tree));
			}),
		);
	});

	it("comes back to the same tree, sizes and all, when a fold is undone", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				const folded = fold(tree, tile);
				if (folded === tree) return;
				expect(unfold(folded, tile)).toEqual({...tree, zoomed: folded.zoomed});
			}),
		);
	});

	it("refuses a fold only of a folded tile or the last open one, and never leaves only strips", () => {
		fc.assert(
			fc.property(picks, ({tree, tile}) => {
				const folded = fold(tree, tile);
				const open = [...tiles(tree.root)].filter((t) => !t.folded).map((t) => t.id);
				const refused = !open.includes(tile) || open.length === 1;
				expect(folded === tree).toBe(refused);
				expect(isFolded(folded.root)).toBe(false);
			}),
		);
	});

	it("draws the open children of every container at shares adding up to 1", () => {
		fc.assert(
			fc.property(trees, (tree) => {
				for (const container of containers(tree.root)) {
					if (isFolded(container)) continue;
					expect(sum(Object.values(openShares(container)))).toBeCloseTo(1, 6);
				}
			}),
		);
	});

	it("keeps every invariant under any resize of any container", () => {
		fc.assert(
			fc.property(
				resizes(fc.double({min: 0, max: 200, noNaN: true})),
				({tree, container, sizes}) => {
					expect(checkTree(resize(tree, container.id, sizes))).toEqual([]);
				},
			),
		);
	});

	it("keeps the shares a partial size map names and splits what is left over the rest", () => {
		fc.assert(
			fc.property(partialResizes, ({tree, container, sizes}) => {
				const resized = sizesOf(resize(tree, container.id, sizes), container.id);
				const named = Object.keys(sizes);
				const rest = container.children.filter((child) => !named.includes(child.id));
				const left = (100 - sum(Object.values(sizes))) / rest.length;
				for (const id of named) expect(resized[id]).toBeCloseTo(sizes[id] ?? Number.NaN, 6);
				for (const child of rest) expect(resized[child.id]).toBeCloseTo(left, 6);
			}),
		);
	});

	it("scales a size map summing over 100 back to 100, keeping its proportions", () => {
		fc.assert(
			fc.property(overfullResizes, ({tree, container, sizes}) => {
				const total = sum(Object.values(sizes));
				expect(total).toBeGreaterThan(100);
				const resized = sizesOf(resize(tree, container.id, sizes), container.id);
				expect(sum(Object.values(resized))).toBeCloseTo(100, 6);
				for (const child of container.children) {
					expect(resized[child.id]).toBeCloseTo(((sizes[child.id] ?? 0) * 100) / total, 6);
				}
			}),
		);
	});

	it("only ever moves focus to a tile the tree holds", () => {
		fc.assert(
			fc.property(
				picks,
				fc.constantFrom("left" as const, "right" as const, "up" as const, "down" as const),
				({tree, tile}, direction) => {
					const landed = findSibling(tree, tile, direction);
					if (landed === null) return;
					expect(order(tree)).toContain(landed.id);
					expect(landed.id).not.toBe(tile);
				},
			),
		);
	});
});
