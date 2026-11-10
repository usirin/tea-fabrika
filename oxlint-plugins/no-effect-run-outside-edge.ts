// An Effect runs only at an edge the platform demands (docs/direction/no-promises.md). Tier 1's
// exam, item 2 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It refuses a call to any of Effect's run functions, `Effect.runPromise(...)`, `runFork(...)` or
// `this.runtime.runSync(...)` alike, in every file of `next/**`. A `ManagedRuntime` has the same
// method names, so the object it is called on does not matter. `runtimePromise` and
// `makeRuntimePromise` (on `FiberSet`, `FiberMap` and `FiberHandle`) count too: each makes a function
// that runs an Effect into a Promise. `NodeRuntime.runMain` is not on the list of refused names:
// `dev.ts`, `grant.ts` and `chaos-drill.ts` start with it and need no edge.
//
// There is no list of edge files (owner, 2026-11-05; Tier 1, P35). The one line a platform demands
// passes only under an edge comment where it stands, `// oxlint-disable-next-line
// fabrika/no-effect-run-outside-edge -- edge: <why>`, which `edge-comment` holds to that shape and CI
// asks the owner about. `.oxlintrc.json` leaves tests out, as the note does.
import type {CreateRule} from "@oxlint/plugins";

/**
 * Effect 4.1.1's run functions (`effect/Effect`), which a `ManagedRuntime` also has as methods, and
 * the two that make a runner for a fiber set, map or handle.
 */
const RUNS = new Set([
	"runCallback",
	"runCallbackWith",
	"runFork",
	"runForkWith",
	"runPromise",
	"runPromiseExit",
	"runPromiseExitWith",
	"runPromiseWith",
	"runSync",
	"runSyncExit",
	"runSyncExitWith",
	"runSyncWith",
	"runtimePromise",
	"makeRuntimePromise",
]);

export const noEffectRunOutsideEdge: CreateRule = {
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				const name =
					callee.type === "Identifier"
						? callee.name
						: callee.type === "MemberExpression" &&
							  !callee.computed &&
							  callee.property.type === "Identifier"
							? callee.property.name
							: null;

				if (name === null || !RUNS.has(name)) {
					return;
				}

				context.report({
					node,
					message: `\`${name}\` runs an Effect (docs/direction/no-promises.md). Hand the Effect back to your caller. Where the platform demands it, mark that one line with \`// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: <why>\`, which the owner reads.`,
				});
			},
		};
	},
};
