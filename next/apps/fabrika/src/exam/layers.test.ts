// p32 and p65, strict layers (docs/plan/tier-1-detail.md, "Strict layers"). `pnpm lint:layers`
// (code-graph, `layer-rules.json`) fails an upward import. This test catches what code-graph cannot
// yet: an import that skips a layer, and which package names each part may import. Its
// skipped-layer half goes when demlik issue 763 lands. Written by the exam (Tier 1, P1).
//
// A folder of the same package is named by its folder, another package by its import name, so the
// exports map carries the rule across. `next/apps/*` has no row: it is the wiring. A program's
// files that its `.` export reaches are what the box loads; the rest of the program is its window.
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
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve, sep} from "node:path";
import {Schema} from "effect";
import {afterAll, describe, expect, it} from "vitest";

const NEXT = resolve(import.meta.dirname, "../../../..");

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

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file);

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

const LIBRARY = "@kampus/libfabrika";
const TUVAL = "@kampus/tuval";
// P14, p65's one outside package (docs/direction/fabrika-design-package.md): the window imports the
// design package's public names, its root and its stylesheet, and nothing deeper.
const DESIGN = "@kampus/fabrika-design";

/** What each part may import beyond itself: the detail's table, as it stands. */
const allowed: Readonly<Record<string, ReadonlyArray<string>>> = {
	id: [],
	"id-test-support": ["id"],
	"libfabrika-entry": ["id", "transport", "data", "coordination", "app", "mcp", "door"],
	transport: ["id"],
	data: ["id"],
	coordination: ["data", "id"],
	app: ["coordination", "id"],
	node: ["app", "coordination", "data", "id"],
	workers: ["app", "coordination", "data", "transport", "id"],
	door: ["app", "coordination", "data", "transport", "id"], // P17a: the library's door composes all four
	mcp: ["app", "transport", "id"], // the named exception: the bridge is a client, as a window is
	desktop: [LIBRARY], // the app layer's names, nothing lower
	window: ["desktop", LIBRARY, `${LIBRARY}/transport`, DESIGN, `${DESIGN}/tokens.css`], // a window is a client (the note's T3); P14: and it takes the design's public names
	dom: ["desktop"],
	browser: ["dom", "desktop", `${LIBRARY}/transport`], // its key signs transport's helloText
	electron: ["dom", "desktop", `${LIBRARY}/transport`, `${LIBRARY}/coordination`], // the menu bar signs what the door takes
	headless: ["desktop"],
	program: [LIBRARY], // `.`, what the box loads: no tuval and no React
	"program-window": [LIBRARY, TUVAL], // `./window`: public names only
};

/** The folders under `src/` of the two library packages, each a part above. */
const FOLDERS: Readonly<Record<string, ReadonlyArray<string>>> = {
	[LIBRARY]: ["transport", "data", "coordination", "app", "mcp", "door", "node", "workers"],
	[TUVAL]: ["desktop", "window", "dom", "browser", "electron", "headless"],
};

/** The files a program's `.` export reaches by relative imports: what the box loads. */
const boxFor = (pkg: Package): ReadonlySet<string> => {
	const seen = new Set<string>();
	const walk = (file: string): void => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const spec of importsInFile(file).filter(isRelative)) {
			const next = pointsAt(file, spec);
			if (existsSync(next) && statSync(next).isFile()) walk(next);
		}
	};
	const entry = exportMap(pkg).get(".");
	if (entry !== undefined && existsSync(entry)) walk(entry);
	return seen;
};

/** The folder under `src/` a library file sits in, or null for an entry file at `src/` itself. */
const folderAt = (pkg: Package, file: string): string | null => {
	const src = join(pkg.dir, "src");
	if (!file.startsWith(`${src}${sep}`)) return null;
	const inside = file.slice(src.length + 1).split(sep);
	return inside.length === 1 ? null : (inside[0] ?? null);
};

/** The part a file of `pkg` belongs to, or null when the table has no row for it. */
const partAt = (pkg: Package, box: ReadonlySet<string>, file: string): string | null => {
	if (pkg.group === "programs") return box.has(file) ? "program" : "program-window";
	if (pkg.manifest.name === LIBRARY) {
		if (file === join(pkg.dir, "src/id.ts")) return "id";
		if (file === join(pkg.dir, "src/id.test-support.ts")) return "id-test-support";
		if (file === join(pkg.dir, "src/testing.ts")) return "app";
		if (file === join(pkg.dir, "src/index.ts")) return "libfabrika-entry";
	}
	const folder = folderAt(pkg, file);
	return folder !== null && FOLDERS[pkg.manifest.name]?.includes(folder) === true ? folder : null;
};

