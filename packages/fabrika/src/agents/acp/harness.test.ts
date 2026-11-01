import {spawnSync} from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {ear} from "../../program/ear.ts";
import {start} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {LOGIN_FILES, temps} from "../claude/sandbox.ts";
import {codexEnvOf, flagsOf} from "../codex/adapter.ts";
import {
	codexConfig,
	codexHome,
	codexHomeOf,
	type Disk,
	depthFor,
	FENCE_LIMIT,
	type FolderAccess,
	fenceTooBig,
	harnessOf,
	homeFence,
	listFolder,
	localDisk,
	type Row,
	withSystem,
} from "./harness.ts";
import {acpProgram} from "./program.ts";

// The codex row (experiment 153): what the adapter is handed, and the Codex home it is given.
// No adapter is started and no model is called: a made-up home stands in for the owner's.

/** A made-up login in the shape Codex writes: the plan, no key. No real token. */
const PLAN = JSON.stringify({auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {id_token: "x"}});

const fakeHome = () => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "codex-row-")));
	mkdirSync(join(home, ".codex"));
	writeFileSync(join(home, ".codex", "auth.json"), PLAN);
	return home;
};

const parentOf = (home: string) => ({
	PATH: "/usr/bin:/bin",
	HOME: home,
	USER: "someone",
	TMPDIR: tmpdir(),
	OPENAI_API_KEY: "kept-out",
	CODEX_API_KEY: "kept-out",
	TYPESAFE_API_KEY: "kept-out",
});

/** A folder that is there, by its real path. A table has no line for one that is not. */
const scratchFolder = () => realpathSync(mkdtempSync(join(tmpdir(), "a-scratch-folder-")));

describe("the codex row", () => {
	it("hands the adapter a keep-list: its own home, workspace-write, no key", () => {
		const home = fakeHome();
		const folder = join(tmpdir(), "a-scratch-folder");
		const h = harnessOf({name: "codex", access: "write"}, folder, null, parentOf(home));
		const codex = codexHomeOf(folder, parentOf(home));
		expect(Object.keys(h.env).sort()).toEqual(
			[
				"CODEX_CONFIG",
				"CODEX_HOME",
				"HOME",
				"INITIAL_AGENT_MODE",
				"NO_BROWSER",
				"PATH",
				"TMPDIR",
				"USER",
			].sort(),
		);
		expect(h.env.CODEX_HOME).toBe(codex);
		// Codex reads skills from ~/.agents too: home is its own home.
		expect(h.env.HOME).toBe(codex);
		expect(h.env.INITIAL_AGENT_MODE).toBe("workspace-write");
		expect(h.prepare).toBeDefined();
		// Planted in the parent: no key may reach Codex, or a plan run could bill it.
		for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "TYPESAFE_API_KEY"])
			expect(h.env[key]).toBeUndefined();
		expect(JSON.stringify(h.env)).not.toContain("kept-out");
	});

	it("keeps the Codex home out of the folder and the temp folders the agent may write", () => {
		const home = fakeHome();
		const folder = join(tmpdir(), "a-scratch-folder");
		const codex = codexHomeOf(folder, parentOf(home));
		expect(codex.startsWith(`${home}/.cache/`)).toBe(true);
		// The fake home is itself under a temp folder here; a real home is not.
		expect(codex.startsWith(folder)).toBe(false);
		expect(codexHomeOf(`${folder}-2`, parentOf(home))).not.toBe(codex);
		expect(temps().length).toBeGreaterThan(0);
	});

	it("merges a config with home unreadable, features off and a plain shell", () => {
		const home = fakeHome();
		const folder = scratchFolder();
		const config = JSON.parse(
			harnessOf({name: "codex", access: "write"}, folder, null, parentOf(home)).env.CODEX_CONFIG ??
				"",
		);
		expect(config.default_permissions).toBe("fenced");
		const fs = config.permissions.fenced.filesystem as Record<string, string>;
		expect(fs[home]).toBe("deny");
		expect(fs[folder]).toBe("write");
		expect(config.shell_environment_policy).toEqual({inherit: "core"});
		expect(config.allow_login_shell).toBe(false);
		expect(config.web_search).toBe("disabled");
		for (const feature of ["apps", "plugins", "browser_use", "computer_use", "multi_agent"])
			expect(config.features[feature]).toBe(false);
	});

	it("tells an agent's commands where a version manager holds the real tools, and nothing else", () => {
		const home = fakeHome();
		const parent = {...parentOf(home), VOLTA_HOME: `${home}/.volta`, SOME_SECRET: "not-a-secret"};
		const config = JSON.parse(
			harnessOf({name: "codex", access: "write"}, "/f", null, parent).env.CODEX_CONFIG ?? "",
		);
		expect(config.shell_environment_policy).toEqual({
			inherit: "core",
			set: {VOLTA_HOME: `${home}/.volta`},
		});
	});

	// A `codex` that is itself a Volta shim, with no VOLTA_HOME set, under Codex's own home: it would
	// look along the PATH, find itself and chain.
	it("hands a Codex that is a Volta shim its tools' home, on the adapter's way and the row's", () => {
		const home = fakeHome();
		const parent = {...parentOf(home), PATH: `${home}/.volta/bin:/usr/bin:/bin`};
		expect(codexEnvOf(parent, "/own").VOLTA_HOME).toBe(`${home}/.volta`);
		const row = harnessOf({name: "codex", access: "write"}, "/f", null, parent);
		expect(row.env.VOLTA_HOME).toBe(`${home}/.volta`);
		expect(JSON.parse(row.env.CODEX_CONFIG ?? "").shell_environment_policy.set).toEqual({
			VOLTA_HOME: `${home}/.volta`,
		});
	});

	it("starts a read row read-only, its folder only readable, and keeps that through a system prompt", () => {
		const home = fakeHome();
		const folder = scratchFolder();
		const parent = parentOf(home);
		const row = harnessOf({name: "codex", access: "read"}, folder, null, parent);
		const told = withSystem(row, {_tag: "append", text: "Only look."}, folder, parent);
		for (const h of [row, told]) {
			expect(h.env.INITIAL_AGENT_MODE).toBe("read-only");
			const config = JSON.parse(h.env.CODEX_CONFIG ?? "");
			expect(config.permissions.fenced.extends).toBe(":read-only");
			expect(config.permissions.fenced.filesystem[folder]).toBe("read");
		}
	});

	it("cannot be asked for without saying what the folder allows", () => {
		// No default: a turn that only reads must not get a writable folder because `access` was left out.
		// @ts-expect-error the codex row needs `access`.
		const bare: Row = "codex";
		// @ts-expect-error the same, as an object.
		const nameOnly: Row = {name: "codex"};
		// @ts-expect-error `codexConfig` takes it too.
		const config = codexConfig("/f", [], "/h", undefined, disk({}));
		expect([bare, nameOnly, typeof config]).toEqual(["codex", {name: "codex"}, "object"]);
	});

	it("opens a folder under home with home itself left open, the folder's siblings closed", () => {
		const home = fakeHome();
		const folder = join(home, "work", "copy");
		mkdirSync(folder, {recursive: true});
		mkdirSync(join(home, "beside"));
		const config = JSON.parse(
			harnessOf({name: "codex", access: "write"}, folder, null, parentOf(home)).env.CODEX_CONFIG ??
				"",
		);
		const fs = config.permissions.fenced.filesystem;
		expect(fs[home]).toBeUndefined();
		expect(fs[join(home, "work")]).toBeUndefined();
		expect(fs[folder]).toBe("write");
		// By name or by pattern, as the system's box can take: both are tested below, here it is closed.
		expect(Object.keys(fs).filter((key) => key.startsWith(`${home}/`))).not.toEqual([folder]);
	});
});

