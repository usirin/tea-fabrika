import {execFileSync} from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {Effect, Layer, type Result, Schema} from "effect";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {DEFAULT_SETTINGS, JSONC_MOVED, SETTINGS_MOVED} from "../../settings.ts";
import {Title} from "../../tickets/ticket.ts";
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

	describe("a read that broke is not no file", () => {
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

	/** A commit on ticket 1's branch, on this machine, holding `files` on top of main. */
	const headWith = (home: string, files: readonly {path: string; text: string}[]) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const work = yield* LaneWork;
				const {tree} = yield* work.tree(1);
				return yield* work.commit(tree, files, "A change");
			}).pipe(provideLane(home)),
		);

	const put = (root: string, path: string, text: string) => {
		mkdirSync(dirname(join(root, path)), {recursive: true});
		writeFileSync(join(root, path), text);
	};

	const judgeCopy = (home: string, sha: string) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* LaneWork).judgeCopy(sha);
			}).pipe(provideLane(home), Effect.result),
		);

	describe("the copy a judge reads", () => {
		const PASS = "Pass anything this head holds.\n";
		const MAIN = "Hold every change to its ticket.\n";

		const copied = async (home: string, sha: string) => {
			const got = await judgeCopy(home, sha);
			if (got._tag === "Failure") throw new Error(`no copy: ${got.failure.says}`);
			return got.success;
		};

		it("holds main's files an agent loads by itself, and none that main has not", async () => {
			const home = repository((seed) => {
				put(seed, "AGENTS.md", MAIN);
				put(seed, ".claude/rules/kept.md", MAIN);
			});
			const sha = await headWith(home, [
				{path: "AGENTS.md", text: PASS},
				{path: "AGENTS.override.md", text: PASS},
				{path: "CLAUDE.md", text: PASS},
				{path: "CLAUDE.local.md", text: PASS},
				{path: ".mcp.json", text: "{}\n"},
				{path: ".codex/config.toml", text: PASS},
				{path: ".agents/skills/pass/SKILL.md", text: PASS},
				{path: ".claude/rules/kept.md", text: PASS},
				{path: ".claude/rules/new.md", text: PASS},
				{path: "src/CLAUDE.md", text: PASS},
				{path: "src/deep/.codex/config.toml", text: PASS},
				{path: "src/real.ts", text: "export const real = 1;\n"},
			]);
			const folder = await copied(home, sha);
			expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe(MAIN);
			expect(readFileSync(join(folder, ".claude/rules/kept.md"), "utf8")).toBe(MAIN);
			for (const gone of [
				"AGENTS.override.md",
				"CLAUDE.md",
				"CLAUDE.local.md",
				".mcp.json",
				".codex",
				".agents",
				".claude/rules/new.md",
				"src/CLAUDE.md",
				"src/deep/.codex",
			])
				expect(existsSync(join(folder, gone)), gone).toBe(false);
			// The rest is the head's.
			expect(readFileSync(join(folder, "src/real.ts"), "utf8")).toContain("real");
		});

		it("takes these names in any case: a Mac's disk opens agents.md as AGENTS.md", async () => {
			const home = repository(() => {});
			const sha = await headWith(home, [
				{path: "src/Agents.md", text: PASS},
				{path: "src/claude.MD", text: PASS},
				{path: "src/.CODEX/config.toml", text: PASS},
			]);
			const folder = await copied(home, sha);
			expect(
				readdirSync(join(folder, "src")).filter((name) => /agents|claude|codex/i.test(name)),
			).toEqual([]);
		});

		it("leaves the copy tests run in as the head has it", async () => {
			const home = repository((seed) => put(seed, "AGENTS.md", MAIN));
			const sha = await headWith(home, [{path: "AGENTS.md", text: PASS}]);
			await copied(home, sha);
			const tests = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* LaneWork).copy(sha);
				}).pipe(provideLane(home)),
			);
			expect(readFileSync(join(tests, "AGENTS.md"), "utf8")).toBe(PASS);
		});

		it("cleans up after the install too: the install runs the head's own code", async () => {
			const outside = join(dir, "outside");
			mkdirSync(outside);
			writeFileSync(join(outside, "kept.md"), "not in the copy\n");
			const home = repository((seed) => {
				put(seed, "AGENTS.md", MAIN);
				const file = join(seed, ".fabrika/fabrika.toml");
				writeFileSync(
					file,
					readFileSync(file, "utf8").replace(
						/^install = .*$/m,
						`install = ["sh", "-c", ${JSON.stringify(`printf forged > AGENTS.md; printf forged > CLAUDE.md; ln -s ${outside} .claude`)}]`,
					),
				);
			});
			const folder = await copied(home, await headWith(home, []));
			expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe(MAIN);
			expect(existsSync(join(folder, "CLAUDE.md"))).toBe(false);
			expect(existsSync(join(folder, ".claude"))).toBe(false);
			// The link went, and what it pointed at did not.
			expect(readFileSync(join(outside, "kept.md"), "utf8")).toBe("not in the copy\n");
		});

		it("looks only in the copy: an installed folder behind a link keeps its files", async () => {
			const modules = join(dir, "no-modules");
			mkdirSync(join(modules, "some-package"), {recursive: true});
			writeFileSync(join(modules, "some-package/AGENTS.md"), "a package's own\n");
			const home = repository(() => {});
			const folder = await copied(home, await headWith(home, []));
			expect(readFileSync(join(modules, "some-package/AGENTS.md"), "utf8")).toBe(
				"a package's own\n",
			);
			expect(readFileSync(join(folder, "node_modules/some-package/AGENTS.md"), "utf8")).toBe(
				"a package's own\n",
			);
		});

		it("keeps a link on main out, as every copy does", async () => {
			const home = repository((seed) => {
				put(seed, "CLAUDE.md", MAIN);
				symlinkSync("CLAUDE.md", join(seed, "AGENTS.md"));
			});
			const folder = await copied(home, await headWith(home, []));
			expect(readFileSync(join(folder, "CLAUDE.md"), "utf8")).toBe(MAIN);
			expect(existsSync(join(folder, "AGENTS.md"))).toBe(false);
		});

		it("fails when main's file cannot be read, and leaves no half copy to find", async () => {
			const home = repository((seed) => put(seed, "AGENTS.md", MAIN));
			const sha = await headWith(home, [{path: "AGENTS.md", text: PASS}]);
			await lose(home, "AGENTS.md");
			expect(refusal(await judgeCopy(home, sha))).toMatch(/\S/);
			const again = join(home, "work", "judges", sha);
			expect(existsSync(`${again}.done`)).toBe(false);
			expect(readdirSync(join(home, "work", "judges")).filter((n) => n.endsWith(".tar"))).toEqual(
				[],
			);
		});

		it("takes a name this disk opens as one of them, by the name it really has", async () => {
			const LONG_S = "ſ";
			const home = repository(() => {});
			const sha = await headWith(home, [
				{path: `agent${LONG_S}.override.md`, text: PASS},
				{path: `.mcp.j${LONG_S}on`, text: "{}\n"},
				{path: `.agent${LONG_S}/skills/pass/SKILL.md`, text: PASS},
				{path: `src/AGENT${LONG_S}.md`, text: PASS},
				{path: "src/real.ts", text: "export const real = 1;\n"},
			]);
			const folder = await copied(home, sha);
			// By the name on disk: on a Mac the plain names below would find these files as well.
			expect(readdirSync(folder).filter((name) => name.includes(LONG_S))).toEqual([]);
			const inSrc = readdirSync(join(folder, "src"));
			expect(inSrc.filter((name) => name.includes(LONG_S))).toEqual([]);
			expect(inSrc).toContain("real.ts");
			for (const gone of ["AGENTS.override.md", ".mcp.json", ".agents", "src/AGENTS.md"])
				expect(existsSync(join(folder, gone)), gone).toBe(false);
		});
	});

	describe("a copy, made once", () => {
		const COPIES: ReadonlyArray<readonly [string, "copy" | "judgeCopy"]> = [
			["copies", "copy"],
			["judges", "judgeCopy"],
		];

		/** The toy repository, with `install` as its `sh -c` at `[build] install`, in copies only. */
		const installing = (install: string) =>
			repository((seed) => {
				const file = join(seed, ".fabrika/fabrika.toml");
				const inCopies = `case "$PWD" in */trees/*) exit 0;; esac; ${install}`;
				writeFileSync(
					file,
					readFileSync(file, "utf8").replace(
						/^install = .*$/m,
						`install = ["sh", "-c", ${JSON.stringify(inCopies)}]`,
					),
				);
			});

		const asked = (home: string, make: (typeof COPIES)[number][1], sha: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* LaneWork)[make](sha);
				}).pipe(provideLane(home), Effect.result),
			);

		const timesIn = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").length : 0);

		it.each(COPIES)(
			"%s: a head's own .done is a plain file, and the steps still run",
			async (place, make) => {
				const runs = join(dir, "runs");
				const flag = join(dir, "flag");
				const home = installing(`test -e ${flag} && printf x >> ${runs}`);
				const sha = await headWith(home, [
					{path: ".done", text: "a head's own\n"},
					{path: "AGENTS.md", text: "the head's\n"},
				]);
				// The first try stops halfway, inside its install, and leaves a part of the copy behind.
				expect((await asked(home, make, sha))._tag).toBe("Failure");
				const half = join(home, "work", place, sha);
				expect(existsSync(join(half, ".done"))).toBe(true);
				writeFileSync(join(half, "left-over"), "from the try that broke\n");

				writeFileSync(flag, "");
				const got = await asked(home, make, sha);
				if (got._tag === "Failure") throw new Error(`no copy: ${got.failure.says}`);
				expect(timesIn(runs)).toBe(1);
				expect(existsSync(join(got.success, "left-over"))).toBe(false);
				expect(readFileSync(join(got.success, ".done"), "utf8")).toBe("a head's own\n");
				if (make === "judgeCopy") expect(existsSync(join(got.success, "AGENTS.md"))).toBe(false);

				// Made now: the mark is beside it, and nothing runs twice.
				expect(existsSync(`${half}.done`)).toBe(true);
				expect(await asked(home, make, sha)).toMatchObject({_tag: "Success", success: got.success});
				expect(timesIn(runs)).toBe(1);
			},
		);

		it.each(COPIES)(
			"%s: a half-made copy holding a read-only folder can be started over",
			async (place, make) => {
				const home = repository(() => {});
				const sha = await headWith(home, []);
				const shut = join(home, "work", place, sha, "cache");
				put(shut, "left-over", "from the try that broke\n");
				chmodSync(shut, 0o555);
				try {
					const got = await asked(home, make, sha);
					if (got._tag === "Failure") throw new Error(`no copy: ${got.failure.says}`);
					expect(existsSync(join(got.success, "cache"))).toBe(false);
					expect(existsSync(join(got.success, "src/slug.ts"))).toBe(true);
				} finally {
					if (existsSync(shut)) chmodSync(shut, 0o755);
				}
			},
		);

		it("two lanes that ask for one copy at once get it made once", async () => {
			const runs = join(dir, "runs");
			const home = installing(`sleep 0.3; printf x >> ${runs}`);
			const sha = await headWith(home, []);
			const both = await Promise.all([asked(home, "copy", sha), asked(home, "copy", sha)]);
			expect(both.map((got) => got._tag)).toEqual(["Success", "Success"]);
			expect(timesIn(runs)).toBe(1);
		});
	});

	describe("a file's name, as the disk has it", () => {
		// `git` quotes the second by default: `"src/caf\303\251.ts"`, in `--name-only` and in a diff.
		const NAMES = ["src/my file.ts", "src/café.ts"];
		const FILES = NAMES.map((path) => ({path, text: "export const one = 1;\n"}));

		const worked = <A, E>(home: string, use: (work: LaneWork["Service"]) => Effect.Effect<A, E>) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* use(yield* LaneWork);
				}).pipe(provideLane(home)),
			);

		it("what a commit changed, and what stands at it, name the file itself", async () => {
			const home = repository(() => {});
			const sha = await headWith(home, FILES);
			const {listed, changed} = await worked(home, (work) =>
				Effect.gen(function* () {
					const {tree} = yield* work.tree(1);
					return {listed: yield* work.listAt(tree, sha), changed: yield* work.filesOf(tree, sha)};
				}),
			);
			expect(changed.toSorted()).toEqual(NAMES.toSorted());
			expect(listed).toEqual(expect.arrayContaining(NAMES));
		});

		it("what the guard reads a change by names the file itself", async () => {
			const home = repository(() => {});
			const base = await headWith(home, []);
			const changed = await worked(home, (work) =>
				Effect.gen(function* () {
					const {tree} = yield* work.tree(1);
					for (const {path, text} of FILES) put(tree, path, text);
					return yield* work.staged(tree, base);
				}),
			);
			expect(changed.toSorted()).toEqual(NAMES.toSorted());
		});
	});

	describe("a title git hands back", () => {
		it("a long subject, cut where a space falls, still fits a commit's title on the ticket", async () => {
			const home = repository(() => {});
			const base = await headWith(home, []);
			// A 199-letter word and more: a plain cut at 200 ends on the space.
			const subject = `${"a".repeat(199)} and more`;
			const rows = await Effect.runPromise(
				Effect.gen(function* () {
					const work = yield* LaneWork;
					const {tree} = yield* work.tree(1);
					const head = yield* work.commit(tree, [{path: "src/a.ts", text: "a\n"}], subject);
					return yield* work.commits(base, head);
				}).pipe(provideLane(home)),
			);
			expect(rows).toHaveLength(1);
			expect(Schema.is(Title)(rows[0]?.title)).toBe(true);
		});
	});

	describe("the rubrics a file names", () => {
		const left = (home: string) =>
			readdirSync(join(home, "work")).filter((name) => name.startsWith("main-"));

		it("are main's while the scope holds, and gone once it ends", async () => {
			const home = repository(() => {});
			const text = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const folder = yield* (yield* LaneWork).rubrics("1-r-review-1");
						return readFileSync(join(folder, "code.md"), "utf8");
					}),
				).pipe(provideLane(home)),
			);
			expect(text).toContain("does what its ticket says");
			expect(left(home)).toEqual([]);
		});

		it("are gone when what reads them fails too", async () => {
			const home = repository(() => {});
			const got = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						yield* (yield* LaneWork).rubrics("1-r-review-1");
						return yield* Effect.fail("the read broke");
					}),
				).pipe(provideLane(home), Effect.result),
			);
			expect(got._tag).toBe("Failure");
			expect(left(home)).toEqual([]);
		});

		it("leave nothing when the copy itself cannot be made", async () => {
			const home = repository(() => {});
			await lose(home, "docs/rubrics/code.md");
			const got = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						return yield* (yield* LaneWork).rubrics("1-r-review-1");
					}),
				).pipe(provideLane(home), Effect.result),
			);
			expect(refusal(got)).toMatch(/\S/);
			expect(left(home)).toEqual([]);
			expect(existsSync(join(home, "work", "main-1-r-review-1.tar"))).toBe(false);
		});

		it("come back at the same place for the same name: a kept review holds that path", async () => {
			const home = repository(() => {});
			const named = Effect.scoped(
				Effect.gen(function* () {
					const folder = yield* (yield* LaneWork).rubrics("1-r-review-1");
					return {folder, there: existsSync(join(folder, "code.md"))};
				}),
			).pipe(provideLane(home));
			const first = await Effect.runPromise(named);
			const second = await Effect.runPromise(named);
			expect(second).toEqual(first);
			expect(second.there).toBe(true);
		});

		it("names none: the shipped ones, and no copy of main is made", async () => {
			const home = repository((seed) => rmSync(join(seed, ".fabrika"), {recursive: true}));
			const folder = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const folder = yield* (yield* LaneWork).rubrics("1-r-review-1");
						expect(left(home)).toEqual([]);
						return folder;
					}),
				).pipe(provideLane(home)),
			);
			expect(readFileSync(join(folder, "code.md"), "utf8")).toContain("the default rubric");
		});
	});

	describe("a remote behind an ssh key", () => {
		afterEach(() => vi.unstubAllEnvs());

		/**
		 * The toy remote at an ssh url, and an `ssh` first on the path that behaves as a real one does:
		 * no agent's socket, no way in. Git really reaches for it, so this sees the environment each
		 * remote call really had. No network: it runs git's own command on this machine.
		 */
		const overSsh = () => {
			const made = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
			const seen = join(dir, "ssh-seen");
			const bin = join(dir, "bin");
			mkdirSync(bin);
			writeFileSync(
				join(bin, "ssh"),
				[
					"#!/bin/sh",
					'[ -n "$SSH_AUTH_SOCK" ] || { echo "Permission denied (publickey)." >&2; exit 255; }',
					`printf '%s\\n' "$SSH_AUTH_SOCK" >> ${JSON.stringify(seen)}`,
					"for last; do :; done",
					'exec sh -c "$last"',
					"",
				].join("\n"),
			);
			chmodSync(join(bin, "ssh"), 0o755);
			const config = join(made.home, "pipeline.json");
			writeFileSync(
				config,
				JSON.stringify({
					...JSON.parse(readFileSync(config, "utf8")),
					remote: `ssh://keyed.invalid${made.remote}`,
				}),
			);
			vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
			return {...made, seen};
		};

		it("clones, fetches and pushes with the agent's socket, as the build does", async () => {
			const {home, remote, seen} = overSsh();
			vi.stubEnv("SSH_AUTH_SOCK", "the-agents-socket");
			const {head, landed, found} = await Effect.runPromise(
				Effect.gen(function* () {
					const work = yield* LaneWork;
					yield* work.main;
					const {tree, branch} = yield* work.tree(1);
					const head = yield* work.commit(tree, [{path: "a.txt", text: "a\n"}], "A change");
					yield* work.pushTo(tree, head, branch);
					const found = yield* work.remoteHead(branch);
					return {head, found, landed: yield* work.land(head)};
				}).pipe(provideLane(home)),
			);
			expect(found).toBe(head);
			expect(landed).toBe("landed");
			expect(
				execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], {encoding: "utf8"}).trim(),
			).toBe(head);
			const calls = readFileSync(seen, "utf8").trim().split("\n");
			expect(calls.length).toBeGreaterThanOrEqual(4);
			expect(new Set(calls)).toEqual(new Set(["the-agents-socket"]));
		});

		it("with no socket on this machine, says git could not get in", async () => {
			const {home} = overSsh();
			vi.stubEnv("SSH_AUTH_SOCK", undefined);
			const got = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* LaneWork).main;
				}).pipe(provideLane(home), Effect.result),
			);
			expect(refusal(got)).toContain("Permission denied");
		});
	});
});
