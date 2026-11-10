// p65, `next/` stands alone (docs/plan/tier-1-detail.md, "Packages" and p65). `package.json` alone
// stops neither a walk up to the root's `node_modules` nor a Node import at a top level, so this
// test reads the imports and bundles the top levels. With `layers.test.ts`. Item 9 of the detail's
// exam; written by the exam (Tier 1, P1).
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve, sep} from "node:path";
import {Schema} from "effect";
import {rolldown, type Plugin} from "rolldown";
import {afterAll, describe, expect, it} from "vitest";

const NEXT = resolve(import.meta.dirname, "../../../..");

// P14, p65's one exception (docs/direction/fabrika-design-package.md): today's app and next/ share
// one design package, and only that package may sit outside next/. The exception is its exact name
// and its exports map, read from where it lives. Any other outside workspace package, a deep
// import into the design package, and today's old packages still fault.
const DESIGN = "@kampus/fabrika-design";
const DESIGN_DIR = resolve(NEXT, "../packages/fabrika-design");

// The reader. Each exam file stands alone and carries its own copy, since a shared helper file
// would export names only tests call, which `pnpm lint:dead` refuses. An import is found by reading
// text: a line that starts with `import` or `export` and names a `from`, a line that is only
// `import` and a quoted name, or a dynamic import call with a quoted name. Planted code is written
// as one-line strings, so no line of an exam file starts with a planted `import`.

const GROUPS = ["packages", "programs", "apps"] as const; // pnpm-workspace.yaml's next/ globs

const Names = Schema.optional(Schema.Record(Schema.String, Schema.String));
const Manifest = Schema.Struct({
	name: Schema.String,
	version: Schema.optional(Schema.String),
	private: Schema.optional(Schema.Boolean),
	sideEffects: Schema.optional(Schema.Unknown),
	scripts: Names,
	exports: Schema.optional(Schema.Unknown),
	dependencies: Names,
	devDependencies: Names,
	peerDependencies: Names,
	optionalDependencies: Names,
});
type Package = {
	readonly dir: string;
	readonly group: (typeof GROUPS)[number];
	readonly manifest: typeof Manifest.Type;
};
const readManifest = Schema.decodeUnknownSync(Manifest);

/** Every package under `next`: a child folder of a group that holds a `package.json`. */
const packagesIn = (next: string): ReadonlyArray<Package> =>
	GROUPS.flatMap((group) => {
		const folder = join(next, group);
		if (!existsSync(folder)) return [];
		return readdirSync(folder, {withFileTypes: true})
			.filter(
				(entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")),
			)
			.map((entry) => ({
				dir: join(folder, entry.name),
				group,
				manifest: readManifest(
					JSON.parse(readFileSync(join(folder, entry.name, "package.json"), "utf8")),
				),
			}));
	});

/** Every `.ts` and `.tsx` file below `dir`, leaving out `node_modules`, `dist` and dot folders. */
const codeFiles = (dir: string): ReadonlyArray<string> =>
	!existsSync(dir)
		? []
		: readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
				const path = join(dir, entry.name);
				if (!entry.isDirectory()) return /\.tsx?$/.test(entry.name) ? [path] : [];
				const skip = ["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".");
				return skip ? [] : codeFiles(path);
			});

const IMPORTS = [
	/^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
	/^[ \t]*import\s*["']([^"']+)["']/gm,
	/\bimport\(\s*["']([^"']+)["']\s*\)/g,
];
const importsIn = (text: string): ReadonlyArray<string> =>
	IMPORTS.flatMap((pattern) =>
		[...text.matchAll(pattern)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])),
	);
const importsInFile = (file: string): ReadonlyArray<string> =>
	importsIn(readFileSync(file, "utf8"));
const isRelative = (spec: string): boolean => spec.startsWith(".");

/** `@kampus/libfabrika/transport` is `{name: "@kampus/libfabrika", subpath: "./transport"}`. */
const packageAt = (spec: string): {readonly name: string; readonly subpath: string} => {
	const parts = spec.split("/");
	const size = spec.startsWith("@") ? 2 : 1;
	const rest = parts.slice(size);
	return {
		name: parts.slice(0, size).join("/"),
		subpath: rest.length === 0 ? "." : `./${rest.join("/")}`,
	};
};

