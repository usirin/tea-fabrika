import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {ear} from "../../program/ear.ts";
import {start} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {temps} from "../claude/sandbox.ts";
import {codexConfig, codexHome, codexHomeOf, harnessOf, type Row, withSystem} from "./harness.ts";
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
		const config = codexConfig("/f", [], "/h");
		expect([bare, nameOnly, typeof config]).toEqual(["codex", {name: "codex"}, "object"]);
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
