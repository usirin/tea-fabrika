import {existsSync, readFileSync} from "node:fs";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {
	BUILD_GO_GONE,
	CHECKS_WITHIN,
	DEFAULT_SETTINGS,
	formatCommand,
	JSONC_MOVED,
	type Rules,
	readSettings,
	repoOf,
	reviewRules,
	SETTINGS_FILE,
	SETTINGS_MOVED,
	type Settings,
	settingsFrom,
} from "./settings.ts";

// One repository's .fabrika/fabrika.toml, the load rules, and the review rules
// read from it (docs/direction/one-fabrika-toml-per-repo.md).

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
	describe("where it is", () => {
		it("has one spelling, in the .fabrika folder", () => {
			expect(SETTINGS_FILE).toBe(".fabrika/fabrika.toml");
		});

		it("a file left at the root is refused with one line that says to move it", () => {
			expect(SETTINGS_MOVED).toBe("fabrika.toml moved to .fabrika/fabrika.toml: move it there");
		});

		it("a .fabrika.jsonc with no new file is refused with one line that says to move it", () => {
			expect(JSONC_MOVED).toBe(
				".fabrika.jsonc moved to [review] in .fabrika/fabrika.toml: move it there",
			);
		});
	});

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

		// A root user reads a shut folder.
		it.skipIf(process.getuid?.() === 0)(
			"a folder that cannot be read is not no file: it stops, never every default",
			async () => {
				const got = await inFolder((folder) =>
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						const path = yield* Path.Path;
						const file = path.join(folder, SETTINGS_FILE);
						yield* fs.makeDirectory(path.dirname(file), {recursive: true});
						yield* fs.writeFileString(file, 'packs = ["@acme/desk"]\n');
						yield* fs.chmod(path.dirname(file), 0o000);
						return yield* readSettings(file).pipe(
							Effect.flip,
							Effect.ensuring(Effect.orDie(fs.chmod(path.dirname(file), 0o755))),
						);
					}),
				);
				expect(got.why).toContain("cannot read");
			},
		);

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
					const path = yield* Path.Path;
					const file = path.join(folder, ".fabrika", "fabrika.toml");
					yield* fs.makeDirectory(path.dirname(file), {recursive: true});
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

		// The PR 4 review: code's checks get a time limit, in whole seconds. A hung command ends
		// `not_run`; left out, the limit is CHECKS_WITHIN.
		it("[build] checks_within is read as whole seconds", async () => {
			expect(await read("[build]\nchecks_within = 600")).toMatchObject({
				build: {checks_within: 600},
			});
		});

		it.each([
			["[build]\nchecks_within = 0", "build.checks_within: "],
			["[build]\nchecks_within = -60", "build.checks_within: "],
			["[build]\nchecks_within = 1.5", "build.checks_within: "],
			["[build]\nchecks_within = '40m'", "build.checks_within: "],
		])("refuses %s, saying %s", async (text, says) => {
			const got = await read(text);
			expect(got).toBeTypeOf("string");
			expect(got).toContain(says);
		});

		it("left out, [build] checks_within stays out, and the limit is 2400 seconds", async () => {
			const got = await read("[build]\ninstall = ['npm', 'ci']");
			expect(typeof got !== "string" && got.build).toEqual({install: ["npm", "ci"]});
			expect(CHECKS_WITHIN).toBe(2400);
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

		// Self-fix PR 3: whether a red head goes back to the builder. Left out, it does.
		it.each([false, true])("[build] send_back = %s is read as written", async (sendBack) => {
			expect(await read(`[build]\nsend_back = ${sendBack}`)).toEqual({
				packs: [],
				pack: {},
				build: {send_back: sendBack},
			});
		});

		it.each(["'no'", "3"])(
			"[build] send_back = %s, not true or false, is refused, naming its key",
			async (value) => {
				const got = await read(`[build]\nsend_back = ${value}`);
				expect(got).toBeTypeOf("string");
				expect(got).toContain("build.send_back: ");
				expect(got).not.toContain("no such key");
			},
		);
	});

	describe("[format]: the repository's formatter", () => {
		it("run names it, with {files} for the paths", async () => {
			expect(await read('[format]\nrun = ["node", "fmt.mjs", "--quiet", "{files}"]')).toEqual({
				packs: [],
				pack: {},
				format: {run: ["node", "fmt.mjs", "--quiet", "{files}"]},
			});
		});

		it.each([
			["[format]", "format.run: "],
			['[format]\nrun = ["node", "fmt.mjs"]', "{files} once"],
			['[format]\nrun = ["node", "fmt.mjs", "{files}", "{files}"]', "{files} once"],
			['[format]\nrun = ["{files}"]', "{files} once"],
			['[format]\nrun = ["node", "--files={files}"]', "{files} once"],
			[
				'[format]\nrun = ["node", "fmt.mjs", "{files}"]\ncheck = ["x"]',
				"format.check: no such key",
			],
		])("refuses %s, saying %s", async (text, says) => {
			const got = await read(text);
			expect(got).toBeTypeOf("string");
			expect(got).toContain(says);
		});

		it("{files} becomes each path, each led by ./ so none reads as an option or a pattern", () => {
			expect(
				formatCommand(
					["node", "fmt.mjs", "{files}", "--quiet"],
					["src/a.ts", "-b.ts", "c d.ts", "!e.ts", "./f.ts"],
				),
			).toEqual([
				"node",
				"fmt.mjs",
				"./src/a.ts",
				"./-b.ts",
				"./c d.ts",
				"./!e.ts",
				"./f.ts",
				"--quiet",
			]);
		});
	});

	describe("the review rules one side of a change holds", () => {
		const NONE: Rules = {governed: [], ui: []};

		it.each<[string, string | null]>([
			["no file", null],
			["an empty file", ""],
			["a file of comments only", "# nothing yet\n"],
			["no [review] table", '[build]\ninstall = ["npm", "ci"]\n'],
			["a [review] table with neither key", '[review]\nrubrics = "docs/rubrics"\n'],
		])("%s: no rules, and known", (_name, text) => {
			expect(reviewRules(text)).toEqual(NONE);
		});

		it("a key left out is an empty list, on its own", () => {
			expect(reviewRules('[review]\ngoverned = [".github/"]\n')).toEqual({
				governed: [".github/"],
				ui: [],
			});
			expect(reviewRules('[review]\nui = ["apps/web/src/"]\n')).toEqual({
				governed: [],
				ui: ["apps/web/src/"],
			});
		});

		it("both keys: their values, as written", () => {
			expect(
				reviewRules('[review]\ngoverned = [".github/", "AGENTS.md"]\nui = ["apps/web/src/"]\n'),
			).toEqual({governed: [".github/", "AGENTS.md"], ui: ["apps/web/src/"]});
		});

		it.each<[string, string]>([
			["not TOML", "[review\ngoverned = "],
			["JSON with comments, the old file's way", '{\n\t// a note\n\t"governedRoots": [],\n}\n'],
			["[review] that is not a table", 'review = "all"\n'],
			["governed that is not a list", '[review]\ngoverned = ".github/"\n'],
			["governed with something other than text in it", '[review]\ngoverned = [".github/", 3]\n'],
			["governed with an empty text in it", '[review]\ngoverned = [""]\n'],
			["ui that is not a list", '[review]\nui = "apps/web/src/"\n'],
			["ui with something other than text in it", "[review]\nui = [3]\n"],
			["ui with an empty text in it", '[review]\nui = [""]\n'],
			["the old shape of ui", '[[review.ui]]\nprefix = "apps/web/src/"\n'],
		])("%s: the rules are not known", (_name, text) => {
			expect(reviewRules(text)).toBeNull();
		});

		it.each<[string, string]>([
			["an unknown table", "[failure]\nfloor = 0.9\n"],
			["an unknown top-level key", 'pakcs = ["@acme/desk"]\n'],
			["keys fabrika no longer reads", '[build]\ngo = "label"\n'],
			["a pick the load refuses", '[checks]\ngithub = "none"\n'],
			["a value elsewhere that does not fit", "packs = 1\n"],
		])("%s elsewhere in the file leaves the rules known: only [review] is read", (_name, rest) => {
			expect(reviewRules(`${rest}\n[review]\ngoverned = [".github/"]\n`)).toEqual({
				governed: [".github/"],
				ui: [],
			});
		});

		it("the old keys are not rules", () => {
			expect(reviewRules('governedRoots = ["a/"]\n')).toEqual(NONE);
		});
	});

	describe("this repository's own file", () => {
		const ROOT = new URL("../../../", import.meta.url);
		/** The file as the load rules take it: one they refuse fails the test that asks, saying why. */
		const loaded = async () => {
			const settings = await read(readFileSync(new URL(SETTINGS_FILE, ROOT), "utf8"));

			if (typeof settings === "string") {
				throw new Error(settings);
			}

			return settings;
		};

		it("passes the load rules, and [review] rubrics names a folder that holds every rubric", async () => {
			const folder = (await loaded()).review?.rubrics;

			if (folder === undefined) {
				throw new Error("[review] rubrics is not named");
			}

			const missing = ["code.md", "doc.md", "skill.md"].filter(
				(file) => !existsSync(new URL(`${folder}/${file}`, ROOT)),
			);
			expect(missing).toEqual([]);
		});

		it("[format] run is the format half of pnpm lint, and a file it skips is no failure", async () => {
			const run = (await loaded()).format?.run ?? [];
			expect(run.slice(0, 2)).toEqual(["node", "oxlint-plugins/format.ts"]);
			expect(run).toContain("--no-error-on-unmatched-pattern");
			expect(existsSync(new URL(run[1] ?? "", ROOT))).toBe(true);
		});

		it("[build] checks_within is 2400 seconds: twice the slowest full test run measured, about 20 minutes", async () => {
			expect((await loaded()).build?.checks_within).toBe(2400);
		});

		it("each [[checks.run]] installs before it runs: a fresh copy of a head has no node_modules", async () => {
			const checks = (await loaded()).checks?.run ?? [];
			expect(checks).not.toEqual([]);

			for (const {run} of checks) {
				expect(run).toHaveLength(3);
				expect(run.slice(0, 2)).toEqual(["sh", "-c"]);
				expect(run[2]).toMatch(/^pnpm install --frozen-lockfile && \S/);
			}
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