/** Every import in `next` that breaks the table, or that the library makes upward. */
const faults = (next: string): ReadonlyArray<string> => {
	const packages = packagesIn(next);
	const above = new Set(
		packages
			.filter((pkg) => pkg.group !== "packages" || pkg.manifest.name === TUVAL)
			.map((pkg) => pkg.manifest.name),
	);
	return codeFiles(next).flatMap((file) => {
		const pkg = ownerAt(packages, file);
		if (pkg === undefined) return [];
		const where = shown(next, file);
		const found: Array<string> = [];
		// Across the whole library, tests included: nothing imports tuval, a program or the app.
		if (pkg.manifest.name === LIBRARY) {
			for (const spec of importsInFile(file).filter((s) => !isRelative(s))) {
				if (above.has(packageAt(spec).name))
					found.push(`${where} imports "${spec}": the library imports nothing above it`);
			}
		}
		if (isTest(file)) return found;
		const folders = FOLDERS[pkg.manifest.name];
		const folder = folderAt(pkg, file);
		if (folders !== undefined && folder !== null && !folders.includes(folder)) {
			return [...found, `${where}: the folder "${folder}" has no row in the exam's table`];
		}
		const part = partAt(pkg, pkg.group === "programs" ? boxFor(pkg) : new Set(), file);
		if (part === null) return found; // the wiring, or an entry file at src/
		const may = allowed[part] ?? [];
		for (const spec of importsInFile(file)) {
			if (isRelative(spec)) {
				if (pkg.group === "programs") continue; // a program's own files, box and window alike
				const target = pointsAt(file, spec);
				if (!target.startsWith(`${pkg.dir}${sep}`)) continue; // leaving the package: deps.test.ts
				const there = partAt(pkg, new Set(), target) ?? "an entry file";
				if (there !== part && !may.includes(there)) {
					found.push(`${where} imports "${spec}": ${part} may not import ${there}`);
				}
			} else if (packageAt(spec).name.startsWith("@kampus/") && !may.includes(spec)) {
				found.push(`${where} imports "${spec}": ${part} may not import it`);
			}
		}
		return found;
	});
};

describe("the real next/", () => {
	it("keeps every part to the imports the table allows", () => {
		expect(faults(NEXT)).toEqual([]);
	});
});