/**
 * A made-up disk: a folder's entries by path, a trailing `@` for a link. A folder not named cannot be
 * read. Every path is its own real path, and every entry is listed by name, unless `more` says.
 */
const disk = (
	tree: Readonly<Record<string, readonly string[]>>,
	more: Partial<Disk> = {},
): Disk => ({
	list: (folder) =>
		tree[folder]?.map((name) => ({name: name.replace(/@$/, ""), link: name.endsWith("@")})) ?? null,
	real: (path) => path,
	depth: 0,
	...more,
});

/** A made-up disk that must not be listed: nothing is opened under home. */
const noWalk: Disk = {
	...disk({}),
	list: () => {
		throw new Error("nothing under home to walk for");
	},
};

/** `real`, from the paths that are links or spelled another way. Any other path is its own. */
const linked =
	(links: Readonly<Record<string, string | null>>): Disk["real"] =>
	(path) => {
		const there = links[path];
		return there === undefined ? path : there;
	};

/** What a home at `/h` always closes, by name. */
const ALWAYS = {
	"/h/.git-credentials": "deny",
	"/h/.config/gh": "deny",
	"/h/.ssh": "deny",
	"/h/.netrc": "deny",
	"/h/.npmrc": "deny",
	"/h/.aws": "deny",
	"/h/.codex/auth.json": "deny",
	"/h/.cache/tea-fabrika/codex": "deny",
	"/h/.codex": "deny",
};

/** The lines that open something. */
const openLines = (table: Readonly<Record<string, string>>) =>
	Object.entries(table).filter(([, rule]) => rule !== "deny");

describe("the fence, from real paths", () => {
	it.each<[string, string, Readonly<Record<string, string>>]>([
		["a link to a login folder", "/h/t", {"/h/t": "/h/.ssh"}],
		["a link to home", "/h/t", {"/h/t": "/h"}],
		["a link above home", "/h/t", {"/h/t": "/"}],
		["a link to a folder that holds a login", "/h/t", {"/h/t": "/h/.config"}],
		["a link to .codex", "/h/t", {"/h/t": "/h/.codex"}],
		["a link to the login file", "/h/t", {"/h/t": "/h/.codex/auth.json"}],
		["under a link to a login folder", "/h/dir/sub", {"/h/dir/sub": "/h/.ssh/sub"}],
		["outside home, a link to a login", "/tmp/t", {"/tmp/t": "/h/.ssh"}],
	])("gives a read line that is %s no line, and keeps the login closed", (_, tool, links) => {
		const table = homeFence(
			"/h",
			[tool],
			"/tmp/copy",
			"write",
			disk({"/h": [".ssh", ".config", ".codex", "t@", "dir"]}, {real: linked(links)}),
		);
		expect(openLines(table)).toEqual([["/tmp/copy", "write"]]);
		expect(table["/h"]).toBe("deny");
		expect(table["/h/.ssh"]).toBe("deny");
	});

	it.each<[string, Readonly<Record<string, string>>]>([
		["a login folder", {"/h/t": "/h/.ssh"}],
		["home", {"/h/t": "/h"}],
		["the Codex folder", {"/h/t": "/h/.codex"}],
	])("gives a read turn's folder that links to %s no line", (_, links) => {
		const table = homeFence("/h", [], "/h/t", "read", disk({"/h": ["t@"]}, {real: linked(links)}));
		expect(openLines(table)).toEqual([]);
		expect(table["/h"]).toBe("deny");
	});

	it("gives a read line that is a link to a harmless folder its real path, and closes the link", () => {
		const table = homeFence(
			"/h",
			["/h/t"],
			"/h/dev/copy",
			"write",
			disk(
				{"/h": ["t@", "tools", "dev@", "work"], "/h/tools": ["x"], "/h/work": ["copy", "old"]},
				{real: linked({"/h/t": "/h/tools/x", "/h/dev/copy": "/h/work/copy"})},
			),
		);
		expect(table).toEqual({
			...ALWAYS,
			"/h/t": "deny",
			"/h/dev": "deny",
			"/h/work/old": "deny",
			"/h/tools/x": "read",
			"/h/work/copy": "write",
		});
	});

	it("gives a path that is not there no line, and walks for nothing on its way", () => {
		const table = homeFence(
			"/h",
			["/h/gone/tool", "/h/.volta"],
			"/h/gone/copy",
			"write",
			disk(
				{"/h": [".volta", "gone"]},
				{real: linked({"/h/gone/tool": null, "/h/gone/copy": null})},
			),
		);
		expect(table).toEqual({...ALWAYS, "/h/gone": "deny", "/h/.volta": "read"});
	});

	it("closes a login's real target as well as its written path, inside the opened folder too", () => {
		const table = homeFence(
			"/h",
			[],
			"/h/copy",
			"write",
			disk({"/h": ["copy", ".ssh@"]}, {real: linked({"/h/.ssh": "/h/copy/keys"})}),
		);
		expect(table["/h/copy"]).toBe("write");
		expect(table["/h/copy/keys"]).toBe("deny");
		expect(table["/h/.ssh"]).toBe("deny");
	});

	it("closes a login's real target outside home, and one under a link that is not there yet", () => {
		const table = homeFence(
			"/h",
			[],
			"/tmp/copy",
			"write",
			disk(
				{},
				{
					real: linked({
						"/h/.ssh": "/vol/keys",
						"/h/.config": "/vol/dot/config",
						"/h/.config/gh": null,
					}),
				},
			),
		);
		expect(table["/vol/keys"]).toBe("deny");
		expect(table["/vol/dot/config/gh"]).toBe("deny");
	});

	it("gives a line inside a login's real target no line", () => {
		const table = homeFence(
			"/h",
			["/vol/keys/tool"],
			"/h/work/copy",
			"write",
			disk(
				{"/h": ["work", ".ssh@", ".aws@"]},
				{real: linked({"/h/.ssh": "/h/work", "/h/.aws": "/vol/keys"})},
			),
		);
		expect(openLines(table)).toEqual([]);
		expect(table["/h"]).toBe("deny");
		expect(table["/vol/keys"]).toBe("deny");
	});

	it("does not close a link to `.codex` whole when its packages are opened: its login stays closed", () => {
		const table = homeFence(
			"/h",
			["/h/.codex/packages"],
			"/tmp/copy",
			"write",
			disk(
				{"/h": [".codex@"], "/vol/codex": ["packages", "history.jsonl"], "/vol": ["codex"]},
				{
					real: linked({
						"/h/.codex": "/vol/codex",
						"/h/.codex/packages": "/vol/codex/packages",
						"/h/.codex/auth.json": "/vol/codex/auth.json",
					}),
				},
			),
		);
		expect(table["/vol/codex/packages"]).toBe("read");
		expect(table["/vol/codex"]).toBeUndefined();
		expect(table["/vol/codex/auth.json"]).toBe("deny");
		expect(table["/h/.codex"]).toBe("deny");
	});

	it("makes its table on a home that is a link, by the real path", () => {
		const table = homeFence(
			"/link/h",
			["/link/h/.ssh", "/link/h/.volta"],
			"/link/h/copy",
			"write",
			disk(
				{"/real/h": [".ssh", ".volta", "copy", "other"]},
				{
					real: linked({
						"/link/h": "/real/h",
						"/link/h/.ssh": "/real/h/.ssh",
						"/link/h/.volta": "/real/h/.volta",
						"/link/h/copy": "/real/h/copy",
					}),
				},
			),
		);
		expect(openLines(table)).toEqual([
			["/real/h/.volta", "read"],
			["/real/h/copy", "write"],
		]);
		expect(table["/real/h/other"]).toBe("deny");
		expect(table["/real/h/.ssh"]).toBe("deny");
		expect(Object.keys(table).filter((key) => key.startsWith("/link/"))).toEqual([]);
	});

	it("reads a spelling with `//` or `./` as the path it is", () => {
		const table = homeFence(
			"//h",
			[],
			"/h//./copy/",
			"write",
			disk({"/h": ["copy", "other"]}, {real: linked({"//h": "/h", "/h//./copy": "/h/copy"})}),
		);
		expect(table).toEqual({...ALWAYS, "/h/other": "deny", "/h/copy": "write"});
	});

	it("on the real disk: follows a link, and says null for a path that is not there", () => {
		const home = fakeHome();
		mkdirSync(join(home, "a"));
		symlinkSync(join(home, "a"), join(home, "l"));
		expect(localDisk.real(join(home, "l"))).toBe(join(home, "a"));
		expect(localDisk.real(join(home, "l", "..", "a"))).toBe(join(home, "a"));
		expect(localDisk.real(join(home, "missing"))).toBeNull();
		expect(localDisk.real("")).toBeNull();
	});
});

