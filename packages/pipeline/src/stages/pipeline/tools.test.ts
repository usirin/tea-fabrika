import {mkdtempSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {spansOf} from "../mutation/scope.ts";
import {MutationScope} from "../mutation/services.ts";
import {makeLaneHome} from "./lane-fixture.ts";
import {laneMutationScope} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Today's version. The mutation step's read of a change, on real git over a bare remote.

describe("the lines the mutation step reads from a change", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-scope-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	it("a changed file with a space or a non-ASCII letter in its name gets its span", async () => {
		const {home} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, briefs: "", person: "owner"})),
		);
		const NAMES = ["src/my file.ts", "src/café.ts"];
		const read = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const {tree, base} = yield* lane.tree(1);
				const files = NAMES.map((path) => ({
					path,
					text: "export const flip = (on: boolean): boolean => !on;\n",
				}));
				const head = yield* lane.commit(tree, files, "A change");
				return yield* (yield* MutationScope).read(base, head, [], []);
			}).pipe(Effect.provide(Layer.provideMerge(laneMutationScope, work))),
		);
		expect(read.diff.files.toSorted()).toEqual(NAMES.toSorted());
		expect(
			spansOf(read)
				.map((span) => span.file)
				.toSorted(),
		).toEqual(NAMES.toSorted());
	});
});
