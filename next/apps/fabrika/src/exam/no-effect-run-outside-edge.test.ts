// `no-effect-run-outside-edge` (exam item 2): an Effect runs only in a named edge file.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const CODE = "fabrika(no-effect-run-outside-edge)";
const FIRES = "next/packages/libfabrika/src/app/fires.ts";
const PASSES = "next/apps/fabrika/dev.ts";

const runs = [
	'import {Effect, ManagedRuntime, Layer} from "effect";', // 1
	"declare const thing: Effect.Effect<number>;", // 2
	"const runtime = ManagedRuntime.make(Layer.empty);", // 3
	"export const a = Effect.runPromise(thing);", // 4
	"export const b = Effect.runSync(thing);", // 5
	"export const c = Effect.runFork(thing);", // 6
	"export const d = Effect.runPromiseExit(thing);", // 7
	"export const e = runtime.runPromise(thing);", // 8
	"export const f = Effect.runCallback(thing);", // 9
].join("\n");

const passes = [
	'import {NodeRuntime} from "@effect/platform-node";',
	'import {Effect} from "effect";',
	"NodeRuntime.runMain(Effect.log('dev'));",
	"export const later = Effect.succeed(1);",
].join("\n");

/** Every edge in the plan's list, at the place the plan's "Packages" section puts it. */
const EDGES = [
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
];

describe("no-effect-run-outside-edge", () => {
	const all = plant({
		[FIRES]: runs,
		[PASSES]: passes,
		...Object.fromEntries(EDGES.map((edge) => [edge, runs])),
		// The same name one folder off is no edge.
		"next/packages/libfabrika/src/brain.ts": runs,
		"next/packages/libfabrika/src/app/process.test.ts": runs,
	});

	it("fires on each run outside an edge, a runtime's methods too", () => {
		expect(all(CODE, FIRES)).toEqual([4, 5, 6, 7, 8, 9]);
		expect(all(CODE, "next/packages/libfabrika/src/brain.ts")).toEqual([4, 5, 6, 7, 8, 9]);
	});

	it("passes NodeRuntime.runMain, each of the 18 edges, and tests", () => {
		expect(EDGES).toHaveLength(18);
		expect(all(CODE, PASSES)).toEqual([]);
		for (const edge of EDGES) expect(all(CODE, edge)).toEqual([]);
		expect(all(CODE, "next/packages/libfabrika/src/app/process.test.ts")).toEqual([]);
	});
});
