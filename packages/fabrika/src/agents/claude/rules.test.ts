import {spawnSync} from "node:child_process";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import type {Sub} from "@demlik/tea";
import {Effect, Schema, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {createDraft, type DraftRun, NotStarted, openLive, sdkRunner} from "./draft.ts";
import {
	AGENTS_MD,
	emptyFolderRefusal,
	MAKE_EMPTY_FOLDER,
	NO_PROJECT_CONFIG,
	ownRules,
	settingsRefusal,
} from "./rules.ts";

describe("a run that reads the folder's own rules", () => {
	it("loads the project's rule files, its settings from the empty folder, AGENTS.md beside CLAUDE.md", () => {
		expect(ownRules({disableClaudeAiConnectors: true})).toEqual({
			settingSources: ["project"],
			projectConfigRoot: "/var/empty",
			settings: {
				disableClaudeAiConnectors: true,
				pluginConfigs: {
					"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
				},
			},
		});
	});

	it("never loads the user's or the local settings", () => {
		expect(ownRules({}).settingSources).toEqual(["project"]);
	});

	it("the run's own settings cannot drop the AGENTS.md option", () => {
		expect(ownRules({pluginConfigs: {}}).settings.pluginConfigs).toBe(AGENTS_MD);
		expect(NO_PROJECT_CONFIG).toBe("/var/empty");
	});
});

describe("options that would load more than the rule files are refused", () => {
	it("lets through no settings at all, and the rule files alone", () => {
		expect(settingsRefusal({settingSources: []})).toBeNull();
		expect(settingsRefusal(ownRules({disableClaudeAiConnectors: true}))).toBeNull();
	});

	it("refuses the project's settings without the empty folder, or with another folder", () => {
		expect(settingsRefusal({settingSources: ["project"]})).toContain(
			"projectConfigRoot is not set",
		);
		expect(
			settingsRefusal({settingSources: ["project"], projectConfigRoot: "/srv/repo"}),
		).toContain("/srv/repo, not /var/empty");
	});

	it("refuses the user's and the local settings, beside the rules or alone", () => {
		expect(settingsRefusal({...ownRules({}), settingSources: ["project", "local"]})).toContain(
			"names local",
		);
		expect(settingsRefusal({settingSources: ["user"]})).toContain("names user");
	});

	it("refuses options that name no sources, which the SDK reads as every settings file", () => {
		expect(settingsRefusal({})).toContain("loads every settings file");
	});
});

// A Claude Code that is not there: should a refused run reach the SDK after all, nothing starts.
const NO_CLAUDE = "/nonexistent-claude-155";

describe("a live run whose options are refused starts nothing", () => {
	const bad = {settingSources: ["project" as const], pathToClaudeCodeExecutable: NO_CLAUDE};

	it("its query fails at the first read, with the reason, before any process", async () => {
		const q = openLive({prompt: "p", options: bad});
		const first = q[Symbol.asyncIterator]().next();
		await expect(first).rejects.toBeInstanceOf(NotStarted);
		await expect(first).rejects.toThrow("projectConfigRoot is not set");
	});

	it("the runner's own opener refuses it, and the run fails with the reason as it is", async () => {
		const draft = createDraft({name: "probe", output: Schema.Struct({})});
		const run: DraftRun = {
			key: "k",
			id: "1",
			prompt: "p",
			session: {id: "00000000-0000-4000-8000-000000000155", continues: false},
			agent: null,
			folder: null,
		};
		const msgs = sdkRunner(
			draft,
			() => bad,
		)({id: "probe", type: "probe", deps: run} as Sub<"probe", DraftRun>);
		const [first] = await Effect.runPromise(Stream.runCollect(Stream.take(msgs, 1)));
		expect(first).toMatchObject({type: "probe_failed"});
		expect(first?.type === "probe_failed" ? first.error : "").toBe(settingsRefusal(bad));
	});
});

describe("the empty folder a run reads settings from", () => {
	const dir = mkdtempSync(join(tmpdir(), "rules-155-"));
	const ready = join(dir, "ready");
	afterAll(() => {
		chmodSync(ready, 0o755);
		rmSync(dir, {recursive: true, force: true});
	});

	it("is refused when it is missing, and the refusal names the command that makes it", () => {
		const why = emptyFolderRefusal(join(dir, "missing"));
		expect(why).toContain("is not on this machine");
		expect(why).toContain(MAKE_EMPTY_FOLDER);
		expect(MAKE_EMPTY_FOLDER).toBe("mkdir -p -m 0555 /var/empty");
	});

	it("is refused when it is a file, holds something, or can be written by this process", () => {
		writeFileSync(join(dir, "file"), "");
		expect(emptyFolderRefusal(join(dir, "file"))).toContain("is not a folder");
		mkdirSync(join(dir, "held", ".claude"), {recursive: true});
		expect(emptyFolderRefusal(join(dir, "held"))).toContain("it holds .claude");
		mkdirSync(join(dir, "open"));
		expect(emptyFolderRefusal(join(dir, "open"))).toContain("can be written by this process");
	});

	// Root writes in any folder, so on root a read-only folder is refused too.
	it.skipIf(process.getuid?.() === 0)(
		"is let through when it is there, empty and read-only",
		() => {
			mkdirSync(ready);
			chmodSync(ready, 0o555);
			expect(emptyFolderRefusal(ready)).toBeNull();
		},
	);
});

// ---------------------------------------------------------------- the lint rule

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

/** The lines `pnpm lint`'s oxlint, with this repository's config, refuses in these files, as `name:line`. */
const fires = (paths: readonly string[]): readonly string[] => {
	const out = spawnSync(OXLINT, ["--format=json", ...paths.map((p) => relative(ROOT, p))], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const report = JSON.parse(out.stdout) as {
		readonly diagnostics: readonly {
			readonly code: string;
			readonly filename: string;
			readonly labels: readonly {readonly span: {readonly line: number}}[];
		}[];
	};
	return report.diagnostics
		.filter((d) => d.code === "fabrika(no-project-settings)")
		.map((d) => `${basename(d.filename)}:${d.labels[0]?.span.line}`)
		.sort();
};

/** Each line of a planted file, and whether the rule must refuse it. */
const PLANTED: readonly (readonly [string, boolean])[] = [
	['export const a = {settingSources: ["project"]};', true],
	['export const b = {"settingSources": ["user"]};', true],
	["export const c = {settingSources: sources};", true],
	["export const d = {settingSources};", true],
	['export const e = {...ownRules({}), projectConfigRoot: "/srv/repo"};', true],
	['options.settingSources = ["project"];', true],
	['options.projectConfigRoot = "/srv/repo";', true],
	['export const f = ["-p", "--setting-sources", "project"];', true],
	['export const g = ["--setting-sources=project"];', true],
	['export const h = ["--project-config-root", "/srv/repo"];', true],
	['export const i = {extraArgs: {"setting-sources": "project"}};', true],
	["export const j = {settingSources: []};", false],
	["export const k = {...ownRules({disableClaudeAiConnectors: true})};", false],
	['export const l = ["-p", "--setting-sources", ""];', false],
	["export const {projectConfigRoot: _gone, ...m} = ownRules({});", false],
	["options.settingSources = [];", false],
];

const PRELUDE = [
	'import {ownRules} from "@kampus/fabrika/agents/sandbox";',
	"declare const options: {settingSources?: string[]; projectConfigRoot?: string};",
	"declare const sources: string[];",
	"declare const settingSources: string[];",
];

describe("pnpm lint refuses the combination anywhere but rules.ts", () => {
	// Planted beside this file, so the repository's own .oxlintrc.json and its rule are what run.
	const plant = mkdtempSync(join(import.meta.dirname, ".no-project-settings-plant-"));
	afterAll(() => rmSync(plant, {recursive: true, force: true}));

	it("refuses each way of loading the project's settings, and lets the safe ones through", () => {
		writeFileSync(
			join(plant, "planted.ts"),
			[...PRELUDE, ...PLANTED.map(([line]) => line)].join("\n"),
		);
		const want = PLANTED.flatMap(([, refused], i) =>
			refused ? [`planted.ts:${PRELUDE.length + i + 1}`] : [],
		).sort();
		expect(fires([join(plant, "planted.ts")])).toEqual(want);
	});

	it("leaves out rules.ts by its path alone: the same text anywhere else is refused", () => {
		const own = join(import.meta.dirname, "rules.ts");
		expect(fires([own])).toEqual([]);
		writeFileSync(join(plant, "rules.ts"), readFileSync(own, "utf8"));
		expect(fires([join(plant, "rules.ts")]).length).toBeGreaterThanOrEqual(2);
	});
});
