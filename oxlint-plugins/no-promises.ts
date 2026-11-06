// No Promise in `next/`: it is Effect all the way (docs/direction/no-promises.md). Tier 1's exam,
// item 1 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It refuses `async`, `await` (and `for await`), `new Promise(...)`, any `Promise.x(...)` call,
// `.then(...)`, `Effect.promise(...)`, `import(...)`, and `.catch(...)` unless the object is a name
// imported from Effect, so `Effect.catch(...)` and `Stream.catch(...)` pass. `import()` is in because
// the plan's small exam names it as an edge line to come (`programs/notes/highlight.ts`).
//
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out. It has no edge list yet: the one
// line a platform demands (`Effect.runPromise` in a Durable Object method) is no Promise syntax, and
// `no-effect-run-outside-edge` holds where it may stand. A new edge comes with a small exam PR.
//
// It sees no types: a `.catch` is told apart by the name it is called on, and `Effect.promise` by
// its written name, so an Effect module bound to another name, or a Promise reached through a
// helper, passes. Report any such miss.
import type {CreateRule, ESTree} from "@oxlint/plugins";
import {effectNames, type Node, plainCall} from "./match.ts";

const WHY = "next/ is Effect all the way (docs/direction/no-promises.md)";

export const noPromises: CreateRule = {
	create(context) {
		const effect = effectNames(context.sourceCode.ast);
		const refuse = (node: Node, what: string) =>
			context.report({node, message: `${what}: ${WHY}. Write it as an Effect.`});
		const asyncFn = (node: ESTree.Function | ESTree.ArrowFunctionExpression) => {
			if (node.async) refuse(node, "An `async` function makes a Promise");
		};
		return {
			FunctionDeclaration: asyncFn,
			FunctionExpression: asyncFn,
			ArrowFunctionExpression: asyncFn,
			AwaitExpression(node) {
				refuse(node, "`await` waits on a Promise");
			},
			ForOfStatement(node) {
				if (node.await) refuse(node, "`for await` waits on Promises");
			},
			ImportExpression(node) {
				refuse(node, "`import()` answers a Promise");
			},
			NewExpression(node) {
				if (node.callee.type === "Identifier" && node.callee.name === "Promise") {
					refuse(node, "`new Promise` makes a Promise");
				}
			},
			CallExpression(node) {
				if (plainCall(node) === "Effect.promise") {
					refuse(node, "`Effect.promise` wraps a Promise");
					return;
				}
				const callee = node.callee;
				if (callee.type !== "MemberExpression" || callee.computed) return;
				if (callee.property.type !== "Identifier") return;
				const name = callee.property.name;
				if (callee.object.type === "Identifier" && callee.object.name === "Promise") {
					refuse(node, `\`Promise.${name}\` works on Promises`);
				} else if (name === "then") {
					refuse(node, "`.then` chains a Promise");
				} else if (
					name === "catch" &&
					!(callee.object.type === "Identifier" && effect.has(callee.object.name))
				) {
					refuse(node, "`.catch` on something not imported from Effect is a Promise's");
				}
			},
		};
	},
};