/** The file a relative import names, as Node and the bundlers find it, or where it points if none. */
const pointsAt = (from: string, spec: string): string => {
	const base = join(dirname(from), spec);
	const tries = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		base.replace(/\.js$/, ".ts"),
	];
	return tries.find((path) => existsSync(path) && statSync(path).isFile()) ?? base;
};

/** A package's `exports` map, each key with the file it points at. */
const exportMap = (pkg: Package): ReadonlyMap<string, string | undefined> => {
	const target = (value: unknown): string | undefined => {
		if (typeof value === "string") return join(pkg.dir, value);
		if (typeof value !== "object" || value === null) return undefined;
		const conditions = new Map(Object.entries(value));
		return target(conditions.get("import") ?? conditions.get("default"));
	};
	const exports = pkg.manifest.exports;
	if (typeof exports !== "object" || exports === null) {
		return exports === undefined ? new Map() : new Map([[".", target(exports)]]);
	}
	const entries = Object.entries(exports);
	if (!entries.every(([key]) => key.startsWith("."))) return new Map([[".", target(exports)]]);
	return new Map(entries.map(([key, value]) => [key, target(value)]));
};

const ownerAt = (packages: ReadonlyArray<Package>, file: string): Package | undefined =>
	packages.find((pkg) => file.startsWith(`${pkg.dir}${sep}`));

/** A path as the messages show it: relative to `from`, with `/`. */
const shown = (from: string, file: string): string => relative(from, file).split(sep).join("/");

// Planted trees: each scan is seen to fire on a planted break before it is trusted on `next/`.
const planted: Array<string> = [];
const plant = (files: Readonly<Record<string, string | object>>): string => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));
	planted.push(root);
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), {recursive: true});
		writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
	}
	return root;
};
afterAll(() => {
	for (const root of planted.splice(0)) rmSync(root, {recursive: true, force: true});
});
const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;
/** A `package.json` the way p65 wants one; `extra` overrides or adds fields. */
const manifest = (name: string, extra: object = {}): object => ({
	name,
	version: "0.0.0",
	private: true,
	sideEffects: false,
	scripts: {typecheck: "tsc --noEmit"},
	exports: {".": "./src/index.ts"},
	...extra,
});

/** `node:fs`, `fs`, `cloudflare:workers`: the platform's own, not a package anyone lists. */
const isPlatform = (spec: string): boolean =>
	spec.includes(":") || builtinModules.includes(spec.split("/")[0] ?? "");

/** Every name a manifest lists, in any of its four dependency fields. */
const listed = (m: Package["manifest"]): ReadonlyMap<string, string> =>
	new Map(
		[m.dependencies, m.devDependencies, m.peerDependencies, m.optionalDependencies].flatMap(
			(names) => Object.entries(names ?? {}),
		),
	);

/** Each package's `package.json`: private at 0.0.0, no side effects, a typecheck, nothing of today's. */
const manifestFaults = (next: string): ReadonlyArray<string> => {
	const packages = packagesIn(next);
	const ours = new Set(packages.map((pkg) => pkg.manifest.name));
	return packages.flatMap((pkg) => {
		const where = shown(next, `${pkg.dir}${sep}package.json`);
		const m = pkg.manifest;
		return [
			...(m.private === true ? [] : [`${where}: not private`]),
			...(m.version === "0.0.0" ? [] : [`${where}: version is not 0.0.0`]),
			...(m.sideEffects === false ? [] : [`${where}: sideEffects is not false`]),
			...(m.scripts?.["typecheck"] === undefined ? [`${where}: no typecheck script`] : []),
			...[...listed(m)].flatMap(([name, range]) => [
				...(name.endsWith("-old") ? [`${where}: depends on ${name}, today's version`] : []),
				...(range.startsWith("workspace:") && !ours.has(name) && name !== DESIGN
					? [`${where}: depends on ${name}, a workspace package outside next/`]
					: []),
			]),
		];
	});
};