describe("the fence, a short table by patterns", () => {
	const two = (tree: Readonly<Record<string, readonly string[]>>, more: Partial<Disk> = {}) =>
		disk(tree, {depth: 2, ...more});

	it("closes by pattern what shares no prefix with a kept name, and by name what does", () => {
		const table = homeFence(
			"/h",
			["/h/.volta"],
			"/h/copy",
			"write",
			two({
				"/h": [".volta", ".vim", ".bashrc", "copy", "copy2", "cop", "cold", "c", "Documents"],
			}),
		);
		expect(table).toEqual({
			...ALWAYS,
			"/h/[!.c]*": "deny",
			"/h/[!.c]*/**": "deny",
			"/h/.[!v]*": "deny",
			"/h/.[!v]*/**": "deny",
			"/h/.vim": "deny",
			"/h/c[!o]*": "deny",
			"/h/c[!o]*/**": "deny",
			"/h/c": "deny",
			"/h/c/**": "deny",
			"/h/copy2": "deny",
			"/h/cop": "deny",
			"/h/cold": "deny",
			"/h/.volta": "read",
			"/h/copy": "write",
		});
	});

	// The box's class matches without case. Listed with a plain `startsWith`, this name stayed open.
	it.each(["library-near", "LIBRARY2", "lIb"])(
		"closes %j by name: the box's pattern takes it for the kept name's prefix",
		(name) => {
			const table = homeFence(
				"/h",
				[],
				"/h/Library/copy",
				"write",
				two({"/h": ["Library", name], "/h/Library": ["copy"]}),
			);
			expect(table[`/h/${name}`]).toBe("deny");
			expect(table["/h/Library"]).toBeUndefined();
		},
	);

	it("walks each folder on the way down the same way", () => {
		const table = homeFence(
			"/h",
			[],
			"/h/Library/App/copy",
			"write",
			two({
				"/h": ["Library", "Li", "L"],
				"/h/Library": ["App", "Apples", "Keychains"],
				"/h/Library/App": ["copy", "copy-old"],
			}),
		);
		expect(table).toEqual({
			...ALWAYS,
			"/h/[!L]*": "deny",
			"/h/[!L]*/**": "deny",
			"/h/L[!i]*": "deny",
			"/h/L[!i]*/**": "deny",
			"/h/L": "deny",
			"/h/L/**": "deny",
			"/h/Li": "deny",
			"/h/Library/[!A]*": "deny",
			"/h/Library/[!A]*/**": "deny",
			"/h/Library/A[!p]*": "deny",
			"/h/Library/A[!p]*/**": "deny",
			"/h/Library/A": "deny",
			"/h/Library/A/**": "deny",
			"/h/Library/Apples": "deny",
			"/h/Library/App/[!c]*": "deny",
			"/h/Library/App/[!c]*/**": "deny",
			"/h/Library/App/c[!o]*": "deny",
			"/h/Library/App/c[!o]*/**": "deny",
			"/h/Library/App/c": "deny",
			"/h/Library/App/c/**": "deny",
			"/h/Library/App/copy-old": "deny",
			"/h/Library/App/copy": "write",
		});
	});

	it.each<[string, string, readonly string[]]>([
		["one character", "w", ["/h/w?*", "/h/w?*/**"]],
		["two characters", "ab", ["/h/ab?*", "/h/ab?*/**"]],
	])("closes all that is longer than a kept name of %s, with no listing", (_, name, keys) => {
		const table = homeFence("/h", [], `/h/${name}`, "write", two({"/h": [name, `${name}2`]}));
		for (const key of keys) expect(table[key]).toBe("deny");
		expect(table[`/h/${name}2`]).toBeUndefined();
		expect(table[`/h/${name}`]).toBe("write");
	});

	it("keeps a short kept name open beside a longer one that shares its start", () => {
		const table = homeFence(
			"/h",
			["/h/ab"],
			"/h/abc",
			"write",
			two({"/h": ["ab", "abc", "abd", "ax"]}),
		);
		expect(table["/h/ab"]).toBe("read");
		expect(table["/h/abc"]).toBe("write");
		expect(table["/h/abd"]).toBe("deny");
		expect(table["/h/a[!b]*"]).toBe("deny");
	});

	it("never writes a key for `.` or `..`, which breaks the box's profile", () => {
		const table = homeFence("/h", [], "/h/..x", "write", two({"/h": ["..x", "..y", ".z"]}));
		expect(table["/h/."]).toBeUndefined();
		expect(table["/h/./**"]).toBeUndefined();
		expect(table["/h/.."]).toBeUndefined();
		expect(table["/h/../**"]).toBeUndefined();
		expect(table["/h/.[!.]*"]).toBe("deny");
		expect(table["/h/..y"]).toBe("deny");
	});

	it("puts a dash last in a class, where it is itself", () => {
		const table = homeFence(
			"/h",
			["/h/-t", "/h/_u"],
			"/h/ c",
			"write",
			two({"/h": ["-t", "_u", " c"]}),
		);
		expect(table["/h/[! _-]*"]).toBe("deny");
	});

	// `?` and a class work by byte, so a name of other characters cannot stand in one.
	it.each<[string, string]>([
		["first character", "日本"],
		["second character", "aé"],
		["accent in the first", "écrit"],
		["pattern character", "a[b"],
		["plus", "+x"],
		["control character", "\rx"],
	])("lists every entry by name where a way down has an odd %s", (_, way) => {
		const table = homeFence(
			"/h",
			[],
			`/h/${way}/copy`,
			"write",
			two({"/h": [way, "Documents", "n"], [`/h/${way}`]: ["copy", "old"]}),
		);
		expect(table["/h/Documents"]).toBe("deny");
		expect(table["/h/n"]).toBe("deny");
		expect(Object.keys(table).filter((key) => key.includes("[!"))).toEqual([]);
	});

	it("uses patterns below a way down with an odd name only if the path is plain", () => {
		const below = homeFence(
			"/h",
			[],
			"/h/wo[rk]/copy",
			"write",
			two({"/h": ["wo[rk]", "near"], "/h/wo[rk]": ["copy", "old"]}),
		);
		expect(below["/h/[!w]*"]).toBe("deny");
		expect(below["/h/wo[[]rk[]]/old"]).toBe("deny");
		expect(below["/h/wo[[]rk[]]/old/**"]).toBe("deny");
		expect(Object.keys(below).filter((key) => key.startsWith("/h/wo[[]rk[]]/["))).toEqual([]);
	});

	it("lists by name under a home whose own path a pattern cannot hold", () => {
		const table = homeFence("/h+é", [], "/h+é/copy", "write", two({"/h+é": ["copy", "n"]}));
		expect(table["/h+é/n"]).toBe("deny");
		expect(Object.keys(table).filter((key) => key.includes("[!"))).toEqual([]);
	});

	it("closes a folder it cannot read, with no pattern in it, and the way down stops there", () => {
		const table = homeFence("/h", [], "/h/stuck/copy", "write", two({"/h": ["stuck", "other"]}));
		expect(table["/h/stuck"]).toBe("deny");
		expect(table["/h/stuck/copy"]).toBe("write");
		expect(Object.keys(table).filter((key) => key.startsWith("/h/stuck/["))).toEqual([]);
	});

	it("closes all of a folder when the way down is a link, with no walk through it", () => {
		const asked: string[] = [];
		const made = two({"/h": ["code@", "other"], "/h/code": ["copy"]});
		const table = homeFence("/h", [], "/h/code/copy", "write", {
			...made,
			list: (folder) => {
				asked.push(folder);
				return made.list(folder);
			},
		});
		expect(asked).toEqual(["/h"]);
		expect(table["/h/?*"]).toBe("deny");
		expect(table["/h/?*/**"]).toBe("deny");
	});

	it("lists every entry at depth 0, with one key for each and no pattern", () => {
		const table = homeFence("/h", [], "/h/copy", "write", disk({"/h": ["copy", "copy2", "n"]}));
		expect(table).toEqual({...ALWAYS, "/h/copy2": "deny", "/h/n": "deny", "/h/copy": "write"});
	});

	it("trusts patterns only on a Mac, the one box where they are proved", () => {
		expect(depthFor("darwin")).toBe(2);
		for (const platform of ["linux", "freebsd", "win32"]) expect(depthFor(platform)).toBe(0);
		expect(localDisk.depth).toBe(depthFor(process.platform));
	});
});

