import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Path} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {describe, expect, it} from "vitest";
import {runChild} from "./child.ts";
import {runEnv} from "./env.ts";
import {DEFAULT_SETTINGS, SETTINGS_FILE} from "./settings.ts";
import {
	type Loaded,
	loadSettings,
	type Source,
	sourceLine,
	type Target,
} from "./settings-source.ts";

// Where fabrika.toml is read from (docs/direction/one-fabrika-toml-per-repo.md):
// a target repository's default branch, as committed, or the folder tsh starts
// in when there is no target. The target is a local bare repository: no
// network.

type Services = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner;

/** For the fixture's own commits: no hook, no signing, no config of the machine's. */
const FIXTURE_ENV = {
	...runEnv(),
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "owner",
	GIT_AUTHOR_EMAIL: "owner@example.com",
	GIT_COMMITTER_NAME: "owner",
	GIT_COMMITTER_EMAIL: "owner@example.com",
};
const sh = (cwd: string, args: readonly string[]) =>
	runChild("git", args, {cwd, env: FIXTURE_ENV}).pipe(
		Effect.flatMap((ran) =>
			ran.code === 0
				? Effect.succeed(ran.out.trim())
				: Effect.die(new Error(`git ${args.join(" ")} failed: ${ran.err}`)),
		),
	);

/** Run `effect` in a fresh folder of its own, on the real file system and git. */
const inFolder = <A, E>(effect: (folder: string) => Effect.Effect<A, E, Services>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return yield* effect(yield* fs.makeTempDirectoryScoped());
		}).pipe(Effect.scoped, Effect.provide(nodeServices)),
	);

/**
 * A target: a bare origin with `main` as its default branch, and a working
 * copy the owner commits and pushes from. `put` commits files on a branch and
 * pushes it, answering the commit.
 */
const origin = (folder: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const bare = path.join(folder, "origin.git");
		const owner = path.join(folder, "owner");
		yield* sh(folder, ["init", "-q", "--bare", "-b", "main", bare]);
		yield* sh(folder, ["init", "-q", "-b", "main", owner]);
		yield* sh(owner, ["remote", "add", "origin", bare]);
		const put = (branch: string, files: Readonly<Record<string, string>>) =>
			Effect.gen(function* () {
				yield* sh(owner, ["checkout", "-q", "-B", branch]);
				for (const [name, text] of Object.entries(files))
					yield* fs.writeFileString(path.join(owner, name), text);
				yield* sh(owner, ["add", "-A"]);
				yield* sh(owner, ["commit", "-q", "--no-verify", "--allow-empty", "-m", branch]);
				yield* sh(owner, ["push", "-q", "--no-verify", "-f", "origin", `${branch}:${branch}`]);
				return yield* sh(owner, ["rev-parse", "HEAD"]);
			});
		const target: Target = {name: "acme/widgets", clone: path.join(folder, "clone"), url: bare};
		return {target, put};
	});

const load = (target: Target) => loadSettings({from: "repo", target});