/** Files the exam owns that may sit outside a package until `next/apps/fabrika` has one. */
const EXAM = /^apps\/fabrika\/(?:e2e\.ts$|e2e\/|src\/exam\/)/;

/** Every import that walks out: unlisted, outside an exports map, out of its package, or no package at all. */
const importFaults = (
	next: string,
	design: Package | undefined = designAt(DESIGN_DIR),
): ReadonlyArray<string> => {
	const packages = packagesIn(next);
	const byName = new Map(
		[...packages, ...(design === undefined ? [] : [design])].map((pkg) => [pkg.manifest.name, pkg]),
	);
	return codeFiles(next).flatMap((file) => {
		const where = shown(next, file);
		const pkg = ownerAt(packages, file);
		if (pkg === undefined) return EXAM.test(where) ? [] : [`${where}: sits in no package`];
		const names = listed(pkg.manifest);
		return importsInFile(file).flatMap((spec) => {
			const found: Array<string> = [];
			if (isRelative(spec)) {
				if (!pointsAt(file, spec).startsWith(`${pkg.dir}${sep}`)) {
					found.push(`${where} imports "${spec}": a relative path out of its package`);
				}
				return found;
			}
			if (isPlatform(spec)) return found;
			const {name, subpath} = packageAt(spec);
			if (name !== pkg.manifest.name && !names.has(name)) {
				found.push(`${where} imports "${spec}": ${name} is not in its package.json`);
			}
			const target = byName.get(name);
			if (target !== undefined && !exportMap(target).has(subpath)) {
				found.push(`${where} imports "${spec}": ${subpath} is not in ${name}'s exports`);
			}
			const inApp = pkg.group === "apps" && shown(pkg.dir, file) !== "src/entry/electron-main.ts";
			if (name === "electron" && inApp) {
				found.push(`${where} imports "${spec}": in an app, only src/entry/electron-main.ts may`);
			}
			return found;
		});
	});
};

/** The design package, read from `dir`, the one package outside next/ that a part may list. */
const designAt = (dir: string): Package | undefined =>
	existsSync(join(dir, "package.json"))
		? {
				dir,
				group: "packages",
				manifest: readManifest(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))),
			}
		: undefined;

/** What a top level bundled for a browser must not reach. */
const FORBIDDEN: ReadonlyArray<{readonly name: string; readonly test: (spec: string) => boolean}> =
	[
		{
			name: "node:*",
			test: (spec) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0] ?? ""),
		},
		{name: "electron", test: (spec) => spec === "electron" || spec.startsWith("electron/")},
		{name: "cloudflare:*", test: (spec) => spec.startsWith("cloudflare:")},
		{name: "@modelcontextprotocol/*", test: (spec) => spec.startsWith("@modelcontextprotocol/")},
	];

/** The detail's list, the top level of the library, of tuval and of notes, plus the library's
 *  `/transport`, which a browser tab runs (Tier 1, P7), its `/data`, which names no platform
 *  and which a tab holds a read copy of later (Tier 1, P6), and its `/coordination`, whose names
 *  the menu bar and the door share (Tier 1, P9). Every program's `/window` comes on top. */
const BROWSER: Readonly<Record<string, ReadonlyArray<string>>> = {
	"@kampus/libfabrika": [".", "./transport", "./data", "./coordination", "./door"],
	"@kampus/tuval": [".", "./page", "./browser"],
	"@kampus/notes": ["."],
};
const browserEntries = (
	packages: ReadonlyArray<Package>,
): ReadonlyArray<{readonly label: string; readonly file: string}> =>
	packages.flatMap((pkg) => {
		const name = pkg.manifest.name;
		const keys = [...(BROWSER[name] ?? []), ...(pkg.group === "programs" ? ["./window"] : [])];
		return keys.flatMap((key) => {
			const file = exportMap(pkg).get(key);
			return file === undefined
				? []
				: [{label: key === "." ? name : `${name}${key.slice(1)}`, file}];
		});
	});

