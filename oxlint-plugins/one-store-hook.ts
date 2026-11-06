// One store hook, and its value is what a view draws (docs/direction/react-compiler.md, C4). Tier
// 1's exam, item 13 (docs/plan/tier-1-detail.md, "The exam PR").
//
// Two halves:
//
// 1. `useSyncExternalStore` is reached only by the one hook's file,
//    `next/packages/tuval/src/window/use-model.ts`, written whole here so no file can make itself the
//    one. Anywhere else, importing it from `react` or from the `use-sync-external-store` shim, or
//    reading it as `React.useSyncExternalStore`, fires.
// 2. A store hook whose value is dropped fires, in every file: `useModel(store);`,
//    `void useModel(store);`. The Compiler compiles such a component with no word, and keeps its
//    first output forever (experiments 176 and 194), so no other check sees it. The store hooks are
//    our `useModel`, React's `useSyncExternalStore`, and tea's `useRuntime` and `useMachine`.
//
// It misses a module object read during render through a helper while the hook's value is used for
// something else (the note's doubt). In `next/`, half 1 leaves no second store to read.
//
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out: a test may plant a broken view.
import type {CreateRule} from "@oxlint/plugins";
import {type Node, pathIn} from "./match.ts";

const HOOK_FILE = "next/packages/tuval/src/window/use-model.ts";
const STORE_HOOKS = new Set(["useModel", "useSyncExternalStore", "useRuntime", "useMachine"]);
const ONLY = `\`useSyncExternalStore\` is the one store hook's alone (${HOOK_FILE}). Read the model through \`useModel\` (docs/direction/react-compiler.md, C4).`;

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
		const own = pathIn(context) === HOOK_FILE;
		const dropped = (node: Node, call: Node) => {
			const name = hookName(call);
			if (name === null || !STORE_HOOKS.has(name)) return;
			context.report({
				node,
				message: `\`${name}\`'s value is dropped. A view draws from what the store hook returns; compiled, a view that reads anything else keeps its first output forever (docs/direction/react-compiler.md, C4).`,
			});
		};
		return {
			ImportDeclaration(node) {
				if (own) return;
				const from = node.source.value;
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
				if (own || node.computed || node.property.type !== "Identifier") return;
				if (node.property.name === "useSyncExternalStore") context.report({node, message: ONLY});
			},
			ExpressionStatement(node) {
				const e = node.expression;
				if (e.type === "UnaryExpression" && e.operator === "void") dropped(node, e.argument);
				else dropped(node, e);
			},
		};
	},
};