describe("the fence around home, from a listing", () => {
	const closed = (table: Readonly<Record<string, string>>) =>
		Object.keys(table).filter((path) => table[path] === "deny");

	it("walks down to a folder deep inside, leaves the way open, and closes what is beside it", () => {
		const table = homeFence(
			"/h",
			[],
			"/h/.cache/lane/copy",
			"write",
			disk({
				"/h": [".cache", "Documents", "notes.txt"],
				"/h/.cache": ["lane", "other"],
				"/h/.cache/lane": ["copy", "old-copy"],
			}),
		);
		expect(table["/h/.cache/lane/copy"]).toBe("write");
		for (const open of ["/h", "/h/.cache", "/h/.cache/lane"]) expect(table[open]).toBeUndefined();
		for (const beside of [
			"/h/Documents",
			"/h/notes.txt",
			"/h/.cache/other",
			"/h/.cache/lane/old-copy",
		])
			expect(table[beside]).toBe("deny");
	});

	it("gives the tools `read` and the folder its access, and does not list inside either", () => {
		const asked: string[] = [];
		const made = disk({"/h": [".volta", "copy", "Documents"]});
		const table = homeFence("/h", ["/h/.volta"], "/h/copy", "read", {
			...made,
			list: (folder) => {
				asked.push(folder);
				return made.list(folder);
			},
		});
		expect(table["/h/.volta"]).toBe("read");
		expect(table["/h/copy"]).toBe("read");
		expect(table["/h/Documents"]).toBe("deny");
		expect(asked).toEqual(["/h"]);
	});

	it("closes home whole and lists nothing when nothing opened is under it", () => {
		const table = homeFence("/h", ["/usr/local/node"], "/tmp/copy", "write", noWalk);
		expect(table["/h"]).toBe("deny");
		expect(table["/usr/local/node"]).toBe("read");
		expect(table["/tmp/copy"]).toBe("write");
	});

	it("does not read a longer name as being under home", () => {
		const table = homeFence("/h", [], "/h-other/copy", "write", noWalk);
		expect(table["/h"]).toBe("deny");
	});

	it("closes every login path, there or not, so one made during a run is closed too", () => {
		const table = homeFence("/h", [], "/h/copy", "write", disk({"/h": ["copy"]}));
		for (const login of [...LOGIN_FILES, ".codex", ".codex/auth.json"])
			expect(table[`/h/${login}`]).toBe("deny");
		// Where every session's Codex home is made, some after this table is.
		expect(table["/h/.cache/tea-fabrika/codex"]).toBe("deny");
	});

	it("walks a login folder that holds an opened one, its login file closed even when not there", () => {
		const table = homeFence(
			"/h",
			["/h/.codex/packages"],
			"/tmp/copy",
			"write",
			disk({"/h": [".codex"], "/h/.codex": ["packages", "history.jsonl"]}),
		);
		expect(table["/h/.codex"]).toBeUndefined();
		expect(table["/h/.codex/packages"]).toBe("read");
		expect(table["/h/.codex/history.jsonl"]).toBe("deny");
		expect(table["/h/.codex/auth.json"]).toBe("deny");
	});

	it("keeps a login path closed even when something asks to open it", () => {
		const table = homeFence("/h", ["/h/.ssh"], "/tmp/copy", "write", disk({"/h": [".ssh"]}));
		expect(table["/h/.ssh"]).toBe("deny");
	});

	it("opens nothing for a tool that holds a login directly, and keeps that login closed", () => {
		const table = homeFence("/h", ["/h/.config"], "/tmp/copy", "write", disk({"/h": [".config"]}));
		expect(table["/h"]).toBe("deny");
		expect(table["/h/.config"]).toBeUndefined();
		expect(table["/h/.config/gh"]).toBe("deny");
	});

	it("opens nothing for a tool inside a login, or one that holds a Codex home", () => {
		const table = homeFence(
			"/h",
			["/h/.ssh/keys", "/h/.cache", "/h/.codex"],
			"/h/copy",
			"write",
			disk({"/h": [".ssh", ".cache", ".codex", "copy"]}),
		);
		for (const closed of ["/h/.ssh", "/h/.cache", "/h/.codex"]) expect(table[closed]).toBe("deny");
		expect(table["/h/.ssh/keys"]).toBeUndefined();
	});

	it.each<[string, readonly string[], string]>([
		["home, the folder elsewhere", ["/h"], "/tmp/copy"],
		["home with a slash at its end", ["/h/"], "/tmp/copy"],
		["above home", ["/"], "/tmp/copy"],
	])("closes home whole when a tool is %s: such a tool opens nothing", (_, tools, folder) => {
		const table = homeFence("/h", tools, folder, "write", noWalk);
		expect(table["/h"]).toBe("deny");
		expect(table["/"]).toBeUndefined();
	});

	it("walks home as ever when a tool is home and the folder is under it", () => {
		const table = homeFence("/h", ["/h"], "/h/copy", "write", disk({"/h": [".gnupg", "copy"]}));
		expect(table["/h"]).toBeUndefined();
		expect(table["/h/.gnupg"]).toBe("deny");
		expect(table["/h/copy"]).toBe("write");
	});

	it("gives a folder that is home no line of its own: home stays closed", () => {
		const table = homeFence("/h", [], "/h", "write", noWalk);
		expect(table).toMatchObject({"/h": "deny"});
	});

	it("closes a folder it cannot read, and home too if that is the one", () => {
		const inner = homeFence("/h", [], "/h/stuck/copy", "write", disk({"/h": ["stuck", "other"]}));
		expect(inner).toEqual({
			...ALWAYS,
			"/h/stuck": "deny",
			"/h/other": "deny",
			"/h/stuck/copy": "write",
		});
		const whole = homeFence("/h", [], "/h/copy", "write", disk({}));
		expect(whole).toEqual({...ALWAYS, "/h": "deny", "/h/copy": "write"});
	});

	it("closes a link like any entry and never walks through one, an opened one too", () => {
		const asked: string[] = [];
		const made = disk({"/h": ["stray@", "code@", "tool@"], "/h/code": ["copy"]});
		const table = homeFence("/h", ["/h/tool"], "/h/code/copy", "write", {
			...made,
			list: (folder) => {
				asked.push(folder);
				return made.list(folder);
			},
		});
		expect(table["/h/stray"]).toBe("deny");
		expect(table["/h/code"]).toBe("deny");
		expect(table["/h/tool"]).toBe("read");
		expect(asked).toEqual(["/h"]);
	});

	// Codex reads a key with one of `* ? [ ]` as a pattern, and a control character does not match as
	// itself. Each of these names, written plainly, left the entry open.
	it.each<[string, string]>([
		["a*b", "a[*]b"],
		["a?b", "a[?]b"],
		["a[1]", "a[[]1[]]"],
		["*", "[*]"],
		["[!a]", "[[]!a[]]"],
		["**", "[*][*]"],
		["a]b", "a[]]b"],
		["a\nb", "a?b"],
		["a\tb", "a?b"],
		["Icon\r", "Icon?"],
		["a\x7fb", "a?b"],
		// In a pattern a backslash and a brace mean something too, and a quote breaks the box's profile.
		["a\\*b", "a[\\][*]b"],
		["a*{b,c}", "a[*][{]b,c[}]"],
		['a"*b', "a?[*]b"],
	])("closes the entry %j as a pattern, itself and what is in it", (name, pattern) => {
		const table = homeFence("/h", [], "/h/copy", "write", disk({"/h": [name, "copy"]}));
		expect(table[`/h/${pattern}`]).toBe("deny");
		expect(table[`/h/${pattern}/**`]).toBe("deny");
		expect(table[`/h/${name}`]).toBeUndefined();
		expect(table["/h/copy"]).toBe("write");
	});

	it.each(["a{b}", "a\\b", "a b", "a\u0085b", "é"])(
		"writes the entry %j as it is: Codex matches it, and a pattern's one-byte `?` would not",
		(name) => {
			const table = homeFence("/h", [], "/h/copy", "write", disk({"/h": [name, "copy"]}));
			expect(table[`/h/${name}`]).toBe("deny");
			expect(Object.keys(table).filter((key) => key.endsWith("/**"))).toEqual([]);
		},
	);

	it("closes the login paths as patterns too when home's own path is odd", () => {
		const table = homeFence("/h[1]", [], "/h[1]/copy", "write", disk({"/h[1]": ["copy", "x"]}));
		expect(table["/h[[]1[]]/x"]).toBe("deny");
		expect(table["/h[[]1[]]/x/**"]).toBe("deny");
		expect(table["/h[[]1[]]/.ssh"]).toBe("deny");
		expect(table["/h[[]1[]]/.ssh/**"]).toBe("deny");
		expect(table["/h[1]/.ssh"]).toBeUndefined();
	});

	it.each<[string, string]>([
		["wo[rk]", "wok"],
		["wo*k", "wowk"],
		["wo?k", "woxk"],
		["wo]k", "wok"],
		["wo\rk", "woxk"],
		['wo"k', "wok"],
	])("gives an opened path %j no line, since Codex refuses a pattern that opens", (name, near) => {
		const table = homeFence(
			"/h",
			[`/h/tools/${name}`],
			`/h/${name}`,
			"write",
			disk({"/h": [name, near, "tools"], "/h/tools": [name, near]}),
		);
		expect(Object.values(table).filter((rule) => rule !== "deny")).toEqual([]);
		// The walk still leaves it alone, and closes the name next to it.
		expect(table[`/h/${near}`]).toBe("deny");
		expect(table[`/h/tools/${near}`]).toBe("deny");
		expect(Object.keys(table).filter((key) => key.includes(name))).toEqual([]);
	});

	// `includes` cannot see `wo[[]rk[]]`, so only the whole table pins this.
	it("makes exactly this table for a way down with an odd name", () => {
		const table = homeFence(
			"/h",
			["/h/wo[rk]/tool"],
			"/h/wo[rk]/copy",
			"write",
			disk({"/h": ["wo[rk]", "near"], "/h/wo[rk]": ["tool", "copy", "old", "Icon\r"]}),
		);
		expect(table).toEqual({
			...ALWAYS,
			"/h/near": "deny",
			"/h/wo[[]rk[]]/old": "deny",
			"/h/wo[[]rk[]]/old/**": "deny",
			"/h/wo[[]rk[]]/Icon?": "deny",
			"/h/wo[[]rk[]]/Icon?/**": "deny",
		});
	});

	it("reads a path the same with or without a slash at its end", () => {
		const table = homeFence("/h/", [], "/h/copy/", "write", disk({"/h": ["copy", "other"]}));
		expect(closed(table)).toContain("/h/other");
		expect(closed(table)).not.toContain("/h/copy");
		expect(table["/h"]).toBeUndefined();
	});

	it("reads a real folder without following a link, and says null for one it cannot read", () => {
		const home = fakeHome();
		mkdirSync(join(home, "a"));
		writeFileSync(join(home, "b"), "");
		symlinkSync(join(home, "a"), join(home, "c"));
		const names = (listFolder(home) ?? []).map((e) => `${e.name}:${e.link}`).sort();
		expect(names).toEqual([".codex:false", "a:false", "b:false", "c:true"]);
		expect(listFolder(join(home, "missing"))).toBeNull();
	});
});