/** Bundles `file` for a browser with no Node shims and lists each forbidden module it reaches. */
const reach = async (next: string, label: string, file: string): Promise<ReadonlyArray<string>> => {
	const hits: Array<string> = [];
	const watch: Plugin = {
		name: "forbidden",
		resolveId(source, importer) {
			const rule = FORBIDDEN.find((f) => f.test(source));
			if (rule === undefined) return undefined;
			hits.push(`${label} reaches ${rule.name}: "${source}" from ${shown(next, importer ?? file)}`);
			return {id: source, external: true};
		},
	};
	let bundle: Awaited<ReturnType<typeof rolldown>> | undefined;
	try {
		bundle = await rolldown({
			input: file,
			platform: "browser",
			logLevel: "silent",
			plugins: [watch],
		});
		await bundle.generate({format: "esm"});
		return hits;
	} catch (error) {
		return [...hits, `${label} does not bundle: ${String(error)}`];
	} finally {
		await bundle?.close();
	}
};

const bundleFaults = async (next: string): Promise<ReadonlyArray<string>> => {
	const all = await Promise.all(
		browserEntries(packagesIn(next)).map(({label, file}) => reach(next, label, file)),
	);
	return all.flat();
};

describe("the real next/", () => {
	it("P17a: the public door exists and bundles for a browser", async () => {
		const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
		expect(library).toBeDefined();
		const entry = exportMap(library!).get("./door");
		expect(entry, "P17a exports the library door").toBeDefined();
		expect(await reach(NEXT, "@kampus/libfabrika/door", entry!)).toEqual([]);
	});
	it("P11: libfabrika exports its required browser entry instead of silently skipping it", async () => {
		const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
		expect(library).toBeDefined();
		const entry = exportMap(library!).get(".");
		expect(entry, "P11 adds libfabrika's browser-safe app entry").toBeDefined();
		expect(await reach(NEXT, "@kampus/libfabrika", entry!)).toEqual([]);
	});
	it("has packages that are private at 0.0.0, with no side effects, a typecheck, and nothing of today's", () => {
		expect(manifestFaults(NEXT)).toEqual([]);
	});

	it("imports only what each package lists, through exports maps, inside its own package", () => {
		expect(importFaults(NEXT)).toEqual([]);
	});

	it("bundles each top level for a browser without node, electron, cloudflare or MCP", async () => {
		expect(await bundleFaults(NEXT)).toEqual([]);
	});
});

describe("reading imports", () => {
	it("finds static, type, re-export, bare, multi-line and dynamic imports, and skips comments", () => {
		const dynamic = `const m = ${"import"}("@pierre/highlights");`; // built from two strings, so no scan reads it as this file's own import
		const text = lines(
			'import {Effect} from "effect";',
			'import type {Wire} from "./wire.ts";',
			'export {fold} from "./fold.ts";',
			'import "./style.css";',
			"import {",
			"\ta,",
			"\tb,",
			'} from "@kampus/libfabrika";',
			dynamic,
			'// import {x} from "not-this";',
			' * import {y} from "nor-this";',
		);
		expect([...importsIn(text)].sort()).toEqual(
			[
				"effect",
				"./wire.ts",
				"./fold.ts",
				"./style.css",
				"@kampus/libfabrika",
				"@pierre/highlights",
			].sort(),
		);
	});
});

