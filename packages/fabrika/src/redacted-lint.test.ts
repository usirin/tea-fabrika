// `pnpm lint` refuses a secret read from `process.env` as plain text (no-secret-env.ts), and a
// `Redacted.value` outside the edge files .oxlintrc.json lists (no-redacted-value.ts). Each planted
// line says whether the rule must refuse it. docs/direction/secrets-are-redacted.md.
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {basename, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {afterAll, describe, expect, it} from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

/** The lines `pnpm lint`'s oxlint, with this repository's config, refuses in these files, by rule. */
const fires = (paths: readonly string[]) => {
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
	const where = (rule: string) =>
		report.diagnostics
			.filter((d) => d.code === `fabrika(${rule})`)
			.map((d) => `${basename(d.filename)}:${d.labels[0]?.span.line}`)
			.sort();
	return {env: where("no-secret-env"), value: where("no-redacted-value")};
};

/** Each line of a planted file, and whether no-secret-env must refuse it. */
const ENV: readonly (readonly [string, boolean])[] = [
	["export const a = process.env.GITHUB_TOKEN;", true],
	['export const b = process.env["TYPESAFE_API_KEY"];', true],
	['export const c = process.env.DOOR_SECRET ?? "";', true],
	["export const {ANTHROPIC_API_KEY} = process.env;", true],
	['export const d = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") !== "";', true],
	["export const e = process.env.CLOUDFLARE_API_TOKEN;", true],
	['export const f = process.env["DB_PASSWORD"];', true],
	["export const g = process.env.GH_AUTH;", true],
	["export const h = process.env.SERVICE_CREDENTIALS;", true],
	["export const i = process.env.KEYS_CACHE_MS;", false],
	["export const j = process.env.GIT_AUTHOR_NAME;", false],
	["export const k = process.env.LOCAL_SECRET_HASH;", false],
	["export const l = process.env.SSH_AUTH_SOCK;", false],
	["export const m = process.env.KEY;", false],
	["export const n = process.env.REAL_KEY;", false],
	["export const o = !process.env.OPENAI_API_KEY;", false],
	["export const p = process.env.CODEX_API_KEY === undefined;", false],
	["export const q = process.env.CODEX_API_KEY !== undefined;", false],
	["delete process.env.CLOUDFLARE_API_TOKEN;", false],
	["export const {TYPESAFE_API_KEY: _gone, ...rest} = process.env;", false],
	["export const r = process.env.PATH;", false],
];

/** Each line of a planted file, and whether no-redacted-value must refuse it. */
const VALUE: readonly (readonly [string, boolean])[] = [
	["export const s = Redacted.value(token);", true],
	["export const t = [token].map(Redacted.value);", true],
	['export const u = "Bearer " + Redacted.value(token);', true],
	["export const v = Redacted.make(String(Math.random()));", false],
	["export const w = String(token);", false],
	["export const x = Redacted.isRedacted(token);", false],
];

const PRELUDE = [
	'import {Redacted} from "effect";',
	"declare const token: Redacted.Redacted<string>;",
];

const lineOf = (i: number) => `planted.ts:${PRELUDE.length + i + 1}`;

describe("pnpm lint keeps secrets in their Redacted", () => {
	// Planted beside this file, so the repository's own .oxlintrc.json and its rules are what run.
	const plant = mkdtempSync(join(import.meta.dirname, ".redacted-plant-"));
	afterAll(() => rmSync(plant, {recursive: true, force: true}));
	const lines = [...ENV, ...VALUE];

	it("refuses each plain read of a secret and each way out of a Redacted, and lets the rest through", () => {
		writeFileSync(join(plant, "planted.ts"), [...PRELUDE, ...lines.map(([l]) => l)].join("\n"));
		const got = fires([join(plant, "planted.ts")]);
		expect(got.env).toEqual(ENV.flatMap(([, no], i) => (no ? [lineOf(i)] : [])).sort());
		expect(got.value).toEqual(
			VALUE.flatMap(([, no], i) => (no ? [lineOf(ENV.length + i)] : [])).sort(),
		);
	});

	it("leaves out an edge file by its path alone: the same text anywhere else is refused", () => {
		const own = join(import.meta.dirname, "host", "http.ts");
		expect(fires([own]).value).toEqual([]);
		writeFileSync(join(plant, "http.ts"), readFileSync(own, "utf8"));
		expect(fires([join(plant, "http.ts")]).value.length).toBeGreaterThanOrEqual(1);
	});
});