describe("the fence, too big for the box", () => {
	const lines = (count: number) =>
		Object.fromEntries(Array.from({length: count}, (_, n) => [`/home/x/private-${n}`, "deny"]));

	it("lets a table at the limit through, and refuses one past it, by its size and no name", () => {
		expect(fenceTooBig(lines(FENCE_LIMIT))).toBe(null);
		const said = fenceTooBig(lines(FENCE_LIMIT + 1));
		expect(said).toContain(`${FENCE_LIMIT + 1} lines`);
		expect(said).toContain(`at most ${FENCE_LIMIT}`);
		expect(said).toContain("Nothing was started");
		expect(said).not.toContain("private");
	});

	/** A real home with more near names than the box takes: patterns cannot close them, at any depth. */
	const crowded = () => {
		const home = fakeHome();
		const folder = join(home, "copy");
		mkdirSync(folder);
		for (let n = 0; n <= FENCE_LIMIT; n++) writeFileSync(join(home, `co-private-${n}`), "");
		return {home, folder};
	};

	it.effect("stops the row before it makes a home, and says why", () =>
		Effect.gen(function* () {
			const {home, folder} = crowded();
			const parent = parentOf(home);
			const row = harnessOf({name: "codex", access: "write"}, folder, null, parent);
			const said = yield* Effect.flip(row.prepare ?? Effect.void);
			expect(said).toContain(`at most ${FENCE_LIMIT}`);
			expect(said).not.toContain("co-private");
			expect(existsSync(codexHomeOf(folder, parent))).toBe(false);
		}).pipe(Effect.provide(nodeServices)),
	);

	it.effect("lets the row go on with a table it can take", () =>
		Effect.gen(function* () {
			const home = fakeHome();
			const folder = join(home, "copy");
			mkdirSync(folder);
			const parent = parentOf(home);
			yield* (
				harnessOf({name: "codex", access: "write"}, folder, null, parent).prepare ?? Effect.void
			);
			expect(lstatSync(join(codexHomeOf(folder, parent), "auth.json")).isSymbolicLink()).toBe(true);
		}).pipe(Effect.provide(nodeServices)),
	);
});

