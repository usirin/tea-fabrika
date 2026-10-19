import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {CONFIG_FILE, type Config, defaultConfig, readConfig} from "./config.ts";

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
				"rounds = 2",
				'ship = "write"',
				'packs = ["@acme/desk", "@acme/log"]',
				'[pack."@acme/desk"]',
				'view = "comment"',
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
			rounds: 2,
			ship: "write",
			packs: ["@acme/desk", "@acme/log"],
			pack: {"@acme/desk": {view: "comment"}},
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
		["rounds = 9", "rounds"],
		['ship = "maybe"', "ship"],
		["repo = ", "not TOML"],
	])("refuses %s before anything runs", async (text, says) => {
		const {got} = await read(text);
		if (typeof got !== "string") throw new Error("read, not refused");
		expect(got).toContain(CONFIG_FILE);
		expect(got).toContain(says);
	});
});