describe("planted breaks", () => {
	it("P17a: the door browser check catches a Node import", async () => {
		const tree = plant({
			"packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
				exports: {"./door": "./src/door/index.ts"},
			}),
			"packages/libfabrika/src/door/index.ts": lines('export {readFileSync} from "node:fs";'),
		});
		expect(
			(await bundleFaults(tree)).some(
				(fault) => fault.includes("@kampus/libfabrika/door") && fault.includes("node:fs"),
			),
		).toBe(true);
	});
	const library = manifest("@kampus/libfabrika", {
		exports: {".": "./src/index.ts", "./transport": "./src/transport/index.ts"},
		dependencies: {effect: "catalog:"},
	});
	const tree = plant({
		"packages/libfabrika/package.json": library,
		"packages/libfabrika/src/index.ts": lines(
			'import {Effect} from "effect";',
			'import {readFileSync} from "node:fs";',
		),
		"packages/libfabrika/src/transport/index.ts": lines('export {wire} from "./wire.ts";'),
		"packages/tuval/package.json": manifest("@kampus/tuval", {
			dependencies: {"@kampus/libfabrika": "workspace:*", "@kampus/fabrika-old": "workspace:*"},
		}),
		"packages/tuval/src/index.ts": lines(
			'import {wire} from "@kampus/libfabrika/transport";',
			'import {log} from "@kampus/libfabrika/src/data/log.ts";',
			'import {lane} from "@kampus/pipeline";',
		),
		"programs/counter/package.json": {
			name: "@kampus/counter",
			version: "1.0.0",
			exports: {".": "./src/index.ts"},
		},
		"programs/counter/src/index.ts": lines(
			'import {run} from "../../../packages/libfabrika/src/index.ts";',
		),
		"apps/fabrika/package.json": manifest("@kampus/fabrika", {
			dependencies: {electron: "catalog:"},
		}),
		"apps/fabrika/src/entry/electron-main.ts": lines('import {app} from "electron";'),
		"apps/fabrika/src/brain.ts": lines('import {app} from "electron";'),
		"src/stray.ts": lines("export const stray = 1;"),
	});

	it("fires on each manifest break", () => {
		expect([...manifestFaults(tree)].sort()).toEqual(
			[
				"packages/tuval/package.json: depends on @kampus/fabrika-old, today's version",
				"packages/tuval/package.json: depends on @kampus/fabrika-old, a workspace package outside next/",
				"programs/counter/package.json: not private",
				"programs/counter/package.json: version is not 0.0.0",
				"programs/counter/package.json: sideEffects is not false",
				"programs/counter/package.json: no typecheck script",
			].sort(),
		);
	});

	it("fires on each import break, and on nothing else", () => {
		expect([...importFaults(tree)].sort()).toEqual(
			[
				'packages/tuval/src/index.ts imports "@kampus/libfabrika/src/data/log.ts": ./src/data/log.ts is not in @kampus/libfabrika\'s exports',
				'packages/tuval/src/index.ts imports "@kampus/pipeline": @kampus/pipeline is not in its package.json',
				'programs/counter/src/index.ts imports "../../../packages/libfabrika/src/index.ts": a relative path out of its package',
				'apps/fabrika/src/brain.ts imports "electron": in an app, only src/entry/electron-main.ts may',
				"src/stray.ts: sits in no package",
			].sort(),
		);
	});

	it("lets the exam's own files sit outside a package until the app has one", () => {
		const early = plant({
			"apps/fabrika/e2e.ts": lines('import {Effect} from "effect";'),
			"apps/fabrika/e2e/door.test.ts": lines('import {it} from "vitest";'),
			"apps/fabrika/src/exam/deps.test.ts": lines('import {it} from "vitest";'),
			"apps/fabrika/src/brain.ts": lines('import {Effect} from "effect";'),
		});
		expect(importFaults(early)).toEqual(["apps/fabrika/src/brain.ts: sits in no package"]);
	});

	it("fires on a top level that reaches node, cloudflare, MCP or electron", async () => {
		const bundles = plant({
			"packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
				exports: {".": "./src/index.ts", "./transport": "./src/transport/index.ts"},
			}),
			"packages/libfabrika/src/index.ts": lines(
				'import {readFileSync} from "node:fs";',
				"export const read = readFileSync;",
			),
			"packages/libfabrika/src/transport/index.ts": lines(
				'import {createHash} from "node:crypto";',
				"export const hash = createHash;",
			),
			"packages/tuval/package.json": manifest("@kampus/tuval"),
			"packages/tuval/src/index.ts": lines("export const clean = 1;"),
			"programs/notes/package.json": manifest("@kampus/notes", {
				exports: {".": "./src/program.ts", "./window": "./src/view.ts"},
			}),
			"programs/notes/src/program.ts": lines(
				'import {serve} from "@modelcontextprotocol/server";',
				"export const s = serve;",
			),
			"programs/notes/src/view.ts": lines('export {DurableObject} from "cloudflare:workers";'),
			"programs/chaos/package.json": manifest("@kampus/chaos", {
				exports: {".": "./src/index.ts", "./window": "./src/window.ts"},
			}),
			"programs/chaos/src/index.ts": lines(
				'import {app} from "electron";',
				"export const a = app;",
			),
			"programs/chaos/src/window.ts": lines('export {a} from "./index.ts";'),
		});
		expect([...(await bundleFaults(bundles))].sort()).toEqual(
			[
				'@kampus/libfabrika reaches node:*: "node:fs" from packages/libfabrika/src/index.ts',
				'@kampus/libfabrika/transport reaches node:*: "node:crypto" from packages/libfabrika/src/transport/index.ts',
				'@kampus/notes reaches @modelcontextprotocol/*: "@modelcontextprotocol/server" from programs/notes/src/program.ts',
				'@kampus/notes/window reaches cloudflare:*: "cloudflare:workers" from programs/notes/src/view.ts',
				'@kampus/chaos/window reaches electron: "electron" from programs/chaos/src/index.ts',
			].sort(),
		);
	});
});

