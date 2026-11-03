// Forbid type-assertion footguns.
//
// Type assertions blind the TypeScript compiler: they assert a shape it can no
// longer verify. We decode at boundaries with `Schema.decodeUnknown` (or type the
// value properly) instead. This rule bans the assertion forms that fully erase
// type information:
//
//   - `as any`                  disables checking on the whole expression.
//   - the double-cast through the top/bottom type, in every spelling:
//       `x as unknown as T`     `(x as unknown) as T`
//       `x as never as T`       `(x as never) as T`
//     The inner `as unknown`/`as never` launders the value past the compiler so
//     the outer cast to `T` is unchecked. Parentheses don't change that, so both
//     the bare and parenthesized forms are banned.
//   - `<T>x`                    the angle-bracket cast (same erasure as
//                               `x as T`, harder to grep).
//
// INTENTIONALLY OUT OF SCOPE (the rule sees no types, so it can't tell a safe
// narrowing from an unsafe one; over-banning would swallow legitimate code):
//   - `as const`                narrows to a literal/readonly type; adds
//                               information, never removes it.
//   - a SINGLE `x as SomeType`  a plain narrowing cast to a real named type
//                               (e.g. `as React.CSSProperties`, or Drizzle's
//                               `column.value as never`). The double-cast forms above
//                               are the laundering footgun; a lone narrowing cast is the
//                               compiler's normal assertion and is left to code
//                               review, not this rule.
//
// Test and support files that bridge Node or test types to runtime surfaces carry a justified
// `// oxlint-disable-next-line fabrika/no-type-assertions -- <reason>`.
import type {CreateRule, ESTree} from "@oxlint/plugins";
import {grouped} from "./match.ts";

export const noTypeAssertions: CreateRule = {
	create(context) {
		const source = context.sourceCode;
		/** The type right after `as`, with no parentheses of its own: `as (any)` is not `as any`. */
		const asKeyword = (node: ESTree.TSAsExpression, kind: string): boolean =>
			node.typeAnnotation.type === kind &&
			source.getTokenBefore(node.typeAnnotation)?.value === "as";
		return {
			TSAsExpression(node) {
				const inner = node.expression;
				if (inner.type === "TSAsExpression" && grouped(source, inner) <= 1) {
					const message = asKeyword(inner, "TSUnknownKeyword")
						? "Type assertions are forbidden: `as unknown as` blinds the compiler. Decode at boundaries with Schema.decodeUnknown, or type the value properly."
						: asKeyword(inner, "TSNeverKeyword")
							? "Type assertions are forbidden: `as never as T` launders a value past the compiler. Construct/type the value properly instead."
							: null;
					if (message !== null) {
						context.report({node: inner.expression, message});
						return;
					}
				}
				if (asKeyword(node, "TSAnyKeyword")) {
					context.report({
						node,
						message:
							"`as any` is forbidden: it disables type checking. Type the value properly (e.g. `as React.CSSProperties` for CSS-var keys).",
					});
				}
			},
			TSTypeAssertion(node) {
				context.report({
					node,
					message:
						"Angle-bracket type assertions (`<T>x`) are forbidden: same erasure as `x as T`. Decode at boundaries with Schema.decodeUnknown, or type the value properly.",
				});
			},
		};
	},
};