describe("a config as flags", () => {
	it("writes DEL so TOML takes it: left raw, Codex refuses the whole value", () => {
		expect(flagsOf({said: "a\x7fb"})).toEqual(["-c", 'said="a\\u007fb"']);
	});
});

// In Codex's own box, with no model: `codex sandbox` runs a command under the real profile, on a
// made-up home. It needs no login. This finds `codex` on the PATH, as the `codex exec` adapter does
// by default. ACP's row runs the Codex it pins instead (adapters/), which this does not test.
const boxHome = realpathSync(mkdtempSync(join(tmpdir(), "codex-box-")));
afterAll(() => rmSync(boxHome, {recursive: true, force: true}));
const boxEnv = codexEnvOf(process.env, boxHome);
const codexBox = (cwd: string, config: Record<string, unknown>, line: string) =>
	spawnSync("codex", ["sandbox", ...flagsOf(config), "--", "/bin/sh", "-c", line], {
		cwd,
		env: boxEnv,
		stdio: "ignore",
	}).status;
const tried = spawnSync("codex", ["sandbox", "--", "/bin/sh", "-c", "exit 0"], {
	cwd: boxHome,
	env: boxEnv,
	encoding: "utf8",
	stdio: ["ignore", "ignore", "pipe"],
});
// Each is how a look along the PATH says no. A folder a box closes answers EPERM, not ENOENT.
const noCodex =
	tried.error !== undefined &&
	"code" in tried.error &&
	["ENOENT", "EACCES", "EPERM"].includes(String(tried.error.code));
// A box cannot start inside another box, and nothing is wrong with either. Agents run these tests
// inside one, with `codex` on the PATH. Only this one line says so: any other failure is a failure.
const insideABox = tried.stderr?.includes("sandbox_apply: Operation not permitted") ?? false;
/** Why Codex's box did not start, with its version. Empty when it did. */
const boxBroken = (): string => {
	if (tried.status === 0) return "";
	const version = spawnSync("codex", ["--version"], {env: boxEnv, encoding: "utf8"}).stdout?.trim();
	const said = (tried.stderr ?? "").trim().split("\n").slice(-3).join(" ");
	return `${version} found, its box does not start (exit ${tried.status}): ${tried.error?.message ?? said}`;
};
const SLOW = 120_000;

type Config = ReturnType<typeof codexConfig>;

const tableKeys = (config: Config) => Object.keys(config.permissions.fenced.filesystem).length;

/** The table, filled to the limit with what closes names under `below`, the costliest key the box takes. */
const patternsBelow = (config: Config, home: string, below: string) => {
	const filesystem: Record<string, FolderAccess | "deny"> = {
		...config.permissions.fenced.filesystem,
	};
	for (let n = 0; Object.keys(filesystem).length < FENCE_LIMIT; n++)
		filesystem[`${home}/${below}/p${n}[!x]*`] = "deny";
	return {...config, permissions: {fenced: {...config.permissions.fenced, filesystem}}};
};

