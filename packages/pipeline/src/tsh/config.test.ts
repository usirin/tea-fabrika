import {createHash} from "node:crypto";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layerDigest} from "@effect/platform-node/NodeCrypto";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {
	CONFIG_FILE,
	type Config,
	defaultConfig,
	ledgerFile,
	readConfig,
	settingsWhere,
} from "./config.ts";

// One repository's tsh.toml, read the way fabrika-main.ts reads it: from a
// real folder, through Effect's FileSystem and Path.

const PLACES = {home: "/h/.tsh", user: "/h"};

/** The config `text` makes, written as tsh.toml in a fresh folder; or the reason it is refused. */
const read = async (text: string | null): Promise<{folder: string; got: Config | string}> => {
	const folder = mkdtempSync(join(tmpdir(), "tsh-config-"));
	if (text !== null) writeFileSync(join(folder, CONFIG_FILE), text);
	const result = await Effect.runPromise(
		readConfig(join(folder, CONFIG_FILE), PLACES).pipe(Effect.result, Effect.provide(nodeServices)),
	);
	return {folder, got: result._tag === "Success" ? result.success : result.failure.why};
};

describe("tsh.toml", () => {
	it("no file: every default", async () => {
		const {got} = await read(null);
		expect(got).toEqual(defaultConfig("/h/.tsh"));
		expect(got).toMatchObject({work: "/h/.tsh/work", rubrics: "/h/.tsh/rubrics", clone: null});
	});

	it("an empty file is every default too", async () => {
		expect((await read("")).got).toEqual(defaultConfig("/h/.tsh"));
	});

	it("reads every key; paths are taken from the file's folder, and ~/ is the user's home", async () => {
		const {folder, got} = await read(
			[
				'repo = "acme/widgets"',
				'work = "~/fabrika/work"',
				'rubrics = "rubrics"',
				'own = ["a-bot", "a-person"]',
				'reviewers = ["a-person"]',
				'model = "sonnet"',
				'effort = "high"',
				"budget = 1.5",
				'ship = "write"',
			].join("\n"),
		);
		expect(got).toEqual({
			repo: {owner: "acme", name: "widgets"},
			work: "/h/fabrika/work",
			clone: "/h/fabrika/work/acme/widgets/clone",
			rubrics: join(folder, "rubrics"),
			own: ["a-bot", "a-person"],
			reviewers: ["a-person"],
			model: "sonnet",
			effort: "high",
			budget: 1.5,
			ship: "write",
			said: {model: "sonnet", effort: "high", budget: 1.5, rubrics: join(folder, "rubrics")},
		});
	});

	it("what the file leaves out is said to be left out, so a repository's pick or the code's default can win", async () => {
		const {got} = await read('model = "haiku"');
		expect(got).toMatchObject({
			model: "haiku",
			said: {model: "haiku", effort: null, budget: null, rubrics: null},
		});
	});

	it("reviewers are own when left out, and a clone written down wins over the repo's", async () => {
		const {folder, got} = await read('repo = "acme/widgets"\nclone = "c"\nown = ["a-bot"]');
		expect(got).toMatchObject({reviewers: ["a-bot"], clone: join(folder, "c")});
	});

	it.each([
		['shipp = "write"', "shipp"],
		['repo = "widgets"', "repo is <owner>/<name>"],
		['effort = "huge"', "effort"],
		["budget = 0", "budget"],
		['ship = "maybe"', "ship"],
		["repo = ", "not TOML"],
	])("refuses %s before anything runs", async (text, says) => {
		const {got} = await read(text);
		if (typeof got !== "string") throw new Error("read, not refused");
		expect(got).toContain(CONFIG_FILE);
		expect(got).toContain(says);
	});

	it.each([
		['packs = ["@acme/desk"]'],
		['[pack."@acme/desk"]\nview = "comment"'],
		['repo = "acme/widgets"\npacks = ["@acme/desk"]\n[pack."@acme/desk"]\nview = "comment"'],
	])("refuses packs, saying they moved to .fabrika/fabrika.toml: %s", async (text) => {
		const {got} = await read(text);
		if (typeof got !== "string") throw new Error("read, not refused");
		expect(got).toContain(CONFIG_FILE);
		expect(got).toContain("add-on packs moved to .fabrika/fabrika.toml");
		expect(got).not.toContain("at the root");
		expect(got).toContain("move the packs line");
	});

	it.each([["rounds = 3"], ['repo = "acme/widgets"\nrounds = 5'], ["rounds = 9"]])(
		"refuses rounds, saying there is no round cap: %s",
		async (text) => {
			const {got} = await read(text);
			if (typeof got !== "string") throw new Error("read, not refused");
			expect(got).toContain(CONFIG_FILE);
			expect(got).toContain("rounds: there is no round cap; the stall rule stops a loop");
		},
	);
});

