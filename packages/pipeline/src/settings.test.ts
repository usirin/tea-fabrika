import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {
	BUILD_GO_GONE,
	DEFAULT_SETTINGS,
	readSettings,
	repoOf,
	SETTINGS_FILE,
	type Settings,
	settingsFrom,
} from "./settings.ts";

// One repository's fabrika.toml, and the three load rules
// (docs/direction/one-fabrika-toml-per-repo.md).

/** The settings `text` makes, or why it is refused. */
const read = (text: string): Promise<Settings | string> =>
	Effect.runPromise(
		settingsFrom(text).pipe(
			Effect.match({onSuccess: (settings) => settings, onFailure: (error) => error.why}),
		),
	);

/** Run `effect` in a fresh folder of its own, on the real file system. */
const inFolder = <A, E>(
	effect: (folder: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return yield* effect(yield* fs.makeTempDirectoryScoped());
		}).pipe(Effect.scoped, Effect.provide(nodeServices)),
	);

describe("fabrika.toml", () => {
	describe("rule 1: an empty or missing file changes nothing", () => {
		it("an empty file: no packs, no pack settings", async () => {
			expect(await read("")).toEqual({packs: [], pack: {}});
			expect(DEFAULT_SETTINGS).toEqual({packs: [], pack: {}});
		});

		it("a file of comments only is empty too", async () => {
			expect(await read("# packs come later\n")).toEqual(DEFAULT_SETTINGS);
		});

		it("no file at the root: every default", async () => {
			const got = await inFolder((folder) => readSettings(`${folder}/${SETTINGS_FILE}`));
			expect(got).toEqual(DEFAULT_SETTINGS);
		});

		it("a pack listed with no table of its own: listed, with no settings", async () => {
			expect(await read('packs = ["@acme/desk"]')).toEqual({packs: ["@acme/desk"], pack: {}});
		});
	});

	describe("rule 2: an unknown key or table fails", () => {
		it.each([
			['pakcs = ["@acme/desk"]', "pakcs"],
			["[failure]\nfloor = 0.9", "failure"],
			["[lane]\nattempts = 3", "lane"],
		])("refuses %s, naming %s", async (text, key) => {
			expect(await read(text)).toBe(`${key}: no such key or table`);
		});

		it("a pack's table that packs does not list: a typo in the name is not ignored", async () => {
			const got = await read('packs = ["@acme/desk"]\n\n[pack."@acme/dsk"]\nview = "markdown"\n');
			expect(got).toBe('pack."@acme/dsk": packs does not list it');
		});

		it("a pack's own keys are the pack's to check, not this file's", async () => {
			expect(await read('packs = ["@acme/desk"]\n\n[pack."@acme/desk"]\nanything = 1\n')).toEqual({
				packs: ["@acme/desk"],
				pack: {"@acme/desk": {anything: 1}},
			});
		});
	});

	describe("rule 3: a value that does not fit fails, and names its key", () => {
		it.each([
			['packs = "@acme/desk"', "packs: "],
			['packs = ["@acme/desk", 3]', "packs[1]: "],
			['packs = [""]', "packs[0]: a pack is named by its package"],
			['packs = ["@acme/desk"]\npack = 3', "pack: "],
			['packs = ["@acme/desk"]\n[pack]\n"@acme/desk" = 3', 'pack."@acme/desk": '],
			["packs = ", "not TOML"],
		])("refuses %s, saying %s", async (text, says) => {
			const got = await read(text);
			expect(got).toBeTypeOf("string");
			expect(got).toContain(says);
		});

		it("the file's own path leads the message, so a person knows which file to fix", async () => {
			const got = await inFolder((folder) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const file = `${folder}/${SETTINGS_FILE}`;
					yield* fs.writeFileString(file, "packs = 1\n");
					return yield* readSettings(file).pipe(Effect.flip);
				}),
			);
			expect(got.why).toMatch(/fabrika\.toml: packs: /);
		});
	});

	describe("a repository's own picks", () => {
		const whole = [
			"[agents.build]",
			'model = "haiku"',
			'effort = "low"',
			"usd = 0.5",
			"[agents.review]",
			'model = "sonnet"',
			"[build]",
			'install = ["npm", "ci"]',
			'checks = [["npm", "test"]]',
			"[review]",
			'rubrics = "docs/rubrics"',
			'governed = [".github/"]',
			"[checks]",
			'github = "none"',
			"[[checks.run]]",
			'name = "test"',
			'run = ["npm", "test"]',
			"[ship]",
			'approval = "none"',
			"[ledger]",
			'at = "sqlite"',
		].join("\n");

		it("each table is read as written, and what it leaves out stays out", async () => {
			expect(await read(whole)).toEqual({
				packs: [],
				pack: {},
				agents: {build: {model: "haiku", effort: "low", usd: 0.5}, review: {model: "sonnet"}},
				build: {install: ["npm", "ci"], checks: [["npm", "test"]]},
				review: {rubrics: "docs/rubrics", governed: [".github/"]},
				checks: {github: "none", run: [{name: "test", run: ["npm", "test"]}]},
				ship: {approval: "none"},
				ledger: {at: "sqlite"},
			});
		});

		it.each([
			["[agents.mutation]\nmodel = 'haiku'", "agents.mutation: no such key or table"],
			["[agents.build]\neffort = 'max'", "agents.build.effort: "],
			["[agents.build]\nusd = 0", "agents.build.usd: "],
			["[build]\ninstall = ['']", "build.install[0]: an empty word"],
			["[build]\nchecks = [[]]", "build.checks[0][0]: "],
			["[review]\nrubrics = '/etc/rubrics'", "review.rubrics: a path inside the repository"],
			["[review]\nrubrics = 'docs/../../x'", "review.rubrics: a path inside the repository"],
			["[checks]\ngithub = 'some'", "checks.github: "],
			["[ship]\napproval = 'admins'", "ship.approval: "],
			["[ledger]\nat = 'https://ledger.example'", "ledger.at: "],
		])("refuses %s, saying %s", async (text, says) => {
			const got = await read(text);
			expect(got).toBeTypeOf("string");
			expect(got).toContain(says);
		});

		it.each([
			"[build]\ngo = 'label'",
			"[build]\ngo = 'plan'",
			"[build]\nlabel = 'agent-ok'",
			"[build]\ngo = 'label'\nlabel = 'agent-ok'\ninstall = ['npm', 'ci']",
		])("build.go or build.label is refused in one line: %s", async (text) => {
			expect(await read(text)).toBe(BUILD_GO_GONE);
		});

		it("GitHub's checks counted for nothing with no check of fabrika's own is refused", async () => {
			expect(await read("[checks]\ngithub = 'none'")).toContain("would pass a change on no check");
		});
	});

	describe("the repository a folder is in", () => {
		it("is the nearest folder up that holds .git, a folder or a working copy's file", async () => {
			const got = await inFolder((folder) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					const root = path.join(folder, "clone");
					yield* fs.makeDirectory(path.join(root, ".git"), {recursive: true});
					yield* fs.makeDirectory(path.join(root, "packages", "a", "src"), {recursive: true});
					const tree = path.join(folder, "tree");
					yield* fs.makeDirectory(path.join(tree, "docs"), {recursive: true});
					yield* fs.writeFileString(path.join(tree, ".git"), `gitdir: ${root}/.git/worktrees/t\n`);
					return {
						deep: yield* repoOf(path.join(root, "packages", "a", "src")),
						rootItself: yield* repoOf(root),
						inTree: yield* repoOf(path.join(tree, "docs")),
						root,
						tree,
					};
				}),
			);
			expect(got.deep).toBe(got.root);
			expect(got.rootItself).toBe(got.root);
			expect(got.inTree).toBe(got.tree);
		});

		it("outside any repository, the folder itself", async () => {
			const got = await inFolder((folder) =>
				Effect.map(repoOf(folder), (repo) => ({repo, folder})),
			);
			expect(got.repo).toBe(got.folder);
		});
	});
});