describe("fabrika.toml from a target repository", () => {
	it("is read as committed on its default branch, in a clone made with no checkout", async () => {
		const got = await inFolder((folder) =>
			Effect.gen(function* () {
				const {target, put} = yield* origin(folder);
				const commit = yield* put("main", {
					[SETTINGS_FILE]: 'packs = ["@acme/desk"]\n\n[pack."@acme/desk"]\ndir = "desk"\n',
					"README.md": "widgets\n",
				});
				const loaded = yield* load(target);
				// No checkout: the clone's folder holds no file of the repository's.
				const fs = yield* FileSystem.FileSystem;
				const files = (yield* fs.readDirectory(target.clone)).filter((name) => name !== ".git");
				return {loaded, commit, files};
			}),
		);
		expect(got.loaded.settings).toEqual({
			packs: ["@acme/desk"],
			pack: {"@acme/desk": {dir: "desk"}},
		});
		expect(got.loaded.source).toEqual({
			from: "repo",
			name: "acme/widgets",
			branch: "main",
			commit: got.commit,
			found: true,
		});
		expect(got.files).toEqual([]);
	});

	it("a lane's branch and a file left in the clone are not read; a new commit on main is", async () => {
		const got = await inFolder((folder) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const {target, put} = yield* origin(folder);
				yield* put("main", {[SETTINGS_FILE]: 'packs = ["@acme/desk"]\n'});
				const first = yield* load(target);
				// A lane's own branch changes the file, and so does a file left in the clone's folder.
				yield* put("build/7", {[SETTINGS_FILE]: 'packs = ["@acme/lane-made"]\n'});
				yield* fs.writeFileString(
					path.join(target.clone, SETTINGS_FILE),
					'packs = ["@acme/uncommitted"]\n',
				);
				const second = yield* load(target);
				// The owner lands a change on main: the next start reads it.
				yield* sh(path.join(folder, "owner"), ["checkout", "-q", "main"]);
				const landed = yield* put("main", {[SETTINGS_FILE]: 'packs = ["@acme/landed"]\n'});
				const third = yield* load(target);
				return {first, second, third, landed};
			}),
		);
		expect(got.first.settings.packs).toEqual(["@acme/desk"]);
		expect(got.second.settings.packs).toEqual(["@acme/desk"]);
		expect(got.second.source).toEqual(got.first.source);
		expect(got.third.settings.packs).toEqual(["@acme/landed"]);
		expect(got.third.source).toMatchObject({branch: "main", commit: got.landed});
	});

	it("no fabrika.toml on the default branch: every default, and the source says it is not there", async () => {
		const got = await inFolder((folder) =>
			Effect.gen(function* () {
				const {target, put} = yield* origin(folder);
				yield* put("main", {"README.md": "widgets\n"});
				yield* put("build/7", {[SETTINGS_FILE]: 'packs = ["@acme/lane-made"]\n'});
				return yield* load(target);
			}),
		);
		expect(got.settings).toEqual(DEFAULT_SETTINGS);
		expect(got.source).toMatchObject({from: "repo", found: false});
	});

	it("a committed file that does not fit stops the read, naming the repository, branch and file", async () => {
		const why = await inFolder((folder) =>
			Effect.gen(function* () {
				const {target, put} = yield* origin(folder);
				yield* put("main", {[SETTINGS_FILE]: "packs = 1\n"});
				return (yield* Effect.flip(load(target))).why;
			}),
		);
		expect(why).toMatch(/^acme\/widgets@main:fabrika\.toml: packs: /);
	});

	it("a clone named with nowhere to clone it from, and not there: refused, never every default", async () => {
		const why = await inFolder((folder) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const clone = path.join(folder, "missing");
				return (yield* Effect.flip(load({name: clone, clone, url: null}))).why;
			}),
		);
		expect(why).toContain("fabrika.toml: no clone of ");
	});
});

describe("fabrika.toml with no target repository", () => {
	it("is read from the folder tsh starts in", async () => {
		const got = await inFolder((folder) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const file = path.join(folder, SETTINGS_FILE);
				const missing = yield* loadSettings({from: "folder", folder});
				yield* fs.writeFileString(file, 'packs = ["@acme/desk"]\n');
				const there = yield* loadSettings({from: "folder", folder});
				return {missing, there, file};
			}),
		);
		expect(got.missing).toEqual<Loaded>({
			settings: DEFAULT_SETTINGS,
			source: {from: "folder", file: got.file, found: false},
		});
		expect(got.there).toEqual<Loaded>({
			settings: {packs: ["@acme/desk"], pack: {}},
			source: {from: "folder", file: got.file, found: true},
		});
	});
});

describe("the line tsh prints at start", () => {
	const commit = "0123456789abcdef0123456789abcdef01234567";
	it.each<[Source, string]>([
		[
			{from: "repo", name: "acme/widgets", branch: "main", commit, found: true},
			"fabrika.toml: acme/widgets@main (0123456)",
		],
		[
			{from: "repo", name: "acme/widgets", branch: "main", commit, found: false},
			"fabrika.toml: acme/widgets@main (0123456), not there: every default",
		],
		[{from: "folder", file: "/w/fabrika.toml", found: true}, "fabrika.toml: /w/fabrika.toml"],
		[
			{from: "folder", file: "/w/fabrika.toml", found: false},
			"fabrika.toml: /w/fabrika.toml, not there: every default",
		],
	])("%j prints %s", (source, line) => {
		expect(sourceLine(source)).toBe(line);
	});
});