describe("where fabrika.toml is read from", () => {
	const start = "/start";
	const of = async (text: string) => {
		const {got} = await read(text);
		if (typeof got === "string") throw new Error(got);
		return settingsWhere(got, start);
	};

	it("a repo named: that repository's, in the clone build makes, cloned from GitHub", async () => {
		expect(await of('repo = "acme/widgets"\nwork = "~/w"')).toEqual({
			from: "repo",
			target: {
				name: "acme/widgets",
				clone: "/h/w/acme/widgets/clone",
				url: "https://github.com/acme/widgets",
			},
		});
	});

	it("only a clone named: that clone's, with nowhere to clone it from", async () => {
		expect(await of('clone = "~/c"')).toEqual({
			from: "repo",
			target: {name: "/h/c", clone: "/h/c", url: null},
		});
	});

	it("no repo and no clone: the folder tsh starts in", async () => {
		expect(await of("")).toEqual({from: "folder", folder: start});
	});
});

describe("where the ledger is kept", () => {
	const fileOf = (where: Parameters<typeof ledgerFile>[1]) =>
		Effect.runPromise(
			ledgerFile("/h/.tsh", where).pipe(Effect.provide(Layer.merge(nodeServices, layerDigest))),
		);
	const repo = (name: string) => ({
		from: "repo" as const,
		target: {name, clone: `/h/w/${name}/clone`, url: `https://github.com/${name}`},
	});

	it("a repository tsh.toml names: one file per repository, under tsh's home", async () => {
		expect(await fileOf(repo("acme/widgets"))).toBe("/h/.tsh/ledgers/github/acme/widgets.sqlite");
		expect(await fileOf(repo("acme/gadgets"))).not.toBe(await fileOf(repo("acme/widgets")));
	});

	it("a folder: its name and a hash of its path, so two folders with one name never share a ledger, and one folder always finds its own", async () => {
		const a = await fileOf({from: "folder", folder: "/one/app"});
		const b = await fileOf({from: "folder", folder: "/two/app"});
		expect(a).toMatch(/^\/h\/\.tsh\/ledgers\/folders\/app-[0-9a-f]{12}\.sqlite$/);
		expect(b).not.toBe(a);
		expect(await fileOf({from: "folder", folder: "/one/app/"})).toBe(a);
	});

	it("a folder's hash is the first 12 hex of its path's SHA-256, so a ledger written before stays found", async () => {
		const hash = createHash("sha256").update("/one/app").digest("hex").slice(0, 12);
		expect(await fileOf({from: "folder", folder: "/one/app"})).toBe(
			`/h/.tsh/ledgers/folders/app-${hash}.sqlite`,
		);
	});

	it("a clone named alone is kept by its path, like a folder", async () => {
		const file = await fileOf({from: "repo", target: {name: "/h/c", clone: "/h/c", url: null}});
		expect(file).toMatch(/^\/h\/\.tsh\/ledgers\/folders\/c-[0-9a-f]{12}\.sqlite$/);
	});
});
