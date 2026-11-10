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
import {dirname, join, relative, resolve} from "node:path";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const runs = {seed: 119120, numRuns: 8};

// fast-check 4.10.2 counts `examples` inside `numRuns`: they run first, and the run stops at
// `numRuns`. P16b's layout law, with 7 examples and `numRuns: 8`, ran 1 generated input, and with
// 11 it would have dropped 3 examples. So a law's generated runs go on top of its examples.
const withExamples = <P extends {readonly numRuns: number; readonly examples: readonly unknown[]}>(
	parameters: P,
): P => ({...parameters, numRuns: parameters.numRuns + parameters.examples.length});

const name = fc.integer({min: 0, max: 100000}).map((n) => `program${n}`);

// The manifest a package is written with, from the fields the harness gives it, and symlinks:
// each path in the package points to a path given from the package folder.
type Package = {
	readonly manifest?: (fields: Readonly<Record<string, unknown>>) => unknown;
	readonly links?: Readonly<Record<string, string>>;
};

const run = (
	name: string,
	exports: unknown,
	sources: Readonly<Record<string, string>>,
	{manifest = (fields) => fields, links = {}}: Package = {},
) => {
	const home = realpathSync(mkdtempSync("/tmp/p16-lint-"));

	try {
		copyFileSync(join(ROOT, ".oxlintrc.json"), join(home, ".oxlintrc.json"));
		symlinkSync(join(ROOT, "oxlint-plugins"), join(home, "oxlint-plugins"));
		const pkg = `next/programs/${name}`;
		mkdirSync(join(home, pkg), {recursive: true});
		const written = manifest({name: `@p16/${name}`, type: "module", exports});
		writeFileSync(
			join(home, pkg, "package.json"),
			typeof written === "string" ? written : JSON.stringify(written),
		);

		for (const [path, text] of Object.entries(sources)) {
			mkdirSync(dirname(join(home, pkg, path)), {recursive: true});
			writeFileSync(join(home, pkg, path), text);
		}

		for (const [path, target] of Object.entries(links)) {
			const at = join(home, pkg, path);
			mkdirSync(dirname(at), {recursive: true});
			symlinkSync(relative(dirname(at), join(home, pkg, target)), at);
		}

		// oxlint lints only JavaScript and TypeScript files, here only the package's own: a file
		// outside it is outside the rule too.
		const linted = Object.keys(sources).filter(
			(path) => /\.[cm]?[jt]sx?$/.test(path) && !path.startsWith("../"),
		);

		const result = spawnSync(
			join(ROOT, "node_modules/.bin/oxlint"),
			[
				"--config",
				join(home, ".oxlintrc.json"),
				"--disable-nested-config",
				"--no-ignore",
				"--format=json",
				...linted.map((path) => `${pkg}/${path}`),
			],
			{cwd: home, encoding: "utf8"},
		);
		expect(result.stdout, result.stderr).not.toBe("");
		const report: {number_of_files: number; diagnostics: Array<{code?: string; message: string}>} =
			JSON.parse(result.stdout);
		expect(report.number_of_files).toBe(linted.length);
		return report.diagnostics.filter((d) => d.code === "fabrika(program-package-layout)");
	} finally {
		rmSync(home, {recursive: true, force: true});
	}
};

