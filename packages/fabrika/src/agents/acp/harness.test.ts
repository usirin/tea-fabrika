import {spawnSync} from "node:child_process";
import {
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
import {join} from "node:path";
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
	harnessOf,
	homeFence,
	type Listing,
	listFolder,
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
		const folder = join(tmpdir(), "a-scratch-folder");
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

	it("starts a read row read-only, its folder only readable, and keeps that through a system prompt", () => {
		const home = fakeHome();
		const folder = join(tmpdir(), "a-scratch-folder");
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
		const config = codexConfig("/f", [], "/h", undefined, () => []);
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
		const fs = config.permissions.fenced.filesystem as Record<string, string>;
		expect(fs[home]).toBeUndefined();
		expect(fs[join(home, "work")]).toBeUndefined();
		expect(fs[join(home, "beside")]).toBe("deny");
		expect(fs[folder]).toBe("write");
	});
});

/** A made-up disk: a folder's entries by path, a trailing `@` for a link. A folder not named cannot be read. */
const disk =
	(tree: Readonly<Record<string, readonly string[]>>): Listing =>
	(folder) =>
		tree[folder]?.map((name) => ({name: name.replace(/@$/, ""), link: name.endsWith("@")})) ?? null;

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
		const table = homeFence("/h", ["/h/.volta"], "/h/copy", "read", (folder) => {
			asked.push(folder);
			return disk({"/h": [".volta", "copy", "Documents"]})(folder);
		});
		expect(table["/h/.volta"]).toBe("read");
		expect(table["/h/copy"]).toBe("read");
		expect(table["/h/Documents"]).toBe("deny");
		expect(asked).toEqual(["/h"]);
	});

	it("closes home whole and lists nothing when nothing opened is under it", () => {
		const table = homeFence("/h", ["/usr/local/node"], "/tmp/copy", "write", () => {
			throw new Error("nothing under home to walk for");
		});
		expect(table["/h"]).toBe("deny");
		expect(table["/usr/local/node"]).toBe("read");
		expect(table["/tmp/copy"]).toBe("write");
	});

	it("does not read a longer name as being under home", () => {
		const table = homeFence("/h", [], "/h-other/copy", "write", () => {
			throw new Error("nothing under home to walk for");
		});
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

	it("keeps a login path closed inside a folder that opens its parent", () => {
		const table = homeFence("/h", ["/h/.config"], "/tmp/copy", "write", disk({"/h": [".config"]}));
		expect(table["/h/.config"]).toBe("read");
		expect(table["/h/.config/gh"]).toBe("deny");
	});

	it("closes a folder it cannot read, and home too if that is the one", () => {
		const inner = homeFence("/h", [], "/h/stuck/copy", "write", disk({"/h": ["stuck", "other"]}));
		expect(inner["/h/stuck"]).toBe("deny");
		expect(inner["/h/other"]).toBe("deny");
		expect(inner["/h/stuck/copy"]).toBe("write");
		const whole = homeFence("/h", [], "/h/copy", "write", disk({}));
		expect(whole["/h"]).toBe("deny");
		expect(whole["/h/copy"]).toBe("write");
	});

	it("closes a link like any entry and never walks through one, unless it is the opened folder", () => {
		const asked: string[] = [];
		const list: Listing = (folder) => {
			asked.push(folder);
			return disk({"/h": ["stray@", "code@", "tool@"], "/h/code": ["copy"]})(folder);
		};
		const table = homeFence("/h", ["/h/tool"], "/h/code/copy", "write", list);
		expect(table["/h/stray"]).toBe("deny");
		expect(table["/h/code"]).toBe("deny");
		expect(table["/h/tool"]).toBe("read");
		expect(asked).toEqual(["/h"]);
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

// In Codex's own box, with no model: `codex sandbox` runs a command under the real profile, on a
// made-up home. It needs no login. Left out where Codex is not there or cannot start its box.
const boxHome = realpathSync(mkdtempSync(join(tmpdir(), "codex-box-")));
afterAll(() => rmSync(boxHome, {recursive: true, force: true}));
const codexBox = (cwd: string, config: Record<string, unknown>, line: string) =>
	spawnSync("codex", ["sandbox", ...flagsOf(config), "--", "/bin/sh", "-c", line], {
		cwd,
		env: codexEnvOf(process.env, boxHome),
		stdio: "ignore",
	}).status;
const boxRuns = process.platform === "darwin" && codexBox(boxHome, {}, "exit 0") === 0;

describe.skipIf(!boxRuns)("the fence, in Codex's own box", () => {
	it("runs a Node script under home, and refuses what is beside it", () => {
		const home = fakeHome();
		const folder = join(home, "work", "copy");
		mkdirSync(folder, {recursive: true});
		mkdirSync(join(home, ".ssh"));
		mkdirSync(join(home, "beside"));
		writeFileSync(join(home, "beside", "note"), "");
		writeFileSync(join(folder, "x.js"), "");
		const config = codexConfig(folder, [], home, "write", listFolder);
		// Made after the table, as during a run.
		writeFileSync(join(home, ".netrc"), "");
		writeFileSync(join(home, "later"), "");

		expect(codexBox(folder, config, `"${process.execPath}" x.js`)).toBe(0);
		expect(codexBox(folder, config, `ls "${home}" >/dev/null`)).toBe(0);
		expect(codexBox(folder, config, `ls "${home}/.ssh" >/dev/null`)).not.toBe(0);
		expect(codexBox(folder, config, `cat "${home}/.codex/auth.json" >/dev/null`)).not.toBe(0);
		expect(codexBox(folder, config, `cat "${home}/beside/note" >/dev/null`)).not.toBe(0);
		expect(codexBox(folder, config, `cat "${home}/.netrc" >/dev/null`)).not.toBe(0);
		expect(codexBox(folder, config, `echo x > "${home}/beside/y"`)).not.toBe(0);
		// What is weaker than a whole closed home, kept in sight: an ordinary entry made later is open.
		expect(codexBox(folder, config, `cat "${home}/later" >/dev/null`)).toBe(0);
	});
});

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
