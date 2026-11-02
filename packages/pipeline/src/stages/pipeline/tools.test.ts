import {mkdtempSync, realpathSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {Settings} from "../../settings.ts";
import {placeIn} from "../mutation/mutant.ts";
import {spansOf} from "../mutation/scope.ts";
import {MutationRunner, MutationScope, type RunAsk} from "../mutation/services.ts";
import {TestsWork} from "../test-writer/program.ts";
import {CheckRunner} from "./checks.ts";
import {makeLaneHome} from "./lane-fixture.ts";
import {laneCheckRunner, laneMutationScope, laneTestsWork} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Today's version. The mutation step's read of a change, on real git over a bare remote.

describe("the lines the mutation step reads from a change", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-scope-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	it("a changed file with a space or a non-ASCII letter in its name gets its span", async () => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
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
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		const asks: RunAsk[] = [];
		const onLines = (ask: RunAsk) =>
			surviving.filter((mutant) => {
				const {file, line} = placeIn(mutant);
				return ask.spans.some((s) => s.file === file && s.from <= line && line <= s.to);
			});
		const runner = Layer.succeed(MutationRunner, {
			tests: () => Effect.succeed({result: "green", failed: [], tail: ""} as const),
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

// Self-fix PR 4: code runs `[build] checks` after every build. A repository whose settings name
// none has nothing that says a head holds, so the checks are not run, never green.
describe("code's checks, as the repository's settings name them", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-checks-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	/** The fixture's real lane work, with `change` made to it. */
	const workWith = (change: (work: LaneWork["Service"]) => LaneWork["Service"]) => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const real = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		return Layer.effect(
			LaneWork,
			Effect.gen(function* () {
				return change(yield* LaneWork);
			}),
		).pipe(Layer.provide(real));
	};
	/** Code's checks at ticket 1's base, over `work`. */
	const checkedOver = (work: Layer.Layer<LaneWork>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const {base} = yield* (yield* LaneWork).tree(1);
				return yield* (yield* CheckRunner).run(base);
			}).pipe(Effect.provide(Layer.provideMerge(laneCheckRunner, work))),
		);
	/** The settings' `[build]` table, as `change` makes it. */
	type Build = NonNullable<Settings["build"]>;
	const buildWith =
		(change: (build: Build) => Build) =>
		(work: LaneWork["Service"]): LaneWork["Service"] => ({
			...work,
			settings: Effect.map(work.settings, (s) => ({...s, build: change(s.build ?? {})})),
		});

	it("are not_run when the settings name no `[build] checks`", async () => {
		// The fixture's own settings, with `[build] checks` left out.
		const checked = await checkedOver(workWith(buildWith(({checks: _, ...build}) => build)));
		expect(checked).toMatchObject({commands: [], result: "not_run", failed: []});
	});

	// The PR 4 review: a hung command ends at `[build] checks_within`, as the settings say it.
	it(
		"end a command that runs past `[build] checks_within` as not_run that says it timed out",
		{timeout: 60_000},
		async () => {
			const started = Date.now();
			const checked = await checkedOver(
				workWith(buildWith((build) => ({...build, checks: [["sleep", "20"]], checks_within: 1}))),
			);
			expect(Date.now() - started).toBeLessThan(15_000);
			expect(checked).toMatchObject({result: "not_run", failed: []});
			expect(checked.tail).toMatch(/timed out/);
		},
	);

	// The PR 4 review: what git or an install says when a copy or the settings fail goes on a
	// public ticket. A home path in it shows as `~`, and a key in it is cut.
	describe("say no home path and no key when", () => {
		const mine = join(homedir(), "code", "acme");
		const key = `ghp_${"Ab3".repeat(12)}`;
		const says = `fatal: could not read ${mine}/.git: the remote said ${key}`;
		const failed = {_tag: "unknown", says} as const;

		it.each([
			[
				"the settings could not be read",
				(work: LaneWork["Service"]) => ({...work, settings: Effect.fail(failed)}),
			],
			[
				"the copy of the head could not be made",
				(work: LaneWork["Service"]) => ({...work, copy: () => Effect.fail(failed)}),
			],
		])("%s", async (_, change) => {
			const checked = await checkedOver(workWith(change));
			expect(checked.result).toBe("not_run");
			expect(checked.tail).toContain("~/code/acme");
			expect(checked.tail).not.toContain(homedir());
			expect(checked.tail).toContain("[key cut]");
			expect(checked.tail).not.toContain(key);
		});
	});
});
