// P16's real oxlint rule, generated packages and each package-layout plant.
import {spawnSync} from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {dirname, join, resolve} from "node:path";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const runs = {seed: 119120, numRuns: 8};
const name = fc.integer({min: 0, max: 100000}).map((n) => `program${n}`);
const run = (name: string, exports: unknown, sources: Readonly<Record<string, string>>) => {
	const home = realpathSync(mkdtempSync("/tmp/p16-lint-"));
	try {
		copyFileSync(join(ROOT, ".oxlintrc.json"), join(home, ".oxlintrc.json"));
		symlinkSync(join(ROOT, "oxlint-plugins"), join(home, "oxlint-plugins"));
		const pkg = `next/programs/${name}`;
		mkdirSync(join(home, pkg), {recursive: true});
		writeFileSync(
			join(home, pkg, "package.json"),
			JSON.stringify({name: `@p16/${name}`, type: "module", exports}),
		);
		for (const [path, text] of Object.entries(sources)) {
			mkdirSync(dirname(join(home, pkg, path)), {recursive: true});
			writeFileSync(join(home, pkg, path), text);
		}
		const result = spawnSync(
			join(ROOT, "node_modules/.bin/oxlint"),
			[
				"--config",
				join(home, ".oxlintrc.json"),
				"--disable-nested-config",
				"--no-ignore",
				"--format=json",
				...Object.keys(sources).map((path) => `${pkg}/${path}`),
			],
			{cwd: home, encoding: "utf8"},
		);
		const report: {number_of_files: number; diagnostics: Array<{code?: string; message: string}>} =
			JSON.parse(result.stdout);
		expect(report.number_of_files).toBe(Object.keys(sources).length);
		return report.diagnostics.filter((d) => d.code === "fabrika(program-package-layout)");
	} finally {
		rmSync(home, {recursive: true, force: true});
	}
};

describe("fabrika/program-package-layout", () => {
	it("accepts a pure entry, conditional exports and a real ./window; no window needs no stub", () => {
		fc.assert(
			fc.property(name, fc.boolean(), (name, window) => {
				const files: Record<string, string> = {
					"src/program.ts": 'export {helper} from "./helper.ts";',
					"src/helper.ts": "export const helper = 1;",
				};
				const exports: Record<string, unknown> = {
					".": {import: "./src/program.ts", default: "./src/program.ts"},
				};
				if (window) {
					exports["./window"] = "./src/window.tsx";
					files["src/window.tsx"] = "export const View = () => <b>ok</b>;";
				}
				expect(run(name, exports, files)).toEqual([]);
			}),
			runs,
		);
	});
	it("plants: Worker entries, hidden windows, missing files and a missing pure entry are refused", () => {
		fc.assert(
			fc.property(name, fc.constantFrom("worker", "workerd", "box", "brain"), (name, entry) => {
				const files = {
					"src/program.ts": "export const program = 1;",
					"src/window.tsx": "export const View = () => <b>ok</b>;",
				};
				for (const exports of [
					{
						".": "./src/program.ts",
						"./window": "./src/window.tsx",
						[`./${entry}`]: "./src/program.ts",
					},
					{".": "./src/program.ts", "./view": "./src/window.tsx"},
					{".": "./src/program.ts", "./window": "./missing.tsx"},
					{"./window": "./src/window.tsx"},
					{".": "./missing.ts", "./window": "./src/window.tsx"},
				])
					expect(run(name, exports, files).length).toBeGreaterThan(0);
			}),
			runs,
		);
	});
	it("plants: Worker runtime imports, re-exports and dynamic imports in the pure graph are refused", () => {
		fc.assert(
			fc.property(
				name,
				fc.constantFrom(
					"cloudflare:workers",
					"@kampus/libfabrika/box",
					"@kampus/libfabrika/workers",
					"workerd",
				),
				(name, source) => {
					for (const statement of [
						`import {env} from ${JSON.stringify(source)}; export {env};`,
						`export * from ${JSON.stringify(source)};`,
						`export const load = () => import(${JSON.stringify(source)});`,
					]) {
						expect(
							run(
								name,
								{".": "./src/program.ts"},
								{"src/program.ts": 'export * from "./helper.ts";', "src/helper.ts": statement},
							).length,
						).toBeGreaterThan(0);
					}
					expect(
						run(
							name,
							{".": "./src/program.ts"},
							{
								"src/program.ts":
									'import type {DurableObject} from "cloudflare:workers"; export type {DurableObject};',
							},
						),
					).toEqual([]);
				},
			),
			runs,
		);
	});
	it("measures the real tree: findings are inspected, with zero false alarms required to block", () => {
		const result = spawnSync(
			join(ROOT, "node_modules/.bin/oxlint"),
			[
				"--config",
				join(ROOT, ".oxlintrc.json"),
				"--disable-nested-config",
				"--no-ignore",
				"--format=json",
				"next/programs",
			],
			{cwd: ROOT, encoding: "utf8"},
		);
		const report: {
			number_of_files: number;
			diagnostics: Array<{code?: string; filename: string; message: string}>;
		} = JSON.parse(result.stdout);
		expect(report.number_of_files).toBeGreaterThan(0);
		const findings = report.diagnostics.filter((d) => d.code === "fabrika(program-package-layout)");
		console.log(
			JSON.stringify({
				rule: "fabrika/program-package-layout",
				files: report.number_of_files,
				findings,
			}),
		);
		expect(findings).toEqual([]);
	});
});