describe("fabrika/program-package-layout", () => {
	// Review 6 of P16b: a link that resolves to nothing is unjudged, save these. A Node builtin has no
	// file to resolve to, and a package the manifest depends on is outside code not installed in the
	// scratch package; a `#` alias is fine when every target its entry names is one of them.
	const fine: readonly {
		readonly line: string;
		readonly manifest: Readonly<Record<string, unknown>>;
	}[] = [
		{line: 'import {join} from "node:path"; export {join};', manifest: {}},
		{line: 'export * from "dep-a";', manifest: {dependencies: {"dep-a": "1.0.0"}}},
		{line: 'import "@scope/dep-b/sub";', manifest: {devDependencies: {"@scope/dep-b": "1.0.0"}}},
		{line: 'export {x} from "dep-c";', manifest: {peerDependencies: {"dep-c": "1.0.0"}}},
		{line: 'import "dep-d";', manifest: {optionalDependencies: {"dep-d": "1.0.0"}}},
		{line: 'import "#path";', manifest: {imports: {"#path": "node:path"}}},
		{
			line: 'export * from "#lib/x";',
			manifest: {
				imports: {"#lib/*": {node: ["dep-a/*"], default: "node:fs"}},
				dependencies: {"dep-a": "1.0.0"},
			},
		},
	];
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

				for (const {line, manifest} of fine) {
					expect(
						run(
							name,
							exports,
							{...files, "src/helper.ts": `${line}\nexport const helper = 1;`},
							{manifest: (fields) => ({...fields, ...manifest})},
						),
						line,
					).toEqual([]);
				}
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

					for (const condition of conditions) {
						files[`src/${condition}.ts`] =
							`import "./helper${extension}"; export const program = 1;`;
					}

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
			withExamples({
				...runs,
				// Review round 5: a types export pulled program.d.ts into the runtime graph.
				examples: [["program0", ["import", "default"], ".d.ts"]],
			}),
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
				]) {
					expect(run(name, exports, files).length).toBeGreaterThan(0);
				}

				// Review 5 of P16b's sweep: each place the rule returned early, skipped a key, dropped
				// a target or read a missing value as fine. Each package holds Worker code the rule
				// cannot see, or cannot read, and is refused.
				const pure = "src/program.ts",
					program = "export const program = 1;",
					fetch = "export default {fetch() { return new Response(''); }};",
					cases: readonly {
						readonly exports: unknown;
						readonly files: Readonly<Record<string, string>>;
						readonly package?: Package;
					}[] = [
						// scenario: a test file as the '.' entry, which the rule skipped, so its findings
						// were never reported anywhere.
						{
							exports: {".": "./src/program.test.ts"},
							files: {"src/program.test.ts": fetch, "src/helper.ts": program},
						},
						// scenario: a '.' entry oxlint does not lint (no extension), so the findings
						// meant for it were never reported.
						{
							exports: {".": "./src/program"},
							files: {"src/program": fetch, "src/helper.ts": program},
						},
						// scenario: an unparsable file behind a subpath, read as an empty module.
						{
							exports: {".": `./${pure}`, "./server": "./src/server.ts"},
							files: {[pure]: program, "src/server.ts": `${fetch}\nexport default {fetch() {`},
						},
						// scenario: an unparsable file in the pure graph, read as an empty module.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: 'export * from "./broken.ts";',
								"src/broken.ts": 'import "cloudflare:workers";\nexport const x = {',
							},
						},
						// scenario: a subpath target that does not start with "./" resolved to nothing and
						// was dropped, though the file holds a Worker.
						{
							exports: {".": `./${pure}`, "./server": "src/server.ts"},
							files: {[pure]: program, "src/server.ts": fetch},
						},
						// scenario: a subpath target naming no file was dropped.
						{exports: {".": `./${pure}`, "./server": "./src/missing.ts"}, files: {[pure]: program}},
						// scenario: an exports key that is neither '.' nor './…' was never read.
						{
							exports: {".": `./${pure}`, import: "./src/server.ts"},
							files: {[pure]: program, "src/server.ts": fetch},
						},
						// scenario: a pattern target in dist/, which the file listing left out.
						{
							exports: {".": `./${pure}`, "./*": "./dist/*.js"},
							files: {[pure]: program, "dist/server.js": fetch},
						},
						// scenario: a pattern target with two `*`, matched only up to the second.
						{
							exports: {".": `./${pure}`, "./*": "./src/*/*.ts"},
							files: {[pure]: program, "src/server/server.ts": fetch},
						},
						// scenario: a pattern target under a symlinked folder, which the listing never
						// entered.
						{
							exports: {".": `./${pure}`, "./*": "./src/*.ts"},
							files: {[pure]: program, "../../../shared/server.ts": fetch},
							package: {links: {"src/lib": "../../../shared"}},
						},
						// scenario: a target outside the package is judged like any other.
						{
							exports: {".": `./${pure}`, "./server": "../../../shared/server.ts"},
							files: {[pure]: program, "../../../shared/server.ts": fetch},
						},
						// scenario: a `#` import in the pure graph was never followed.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: 'export {Server} from "#server";',
								"src/server.ts": "export class Server extends WorkerEntrypoint {}",
							},
							package: {
								manifest: (fields) => ({...fields, imports: {"#server": "./src/server.ts"}}),
							},
						},
						// scenario: a dynamic import by a template literal was never followed.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: "export const load = () => import(`./server.ts`);",
								"src/server.ts": "export class Server extends WorkerEntrypoint {}",
							},
						},
						// scenario: a `require` was never followed.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: 'const server = require("./server.ts"); export {server};',
								"src/server.ts": "export class Server extends WorkerEntrypoint {}",
							},
						},
						// scenario: `import x = require(…)` was never followed.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: 'import server = require("./server.ts"); export {server};',
								"src/server.ts": "export class Server extends WorkerEntrypoint {}",
							},
						},
						// scenario: a `require` of a Worker runtime in pure code was not reported.
						{
							exports: {".": `./${pure}`},
							files: {[pure]: 'const w = require("cloudflare:workers"); export {w};'},
						},
						// scenario: `import x = require(…)` of a Worker runtime in pure code was not reported.
						{
							exports: {".": `./${pure}`},
							files: {[pure]: 'import w = require("cloudflare:workers"); export {w};'},
						},
						// scenario: a dynamic import by a computed name loads what the rule cannot see.
						{
							exports: {".": `./${pure}`},
							files: {
								[pure]: 'const at = "./server.ts"; export const load = () => import(at);',
								"src/server.ts": fetch,
							},
						},
						// Review 6 of P16b: a link that resolved to nothing was dropped with no finding.
						// Each names code the rule cannot see, and none is a Node builtin or a package
						// the manifest depends on.
						// scenario: a relative link to a missing file.
						{exports: {".": `./${pure}`}, files: {[pure]: 'export * from "./missing.ts";'}},
						// scenario: a `#` link the manifest has no `imports` entry for.
						{exports: {".": `./${pure}`}, files: {[pure]: 'import "#server";'}},
						// scenario: a `#` link whose entry names a missing file.
						{
							exports: {".": `./${pure}`},
							files: {[pure]: 'import "#server";'},
							package: {
								manifest: (fields) => ({...fields, imports: {"#server": "./src/missing.ts"}}),
							},
						},
						// scenario: a `#` link whose entry names, beside a builtin, a package the manifest
						// does not depend on.
						{
							exports: {".": `./${pure}`},
							files: {[pure]: 'import "#server";'},
							package: {
								manifest: (fields) => ({
									...fields,
									imports: {"#server": {node: "node:fs", default: "server-pkg"}},
								}),
							},
						},
						// scenario: a package the manifest does not depend on.
						{exports: {".": `./${pure}`}, files: {[pure]: 'import "server-pkg";'}},
						// scenario: the package's own name, for a subpath it does not export.
						{exports: {".": `./${pure}`}, files: {[pure]: `import "@p16/${name}/server";`}},
						// scenario: a module by another scheme, which no file stands for.
						{exports: {".": `./${pure}`}, files: {[pure]: 'import "virtual:server";'}},
						// scenario: the same, behind a subpath rather than '.'.
						{
							exports: {".": `./${pure}`, "./server": "./src/server.ts"},
							files: {[pure]: program, "src/server.ts": 'export * from "./missing.ts";'},
						},
					];

				for (const {exports, files, package: setup} of cases) {
					expect(run(name, exports, files, setup), JSON.stringify(exports)).not.toEqual([]);
				}
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
	const imports = "Pure program code cannot import Worker runtime APIs.";
	// Each Worker shape: whether it defines a Worker (a class or a handler), and what the per-line
	// check says of it when '.' loads it as pure code.
	const shapes: readonly {
		readonly text: (c: string) => string;
		readonly defines: boolean;
		readonly pure: readonly string[];
	}[] = [
		{
			text: (c) =>
				`import {WorkerEntrypoint} from "cloudflare:workers"; export class ${c} extends WorkerEntrypoint {}`,
			defines: true,
			pure: [imports],
		},
		{text: (c) => `export class ${c} extends DurableObject {}`, defines: true, pure: []},
		{
			text: (c) => `export const ${c} = class extends WorkflowEntrypoint {};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `class ${c} extends cloudflare.DurableObject {} export {${c}};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `export default {fetch() { return new Response("${c}"); }};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `export const ${c} = 1; export * from "@kampus/libfabrika/box";`,
			defines: false,
			pure: ["Pure program code cannot export Worker runtime APIs."],
		},
		{
			text: (c) => `export const ${c} = () => import("workerd");`,
			defines: false,
			pure: ["Pure program code cannot load Worker runtime APIs."],
		},
		{text: (c) => `import "miniflare"; export const ${c} = 1;`, defines: false, pure: [imports]},
		// Review 2 of P16b: Cloudflare's documented handler forms, and a handler by name.
		{
			text: (c) =>
				`export default {async fetch() { return new Response("${c}"); }} satisfies ExportedHandler;`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `export default {fetch() { return new Response("${c}"); }} as ExportedHandler;`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `const ${c} = {fetch() { return new Response(""); }}; export default ${c};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) =>
				`const ${c} = {scheduled() {}} satisfies ExportedHandler; const app = ${c}; export default app;`,
			defines: true,
			pure: [],
		},
		{text: (c) => `const ${c} = {queue() {}}; export {${c} as default};`, defines: true, pure: []},
		// Review 3 of P16b: a spread default carries the handler object it spreads (13 to 15).
		{
			text: (c) => `const ${c} = {fetch() { return new Response(""); }}; export default {...${c}};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `export default {...{scheduled() {}}, ${c}: 1};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) =>
				`const ${c} = {email() {}}; const app = {...(${c} as ExportedHandler)} satisfies ExportedHandler; export default app;`,
			defines: true,
			pure: [],
		},
		// The rest of the handler forms syntax can see: an arrow property, a string key, a computed
		// literal key, a default class, `<T>x`, and `x!` around parentheses (16 to 21).
		{
			text: (c) => `export default {fetch: async () => new Response("${c}")};`,
			defines: true,
			pure: [],
		},
		{text: (c) => `export default {"tail"() {}, ${c}: 1};`, defines: true, pure: []},
		{text: (c) => `export default {["queue"]() {}, ${c}: 1};`, defines: true, pure: []},
		{text: (c) => `export default class ${c} extends WorkerEntrypoint {}`, defines: true, pure: []},
		{
			text: (c) => `export default <ExportedHandler>{fetch() { return new Response("${c}"); }};`,
			defines: true,
			pure: [],
		},
		{
			text: (c) => `export default ({fetch() { return new Response("${c}"); }})!;`,
			defines: true,
			pure: [],
		},
		// Review 5 of P16b's sweep: a Worker base class by a local name (22).
		{
			text: (c) => `const ${c}Base = DurableObject; export class ${c} extends ${c}Base {}`,
			defines: true,
			pure: [],
		},
	];
	// How the Worker file is reached from its export: itself, a `.ts` link, a link written without
	// an extension, which TypeScript resolves, a symlink to a file outside the package, or a link
	// out of the package. Review 6 of P16b: the Worker file itself, with its Worker runtime import
	// behind a `#` alias in the package's own `imports`, as a string, an array, a nested condition
	// after a file target, or a pattern key.
	const links = [
		"same file",
		".ts",
		"no extension",
		"symlink",
		"outside",
		"imports alias",
		"imports array",
		"imports condition",
		"imports pattern",
	] as const;
	// The Worker runtime name a shape links, if any.
	const runtimeName = /"(cloudflare:workers|@kampus\/libfabrika\/box|workerd|miniflare)"/;
	// How the package exports the Worker file: its own key, a pattern key, or a runtime condition
	// of '.' beside the pure program. Review 3 of P16b: a fallback array on a key, inside a
	// condition, or under a runtime condition of '.'; a pattern whose target has no `*`; and a
	// pattern that a null target shuts off for the Worker file, which then exports nothing.
	// Review 5 of P16b: './window' itself, with the Worker in a `.ts` or a `.tsx` file.
	const entries = [
		"key",
		"pattern",
		"key pattern",
		"condition",
		"array key",
		"array condition",
		"array dot",
		"fixed pattern",
		"null pattern",
		"window",
		"window tsx",
	] as const;
	// Review 5 of P16b: the manifest's name, which a pattern asks the package's own exports by. With
	// none, or one that is not a string, every subpath a pattern matches counts as offered.
	const manifests = {
		name: (fields: Readonly<Record<string, unknown>>) => fields,
		"no name": ({name: _, ...fields}: Readonly<Record<string, unknown>>) => fields,
		"number name": (fields: Readonly<Record<string, unknown>>) => ({...fields, name: 7}),
	} as const;
	const box = /\/(?:worker|workers|workerd|box|brain)(?:\/|$)/;
	it("plants: a Worker entry or a window behind any other export key is refused, by what it loads", () => {
		fc.assert(
			fc.property(
				name,
				three(key),
				three(path),
				fc.stringMatching(/^[A-Z][A-Za-z0-9]{0,7}$/),
				fc.nat({max: shapes.length - 1}),
				fc.constantFrom(...links),
				fc.constantFrom(...entries),
				fc.constantFrom("workerd", "worker", "browser", "import", "node", "default"),
				fc.constantFrom(...(Object.keys(manifests) as (keyof typeof manifests)[])),
				(
					name,
					[workerKey, windowKey, helperKey],
					[workerPath, windowPath, helperPath],
					c,
					shape,
					link,
					entry,
					condition,
					manifest,
				) => {
					const windowEntry = entry === "window" || entry === "window tsx",
						ext = entry === "window tsx" ? "tsx" : "ts",
						worker = `./${workerPath}.${ext}`,
						view = `./${windowPath}.tsx`,
						last = workerPath.split("/").at(-1) ?? "",
						impl = `./${last}.impl${link === ".ts" ? ".ts" : ""}`,
						// The Worker code's own file outside the package, as written from the package
						// folder and from the Worker file's folder.
						outside = `../../../outside/${last}.ts`,
						up = `${"../".repeat(workerPath.split("/").length - 1)}${outside}`,
						// The pure program sits beside the Worker file under '.', on the other condition.
						beside = condition === "default" ? "import" : "default",
						written = shapes[shape]!.text(c),
						runtime = runtimeName.exec(written)?.[1],
						// The beside condition's file target comes first, so the resolver answers with it.
						aliases: Record<string, unknown> =
							runtime === undefined
								? {}
								: link === "imports alias"
									? {"#cf": runtime}
									: link === "imports array"
										? {"#cf": [runtime]}
										: link === "imports condition"
											? {"#cf": {[beside]: "./src/program.ts", [condition]: {default: runtime}}}
											: link === "imports pattern"
												? {"#cf/*": "*"}
												: {},
						text =
							runtime === undefined || !link.startsWith("imports")
								? written
								: written.replace(
										JSON.stringify(runtime),
										JSON.stringify(link === "imports pattern" ? `#cf/${runtime}` : "#cf"),
									),
						files: Record<string, string> = {
							"src/program.ts": "export const program = 1;",
							[`${helperPath}.ts`]: "export const helper = 1;",
							[`${windowPath}.tsx`]: "export const View = () => <b>ok</b>;",
							// The Worker code sits in the exported file, in a local file it loads, or
							// outside the package.
							...(link === "same file" || link.startsWith("imports")
								? {[`${workerPath}.${ext}`]: text}
								: link === "symlink"
									? {[outside]: text}
									: link === "outside"
										? {
												[`${workerPath}.${ext}`]: `export * from ${JSON.stringify(up)};`,
												[outside]: text,
											}
										: {
												[`${workerPath}.${ext}`]: `export * from ${JSON.stringify(impl)};`,
												[`${workerPath}.impl.ts`]: text,
											}),
						},
						symlinks = link === "symlink" ? {[`${workerPath}.${ext}`]: outside} : {},
						// The Worker file's subpaths under "./*", which "null pattern" shuts off.
						shut = [
							`./${workerPath.slice("src/".length)}`,
							...(link === ".ts" || link === "no extension"
								? [`./${workerPath.slice("src/".length)}.impl`]
								: []),
						],
						// The export that carries the Worker file, and the key its finding names.
						carriers: Record<(typeof entries)[number], [string, Record<string, unknown>]> = {
							key: [workerKey, {[workerKey]: worker}],
							pattern: ["./*", {"./*": "./src/*.ts"}],
							"key pattern": [`${workerKey}/*`, {[`${workerKey}/*`]: "./src/*.ts"}],
							condition: [".", {".": {[condition]: worker, [beside]: "./src/program.ts"}}],
							"array key": [workerKey, {[workerKey]: [worker]}],
							"array condition": [workerKey, {[workerKey]: {[condition]: [worker]}}],
							"array dot": [".", {".": {[condition]: [worker], [beside]: "./src/program.ts"}}],
							"fixed pattern": [`${workerKey}/*`, {[`${workerKey}/*`]: worker}],
							"null pattern": [
								"./*",
								{"./*": "./src/*.ts", ...Object.fromEntries(shut.map((key) => [key, null]))},
							],
							window: ["./window", {"./window": worker}],
							"window tsx": ["./window", {"./window": worker}],
						},
						[shown, exported] = carriers[entry],
						// A window behind an array target is the same window.
						arrays = entry.startsWith("array"),
						target = (path: string) => (arrays ? [path] : path),
						entryMessage = (key: string) =>
							`A program package has no Worker entry. libfabrika builds its box; '${key}' is one.`,
						workerMessage = entryMessage(shown),
						windowMessage = `The window is exported at './window', never at '${windowKey}'.`,
						unexported =
							"Export the real window at './window'. A program without a window needs no stub.",
						// Under '.', the file is pure code too: a Worker class or handler names '.', and a
						// Worker runtime import is reported on its own line, or for the package when the
						// file is one oxlint does not lint here (outside the package, or by a symlink).
						lined = link !== "symlink" && link !== "outside",
						away = link === "symlink" ? `${workerPath}.${ext}` : outside,
						pure = lined
							? shapes[shape]!.pure
							: shapes[shape]!.pure.length > 0
								? [`Pure program code cannot load Worker runtime APIs, as '${away}' does.`]
								: [],
						// A null target exports nothing, though a key named for libfabrika's box is
						// refused by its name alone. With no name to ask the exports by, the pattern
						// keeps the subpath.
						boxed = shut.filter((key) => box.test(key)).map(entryMessage),
						expected =
							entry === "condition" || entry === "array dot"
								? [...(shapes[shape]!.defines ? [workerMessage] : []), ...pure]
								: entry === "null pattern"
									? manifest === "name"
										? boxed
										: [workerMessage, ...boxed]
									: [workerMessage],
						// A Worker file shaped like a window is a window nobody exports, until './window'
						// carries it.
						stray = entry === "window tsx" ? [unexported] : [],
						base = {
							".": target("./src/program.ts"),
							"./window": target(view),
							[helperKey]: `./${helperPath}.ts`,
						},
						messages = (exports: unknown) =>
							run(name, exports, files, {
								manifest: (fields) => ({
									...manifests[manifest](fields),
									...(Object.keys(aliases).length === 0 ? {} : {imports: aliases}),
								}),
								links: symlinks,
							})
								.map((d) => d.message)
								.sort();
					// A pure extra export and a window at './window' are fine; an unexported .ts is not judged.
					expect(messages(base)).toEqual(stray);
					// At './window' the Worker takes the real window's place, which nobody exports then.
					expect(messages({...base, ...exported})).toEqual(
						[...expected, ...(windowEntry ? [unexported] : [])].sort(),
					);
					const {"./window": _, ...moved} = base;
					expect(messages({...moved, [windowKey]: target(view)})).toEqual(
						[windowMessage, ...stray].sort(),
					);
					// A window file nobody exports, at any path, still needs './window'.
					expect(messages(moved)).toEqual([unexported]);
					// The review's package: a Worker entry and the window both behind other keys.
					expect(messages({...moved, ...exported, [windowKey]: target(view)})).toEqual(
						[...expected, windowMessage].sort(),
					);
				},
			),
			withExamples({
				...runs,
				examples: [
					// Review 1 of P16b: "./server" loading a WorkerEntrypoint class and "./ui" loading a
					// .tsx gave no finding, while the same package with "./worker" did.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, "./*": "./src/*.ts" with a WorkerEntrypoint class in
					// src/server.ts: the literal pattern target was looked up as a file and gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						"same file",
						"pattern",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, `export default {async fetch() {}} satisfies
					// ExportedHandler;` behind "./server" gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						8,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, the same handler under `as` gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						9,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, `const app = {fetch() {}}; export default app;` gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"app",
						10,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, ".": {"workerd": "./src/worker.ts", "default":
					// "./src/program.ts"} with a fetch handler in worker.ts gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/worker", "src/ui", "src/lib"],
						"Worker",
						4,
						"same file",
						"condition",
						"workerd",
						"name",
					],
					// pinned: review 2 of P16b, src/server.ts holding `export * from "./impl"` with the
					// Worker in impl.ts gave no finding: the link without an extension was not followed.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						"no extension",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 3 of P16b, "./server": ["./src/server.ts"] with a WorkerEntrypoint
					// class in server.ts gave no finding, and a window behind an array target was told
					// to move to './window' instead of named at its key.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						"same file",
						"array key",
						"workerd",
						"name",
					],
					// pinned: review 3 of P16b, "./server": {"default": ["./src/server.ts"]} gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						0,
						"same file",
						"array condition",
						"default",
						"name",
					],
					// pinned: review 3 of P16b, ".": {"workerd": ["./src/worker.ts"], "default":
					// "./src/program.ts"} gave no finding for the Worker in worker.ts.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/worker", "src/ui", "src/lib"],
						"Worker",
						0,
						"same file",
						"array dot",
						"workerd",
						"name",
					],
					// pinned: review 3 of P16b, `const h = {fetch() {}}; export default {...h};` behind
					// "./server" gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"h",
						13,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b, "./window": "./src/window.tsx" holding `export default
					// {fetch() {}}` gave no finding: the "./window" graph was never judged for Worker code.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/window", "src/ui", "src/lib"],
						"Window",
						4,
						"same file",
						"window tsx",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b, the same "./window" file holding a class on WorkerEntrypoint
					// from cloudflare:workers gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/window", "src/ui", "src/lib"],
						"Window",
						0,
						"same file",
						"window tsx",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b, "./window": "./src/server.ts" with a fetch handler gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						4,
						"same file",
						"window",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b, a manifest with no `name` and "./*": "./src/*.ts" with a fetch
					// handler in src/server.ts gave no finding: the pattern's targets were dropped.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						4,
						"same file",
						"pattern",
						"workerd",
						"no name",
					],
					// pinned: review 5 of P16b's sweep, `const Base = DurableObject; class X extends Base {}`
					// behind "./server" gave no finding.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/server", "src/ui", "src/lib"],
						"Server",
						22,
						"same file",
						"key",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b's sweep, '.' under "workerd" loading, through a symlink, a file
					// outside the package that imports cloudflare:workers gave no finding: oxlint never lints it.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/worker", "src/ui", "src/lib"],
						"Worker",
						7,
						"symlink",
						"condition",
						"workerd",
						"name",
					],
					// pinned: review 6 of P16b, `"imports": {"#cf": "cloudflare:workers"}` with '.' (under
					// "workerd") holding `import {WorkerEntrypoint} from "#cf"` and a class on it gave no
					// finding: worker() saw only "#cf", and the resolver's error for the real name was dropped.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/worker", "src/ui", "src/lib"],
						"Worker",
						0,
						"imports alias",
						"condition",
						"workerd",
						"name",
					],
					// pinned: review 5 of P16b's sweep, the same import reached by a link out of the package.
					[
						"program0",
						["./server", "./ui", "./lib"],
						["src/worker", "src/ui", "src/lib"],
						"Worker",
						7,
						"outside",
						"condition",
						"workerd",
						"name",
					],
				],
			}),
		);
	});
	// Node's sugar: an exports value that is a string, an array or an object of conditions is '.'.
	it("plants: '.' written as the whole exports value is '.', and a Worker entry there is refused", () => {
		fc.assert(
			fc.property(
				name,
				fc.nat({max: shapes.length - 1}),
				fc.constantFrom("string", "array", "conditions", "array conditions"),
				fc.constantFrom("workerd", "worker", "browser", "import", "node"),
				(name, shape, form, condition) => {
					const files = {
							"src/program.ts": "export const program = 1;",
							"src/worker.ts": shapes[shape]!.text("Worker"),
						},
						as = (path: string) =>
							form === "string"
								? path
								: form === "array"
									? [path]
									: form === "conditions"
										? {[condition]: path, default: "./src/program.ts"}
										: {[condition]: [path], default: ["./src/program.ts"]},
						messages = (exports: unknown) =>
							run(name, exports, files)
								.map((d) => d.message)
								.sort();
					expect(messages(as("./src/program.ts"))).toEqual([]);
					expect(messages(as("./src/worker.ts"))).toEqual(
						[
							...(shapes[shape]!.defines
								? ["A program package has no Worker entry. libfabrika builds its box; '.' is one."]
								: []),
							...shapes[shape]!.pure,
						].sort(),
					);
				},
			),
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

	for (const form of ["declaration", "specifier"] as const) {
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
	}

	for (const form of ["declaration", "specifier"] as const) {
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
	}

	for (const edge of [
		'import type {X} from "./helper.ts"; export type {X};',
		'import {type X} from "./helper.ts"; export type {X};',
		'export type {X} from "./helper.ts";',
		'export {type X} from "./helper.ts";',
		'export type * from "./helper.ts";',
	]) {
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
	}

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
