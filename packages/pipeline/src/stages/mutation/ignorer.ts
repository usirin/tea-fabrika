// The mutation step's ignorer (docs/direction/promises-in-the-pipeline.md):
// kinds of mutant that make no useful test. Google calls them arid nodes
// (https://arxiv.org/abs/2102.11378). It is one rule, experiment 124's, fixed
// before any agent ran: ignore every mutant inside the text of an error or a
// log line. That is any argument of `new <Name>Error(...)`, of
// `<Name>Error(...)`, of `super(...)` in a class that extends `<Name>Error`,
// or of `console.<any>(...)`.
//
// The ignorer is part of the exam. A diff that changes this file asks the
// owner (`exam` in ./scope.ts).
//
// It is a Stryker ignorer plugin, loaded by path: Stryker imports this file
// as it is, so it imports nothing. The node types are written out here, as
// much of Babel's `NodePath` as the rule reads.

interface Node {
	readonly type: string;
	readonly name?: string;
	readonly callee?: Node;
	readonly object?: Node;
	readonly superClass?: Node | null;
}

/** As much of Babel's `NodePath` as the rule reads. */
export interface Path {
	readonly node: Node;
	readonly parentPath: Path | null;
	readonly listKey?: string | undefined;
	isCallExpression(): boolean;
	isNewExpression(): boolean;
	isClassDeclaration(): boolean;
	isClassExpression(): boolean;
	findParent(test: (p: Path) => boolean): Path | null;
}

/** The ignorer's name, as a Stryker config names it. */
export const IGNORER = "arid";

const endsError = (node: Node | null | undefined) =>
	node != null && node.type === "Identifier" && /Error$/.test(node.name ?? "");

/** Why a call's arguments are text nobody tests: an error's, a log line's, or neither. */
function why(call: Path): "error text" | "log text" | undefined {
	const callee = call.node.callee;
	if (call.isNewExpression() && endsError(callee)) return "error text";
	if (!call.isCallExpression() || callee === undefined) return undefined;
	if (endsError(callee)) return "error text";
	if (callee.type === "Super") {
		const owner = call.findParent((p) => p.isClassDeclaration() || p.isClassExpression());
		if (owner !== null && endsError(owner.node.superClass)) return "error text";
	}
	if (
		callee.type === "MemberExpression" &&
		callee.object?.type === "Identifier" &&
		callee.object.name === "console"
	)
		return "log text";
	return undefined;
}

/** The rule: a reason to ignore the node and everything under it, or `undefined` to keep it. */
export function shouldIgnore(path: Path): string | undefined {
	const parent = path.parentPath;
	if (parent === null || path.listKey !== "arguments") return undefined;
	if (!parent.isCallExpression() && !parent.isNewExpression()) return undefined;
	const found = why(parent);
	return found === undefined ? undefined : `${IGNORER}: ${found}`;
}

/** What Stryker reads from a plugin file. */
export const strykerPlugins = [{kind: "Ignore", name: IGNORER, value: {shouldIgnore}}];
