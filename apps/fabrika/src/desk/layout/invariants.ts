import {
	type ContainerId,
	type ContainerNode,
	isFolded,
	type LayoutNode,
	type LayoutTree,
	type NodeId,
	SIZE_TOLERANCE,
	type TileId,
} from "./node.ts";

// What a well-formed layout tree is, as data. Every operation in `tree.ts` keeps these, the
// property tests check them, and a saved layout that breaks one is refused (desk.ts, `restore`)
// instead of drawn. Ported from Tuval's layout invariants, with AeroSpace's two normalizations: no container of one child, and nested containers alternate.

export type Violation =
	| {readonly kind: "duplicate-id"; readonly id: NodeId}
	/** A container with no children: `remove` drops one instead of leaving it. */
	| {readonly kind: "empty-container"; readonly id: ContainerId}
	/** A container, not the root, with one child: that child belongs in the parent, with its share. */
	| {readonly kind: "redundant-container"; readonly id: ContainerId}
	/** A container with its parent's orientation: its children belong in the parent, as in AeroSpace. */
	| {readonly kind: "same-orientation"; readonly id: ContainerId; readonly parent: ContainerId}
	| {readonly kind: "sizes-key-unknown"; readonly container: ContainerId; readonly id: NodeId}
	| {readonly kind: "sizes-child-missing"; readonly container: ContainerId; readonly id: NodeId}
	| {readonly kind: "sizes-not-total"; readonly container: ContainerId; readonly sum: number}
	/** Every tile folded: the workspace would be only strips. `fold` refuses the last open tile. */
	| {readonly kind: "all-folded"}
	| {readonly kind: "zoomed-tile-missing"; readonly id: TileId};

export function checkTree(tree: LayoutTree): readonly Violation[] {
	const violations: Violation[] = [];
	const seen = new Set<NodeId>();

	const walk = (node: LayoutNode, parent: ContainerNode | null): void => {
		if (seen.has(node.id)) violations.push({kind: "duplicate-id", id: node.id});
		seen.add(node.id);
		if (node.tag === "tile") return;

		if (node.children.length === 0) violations.push({kind: "empty-container", id: node.id});
		else if (node.children.length === 1 && parent !== null)
			violations.push({kind: "redundant-container", id: node.id});
		if (parent !== null && parent.orientation === node.orientation)
			violations.push({kind: "same-orientation", id: node.id, parent: parent.id});

		violations.push(...checkSizes(node));
		for (const child of node.children) walk(child, node);
	};

	walk(tree.root, null);

	if (tree.root.children.length > 0 && isFolded(tree.root)) violations.push({kind: "all-folded"});
	if (tree.zoomed !== null && !hasTile(tree.root, tree.zoomed)) {
		violations.push({kind: "zoomed-tile-missing", id: tree.zoomed});
	}
	return violations;
}

function checkSizes(container: ContainerNode): readonly Violation[] {
	if (container.children.length === 0) return [];
	const violations: Violation[] = [];
	const childIds = new Set<NodeId>(container.children.map((child) => child.id));

	for (const id of Object.keys(container.sizes)) {
		if (!childIds.has(id))
			violations.push({kind: "sizes-key-unknown", container: container.id, id});
	}
	for (const id of childIds) {
		if (container.sizes[id] === undefined)
			violations.push({kind: "sizes-child-missing", container: container.id, id});
	}

	const sum = Object.values(container.sizes).reduce((total, value) => total + value, 0);
	if (Math.abs(sum - 100) > SIZE_TOLERANCE) {
		violations.push({kind: "sizes-not-total", container: container.id, sum});
	}
	return violations;
}

function hasTile(node: LayoutNode, id: TileId): boolean {
	if (node.tag === "tile") return node.id === id;
	return node.children.some((child) => hasTile(child, id));
}
