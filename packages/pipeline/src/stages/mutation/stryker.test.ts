import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {MutationRunner} from "./services.ts";
import {sampleOf, strykerRunner} from "./stryker.ts";

// One small real run of StrykerJS, on the toy repository in
// fixtures/mutation: a copy of it in a temporary folder, with this package's
// node_modules linked in. Its test is weak on purpose. No network, no key.

const FIXTURE = fileURLToPath(new URL("../../../../../fixtures/mutation", import.meta.url));
const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));

/** The fixture's lines that hold code: `clamp` and `unit`. */
const SPANS = [{file: "clamp.ts", from: 9, to: 19}];

/** Run `use` with a fresh copy of the fixture and the runner over it. */
const inCopy = <A, E>(use: (runner: MutationRunner["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const dir = yield* fs.makeTempDirectoryScoped({prefix: "mutation-fixture-"});
				for (const name of yield* fs.readDirectory(FIXTURE))
					yield* fs.copyFile(path.join(FIXTURE, name), path.join(dir, name));
				yield* fs.symlink(MODULES, path.join(dir, "node_modules"));
				const layer = strykerRunner({
					folder: () => dir,
					tests: ["node_modules/.bin/vitest", "run"],
					typecheck: ["node_modules/.bin/tsc", "--noEmit", "-p", "."],
				});
				return yield* Effect.gen(function* () {
					return yield* use(yield* MutationRunner);
				}).pipe(Effect.provide(layer));
			}),
		).pipe(Effect.provide(nodeServices)),
	);

describe("StrykerJS behind MutationRunner, on the fixture", () => {
	it("runs the repo's own tests, then lets the weak test's mutants live and leaves out what it must", async () => {
		const [tests, ran] = await inCopy((runner) =>
			// One after the other: Stryker's run must not overlap the plain test run in the same copy.
			Effect.all([runner.tests("h"), runner.run({head: "h", spans: SPANS, seed: 5, most: 150})], {
				concurrency: 1,
			}),
		);
		expect(tests).toBe("green");
		// The error text: the skip list.
		expect(ran.skipped).toBe(1);
		// No test runs `unit`, and the typecheck refuses both its mutants: `return ""` is not a
		// `Unit`, and a body made `{}` returns nothing.
		expect(ran.refused).toBe(2);
		expect(ran.lived.some((m) => m.mutant.startsWith("clamp.ts:17:"))).toBe(false);
		expect(ran.ran).toBe(ran.found);
		// The place, without the id's tag of mutator and replacement.
		const lived = ran.lived.map(
			(m) => `${m.mutant.replace(/:[0-9a-f]{6}$/, "")} ${m.original} -> ${m.replacement}`,
		);
		// Nothing checks a number above `high`, or a low equal to the high.
		expect(lived).toContain("clamp.ts:12:6 n > high -> false");
		expect(lived).toContain("clamp.ts:12:6 n > high -> n >= high");
		expect(lived).toContain("clamp.ts:10:6 low > high -> low >= high");
		// Two mutants at one place keep apart.
		expect(new Set(ran.lived.map((m) => m.mutant)).size).toBe(ran.lived.length);
		expect(ran.killed + ran.refused + ran.lived.length).toBe(ran.ran);
	}, 120_000);

	it("runs only the fixed-seed sample when there are more mutants than `most`", async () => {
		const ran = await inCopy((runner) => runner.run({head: "h", spans: SPANS, seed: 5, most: 4}));
		expect(ran.ran).toBe(4);
		expect(ran.found).toBeGreaterThan(4);
		expect(ran.killed + ran.refused + ran.lived.length).toBe(4);
	}, 120_000);
});

describe("the sample", () => {
	const items = Array.from({length: 40}, (_, i) => i);

	it("is the same on every run, keeps the first order, and takes all when they fit", () => {
		const a = sampleOf(items, 139, 10);
		expect(a).toEqual(sampleOf(items, 139, 10));
		expect(a).toHaveLength(10);
		expect([...a].sort((x, y) => x - y)).toEqual(a);
		expect(new Set(a).size).toBe(10);
		expect(sampleOf(items, 139, 40)).toEqual(items);
		expect(sampleOf(items, 1, 10)).not.toEqual(a);
	});
});