describe("planted breaks", () => {
	it("P17a: the door composes lower parts; lower parts cannot import it", () => {
		const tree = plant({
			"packages/libfabrika/package.json": manifest(LIBRARY),
			"packages/libfabrika/src/door/door.ts": lines(
				'import {run} from "../app/runner.ts";',
				'import {member} from "../coordination/member.ts";',
				'import {log} from "../data/log.ts";',
				'import {wire} from "../transport/wire.ts";',
			),
			...Object.fromEntries(
				["app", "coordination", "data", "transport"].map((part) => [
					`packages/libfabrika/src/${part}/up.ts`,
					lines('import {Door} from "../door/door.ts";'),
				]),
			),
		});
		expect([...faults(tree)].sort()).toEqual(
			["app", "coordination", "data", "transport"]
				.map(
					(part) =>
						`packages/libfabrika/src/${part}/up.ts imports "../door/door.ts": ${part} may not import door`,
				)
				.sort(),
		);
	});
	const lib = (extra: object = {}) =>
		manifest(LIBRARY, {
			exports: {
				".": "./src/index.ts",
				"./transport": "./src/transport/index.ts",
				"./coordination": "./src/coordination/index.ts",
				"./data": "./src/data/index.ts",
			},
			...extra,
		});
	const tree = plant({
		"packages/libfabrika/package.json": lib(),
		"packages/libfabrika/src/index.ts": lines('export {run} from "./app/runner.ts";'),
		"packages/libfabrika/src/transport/wire.ts": lines('import {log} from "../data/log.ts";'),
		"packages/libfabrika/src/data/log.ts": lines('import {view} from "@kampus/tuval";'),
		"packages/libfabrika/src/data/log.test.ts": lines('import {counter} from "@kampus/counter";'),
		"packages/libfabrika/src/coordination/mailbox.ts": lines('import {log} from "../data/log.ts";'),
		"packages/libfabrika/src/app/runner.ts": lines(
			'import {mailbox} from "../coordination/mailbox.ts";',
			'import {log} from "../data/log.ts";',
		),
		"packages/libfabrika/src/mcp/tools.ts": lines(
			'import {run} from "../app/runner.ts";',
			'import type {Wire} from "../transport/wire.ts";',
		),
		"packages/libfabrika/src/sync/merge.ts": lines("export const merge = 1;"),
		"packages/tuval/package.json": manifest(TUVAL),
		"packages/tuval/src/index.ts": lines('export {fold} from "./desktop/fold.ts";'),
		"packages/tuval/src/desktop/layout.ts": lines('import {run} from "@kampus/libfabrika";'),
		"packages/tuval/src/desktop/fold.ts": lines('import {log} from "@kampus/libfabrika/data";'),
		"packages/tuval/src/window/main.ts": lines(
			'import {layout} from "../desktop/layout.ts";',
			'import {wire} from "@kampus/libfabrika/transport";',
		),
		"packages/tuval/src/dom/root.ts": lines('import {layout} from "../desktop/layout.ts";'),
		"packages/tuval/src/browser/key.ts": lines(
			'import {root} from "../dom/root.ts";',
			'import {wire} from "@kampus/libfabrika/transport";',
		),
		"packages/tuval/src/electron/menu.ts": lines(
			'import {grant} from "@kampus/libfabrika/coordination";',
		),
		"packages/tuval/src/headless/run.ts": lines('import {main} from "../window/main.ts";'),
		"programs/notes/package.json": manifest("@kampus/notes", {
			exports: {".": "./src/program.ts", "./window": "./src/view.tsx"},
		}),
		"programs/notes/src/program.ts": lines(
			'import {root} from "./root.ts";',
			'import {defineProgram} from "@kampus/libfabrika";',
		),
		"programs/notes/src/root.ts": lines('import {send} from "@kampus/tuval";'),
		"programs/notes/src/view.tsx": lines(
			'import {notes} from "./program.ts";',
			'import {useModel} from "@kampus/tuval";',
		),
		"programs/notes/src/tile.ts": lines('import {wire} from "@kampus/libfabrika/transport";'),
		"programs/counter/package.json": manifest("@kampus/counter"),
		"programs/counter/src/index.ts": lines('import {defineProgram} from "@kampus/libfabrika";'),
		"apps/fabrika/package.json": manifest("@kampus/fabrika"),
		"apps/fabrika/src/brain.ts": lines(
			'import {log} from "@kampus/libfabrika/data";',
			'import {fold} from "@kampus/tuval";',
		),
	});

	// Everything else in the tree is clean, the named exceptions included: mcp, the window, the
	// browser key and the electron menu reach transport; the menu reaches coordination; a program's
	// window imports its own program; the app imports anything.
	it("fires on each planted break, and on nothing else", () => {
		expect([...faults(tree)].sort()).toEqual(
			[
				'packages/libfabrika/src/transport/wire.ts imports "../data/log.ts": transport may not import data',
				'packages/libfabrika/src/data/log.ts imports "@kampus/tuval": the library imports nothing above it',
				'packages/libfabrika/src/data/log.ts imports "@kampus/tuval": data may not import it',
				'packages/libfabrika/src/data/log.test.ts imports "@kampus/counter": the library imports nothing above it',
				'packages/libfabrika/src/app/runner.ts imports "../data/log.ts": app may not import data',
				'packages/libfabrika/src/sync/merge.ts: the folder "sync" has no row in the exam\'s table',
				'packages/tuval/src/desktop/fold.ts imports "@kampus/libfabrika/data": desktop may not import it',
				'packages/tuval/src/headless/run.ts imports "../window/main.ts": headless may not import window',
				'programs/notes/src/root.ts imports "@kampus/tuval": program may not import it',
				'programs/notes/src/tile.ts imports "@kampus/libfabrika/transport": program-window may not import it',
			].sort(),
		);
	});
});

describe("P14: the window's design imports", () => {
	const tree = plant({
		"packages/tuval/package.json": manifest(TUVAL),
		"packages/tuval/src/window/main.tsx": lines(
			'import {color} from "@kampus/fabrika-design";',
			'import "@kampus/fabrika-design/tokens.css";',
			'import {Layout} from "../desktop/layout.ts";',
		),
		"packages/tuval/src/window/deep.tsx": lines(
			'import "@kampus/fabrika-design/src/tokens.css";',
			'import {theme} from "@kampus/fabrika-design/tokens";',
		),
		"packages/tuval/src/desktop/layout.ts": lines('import {color} from "@kampus/fabrika-design";'),
		"packages/tuval/src/desktop/other.ts": lines('import {pipe} from "@kampus/pipeline";'),
		"packages/tuval/src/browser/key.ts": lines('import {color} from "@kampus/fabrika-design";'),
		"packages/libfabrika/package.json": manifest(LIBRARY),
		"packages/libfabrika/src/transport/wire.ts": lines(
			'import {color} from "@kampus/fabrika-design";',
		),
	});

	it("takes the design's public names in the window and refuses a deep import and the other parts", () => {
		expect([...faults(tree)].sort()).toEqual(
			[
				'packages/tuval/src/window/deep.tsx imports "@kampus/fabrika-design/src/tokens.css": window may not import it',
				'packages/tuval/src/window/deep.tsx imports "@kampus/fabrika-design/tokens": window may not import it',
				'packages/tuval/src/desktop/layout.ts imports "@kampus/fabrika-design": desktop may not import it',
				'packages/tuval/src/desktop/other.ts imports "@kampus/pipeline": desktop may not import it',
				'packages/tuval/src/browser/key.ts imports "@kampus/fabrika-design": browser may not import it',
				'packages/libfabrika/src/transport/wire.ts imports "@kampus/fabrika-design": transport may not import it',
			].sort(),
		);
	});
});
