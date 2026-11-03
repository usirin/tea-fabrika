// Ban a bare `throw` statement lexically inside an `Effect.gen(...)` generator body or
// an `Effect.fn(...)` body: the failure must route through the typed `E` channel.
//
// Rationale (single site; #2736): a `throw` inside an Effect generator escapes as an
// uncatchable DEFECT with an empty `E` channel: the caller's `catchTag`/`catchAll` never
// sees it and the type system can't force it to be handled. This is the exact hole the
// #2736 Effect-v4 family (`no-raw-try-catch` / `no-effect-promise`) leaves: those
// ban the try/catch and promise "cosplay as Effect" tells, but a naked `throw` in a gen
// body slips past both. The fix keeps the failure in the type: `yield* Effect.fail(new
// SomeError({...}))` (a `Schema.TaggedErrorClass` in `E`) for a recoverable failure, or
// `yield* Effect.die(cause)` for a genuine, non-recoverable defect stated as one.
//
// Match: a `throw` anywhere inside a call whose callee is `Effect.gen` / `Effect.fn`,
// covering the direct form (`Effect.gen(function* ...)`) and the curried, span-named
// `Effect.fn` form (`Effect.fn("name")(function* ...)`, whose outer call's callee is
// `Effect.fn("name")`). It reaches any nesting depth, so a `throw` guarded inside an `if` in
// the generator body is still caught. Containment is lexical (the issue's contract): the rule
// sees no types to distinguish the immediate generator body from a nested plain closure, and the
// family accepts lexical scoping.
//
// A genuine exception (a real defect stated as a throw at a pre-Effect boundary) is a per-line
// `// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- <reason>`, never blanket.
import type {CreateRule} from "@oxlint/plugins";
import {ancestors, dotted, type Node, plainCall} from "./match.ts";

const isEffectBody = (name: string | null): boolean =>
	name === "Effect.gen" || name === "Effect.fn";

const opensEffect = (callee: Node): boolean =>
	isEffectBody(dotted(callee)) || isEffectBody(plainCall(callee));

export const noThrowInEffectGen: CreateRule = {
	create(context) {
		return {
			ThrowStatement(node) {
				for (const up of ancestors(node)) {
					if (up.type !== "CallExpression" || !opensEffect(up.callee)) continue;
					context.report({
						node,
						message:
							"Bare `throw` inside an `Effect.gen`/`Effect.fn` body is banned: a thrown exception escapes the `E` channel as an uncatchable defect (#2736). Fix: `yield* Effect.fail(new SomeError({...}))` (a `Schema.TaggedErrorClass` in the `E` channel) for a recoverable failure, or `yield* Effect.die(cause)` for a genuine defect. Exception: // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- <reason>.",
					});
					return;
				}
			},
		};
	},
};