describe("P14: the design package is the one allowed outside package", () => {
	const designFiles = {
		"design/package.json": manifest(DESIGN, {
			exports: {
				".": "./src/index.ts",
				"./tokens.css": "./src/tokens.css",
				"./package.json": "./package.json",
			},
		}),
	};
	const tree = plant({
		...designFiles,
		"packages/tuval/package.json": manifest("@kampus/tuval", {
			dependencies: {[DESIGN]: "workspace:*"},
		}),
		"packages/tuval/src/index.ts": lines(
			'import {color} from "@kampus/fabrika-design";',
			'import "@kampus/fabrika-design/tokens.css";',
		),
		"packages/tuval/src/deep.ts": lines(
			'import "@kampus/fabrika-design/src/tokens.css";',
			'import {color} from "../../../design/src/index.ts";',
		),
		"programs/counter/package.json": manifest("@kampus/counter"),
		"programs/counter/src/index.ts": lines('import {color} from "@kampus/fabrika-design";'),
		"programs/notes/package.json": manifest("@kampus/notes", {
			dependencies: {"@kampus/pipeline": "workspace:*", [DESIGN]: "workspace:*"},
		}),
		"programs/notes/src/index.ts": lines("export const notes = 1;"),
	});
	const design = designAt(join(tree, "design"));

	it("lets a manifest list the design package and no other outside workspace package", () => {
		expect(manifestFaults(tree)).toEqual([
			"programs/notes/package.json: depends on @kampus/pipeline, a workspace package outside next/",
		]);
	});

	it("finds the real design package where it lives", () => {
		expect(designAt(DESIGN_DIR)?.manifest.name).toBe(DESIGN);
	});

	it("lets a listed public import through, and refuses a deep, relative or unlisted one", () => {
		expect([...importFaults(tree, design)].sort()).toEqual(
			[
				'packages/tuval/src/deep.ts imports "@kampus/fabrika-design/src/tokens.css": ./src/tokens.css is not in @kampus/fabrika-design\'s exports',
				'packages/tuval/src/deep.ts imports "../../../design/src/index.ts": a relative path out of its package',
				'programs/counter/src/index.ts imports "@kampus/fabrika-design": @kampus/fabrika-design is not in its package.json',
			].sort(),
		);
	});

	it("does not take a made-up outside package for the design package", () => {
		const other = plant({
			"packages/tuval/package.json": manifest("@kampus/tuval", {
				dependencies: {"@kampus/fabrika-design-copy": "workspace:*"},
			}),
			"packages/tuval/src/index.ts": lines('import {x} from "@kampus/fabrika-design-copy";'),
		});
		expect(manifestFaults(other)).toEqual([
			"packages/tuval/package.json: depends on @kampus/fabrika-design-copy, a workspace package outside next/",
		]);
	});
});
