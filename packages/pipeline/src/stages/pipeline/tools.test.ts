import {mkdtempSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {placeIn} from "../mutation/mutant.ts";
import {spansOf} from "../mutation/scope.ts";
import {MutationRunner, MutationScope, type RunAsk} from "../mutation/services.ts";
import {TestsWork} from "../test-writer/program.ts";
import {makeLaneHome} from "./lane-fixture.ts";
import {laneMutationScope, laneTestsWork} from "./tools.ts";
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

// A new test kills its mutant when the mutant no longer survives, so a run that looked at no line
// would call every test a killer.
describe("whether a new test kills its mutant", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-kill-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const MUTANT = "src/flip.ts:7:3:abc123";

	/** With `surviving` as what a run finds on the lines it is asked for: as a real one, none on no line. */
	const killed = async (surviving: readonly string[]) => {
		const {home} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, briefs: "", person: "owner"})),
		);
		const asks: RunAsk[] = [];
		const onLines = (ask: RunAsk) =>
			surviving.filter((mutant) => {
				const {file, line} = placeIn(mutant);
				return ask.spans.some((s) => s.file === file && s.from <= line && line <= s.to);
			});
		const runner = Layer.succeed(MutationRunner, {
			tests: () => Effect.succeed("green"),
			run: (ask) =>
				Effect.sync(() => {
					asks.push(ask);
					const survived = onLines(ask).map((mutant) => ({
						mutant,
						mutator: "EqualityOperator",
						original: "===",
						replacement: "!==",
					}));
					return {
						found: survived.length,
						ran: survived.length,
						ignored: 0,
						compileErrors: 0,
						killed: 0,
						survived,
					};
				}),
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const {tree} = yield* lane.tree(1);
				const commit = yield* lane.commit(
					tree,
					[{path: "src/flip.ts", text: "export const flip = (on: boolean): boolean => !on;\n"}],
					"A change",
				);
				const tests = yield* TestsWork;
				return yield* tests.kill({
					commit,
					mutant: MUTANT,
					file: "src/flip.test.ts",
					test: "flips",
				});
			}).pipe(Effect.provide(Layer.provideMerge(laneTestsWork, Layer.merge(work, runner)))),
		);
		return {result, spans: asks.map((ask) => ask.spans)};
	};

	it("asks for the mutant's own line, and a mutant still surviving there answers green", async () => {
		const {result, spans} = await killed([MUTANT]);
		expect(spans).toEqual([[{file: "src/flip.ts", from: 7, to: 7}]]);
		expect(result).toBe("green");
	});

	it("a mutant no longer surviving answers red", async () => {
		expect((await killed([])).result).toBe("red");
	});
});
