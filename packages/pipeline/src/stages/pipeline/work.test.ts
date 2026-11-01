import {execFileSync} from "node:child_process";
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {SETTINGS_MOVED} from "../../settings.ts";
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

	const settingsIn = (home: string) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* LaneWork).settings;
			}).pipe(
				Effect.provide(laneWork),
				Effect.provide(Layer.succeed(LaneHome, {home, briefs: "", person: "owner"})),
				Effect.result,
			),
		);

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

	it("a .fabrika.jsonc at main is not refused", async () => {
		const home = repository((seed) => {
			writeFileSync(join(seed, ".fabrika.jsonc"), "{}\n");
		});
		expect(await settingsIn(home)).toMatchObject({_tag: "Success"});
	});
});
