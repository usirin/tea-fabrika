import {execFileSync} from "node:child_process";
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer, type Result} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DEFAULT_SETTINGS, JSONC_MOVED, SETTINGS_MOVED} from "../../settings.ts";
import {makeLaneHome} from "./lane-fixture.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// The lane reads a repository's settings at main's tip, in a clone of its own, on real git over a
// bare remote. Today's version.

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

describe("the settings a lane works by", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-work-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	/** The toy repository's main, with `change` committed and pushed in its seed. */
	const repository = (change: (seed: string) => void) => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const git = (...args: readonly string[]) =>
			execFileSync("git", args, {cwd: seed, env: {...process.env, ...IDENTITY}, stdio: "pipe"});
		change(seed);
		git("add", "-A");
		git("commit", "--quiet", "--allow-empty", "-m", "change");
		git("push", "--quiet", "origin", "main");
		return home;
	};

	const provideLane = (home: string) =>
		Effect.provide(
			laneWork.pipe(Layer.provide(Layer.succeed(LaneHome, {home, briefs: "", person: "owner"}))),
		);

	const settingsIn = (home: string) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* LaneWork).settings;
			}).pipe(provideLane(home), Effect.result),
		);

	/** What a read that had to fail says. It read after all: the test fails, and says so. */
	const refusal = <A>(got: Result.Result<A, {readonly says?: string}>) => {
		if (got._tag === "Success") throw new Error("read, not refused");
		return got.failure.says;
	};

	it("reads the nested file at main", async () => {
		const got = await settingsIn(repository(() => {}));
		expect(got).toMatchObject({
			_tag: "Success",
			success: {review: {rubrics: "docs/rubrics"}},
		});
	});

	it("a file left at the root beside the new one is refused", async () => {
		const home = repository((seed) => {
			writeFileSync(join(seed, "fabrika.toml"), "");
		});
		const got = await settingsIn(home);
		if (got._tag === "Success") throw new Error("read, not refused");
		expect(got.failure.says).toContain(SETTINGS_MOVED);
	});

	it("a file left at the root with none in the folder is refused, never read as every default", async () => {
		const home = repository((seed) => {
			writeFileSync(join(seed, "fabrika.toml"), "");
			rmSync(join(seed, ".fabrika"), {recursive: true});
		});
		const got = await settingsIn(home);
		if (got._tag === "Success") throw new Error("read, not refused");
		expect(got.failure.says).toContain(SETTINGS_MOVED);
	});

	it("a .fabrika.jsonc beside the new file is not refused, and the new file is read", async () => {
		const home = repository((seed) => {
			writeFileSync(join(seed, ".fabrika.jsonc"), "{}\n");
		});
		expect(await settingsIn(home)).toMatchObject({
			_tag: "Success",
			success: {review: {rubrics: "docs/rubrics"}},
		});
	});

	it("only a .fabrika.jsonc at main is refused: its governed folders would read as none", async () => {
		const home = repository((seed) => {
			writeFileSync(join(seed, ".fabrika.jsonc"), "{}\n");
			rmSync(join(seed, ".fabrika"), {recursive: true});
		});
		expect(refusal(await settingsIn(home))).toBe(JSONC_MOVED);
	});

	it.each<[string, boolean]>([
		["with only a .fabrika.jsonc", false],
		["with both others", true],
	])("a file left at the root %s says to move that one", async (_name, keep) => {
		const home = repository((seed) => {
			writeFileSync(join(seed, "fabrika.toml"), "");
			writeFileSync(join(seed, ".fabrika.jsonc"), "{}\n");
			if (!keep) rmSync(join(seed, ".fabrika"), {recursive: true});
		});
		expect(refusal(await settingsIn(home))).toBe(SETTINGS_MOVED);
	});

	it("none of them at main: every default", async () => {
		const home = repository((seed) => {
			rmSync(join(seed, ".fabrika"), {recursive: true});
		});
		expect(await settingsIn(home)).toMatchObject({_tag: "Success", success: DEFAULT_SETTINGS});
	});

	describe("a read that broke is not no file", () => {
		/** The object `path` names at main, deleted from the lane's clone: git exits 128 reading it. */
		const lose = (home: string, path: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					yield* (yield* LaneWork).main;
				}).pipe(provideLane(home)),
			).then(() => {
				const clone = join(home, "work", "clone");
				const sha = execFileSync("git", ["rev-parse", `origin/main:${path}`], {
					cwd: clone,
					encoding: "utf8",
				}).trim();
				rmSync(join(clone, ".git", "objects", sha.slice(0, 2), sha.slice(2)));
			});

		it("the file that cannot be read fails the settings, with the reason", async () => {
			const home = repository(() => {});
			await lose(home, ".fabrika/fabrika.toml");
			expect(refusal(await settingsIn(home))).toMatch(/\S/);
		});

		it("the folder that cannot be listed fails the settings, with the reason", async () => {
			const home = repository(() => {});
			await lose(home, ".fabrika");
			expect(refusal(await settingsIn(home))).toMatch(/\S/);
		});

		it("a leftover at the root that cannot be read does not skip the refusal", async () => {
			const home = repository((seed) => {
				writeFileSync(join(seed, "fabrika.toml"), "# left behind\n");
			});
			await lose(home, "fabrika.toml");
			expect(refusal(await settingsIn(home))).toMatch(/\S/);
		});

		/** `show`, of `path` at main's tip. */
		const showAtMain = (home: string, path: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const work = yield* LaneWork;
					return yield* work.show(yield* work.main, path);
				}).pipe(provideLane(home), Effect.result),
			);

		it("show: a file that is there comes back as it was written, to the last newline", async () => {
			const home = repository((seed) => {
				writeFileSync(join(seed, "notes.txt"), "line\n\n");
			});
			expect(await showAtMain(home, "notes.txt")).toMatchObject({success: "line\n\n"});
		});

		it.each<[string, string]>([
			["a file", "no-such-file"],
			["a folder and a file", "no/such/file"],
		])("show: %s that is not there is null", async (_name, path) => {
			const home = repository(() => {});
			expect(await showAtMain(home, path)).toMatchObject({_tag: "Success", success: null});
		});

		it("show: a file that cannot be read fails, with the reason", async () => {
			const home = repository(() => {});
			await lose(home, ".fabrika/fabrika.toml");
			expect(refusal(await showAtMain(home, ".fabrika/fabrika.toml"))).toMatch(/\S/);
		});

		it("show: a commit that is not there fails, with the reason", async () => {
			const home = repository(() => {});
			const got = await Effect.runPromise(
				Effect.gen(function* () {
					const work = yield* LaneWork;
					yield* work.main;
					return yield* work.show("0".repeat(40), "README.md");
				}).pipe(provideLane(home), Effect.result),
			);
			expect(refusal(got)).toMatch(/\S/);
		});
	});
});
