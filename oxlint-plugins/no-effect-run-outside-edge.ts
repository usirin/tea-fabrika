// An Effect runs only at an edge the platform demands (docs/direction/no-promises.md). Tier 1's
// exam, item 2 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It refuses a call to any of Effect's run functions, `Effect.runPromise(...)`, `runFork(...)` or
// `this.runtime.runSync(...)` alike, in any file of `next/**` that is not on the list below. A
// `ManagedRuntime` has the same method names, so the object it is called on does not matter.
// `NodeRuntime.runMain` is not on the list of refused names: `dev.ts`, `grant.ts` and
// `chaos-drill.ts` start with it and need no edge.
//
// The edges are whole paths from the top of the repo, written here, so a file cannot make itself one.
// They are the plan's short paths, placed where the plan's "Packages" section puts them. A new edge
// comes with a small exam PR. `.oxlintrc.json` leaves tests out, as the note does.
import type {CreateRule} from "@oxlint/plugins";
import {pathIn} from "./match.ts";

const EDGES: ReadonlySet<string> = new Set([
	"next/packages/libfabrika/src/data/project.ts",
	"next/packages/libfabrika/src/data/ledger.ts",
	"next/packages/libfabrika/src/app/process.ts",
	"next/packages/libfabrika/src/transport/gateway.ts",
	"next/packages/libfabrika/src/transport/hello.ts",
	"next/packages/libfabrika/src/transport/sshsig.ts",
	"next/apps/fabrika/src/brain.ts",
	"next/apps/fabrika/build.ts",
	"next/packages/tuval/src/window/use-model.ts",
	"next/packages/tuval/src/browser/key.ts",
	"next/packages/tuval/src/electron/preload.ts",
	"next/packages/tuval/src/electron/panel-preload.ts",
	"next/packages/tuval/src/electron/key.ts",
	"next/packages/tuval/src/electron/person-key.ts",
	"next/packages/tuval/src/electron/person-check.ts",
	"next/apps/fabrika/src/launchd.ts",
	"next/apps/fabrika/src/entry/electron-main.ts",
	"next/apps/fabrika/alchemy.run.ts",
]);

/** Effect 4.1.1's run functions (`effect/Effect`), which a `ManagedRuntime` also has as methods. */
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
]);

export const noEffectRunOutsideEdge: CreateRule = {
	create(context) {
		if (EDGES.has(pathIn(context))) return {};
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
				if (name === null || !RUNS.has(name)) return;
				context.report({
					node,
					message: `\`${name}\` runs an Effect, and only an edge file may (docs/direction/no-promises.md). Hand the Effect back to your caller; a new edge comes with a small exam PR.`,
				});
			},
		};
	},
};
