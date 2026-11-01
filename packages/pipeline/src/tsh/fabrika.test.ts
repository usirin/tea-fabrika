import {chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {memoryStorage} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {DEFAULT_SETTINGS} from "../settings.ts";
import {HOLDS_NOTHING, type Local, setupOf} from "../setup.ts";
import {Look} from "../stages/ship/look.ts";
import {defaultConfig} from "./config.ts";
import {fabrikaEntries} from "./fabrika.ts";

// What a repository declares in .fabrika/fabrika.toml reaches the GitHub reader
// fabrika's tsh lists. Today's version. The reader is not handed in here: `reads`
// is left out, so `fabrikaEntries` makes its own, as a real run does. It runs the
// `gh` on the PATH, and a stand-in comes first on the PATH for this file, so no
// call leaves it. Its answers are the recorded pull request with no CODEOWNERS at
// its base: then what was declared decides whose approval it needs.

const PR = "https://github.com/example/repo/pull/7";
const NOTHING_SAID: Local = {model: null, effort: null, budget: null, rubrics: null};
const PLACES = {shipped: "/fabrika/rubrics", repo: "/home/rubrics/c0ffee"};

let dir: string;
const path = process.env.PATH;

beforeAll(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "fabrika-reads-")));
	const answer = JSON.parse(
		readFileSync(
			new URL("../../../../fixtures/code-host/open-awaiting-approval.json", import.meta.url),
			"utf8",
		),
	);
	answer.data.repository.codeowners = null;
	const head: string = answer.data.repository.pullRequest.headRefOid;
	writeFileSync(join(dir, "pr.json"), JSON.stringify(answer));
	writeFileSync(
		join(dir, "where.json"),
		JSON.stringify({
			data: {repository: {pullRequest: {headRefOid: head, baseRefName: "main"}}},
		}),
	);
	const tip = "4ab1d3f0c2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9";
	writeFileSync(join(dir, "main.json"), JSON.stringify({tested: tip, tip}));
	writeFileSync(
		join(dir, "gh"),
		[
			"#!/bin/sh",
			'for arg in "$@"; do',
			'\tcase "$arg" in',
			`\t\tcodeowners=*) exec cat "${dir}/pr.json" ;;`,
			`\t\trepos/*/compare/*) exec cat "${dir}/main.json" ;;`,
			"\tesac",
			"done",
			`exec cat "${dir}/where.json"`,
			"",
		].join("\n"),
	);
	chmodSync(join(dir, "gh"), 0o755);
	process.env.PATH = `${dir}:${path ?? ""}`;
});

afterAll(() => {
	process.env.PATH = path;
	rmSync(dir, {recursive: true, force: true});
});

/** What a read-only `ship`, as fabrika lists it, reads of the pull request's approval. */
const approvalRead = (approval: "codeowners" | "none" | null) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const settings =
				approval === null ? DEFAULT_SETTINGS : {...DEFAULT_SETTINGS, ship: {approval}};
			const setup = setupOf(settings, HOLDS_NOTHING, NOTHING_SAID, PLACES);
			const entries = fabrikaEntries(defaultConfig(dir), undefined, undefined, undefined, setup);
			const ship = entries.find((entry) => entry.program.name === "ship");
			if (ship === undefined) return yield* Effect.die("ship is not listed");
			const called = yield* ship.call(
				{mode: "read"},
				{
					told: {pr: [PR]},
					listeners: {},
					keeping: {id: "ship:declared", storage: memoryStorage()},
					stopOn: Effect.never,
				},
			);
			if (called.kind !== "called") return yield* Effect.die(called.why);
			const found = called.heard.find((heard) => heard.name === "found");
			return Schema.decodeUnknownSync(Look)(found?.value).facts?.approval;
		}).pipe(Effect.scoped),
	);

describe("what the repository declared reaches the GitHub reader", () => {
	it("approval none, and no CODEOWNERS: no approval is needed", async () => {
		expect(await approvalRead("none")).toBe("not_needed");
	});

	it.each<[string, "codeowners" | null]>([
		["approval codeowners", "codeowners"],
		["nothing declared", null],
	])("%s, and no CODEOWNERS: it is not known", async (_name, approval) => {
		expect(await approvalRead(approval)).toBe("unknown");
	});
});
