// What the rules here share: asking a piece of syntax the same question the old GritQL patterns
// asked. They worked on text-like shapes, so `Effect.all(x)` matched and `Effect?.all(x)`,
// `Effect.all<T>(x)` and `x.Effect.all(y)` did not. The rules keep that exactly: README.md says how
// that was measured.
import type {Context, ESTree, Visitor} from "@oxlint/plugins";

type Source = Context["sourceCode"];
export type Node = ESTree.Node;

/** `Context.Tag` for that plain member, `process.env.X` for a longer one. `null` for any other shape. */
export const dotted = (node: Node): string | null => {
	if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name;
	if (node.type === "TSQualifiedName") {
		const left = dotted(node.left);
		return left === null ? null : `${left}.${node.right.name}`;
	}
	if (node.type === "JSXMemberExpression") {
		const object = dotted(node.object);
		return object === null ? null : `${object}.${node.property.name}`;
	}
	if (node.type !== "MemberExpression" || node.computed || node.optional) return null;
	if (node.property.type !== "Identifier") return null;
	const object = dotted(node.object);
	return object === null ? null : `${object}.${node.property.name}`;
};

/** The written name of a call that carries no type arguments and no `?.`: `Effect.all`, `tell`. */
export const plainCall = (node: Node): string | null =>
	node.type === "CallExpression" && !node.optional && node.typeArguments == null
		? dotted(node.callee)
		: null;

/** A plain member on the left of a write: `a.b = 1`, `a.b++`, `[a.b] = c`, `for (a.b of c)`. */
export const isWritten = (node: Node): boolean => {
	const {parent} = node as Node & {readonly parent: Node};
	switch (parent.type) {
		case "AssignmentExpression":
		case "AssignmentPattern":
		case "ForInStatement":
		case "ForOfStatement":
			return parent.left === node;
		case "UpdateExpression":
		case "ArrayPattern":
		case "RestElement":
			return true;
		case "Property":
			return parent.value === node && parent.parent.type === "ObjectPattern";
		default:
			return false;
	}
};

/** The pairs of parentheses written around a node, not counting a call's own. */
export const grouped = (source: Source, node: Node): number => {
	let pairs = 0;
	let before = source.getTokenBefore(node);
	let after = source.getTokenAfter(node);
	while (before?.value === "(" && after?.value === ")") {
		pairs++;
		before = source.getTokenBefore(before);
		after = source.getTokenAfter(after);
	}
	const {parent} = node as Node & {readonly parent: Node};
	if ((parent.type === "CallExpression" || parent.type === "NewExpression") && pairs > 0) {
		const sole = parent.arguments.length === 1 && parent.arguments[0] === node;
		const close = source.getLastToken(parent);
		const comma = close !== null && source.getTokenBefore(close)?.value === ",";
		if (sole && !comma) pairs--;
	}
	return pairs;
};

/** Each ancestor of a node, nearest first. */
export function* ancestors(node: Node): Generator<Node> {
	let at = (node as Node & {readonly parent?: Node | null}).parent;
	while (at != null) {
		yield at;
		at = (at as Node & {readonly parent?: Node | null}).parent;
	}
}

/** A string literal in the source, with its quotes: `"a"`. */
export const quoted = (node: Node): string | null =>
	node.type === "Literal" && typeof node.value === "string" ? node.raw : null;

/** The empty string, in either quote, with no parentheses around it. */
export const isEmptyString = (source: Source, node: Node | null): boolean =>
	node !== null && quoted(node)?.length === 2 && grouped(source, node) === 0;

/** Every node under one, the node included. */
export function* below(node: Node): Generator<Node> {
	yield node;
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent" || value === null || typeof value !== "object") continue;
		for (const part of Array.isArray(value) ? value : [value]) {
			if (part !== null && typeof part === "object" && typeof part.type === "string") {
				yield* below(part);
			}
		}
	}
}

/** A rule that refuses any plain use of some dotted names, in values and in types. */
export const banNames =
	(messages: Readonly<Record<string, string>>) =>
	(context: Context): Visitor => {
		const check = (node: Node) => {
			const name = dotted(node);
			const message = name === null ? undefined : messages[name];
			if (message !== undefined && !isWritten(node)) context.report({node, message});
		};
		return {
			MemberExpression: check,
			TSQualifiedName: check,
			// `<Redacted.value />`. The opening tag is enough: a closing tag says it a second time.
			JSXMemberExpression(node) {
				if ((node as Node & {readonly parent: Node}).parent.type !== "JSXClosingElement")
					check(node);
			},
		};
	};
