import {execFileSync} from "node:child_process";
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, matchesGlob} from "node:path";
import type {Options} from "@anthropic-ai/claude-agent-sdk";
import {Effect} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {memoryStorage} from "../../program/storage.ts";
import {SummonManager} from "../../shell/summon.ts";
import type {Harness} from "../acp/harness.ts";
import {summonManager} from "./manager.ts";

const seen = vi.hoisted(() => ({
	opened: [] as {folder: string; meta: Harness["meta"]; env: Harness["env"]}[],
}));

// Keep the real manager, ACP program and harness settings. Only installation/login preparation
// and the remote adapter are replaced: the connection records exactly what session/new receives.
vi.mock("../acp/harness.ts", async (original) => {
	const actual = await original<typeof import("../acp/harness.ts")>();
	return {
		...actual,
		harnessOf: (...args: Parameters<typeof actual.harnessOf>) => ({
			...actual.harnessOf(...args),
			script: actual.harnessOf("fake", args[1], null).script,
			prepare: Effect.void,
		}),
	};
});

vi.mock("../acp/client.ts", async (original) => ({
	...(await original<typeof import("../acp/client.ts")>()),
	connect: (harness: Harness) => {
		const opened = {id: "env-law", mode: "read-only", modes: ["read-only"], config: []};
		return Effect.succeed({
			pid: 0,
			can: () => true,
			open: (_how: string, _id: string | null, folder: string, meta: Harness["meta"]) =>
				Effect.sync(() => {
					seen.opened.push({folder, meta, env: harness.env});
					return opened;
				}),
			configure: () => Effect.succeed(opened),
			prompt: () => Effect.die("this law must never call a model"),
			cancel: () => Effect.void,
			stderr: () => "",
		});
	},
}));

const made: string[] = [];

afterEach(() => {
	seen.opened.length = 0;
	for (const folder of made.splice(0)) rmSync(folder, {recursive: true, force: true});
});

describe("T237-1: summon keeps the harness's hidden-file defaults", () => {
	it.each(["claude", "codex"])(
		"passes env denies to %s when opening its repo session",
		async (agent) => {
			const folder = realpathSync(mkdtempSync(join(tmpdir(), "summon-env-")));
			made.push(folder);
			execFileSync("git", ["init", "-q"], {cwd: folder});
			writeFileSync(join(folder, ".env"), "made-up text\n");
			writeFileSync(join(folder, "README.md"), "ordinary text\n");
			await Effect.runPromise(
				Effect.gen(function* () {
					const manager = yield* SummonManager;
					yield* manager.summon({agent, settings: [], name: "scout", by: "user:owner"});
				}).pipe(Effect.scoped, Effect.provide(summonManager({folder, storage: memoryStorage()}))),
			);
			expect(seen.opened).toHaveLength(1);
			const opened = seen.opened[0]!;
			expect(opened.folder).toBe(folder);
			if (agent === "claude") {
				const {options} = (opened.meta as {claudeCode: {options: Options}}).claudeCode;
				expect(options.sandbox?.filesystem?.allowRead).toContain(folder);
				expect(options.sandbox?.filesystem?.denyRead).toEqual(
					expect.arrayContaining(["**/.env", "**/.env.*"]),
				);
				expect(options.settings).toMatchObject({
					permissions: {deny: expect.arrayContaining(["Read(**/.env)", "Read(**/.env.*)"])},
				});
			} else {
				const config = JSON.parse(opened.env.CODEX_CONFIG ?? "{}");
				const files = config.permissions.fenced.filesystem as Record<string, string>;
				expect(files[folder]).toBe("read");
				const denies = Object.entries(files).filter(([, rule]) => rule === "deny");
				expect(denies.some(([glob]) => matchesGlob(join(folder, "README.md"), glob))).toBe(false);
				expect(denies.some(([glob]) => matchesGlob(join(folder, ".env"), glob))).toBe(true);
			}
		},
	);
});
