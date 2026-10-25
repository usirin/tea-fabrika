import {
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	SIZE_TOLERANCE,
	type StackId,
	type StackNode,
	type TileId,
} from "./node.ts";

// What a well-formed layout tree is, as data. Every operation in `tree.ts` keeps these, the
// property tests check them, and a saved layout that breaks one is refused (desk/saved.ts)
// instead of drawn. Ported from Tuval's (kamp-us/phoenix, apps/tuval/src/shell/layout).

export type Violation =
	| {readonly kind: "duplicate-id"; readonly id: NodeId}
	/** A stack with no children: `remove` folds one into its grandparent instead of leaving it. */
	| {readonly kind: "empty-stack"; readonly id: StackId}
	/** A stack, not the root, with one child: that child belongs in the grandparent, with its share. */
	| {readonly kind: "redundant-stack"; readonly id: StackId}
	| {readonly kind: "sizes-key-unknown"; readonly stack: StackId; readonly id: NodeId}
	| {readonly kind: "sizes-child-missing"; readonly stack: StackId; readonly id: NodeId}
	| {readonly kind: "sizes-not-total"; readonly stack: StackId; readonly sum: number}
	| {readonly kind: "zoomed-tile-missing"; readonly id: TileId};

export function checkTree(tree: LayoutTree): readonly Violation[] {
	const violations: Violation[] = [];
	const seen = new Set<NodeId>();

	const walk = (node: LayoutNode, isRoot: boolean): void => {
		if (seen.has(node.id)) violations.push({kind: "duplicate-id", id: node.id});
		seen.add(node.id);
		if (node.tag === "tile") return;

		if (node.children.length === 0) violations.push({kind: "empty-stack", id: node.id});
		else if (node.children.length === 1 && !isRoot)
			violations.push({kind: "redundant-stack", id: node.id});

		violations.push(...checkSizes(node));
		for (const child of node.children) walk(child, false);
	};

	walk(tree.root, true);

	if (tree.zoomed !== null && !hasTile(tree.root, tree.zoomed)) {
		violations.push({kind: "zoomed-tile-missing", id: tree.zoomed});
	}
	return violations;
}

function checkSizes(stack: StackNode): readonly Violation[] {
	if (stack.children.length === 0) return [];
	const violations: Violation[] = [];
	const childIds = new Set<NodeId>(stack.children.map((child) => child.id));

	for (const id of Object.keys(stack.sizes)) {
		if (!childIds.has(id)) violations.push({kind: "sizes-key-unknown", stack: stack.id, id});
	}
	for (const id of childIds) {
		if (stack.sizes[id] === undefined)
			violations.push({kind: "sizes-child-missing", stack: stack.id, id});
	}

	const sum = Object.values(stack.sizes).reduce((total, value) => total + value, 0);
	if (Math.abs(sum - 100) > SIZE_TOLERANCE) {
		violations.push({kind: "sizes-not-total", stack: stack.id, sum});
	}
	return violations;
}

function hasTile(node: LayoutNode, id: TileId): boolean {
	if (node.tag === "tile") return node.id === id;
	return node.children.some((child) => hasTile(child, id));
}