describe.skipIf(process.platform !== "darwin" || noCodex || insideABox)(
	"the fence, in Codex's own box",
	() => {
		it("has a box that starts", () => {
			expect(boxBroken()).toBe("");
		});

		describe.skipIf(tried.status !== 0)("run inside it", () => {
			/** A path as one word of a shell line, whatever it holds. */
			const word = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;

			it("runs a Node script under home, and refuses what is beside it", () => {
				const home = fakeHome();
				const folder = join(home, "work", "copy");
				mkdirSync(folder, {recursive: true});
				mkdirSync(join(home, ".ssh"));
				mkdirSync(join(home, "beside"));
				writeFileSync(join(home, "beside", "note"), "");
				writeFileSync(join(folder, "x.js"), "");
				const config = codexConfig(folder, [], home, "write", localDisk);
				// Made after the table, as during a run.
				writeFileSync(join(home, ".netrc"), "");
				writeFileSync(join(home, "later"), "");
				writeFileSync(join(home, "work2"), "");
				writeFileSync(join(home, "WORK3"), "");

				expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
				expect(codexBox(folder, config, `ls "${home}" >/dev/null`)).toBe(0);
				expect(codexBox(folder, config, `ls "${home}/.ssh" >/dev/null`)).not.toBe(0);
				expect(codexBox(folder, config, `cat "${home}/.codex/auth.json" >/dev/null`)).not.toBe(0);
				expect(codexBox(folder, config, `cat "${home}/beside/note" >/dev/null`)).not.toBe(0);
				expect(codexBox(folder, config, `cat "${home}/.netrc" >/dev/null`)).not.toBe(0);
				expect(codexBox(folder, config, `echo x > "${home}/beside/y"`)).not.toBe(0);
				// A pattern closes an entry made later, unless it shares two characters with the way down.
				expect(codexBox(folder, config, `cat "${home}/later" >/dev/null`)).not.toBe(0);
				// What is weaker than a whole closed home, kept in sight.
				expect(codexBox(folder, config, `cat "${home}/work2" >/dev/null`)).toBe(0);
				expect(codexBox(folder, config, `cat "${home}/WORK3" >/dev/null`)).toBe(0);
			});

			it(
				"takes a whole table at the limit, of names and of patterns",
				() => {
					const home = fakeHome();
					const folder = join(home, "copy");
					mkdirSync(folder);
					writeFileSync(join(folder, "x.js"), "");
					const room = FENCE_LIMIT - tableKeys(codexConfig(folder, [], home, "write", localDisk));
					for (let n = 0; n < room; n++) writeFileSync(join(home, `co-near-${n}`), "");
					const names = codexConfig(folder, [], home, "write", localDisk);
					expect(tableKeys(names)).toBe(FENCE_LIMIT);
					expect(fenceTooBig(names.permissions.fenced.filesystem)).toBe(null);
					// One box, for each command in it takes seconds at this size.
					const line = `"${process.execPath}" x.js && ! cat "${home}/co-near-0" 2>/dev/null`;
					expect(codexBox(folder, names, line)).toBe(0);

					const patterns = patternsBelow(names, home, "a/b/c");
					expect(tableKeys(patterns)).toBe(FENCE_LIMIT);
					expect(codexBox(folder, patterns, `"${process.execPath}" x.js`)).toBe(0);
				},
				SLOW,
			);

			it(
				"runs nothing on a table too deep for it, even under the limit",
				() => {
					const home = fakeHome();
					const folder = join(home, "copy");
					mkdirSync(folder);
					const config = codexConfig(folder, [], home, "write", localDisk);
					const deep = patternsBelow(config, home, Array(20).fill("d").join("/"));
					expect(tableKeys(deep)).toBe(FENCE_LIMIT);
					expect(codexBox(folder, deep, `touch ran`)).not.toBe(0);
					expect(existsSync(join(folder, "ran"))).toBe(false);
				},
				SLOW,
			);

			it(
				"closes every name beside the way down, near names and other cases too",
				() => {
					const home = fakeHome();
					const way = "Library/Application Support/fab/work/lane-1/copy";
					const tool = ".volta/tools/node";
					const folder = join(home, way);
					mkdirSync(folder, {recursive: true});
					mkdirSync(join(home, tool), {recursive: true});
					writeFileSync(join(folder, "x.js"), "");
					writeFileSync(join(home, tool, "t.js"), "");
					const closed = [
						".ssh/id_x",
						".config/gh/hosts.yml",
						".codex/auth.json",
						"Documents/doc",
						"nodot",
						"a*b",
						"[x]",
						"Icon\r",
						"L",
						"Li/s",
						"Library2/s",
						"Librar",
						"library-near/s",
						".v/s",
						".vol",
						".voltage/s",
						".volta2/s",
						".volta/other/s",
						".volta/tools/node2/s",
						".volta/tools/NODE3/s",
						"Library/Keychains/k",
						"Library/Application/s",
						"Library/Application Support2/s",
						"Library/Application Support/other/s",
						"Library/Application Support/fa",
						"Library/Application Support/fab2/s",
						"Library/Application Support/FAB3/s",
						"Library/Application Support/fab/work/lane-1/copy2/s",
						"Library/Application Support/fab/work/lane-1/cop",
						"Library/Application Support/fab/work/copy/s",
						"Library/Application Support/fab/other/s",
						"Library/Application Support/fab/s",
						".hidden",
						"..double/s",
						"é/s",
						"日本/s",
					];
					for (const name of closed) {
						mkdirSync(dirname(join(home, name)), {recursive: true});
						writeFileSync(join(home, name), "");
					}
					const config = codexConfig(folder, [join(home, tool)], home, "write", localDisk);

					expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
					expect(codexBox(folder, config, "echo x > y")).toBe(0);
					expect(
						codexBox(folder, config, `"${process.execPath}" ${word(join(home, tool, "t.js"))}`),
					).toBe(0);
					const open = closed.filter(
						(name) => codexBox(folder, config, `cat ${word(join(home, name))}`) === 0,
					);
					expect(open).toEqual([]);
					// The same names, spelled in another case: the disk takes them, so the box must refuse them.
					for (const spelled of ["LIBRARY/Keychains/k", "library/KEYCHAINS/k", ".SSH/id_x"])
						expect(codexBox(folder, config, `cat ${word(join(home, spelled))}`)).not.toBe(0);
					// Made after the table, sharing no first two characters with the way down.
					for (const later of [
						"after/s",
						"Library/after",
						".after",
						"Library/Application Support/fab/x",
					]) {
						mkdirSync(dirname(join(home, later)), {recursive: true});
						writeFileSync(join(home, later), "");
						expect(codexBox(folder, config, `cat ${word(join(home, later))}`)).not.toBe(0);
					}
				},
				SLOW,
			);

			it("refuses a link in a read line to what it would open, by its real path", () => {
				const home = fakeHome();
				const folder = join(home, "work", "copy");
				mkdirSync(folder, {recursive: true});
				writeFileSync(join(folder, "x.js"), "");
				mkdirSync(join(home, ".ssh", "sub"), {recursive: true});
				writeFileSync(join(home, ".ssh", "id_x"), "");
				writeFileSync(join(home, ".ssh", "sub", "f"), "");
				mkdirSync(join(home, ".config", "gh"), {recursive: true});
				writeFileSync(join(home, ".config", "gh", "hosts.yml"), "");
				symlinkSync(join(home, ".ssh"), join(home, "t"));
				symlinkSync(home, join(home, "h"));
				symlinkSync(join(home, ".config"), join(home, "c"));
				symlinkSync(join(home, ".codex"), join(home, "o"));
				symlinkSync(join(home, ".codex", "auth.json"), join(home, "a"));
				symlinkSync(join(home, ".ssh"), join(home, "dir"));
				const tools = ["t", "h", "c", "o", "a", "dir/sub"].map((name) => join(home, name));
				const config = codexConfig(folder, tools, home, "write", localDisk);

				expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
				for (const secret of [
					".ssh/id_x",
					".ssh/sub/f",
					"t/id_x",
					"dir/sub/f",
					".config/gh/hosts.yml",
					"c/gh/hosts.yml",
					".codex/auth.json",
					"o/auth.json",
					"a",
					"h/.ssh/id_x",
				])
					expect(codexBox(folder, config, `cat ${word(join(home, secret))}`)).not.toBe(0);
			});

			it("closes a `.ssh` that links into the opened folder, by either name", () => {
				const home = fakeHome();
				const folder = join(home, "copy");
				mkdirSync(join(folder, "keys"), {recursive: true});
				writeFileSync(join(folder, "keys", "id_x"), "");
				writeFileSync(join(folder, "x.js"), "");
				symlinkSync(join(folder, "keys"), join(home, ".ssh"));
				const config = codexConfig(folder, [], home, "write", localDisk);

				expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
				expect(codexBox(folder, config, `cat ${word(join(home, ".ssh", "id_x"))}`)).not.toBe(0);
				expect(codexBox(folder, config, "cat keys/id_x")).not.toBe(0);
			});

			it("works on a home reached through a link, and closes what is beside the folder", () => {
				const real = fakeHome();
				const folder = join(real, "copy");
				mkdirSync(folder);
				writeFileSync(join(folder, "x.js"), "");
				mkdirSync(join(real, ".ssh"));
				writeFileSync(join(real, ".ssh", "id_x"), "");
				writeFileSync(join(real, "beside"), "");
				const link = `${real}-link`;
				symlinkSync(real, link);
				const config = codexConfig(join(link, "copy"), [], link, "write", localDisk);

				expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
				expect(codexBox(folder, config, "echo x > y")).toBe(0);
				for (const home of [real, link]) {
					expect(codexBox(folder, config, `cat ${word(join(home, ".ssh", "id_x"))}`)).not.toBe(0);
					expect(codexBox(folder, config, `cat ${word(join(home, "beside"))}`)).not.toBe(0);
				}
			});

			it.each([
				"a*b",
				"a?b",
				"a[1]",
				"*",
				"[!a]",
				"**",
				"a]b",
				"a\nb",
				"a\tb",
				"Icon\r",
				"a\x7fb",
				"a\\*b",
				"a*{b,c}",
				'a"*b',
				"a{b}",
				"a\\b",
				"a\u0085b",
			])(
				"closes %j, a file and a folder, with the opened folder still working",
				(name) => {
					const home = fakeHome();
					const folder = join(home, "copy");
					mkdirSync(folder);
					writeFileSync(join(folder, "x.js"), "");
					writeFileSync(join(home, name), "");
					const inner = `${name}-folder`;
					mkdirSync(join(home, inner));
					writeFileSync(join(home, inner, "note"), "");
					const config = codexConfig(folder, [], home, "write", localDisk);

					expect(codexBox(folder, config, `cat ${word(join(home, name))}`)).not.toBe(0);
					expect(codexBox(folder, config, `cat ${word(join(home, inner, "note"))}`)).not.toBe(0);
					expect(codexBox(folder, config, `ls ${word(join(home, inner))}`)).not.toBe(0);
					expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
					expect(codexBox(folder, config, "echo x > y")).toBe(0);
				},
				SLOW,
			);

			it.each<[string, string]>([
				["wo[rk]", "wok"],
				["wo*k", "wowk"],
				["wo?k", "woxk"],
				["wo]k", "wok"],
				["wo\rk", "woxk"],
			])(
				"opens a folder and a tool named %j, and not the name beside them",
				(name, near) => {
					const home = fakeHome();
					const folder = join(home, name);
					mkdirSync(join(home, "tools"));
					const tool = join(home, "tools", name);
					for (const open of [folder, tool, join(home, near), join(home, "tools", near)]) {
						mkdirSync(open);
						writeFileSync(join(open, "f"), "");
					}
					writeFileSync(join(folder, "x.js"), "");
					const accesses: readonly FolderAccess[] = ["write", "read"];
					for (const access of accesses) {
						const config = codexConfig(folder, [tool], home, access, localDisk);
						expect(codexBox(folder, config, "cat f")).toBe(0);
						expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
						expect(codexBox(folder, config, "echo x > y") === 0).toBe(access === "write");
						expect(codexBox(folder, config, `cat ${word(join(tool, "f"))}`)).toBe(0);
						expect(codexBox(folder, config, `cat ${word(join(home, near, "f"))}`)).not.toBe(0);
						expect(
							codexBox(folder, config, `cat ${word(join(home, "tools", near, "f"))}`),
						).not.toBe(0);
					}
				},
				SLOW,
			);

			it("fails closed when a `?` also matches the folder that holds the opened one", () => {
				const home = fakeHome();
				const folder = join(home, "co1", "copy");
				mkdirSync(folder, {recursive: true});
				writeFileSync(join(home, "co\r"), "");
				const config = codexConfig(folder, [], home, "write", localDisk);

				expect(codexBox(folder, config, `cat ${word(join(home, "co\r"))}`)).not.toBe(0);
				expect(codexBox(folder, config, "echo x > y")).not.toBe(0);
			});

			it("works under a home whose own path holds a `[`", () => {
				const home = join(fakeHome(), "odd[1]");
				const folder = join(home, "copy");
				for (const made of [folder, join(home, ".ssh"), join(home, "beside")]) {
					mkdirSync(made, {recursive: true});
					writeFileSync(join(made, "f"), "");
				}
				writeFileSync(join(folder, "x.js"), "");
				const config = codexConfig(folder, [], home, "write", localDisk);

				expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
				expect(codexBox(folder, config, "echo x > y")).toBe(0);
				expect(codexBox(folder, config, `cat ${word(join(home, ".ssh", "f"))}`)).not.toBe(0);
				expect(codexBox(folder, config, `cat ${word(join(home, "beside", "f"))}`)).not.toBe(0);
			});

			it("keeps what is in home closed when a tool is home itself", () => {
				const home = fakeHome();
				const elsewhere = fakeHome();
				mkdirSync(join(home, ".gnupg"));
				writeFileSync(join(home, ".gnupg", "key"), "");
				const under = join(home, "copy");
				mkdirSync(under);
				const beside = codexConfig(elsewhere, [home], home, "write", localDisk);
				const inside = codexConfig(under, [home], home, "write", localDisk);

				expect(codexBox(elsewhere, beside, "exit 0")).toBe(0);
				expect(codexBox(elsewhere, beside, `cat "${home}/.gnupg/key"`)).not.toBe(0);
				expect(codexBox(under, inside, "exit 0")).toBe(0);
				expect(codexBox(under, inside, `cat "${home}/.gnupg/key"`)).not.toBe(0);
			});

			it("keeps what is in home closed when the folder is home itself", () => {
				const home = fakeHome();
				mkdirSync(join(home, ".gnupg"));
				writeFileSync(join(home, ".gnupg", "key"), "");
				const config = codexConfig(home, [], home, "write", localDisk);

				expect(codexBox(home, config, `cat "${home}/.gnupg/key"`)).not.toBe(0);
			});
		});
	},
);

