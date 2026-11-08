// One store hook, and its value is what a view draws (docs/direction/react-compiler.md, C4). Tier
// 1's exam, item 13 (docs/plan/tier-1-detail.md, "The exam PR").
//
// Two halves:
//
// 1. `useSyncExternalStore` has no allowed file in `next/`. Importing it from `react` or from the
//    `use-sync-external-store` shim, or reading it as `React.useSyncExternalStore`, fires. A view
//    reads its model through `useRuntime` from `@demlik/tea/react`.
// 2. A store hook whose value is dropped fires, in every checked file: `useRuntime(run);`,
//    `void useRuntime(run);`. The Compiler compiles such a component with no word, and keeps its
//    first output forever (experiments 176 and 194), so no other check sees it. The store hooks are
//    legacy `useModel`, React's `useSyncExternalStore`, and tea's `useRuntime` and `useMachine`.
//
// It follows written names and plain member access. It does not trace every alias, computed access,
// re-export or helper.
//
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out: a test may plant a broken view.
import type {CreateRule} from "@oxlint/plugins";
import {pathIn, type Node} from "./match.ts";

const STORE_HOOKS = new Set(["useModel", "useSyncExternalStore", "useRuntime", "useMachine"]);
const ONLY =
	"`useSyncExternalStore` is not allowed in `next/`. Read the model through `useRuntime` from `@demlik/tea/react` (docs/direction/react-compiler.md, C4).";

/** The hook a call names, plainly or as a member: `useModel(...)`, `React.useSyncExternalStore(...)`. */
const hookName = (node: Node): string | null => {
	if (node.type !== "CallExpression") return null;
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name;
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier"
	)
		return callee.property.name;
	return null;
};

export const oneStoreHook: CreateRule = {
	create(context) {
		// Supported: named import aliases, namespace/default imports, literal member access,
		// const aliases and const destructuring. Dynamic property names and mutable aliases are
		// outside this check. Import checks still refuse the external-store shim.
		const names = new Map<string, string>();
		const namespaces = new Map<string, string>();
		const window = /next\/packages\/tuval\/src\/window\//.test(pathIn(context));
		const member = (node: Node): string | null => {
			if (node.type === "Identifier") return names.get(node.name) ?? node.name;
			if (node.type !== "MemberExpression" || node.object.type !== "Identifier") return null;
			if (!namespaces.has(node.object.name)) return null;
			return !node.computed && node.property.type === "Identifier"
				? node.property.name
				: node.computed &&
					  node.property.type === "Literal" &&
					  typeof node.property.value === "string"
					? node.property.value
					: null;
		};
		const dropped = (node: Node, call: Node) => {
			const name = call.type === "CallExpression" ? (member(call.callee) ?? hookName(call)) : null;
			if (name === null || !STORE_HOOKS.has(name)) return;
			context.report({
				node,
				message: `\`${name}\`'s value is dropped. A view draws from what the store hook returns; compiled, a view that reads anything else keeps its first output forever (docs/direction/react-compiler.md, C4).`,
			});
		};
		return {
			VariableDeclarator(node) {
				if (
					node.parent.type !== "VariableDeclaration" ||
					node.parent.kind !== "const" ||
					node.init === null
				)
					return;
				if (node.id.type === "Identifier") {
					const name =
						node.init.type === "Identifier"
							? (names.get(node.init.name) ?? null)
							: member(node.init);
					if (name !== null) names.set(node.id.name, name);
				} else if (
					node.id.type === "ObjectPattern" &&
					node.init.type === "Identifier" &&
					namespaces.has(node.init.name)
				) {
					for (const property of node.id.properties)
						if (
							property.type === "Property" &&
							property.key.type === "Identifier" &&
							property.value.type === "Identifier"
						)
							names.set(property.value.name, property.key.name);
				}
			},
			ImportDeclaration(node) {
				const from = node.source.value;
				if (from === "react" || from === "@demlik/tea/react") {
					for (const spec of node.specifiers) {
						if (spec.type === "ImportSpecifier")
							names.set(
								spec.local.name,
								spec.imported.type === "Identifier"
									? spec.imported.name
									: String(spec.imported.value),
							);
						else namespaces.set(spec.local.name, from);
					}
				}
				if (from.startsWith("use-sync-external-store")) {
					context.report({node, message: ONLY});
					return;
				}
				if (from !== "react") return;
				for (const spec of node.specifiers) {
					if (
						spec.type === "ImportSpecifier" &&
						spec.imported.type === "Identifier" &&
						spec.imported.name === "useSyncExternalStore"
					) {
						context.report({node: spec, message: ONLY});
					}
				}
			},
			MemberExpression(node) {
				if (node.computed || node.property.type !== "Identifier") return;
				if (node.property.name === "useSyncExternalStore") context.report({node, message: ONLY});
			},
			CallExpression(node) {
				if (!window) return;
				const name = member(node.callee);
				const imported = node.callee.type !== "Identifier" || names.has(node.callee.name);
				if (imported && (name === "memo" || name === "useMemo" || name === "useCallback"))
					context.report({
						node,
						message:
							"The React Compiler owns memoization in a window. Remove manual memoization (C6).",
					});
				if (name !== "useRuntime") return;
				const selector = node.arguments[1];
				if (selector === undefined || (selector.type === "Literal" && selector.value == null))
					context.report({
						node,
						message: "A window useRuntime reader needs a selector as its second argument (p50).",
					});
				else if (
					selector.type === "ArrowFunctionExpression" &&
					(selector.body.type === "ObjectExpression" || selector.body.type === "ArrayExpression")
				)
					context.report({
						node: selector,
						message:
							"Select an existing model part; constructing an object or array changes every read (p50).",
					});
			},
			ExpressionStatement(node) {
				const e = node.expression;
				if (e.type === "UnaryExpression" && e.operator === "void") dropped(node, e.argument);
				else dropped(node, e);
			},
		};
	},
};
