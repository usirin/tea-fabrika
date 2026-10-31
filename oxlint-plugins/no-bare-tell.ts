// Ban a `tell` or an `offer` to a program's input whose Effect is made and dropped.
//
// This repo's own rule, not a copy (see README.md). Both answer an Effect: the value
// goes on the line only when that Effect runs, and a `tell` on a full line fails `Full`.
// Made and dropped, nothing is told, and nothing says so. Run it (`yield* tell(run, "pr",
// url)`), handle its `Full` where a full line is expected (`Effect.catchTag("Full", ...)`),
// or hand it on.
//
// Two shapes drop it:
//
// 1. A bare statement: `tell(run, name, value);` or `run.tell(name, value);`. `tsc` also
//    catches this one, through Effect's `floatingEffect`, but only in type-checked code;
//    this rule covers `experiments/` too, which is linted and not type-checked.
// 2. A callback that answers the call: `xs.forEach((x) => run.tell("n", x))`,
//    `setTimeout(() => tell(run, "n", 1))`, `const f: () => void = () => run.tell(...)`.
//    The caller wants nothing back, so the Effect is dropped. TypeScript lets an arrow
//    that answers a value stand where `() => void` is asked, and Effect's checks do not
//    look there, so this rule is the only check.
//
// A callback is left alone when its Effect is surely kept: when it is an argument straight
// to an Effect combinator (`Effect.forEach(xs, (x) => tell(run, "n", x))`, `Stream.x`,
// `Layer.x`, or a `.pipe(...)`), or when the arrow names its return type, so the
// compiler checks it is an Effect. The rule sees no types, so any other place is flagged: write
// the loop with `Effect.forEach`, or name the return type when a helper hands the Effect on.
import type {Context, CreateRule} from "@oxlint/plugins";
import {ancestors, grouped, type Node} from "./match.ts";

const isTell = (node: Node): boolean => {
	if (node.type !== "CallExpression" || node.optional || node.typeArguments != null) return false;
	if (node.callee.type === "Identifier") {
		return (
			(node.callee.name === "tell" || node.callee.name === "offer") && node.arguments.length === 3
		);
	}
	if (node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.optional) {
		return false;
	}
	const {property} = node.callee;
	return (
		property.type === "Identifier" &&
		(property.name === "tell" || property.name === "offer") &&
		node.arguments.length === 2
	);
};

/** `Effect.x`, `Stream.x`, `Layer.x`, or any `x.pipe`, each written plainly. */
const keepsIt = (source: Context["sourceCode"], callee: Node): boolean => {
	if (callee.type !== "MemberExpression" || callee.computed || callee.optional) return false;
	if (grouped(source, callee) > 0) return false;
	if (callee.property.type === "Identifier" && callee.property.name === "pipe") return true;
	return (
		callee.object.type === "Identifier" &&
		grouped(source, callee.object) === 0 &&
		(callee.object.name === "Effect" ||
			callee.object.name === "Stream" ||
			callee.object.name === "Layer")
	);
};

export const noBareTell: CreateRule = {
	create(context) {
		const source = context.sourceCode;
		return {
			ExpressionStatement(node) {
				if (grouped(source, node.expression) === 0 && isTell(node.expression)) {
					context.report({
						node: node.expression,
						message:
							"A bare `tell` or `offer` makes an Effect and drops it: nothing is told. Run it with `yield*`, and catch `Full` with `Effect.catchTag('Full', ...)` where a full line is expected.",
					});
				}
			},
			ArrowFunctionExpression(node) {
				if (node.returnType != null || grouped(source, node.body) > 0 || !isTell(node.body)) return;
				const text = source.getText(node);
				for (const up of ancestors(node)) {
					if (up.type !== "CallExpression" || !keepsIt(source, up.callee)) continue;
					const same = up.arguments.some(
						(arg) => grouped(source, arg) === 0 && source.getText(arg) === text,
					);
					if (same) return;
				}
				context.report({
					node,
					message:
						"This callback answers a `tell` or `offer`, and nothing here is sure to run that Effect: a caller that wants nothing back (`forEach`, `setTimeout`, a `() => void`) drops it, and nothing is told. Use `Effect.forEach`, or name the callback's return type so the compiler checks the Effect is handed on.",
				});
			},
		};
	},
};