describe("the Codex home", () => {
	const run = <A, E>(e: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.result(e));
	const make = (home: string, login: string) =>
		run(codexHome(home, login).pipe(Effect.provide(nodeServices)) as Effect.Effect<void, string>);

	it("holds a link to the login and nothing else, and is kept as it is on a second start", async () => {
		const home = fakeHome();
		const login = join(home, ".codex", "auth.json");
		const codex = join(home, ".cache", "codex", "one");
		expect((await make(codex, login))._tag).toBe("Success");
		expect(lstatSync(join(codex, "auth.json")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(codex, "auth.json"))).toBe(login);
		expect((await make(codex, login))._tag).toBe("Success");
	});

	it("refuses a home whose auth.json is a file, or a link somewhere else", async () => {
		const home = fakeHome();
		const login = join(home, ".codex", "auth.json");
		const file = join(home, "file-home");
		mkdirSync(file);
		writeFileSync(join(file, "auth.json"), PLAN);
		const filed = await make(file, login);
		expect(filed._tag === "Failure" && String(filed.failure)).toMatch(/is a file/);

		const elsewhere = join(home, "elsewhere-home");
		const other = join(home, "other.json");
		writeFileSync(other, PLAN);
		expect((await make(elsewhere, other))._tag).toBe("Success");
		const moved = await make(elsewhere, login);
		expect(moved._tag === "Failure" && String(moved.failure)).toMatch(/links somewhere else/);
	});

	// Planted mistakes: each login below must stop the run before the adapter starts.
	it.each([
		[
			"an API key login",
			{auth_mode: "apikey", OPENAI_API_KEY: "planted-key"},
			/not a ChatGPT plan/,
		],
		[
			"a plan login with a key stored beside it",
			{auth_mode: "chatgpt", OPENAI_API_KEY: "planted-key"},
			/holds an API key/,
		],
		["a login with no mode", {OPENAI_API_KEY: null}, /not a ChatGPT plan/],
		["a file that is not JSON", "not json", /not one codex wrote/],
	])("refuses %s, and makes no home", async (_, content, why) => {
		const home = fakeHome();
		const login = join(home, ".codex", "auth.json");
		writeFileSync(login, typeof content === "string" ? content : JSON.stringify(content));
		const codex = join(home, "h");
		const r = await make(codex, login);
		expect(r._tag === "Failure" && String(r.failure)).toMatch(why);
		expect(() => lstatSync(codex)).toThrow();
	});

	it("refuses when there is no login to link to", async () => {
		const home = fakeHome();
		const r = await make(join(home, "h"), join(home, "missing", "auth.json"));
		expect(r._tag === "Failure" && String(r.failure)).toMatch(/not signed in/);
	});
});

describe("acp --agent codex", () => {
	it.effect("refuses a mode where a model answers the asks, no sandbox, or no mode at all", () =>
		Effect.gen(function* () {
			const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-codex-")));
			// Left out, codex's mode would say nothing about whether its folder may change.
			for (const mode of ["agent", "agent-full-access", undefined]) {
				const opened = ear<unknown>();
				const started = yield* start(
					acpProgram,
					{
						agent: "codex",
						folder,
						model: undefined,
						effort: undefined,
						mode,
						permissions: undefined,
						reopen: undefined,
						budget: undefined,
					},
					{opened: opened.hear},
					{id: `acp:codex-mode-${mode}`, storage: memoryStorage()},
				);
				if (started.kind !== "running") continue;
				const end = yield* started.run.ended;
				expect(JSON.stringify(end)).toMatch(/codex runs only in read-only or workspace-write/);
				expect(opened.values).toEqual([]);
			}
		}).pipe(Effect.scoped, Effect.provide(nodeServices)),
	);
});
