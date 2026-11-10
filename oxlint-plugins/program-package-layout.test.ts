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
	it("mixed export conditions follow runtime entries and skip types and declaration files", () => {
		fc.assert(
			fc.property(
				name,
				fc.shuffledSubarray(
					["default", "import", "require", "node", "browser", "development", "production"],
					{minLength: 2, maxLength: 4},
				),
				fc.constantFrom(".d.ts", ".d.mts", ".d.cts"),
				(name, conditions, extension) => {
					const statement = 'import "cloudflare:workers";',
						declaration = `./src/program${extension}`,
						files: Record<string, string> = {
							[`src/program${extension}`]: statement,
							[`src/helper${extension}`]: statement,
							"src/types.ts": statement,
						},
						exports = {
							".": {
								types: {import: "./src/types.ts", default: declaration},
								...Object.fromEntries(
									conditions.map((condition) => [
										condition,
										{
											types: "./src/types.ts",
											import: `./src/${condition}.ts`,
											default: declaration,
										},
									]),
								),
							},
						};
					for (const condition of conditions)
						files[`src/${condition}.ts`] =
							`import "./helper${extension}"; export const program = 1;`;
					expect(run(name, exports, files)).toEqual([]);
					// Plant the same Worker import in each runtime entry, one at a time.
					for (const condition of conditions) {
						const findings = run(name, exports, {
							...files,
							[`src/${condition}.ts`]: statement,
						});
						expect(findings).toHaveLength(1);
						expect(findings[0]?.message).toBe(
							"Pure program code cannot import Worker runtime APIs.",
						);
					}
				},
			),
			{
				...runs,
				// Review round 5: a types export pulled program.d.ts into the runtime graph.
				examples: [["program0", ["import", "default"], ".d.ts"]],
			},
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
	// Review 1 of P16b: the rule knew Worker entries and windows only by a fixed list of names.
	const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
	const key = fc
		.array(segment, {minLength: 1, maxLength: 2})
		.map((parts) => `./${parts.join("/")}`)
		// Keep libfabrika's own entry names out, so only what an export loads can catch it.
		.filter(
			(key) => key !== "./window" && !/\/(?:worker|workers|workerd|box|brain)(?:\/|$)/.test(key),
		);
	const path = fc
		.array(segment, {minLength: 1, maxLength: 2})
		.map((parts) => `src/${parts.join("/")}`)
		.filter((path) => path !== "src/program");
	const three = (values: fc.Arbitrary<string>) =>
		fc
			.uniqueArray(values, {minLength: 3, maxLength: 3})
			.map((all): [string, string, string] => [all[0] ?? "", all[1] ?? "", all[2] ?? ""]);
	const shapes = [
		(c: string) =>
			`import {WorkerEntrypoint} from "cloudflare:workers"; export class ${c} extends WorkerEntrypoint {}`,
		(c: string) => `export class ${c} extends DurableObject {}`,
		(c: string) => `export const ${c} = class extends WorkflowEntrypoint {};`,
		(c: string) => `class ${c} extends cloudflare.DurableObject {} export {${c}};`,
		(c: string) => `export default {fetch() { return new Response("${c}"); }};`,
		(c: string) => `export const ${c} = 1; export * from "@kampus/libfabrika/box";`,
		(c: string) => `export const ${c} = () => import("workerd");`,
		(c: string) => `import "miniflare"; export const ${c} = 1;`,
	];
	it("plants: a Worker entry or a window behind any other export key is refused, by what it loads", () => {
		fc.assert(
			fc.property(
				name,
				three(key),
				three(path),
				fc.stringMatching(/^[A-Z][A-Za-z0-9]{0,7}$/),
				fc.nat({max: shapes.length - 1}),
				fc.boolean(),
				(
					name,
					[workerKey, windowKey, helperKey],
					[workerPath, windowPath, helperPath],
					c,
					shape,
					deep,
				) => {
					const workerMessage = `A program package has no Worker entry. libfabrika builds its box; '${workerKey}' is one.`,
						windowMessage = `The window is exported at './window', never at '${windowKey}'.`,
						unexported =
							"Export the real window at './window'. A program without a window needs no stub.",
						worker = `./${workerPath}.ts`,
						view = `./${windowPath}.tsx`,
						files: Record<string, string> = {
							"src/program.ts": "export const program = 1;",
							[`${helperPath}.ts`]: "export const helper = 1;",
							[`${windowPath}.tsx`]: "export const View = () => <b>ok</b>;",
							// The Worker code sits in the exported file or in a local file it loads.
							...(deep
								? {
										[`${workerPath}.ts`]: `export * from "./${workerPath.split("/").at(-1)}.impl.ts";`,
										[`${workerPath}.impl.ts`]: shapes[shape]!(c),
									}
								: {[`${workerPath}.ts`]: shapes[shape]!(c)}),
						},
						base = {".": "./src/program.ts", "./window": view, [helperKey]: `./${helperPath}.ts`},
						messages = (exports: unknown) => run(name, exports, files).map((d) => d.message);
					// A pure extra export and a window at './window' are fine; an unexported .ts is not judged.
					expect(messages(base)).toEqual([]);
					expect(messages({...base, [workerKey]: worker})).toEqual([workerMessage]);
					const {"./window": _, ...moved} = base;
					expect(messages({...moved, [windowKey]: view})).toEqual([windowMessage]);
					// A window file nobody exports, at any path, still needs './window'.
					expect(messages(moved)).toEqual([unexported]);
					// The review's package: a Worker entry and the window both behind other keys.
					expect(messages({...moved, [workerKey]: worker, [windowKey]: view}).sort()).toEqual(
						[workerMessage, windowMessage].sort(),
					);
				},
			),
			{
				...runs,
				// Review 1 of P16b: "./server" loading a WorkerEntrypoint class and "./ui" loading a
				// .tsx gave no finding, while the same package with "./worker" did.
				examples: [
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						false,
					],
				],
			},
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
	it("plant: literal dynamic imports follow pure helpers through nested functions and cycles", () => {
		fc.assert(
			fc.property(
				name,
				fc.constantFrom("cloudflare:workers", "@kampus/libfabrika/workers", "workerd"),
				(name, source) => {
					const files = {
						"src/program.ts": 'export const load = () => import("./helper.ts");',
						"src/helper.ts":
							'export const load = async () => { return import("./nested/runtime.ts"); };',
						"src/nested/runtime.ts":
							'export const load = () => import("../helper.ts"); export const pure = 1;',
					};
					expect(run(name, {".": "./src/program.ts"}, files)).toEqual([]);
					for (const statement of [
						`import {env} from ${JSON.stringify(source)}; export {env};`,
						`export * from ${JSON.stringify(source)};`,
						`export const worker = () => import(${JSON.stringify(source)});`,
					]) {
						const planted = {
							...files,
							"src/nested/runtime.ts": `${files["src/nested/runtime.ts"]}\n${statement}`,
						};
						expect(
							run(name, {".": "./src/program.ts"}, planted).length,
							"dynamic pure helper imports a Worker API",
						).toBeGreaterThan(0);
					}
				},
			),
			{...runs, numRuns: 3},
		);
	});
	for (const form of ["declaration", "specifier"] as const)
		it(`type-only ${form} imports are erased; changing one to a value import is a finding`, () => {
			fc.assert(
				fc.property(name, name, (name, alias) => {
					const binding = `DurableObject as ${alias}`,
						statement =
							form === "declaration"
								? `import type {${binding}} from "cloudflare:workers";`
								: `import {type ${binding}} from "cloudflare:workers";`,
						files = {"src/program.ts": `${statement} export type {${alias}};`};
					expect(run(name, {".": "./src/program.ts"}, files)).toEqual([]);
					// Plant a runtime import of the same name in the same pure entry.
					const findings = run(
						name,
						{".": "./src/program.ts"},
						{
							"src/program.ts": `import {${binding}} from "cloudflare:workers"; export {${alias}};`,
						},
					);
					expect(findings).toHaveLength(1);
					expect(findings[0]?.message).toBe("Pure program code cannot import Worker runtime APIs.");
				}),
				runs,
			);
		});
	for (const form of ["declaration", "specifier"] as const)
		it(`type-only ${form} re-exports are erased; changing one to a value re-export is a finding`, () => {
			fc.assert(
				fc.property(name, name, (name, alias) => {
					const binding = `DurableObject as ${alias}`,
						statement =
							form === "declaration"
								? `export type {${binding}} from "cloudflare:workers";`
								: `export {type ${binding}} from "cloudflare:workers";`;
					expect(run(name, {".": "./src/program.ts"}, {"src/program.ts": statement})).toEqual([]);
					// Plant a runtime re-export of the same name in the same pure entry.
					const findings = run(
						name,
						{".": "./src/program.ts"},
						{
							"src/program.ts": `export {${binding}} from "cloudflare:workers";`,
						},
					);
					expect(findings).toHaveLength(1);
					expect(findings[0]?.message).toBe("Pure program code cannot export Worker runtime APIs.");
					// A type-only specifier must not hide a value specifier in the same declaration.
					expect(
						run(
							name,
							{".": "./src/program.ts"},
							{
								"src/program.ts": `export {type ${binding}, env} from "cloudflare:workers";`,
							},
						),
					).toHaveLength(1);
				}),
				runs,
			);
		});
	for (const edge of [
		'import type {X} from "./helper.ts"; export type {X};',
		'import {type X} from "./helper.ts"; export type {X};',
		'export type {X} from "./helper.ts";',
		'export {type X} from "./helper.ts";',
		'export type * from "./helper.ts";',
	])
		it(`a type-only helper link loads no Worker code: ${edge}`, () => {
			fc.assert(
				fc.property(name, name, (name, alias) => {
					const files = {
						"src/program.ts": edge,
						"src/helper.ts": `import {env} from "cloudflare:workers"; export type X = string; export const ${alias} = env;`,
					};
					// Run the plant first, so the same helper is proved reachable by a value link.
					for (const link of [
						`export {${alias}} from "./helper.ts";`,
						'export {} from "./helper.ts";',
						`export {type X, ${alias}} from "./helper.ts";`,
						`import {type X, ${alias}} from "./helper.ts"; export {${alias}};`,
						'import "./helper.ts";',
					]) {
						const findings = run(
							name,
							{".": "./src/program.ts"},
							{...files, "src/program.ts": link},
						);
						expect(findings).toHaveLength(1);
						expect(findings[0]?.message).toBe(
							"Pure program code cannot import Worker runtime APIs.",
						);
					}
					expect(run(name, {".": "./src/program.ts"}, files)).toEqual([]);
				}),
				{...runs, numRuns: 3},
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
