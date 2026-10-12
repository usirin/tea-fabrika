import {execFile} from "node:child_process";
import {mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, posix, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {loadInProcessGraph} from "@demlik/code-graph/resolve";
import {Effect, Layer} from "effect";
import {z} from "zod";
import {
	CODE,
	codeBlocksOf,
	type Definition,
	declares,
	type FactsPack,
	isTest,
	type Mentions,
	type NameFact,
	namesCalledIn,
	type PageFact,
	type PathFact,
	pagesOf,
	pathInPackage,
	signatureAt,
	twinsOf,
} from "./facts.ts";
import {Facts} from "./services.ts";

// The Facts service on a repo on this machine. Plain code throughout:
//   git          the files at HEAD, every line a name is on, a file's text
//   code-graph   who calls a function (its call graph, run once per package),
//                and which of a package's export subpaths publish a name (its
//                resolver, which follows re-exports the way the compiler does)
//   by hand      where a name is declared, and its signature: code-graph's
//                graph holds functions only, by id, with no declaration text;
//                and a doc page's twins and the names its code blocks call

export interface LocalFactsOptions {
	/** Definitions kept per name; the rest are counted. */
	readonly definitions?: number;
	/** Callers kept per definition; the rest are counted. */
	readonly callers?: number;
	/** Files at HEAD offered for a path that is not there. */
	readonly near?: number;
	/** Doc pages read for twins and calls; the rest are left out. */
	readonly pages?: number;
	/** Twins kept per page; the rest are counted. */
	readonly twins?: number;
	/** Names kept from pages' code blocks, in all, past the ones the report names; one definition each. */
	readonly pageNames?: number;
	/** Ask code-graph for callers and publication. Off, those facts are left `null`. */
	readonly codeGraph?: boolean;
}

interface Ran {
	readonly code: number;
	readonly output: string;
}

const run = (cwd: string, file: string, args: readonly string[]) =>
	new Promise<Ran>((resolve, reject) => {
		execFile(
			file,
			args,
			{cwd, maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60 * 1000},
			(error, stdout, stderr) => {
				if (error !== null && typeof error.code !== "number") reject(error);
				else
					resolve({
						code: error === null ? 0 : (error.code as number),
						output: stdout + (error === null ? "" : stderr),
					});
			},
		);
	});

async function git(dir: string, ...args: string[]): Promise<string> {
	const ran = await run(dir, "git", args);
	if (ran.code !== 0) throw new Error(ran.output);
	return ran.output;
}

/** A line that declares the name, as git found it. */
interface Declared {
	readonly file: string;
	readonly line: number;
	readonly exported: boolean;
}

/** Every line at HEAD that holds `name` as a word: which files hold it, and which lines declare it. */
async function findName(
	dir: string,
	name: string,
): Promise<{readonly files: number; readonly declared: readonly Declared[]}> {
	const ran = await run(dir, "git", ["grep", "-n", "-w", "-I", "-F", "-z", "-e", name, "HEAD"]);
	// Exit 1 is "no line holds it".
	if (ran.code === 1) return {files: 0, declared: []};
	if (ran.code !== 0) throw new Error(ran.output);
	const files = new Set<string>();
	const declared: Declared[] = [];
	for (const row of ran.output.split("\n")) {
		const [where, line, text] = row.split("\0");
		if (where === undefined || line === undefined || text === undefined) continue;
		const file = where.replace(/^HEAD:/, "");
		files.add(file);
		const declaration = CODE.test(file) ? declares(text, name) : null;
		if (declaration !== null)
			declared.push({file, line: Number(line), exported: declaration.exported});
	}
	return {files: files.size, declared};
}

/** Every line at HEAD that holds one of `texts`, as it is written, with its file. */
async function linesHolding(
	dir: string,
	texts: readonly string[],
): Promise<readonly {file: string; text: string}[]> {
	const ran = await run(dir, "git", [
		"grep",
		"-n",
		"-I",
		"-F",
		"-z",
		...texts.flatMap((t) => ["-e", t]),
		"HEAD",
	]);
	if (ran.code === 1) return [];
	if (ran.code !== 0) throw new Error(ran.output);
	return ran.output.split("\n").flatMap((row) => {
		const [where, , text] = row.split("\0");
		return where === undefined || text === undefined
			? []
			: [{file: where.replace(/^HEAD:/, ""), text}];
	});
}

/** Above this many local declarations and no exported one, a name is a common local, and none is listed. */
const COMMON_LOCAL = 3;

/** The items that pass `test`, if any do; otherwise all of them. */
const narrow = <T>(items: readonly T[], test: (item: T) => boolean): readonly T[] =>
	items.some(test) ? items.filter(test) : items;

/**
 * The declarations worth showing, and how many are left out. Exported ones
 * win: an unexported helper of the same name is not what a report means when
 * an exported one exists. Then those outside tests and fixtures win, then
 * those in the packages the report's own paths are in. With nothing exported,
 * a few local declarations outside tests are shown, unless there are many: a
 * name declared locally all over, such as `ctx`, is a common variable name.
 */
function best(
	declared: readonly Declared[],
	inScope: (file: string) => boolean,
	keep: number,
): {readonly kept: readonly Declared[]; readonly more: number} {
	const exported = declared.filter((d) => d.exported);
	const locals = declared.filter((d) => !isTest(d.file));
	if (exported.length === 0 && locals.length > COMMON_LOCAL)
		return {kept: [], more: declared.length};
	const pool = narrow(
		narrow(exported.length > 0 ? exported : locals, (d) => !isTest(d.file)),
		(d) => inScope(d.file),
	);
	const kept = [...pool]
		.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
		.slice(0, exported.length > 0 ? keep : Math.min(keep, 2));
	return {kept, more: declared.length - kept.length};
}

/** A package of the repo: its folder (`""` for the root), its name, its exports, and its tiers by subpath. */
interface Package {
	readonly dir: string;
	readonly name: string | null;
	readonly manifest: Record<string, unknown>;
	readonly tiers: ReadonlyMap<string, string>;
}

/**
 * A tier table such as demlik's `MAINTAINING.md` keeps: a Markdown row whose
 * first cell is a backticked export subpath and whose second is its tier.
 * Optional: a package without one has no tiers.
 */
export function tiersOf(text: string): ReadonlyMap<string, string> {
	const tiers = new Map<string, string>();
	for (const line of text.split("\n")) {
		const match = /^\|\s*`(\.[^`]*)`\s*\|\s*([\w-]+)[^|]*\|/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined && !tiers.has(match[1]))
			tiers.set(match[1], match[2]);
	}
	return tiers;
}

/** Every string a conditional export target holds: `{ types, import }` and nested conditions alike. */
const targets = (value: unknown): string[] =>
	typeof value === "string"
		? [value]
		: typeof value === "object" && value !== null
			? Object.values(value).flatMap(targets)
			: [];

/**
 * The source file an export target is built from, if the repo holds it: the
 * target itself when it is source, or its `dist/` (or `build/`, `lib/`) path
 * moved to `src/` with a source extension. A best guess, checked against HEAD.
 */
function sourceOf(pkgDir: string, target: string, tracked: ReadonlySet<string>): string | null {
	const bare = target.replace(/^\.\//, "");
	const stems = new Set<string>([
		bare
			.replace(/\.d\.[cm]?ts$/, "")
			.replace(/\.[cm]?jsx?$/, "")
			.replace(/\.[cm]?tsx?$/, ""),
	]);
	for (const stem of [...stems]) stems.add(stem.replace(/^(?:dist|build|lib|out)\//, "src/"));
	for (const stem of stems) {
		for (const extension of [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]) {
			const file = posix.join(pkgDir, `${stem}${extension}`);
			if (tracked.has(file)) return file;
		}
	}
	return null;
}

/** A package's published entries: each export subpath and the source file behind it. Patterns and non-code files are left out. */
function entriesOf(
	pkg: Package,
	tracked: ReadonlySet<string>,
): readonly {subpath: string; source: string}[] {
	const exports = pkg.manifest.exports;
	const map: Record<string, unknown> =
		exports === undefined
			? {
					".": [pkg.manifest.module, pkg.manifest.main, pkg.manifest.types].filter(
						(t) => typeof t === "string",
					),
				}
			: typeof exports === "string" ||
					Array.isArray(exports) ||
					!Object.keys(exports as object).some((k) => k.startsWith("."))
				? {".": exports}
				: (exports as Record<string, unknown>);
	return Object.entries(map).flatMap(([subpath, value]) => {
		if (subpath.includes("*")) return [];
		const source = targets(value)
			.map((t) => sourceOf(pkg.dir, t, tracked))
			.find((s) => s !== null);
		return source === undefined || source === null ? [] : [{subpath, source}];
	});
}

/** What code-graph's `--graph --edges --json` holds that is read here. */
const Graph = z.object({
	functions: z.array(
		z.object({
			file: z.string(),
			name: z.string(),
			startLine: z.number(),
			edges: z
				.object({calledBy: z.array(z.object({callerId: z.string(), line: z.number()}))})
				.optional(),
		}),
	),
});
type Graph = z.infer<typeof Graph>;

/** code-graph's CLI, as this package installs it. */
const CODE_GRAPH = fileURLToPath(import.meta.resolve("@demlik/code-graph/dist/index.js"));

/**
 * code-graph's call graph of one package, run from its folder so its tsconfig
 * is the one used. `null` when it cannot be built there, such as a package
 * with no tsconfig. It reads the folder as it is, not HEAD: triage runs on a
 * clean checkout, where the two are the same.
 */
async function callGraph(root: string, pkgDir: string): Promise<Graph | null> {
	const scratch = await mkdtemp(join(tmpdir(), "tea-fabrika-graph-"));
	try {
		const out = join(scratch, "graph.json");
		const ran = await run(join(root, pkgDir), process.execPath, [
			CODE_GRAPH,
			".",
			"--graph",
			"--edges",
			"--json",
			"--out",
			out,
		]);
		if (ran.code !== 0) return null;
		const parsed = Graph.safeParse(JSON.parse(await readFile(out, "utf8")));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	} finally {
		await rm(scratch, {recursive: true, force: true});
	}
}

/** The callers of the function declared at `file:line`, as `file:line` of each call; `null` when the graph has no such function. */
function callersIn(
	graph: Graph,
	pkgDir: string,
	d: Declared,
	name: string,
	keep: number,
): Definition["callers"] {
	const inFile = graph.functions.filter((f) => posix.join(pkgDir, f.file) === d.file);
	const fn =
		inFile.find((f) => f.startLine === d.line) ??
		inFile.find((f) => f.name === name && Math.abs(f.startLine - d.line) <= 2);
	if (fn === undefined) return null;
	const calls = [
		...new Set(
			(fn.edges?.calledBy ?? []).map(
				(c) => `${posix.join(pkgDir, c.callerId.slice(0, c.callerId.lastIndexOf(":")))}:${c.line}`,
			),
		),
	].sort(
		(a, b) =>
			Number(isTest(a)) - Number(isTest(b)) || a.localeCompare(b, undefined, {numeric: true}),
	);
	return {total: calls.length, sample: calls.slice(0, keep)};
}

/**
 * Which of a package's export subpaths publish each name, by code-graph's
 * resolver: a probe file outside the repo imports one entry, and the resolver
 * says where the entry's export of that name is declared. A subpath publishes
 * a definition when that is the definition's own file. `null` per name when
 * the package cannot be resolved (no tsconfig, say).
 */
async function publication(
	root: string,
	pkg: Package,
	tracked: ReadonlySet<string>,
	asked: readonly {readonly name: string; readonly file: string}[],
): Promise<ReadonlyMap<string, Definition["published"]>> {
	const entries = entriesOf(pkg, tracked);
	const graph = loadInProcessGraph(join(root, pkg.dir || "."));
	if (graph === null) return new Map();
	const scratch = await mkdtemp(join(tmpdir(), "tea-fabrika-probe-"));
	try {
		const probes = await Promise.all(
			entries.map(async (entry, i) => {
				const source = join(root, entry.source);
				const probe = join(scratch, `entry-${i}.ts`);
				await writeFile(
					probe,
					`import * as entry from ${JSON.stringify(source)};\nexport { entry };\n`,
				);
				return {...entry, source, probe};
			}),
		);
		const found = new Map<string, Definition["published"]>();
		for (const {name, file} of asked) {
			const published = probes.flatMap((p) => {
				const origin = graph.resolveExportOrigin(p.probe, p.source, name);
				return origin !== null && relative(root, origin.file) === file
					? [{subpath: p.subpath, tier: pkg.tiers.get(p.subpath) ?? null}]
					: [];
			});
			found.set(`${name}\n${file}`, published);
		}
		return found;
	} catch {
		return new Map();
	} finally {
		graph.dispose();
		await rm(scratch, {recursive: true, force: true});
	}
}

/** One mentioned path: whether HEAD holds it, as a file or a folder, and what it may have meant if not. */
function pathFact(
	path: string,
	files: readonly string[],
	tracked: ReadonlySet<string>,
	near: number,
): PathFact {
	const bare = path.replace(/^\.\//, "").replace(/\/$/, "");
	const exists = tracked.has(bare) || files.some((f) => f.startsWith(`${bare}/`));
	if (exists) return {path, exists, near: []};
	const deeper = files.filter((f) => f.endsWith(`/${bare}`));
	const base = posix.basename(bare);
	const named = deeper.length > 0 ? deeper : files.filter((f) => posix.basename(f) === base);
	return {path, exists, near: named.slice(0, near)};
}

async function gather(
	dir: string,
	mentions: Mentions,
	options: LocalFactsOptions,
): Promise<FactsPack> {
	const keep = {
		definitions: options.definitions ?? 3,
		callers: options.callers ?? 6,
		near: options.near ?? 3,
		pages: options.pages ?? 3,
		twins: options.twins ?? 3,
		pageNames: options.pageNames ?? 6,
	};
	const root = await realpath(dir);
	const files = (await git(root, "ls-tree", "-r", "-z", "--name-only", "HEAD"))
		.split("\0")
		.filter((f) => f !== "");
	const tracked = new Set(files);
	const texts = new Map<string, Promise<string>>();
	const show = (file: string) => {
		const known = texts.get(file) ?? git(root, "show", `HEAD:${file}`);
		texts.set(file, known);
		return known;
	};

	const packages = new Map<string, Promise<Package | null>>();
	const packageAt = (pkgDir: string): Promise<Package | null> => {
		const known =
			packages.get(pkgDir) ??
			(async () => {
				const manifest = JSON.parse(await show(posix.join(pkgDir, "package.json"))) as Record<
					string,
					unknown
				>;
				const tierFile = posix.join(pkgDir, "MAINTAINING.md");
				const tiers = tracked.has(tierFile)
					? tiersOf(await show(tierFile))
					: new Map<string, string>();
				return {
					dir: pkgDir,
					name: typeof manifest.name === "string" ? manifest.name : null,
					manifest,
					tiers,
				};
			})().catch(() => null);
		packages.set(pkgDir, known);
		return known;
	};
	/** The folder of the package a file is in, or `null` when no package.json above it is at HEAD. */
	const packageDirOf = (file: string): string | null => {
		for (let d = posix.dirname(file); ; d = posix.dirname(d)) {
			const at = d === "." ? "" : d;
			if (tracked.has(posix.join(at, "package.json"))) return at;
			if (d === "." || d === "/") return null;
		}
	};
	const packageOf = (file: string): Promise<Package | null> => {
		const at = packageDirOf(file);
		return at === null ? Promise.resolve(null) : packageAt(at);
	};

	const paths = mentions.paths.map((p) => pathFact(p, files, tracked, keep.near));
	// The packages the report's own paths are in: a name declared there is likely the one it means.
	const scope = new Set(
		paths.flatMap((p) => {
			const file = p.exists ? p.path.replace(/^\.\//, "") : p.near[0];
			const at = file === undefined ? null : packageDirOf(file);
			return at === null ? [] : [at];
		}),
	);
	const inScope = (file: string) => scope.has(packageDirOf(file) ?? "\0");

	// The doc pages the paths are: the tests that name each, and what its code blocks call.
	const read = await Promise.all(
		pagesOf(paths)
			.slice(0, keep.pages)
			.map(async (page) => {
				const pkgDir = packageDirOf(page);
				// The path inside its package is part of the path from the root, so one search finds both.
				const twins = twinsOf(
					page,
					pkgDir,
					await linesHolding(root, [pathInPackage(page, pkgDir)]),
				);
				const fact: PageFact = {
					page,
					twins: twins.slice(0, keep.twins),
					more: Math.max(0, twins.length - keep.twins),
				};
				return {fact, calls: namesCalledIn(codeBlocksOf(await show(page)).join("\n"))};
			}),
	);
	const fromPages: {readonly name: string; readonly calledIn: string}[] = [];
	for (const {fact, calls} of read) {
		for (const name of calls) {
			if (!mentions.names.includes(name) && !fromPages.some((p) => p.name === name))
				fromPages.push({name, calledIn: fact.page});
		}
	}

	// A name a page calls gets one definition: it is context, and an overloaded one would fill the pack.
	const lookUp = async (name: string, calledIn: string | null) => {
		const {files: mentionedIn, declared} = await findName(root, name);
		return {
			name,
			calledIn,
			mentionedIn,
			...best(declared, inScope, calledIn === null ? keep.definitions : 1),
		};
	};
	const named = await Promise.all(mentions.names.map((name) => lookUp(name, null)));
	// A page's name is kept only when the repo exports it: a page's `expect` is vitest's.
	const called = (await Promise.all(fromPages.map((p) => lookUp(p.name, p.calledIn))))
		.filter((f) => f.kept.some((d) => d.exported))
		.slice(0, keep.pageNames);
	const found = [...named, ...called];
	const kept = found.flatMap((f) => f.kept.map((d) => ({name: f.name, d})));
	const owners = await Promise.all(kept.map(({d}) => packageOf(d.file)));
	const inPackages = [
		...new Map(owners.flatMap((p) => (p === null ? [] : [[p.dir, p] as const]))).values(),
	];

	const useGraph = options.codeGraph ?? true;
	const graphs = new Map(
		await Promise.all(
			inPackages.map(async (p) => [p.dir, useGraph ? await callGraph(root, p.dir) : null] as const),
		),
	);
	const published = new Map(
		await Promise.all(
			inPackages.map(async (p) => {
				const asked = kept
					.filter(({d}, i) => d.exported && owners[i]?.dir === p.dir)
					.map(({name, d}) => ({name, file: d.file}));
				const answers =
					useGraph && asked.length > 0 ? await publication(root, p, tracked, asked) : new Map();
				return [p.dir, answers] as const;
			}),
		),
	);

	const definition = async (name: string, d: Declared): Promise<Definition> => {
		const pkg = await packageOf(d.file);
		const graph = pkg === null ? null : (graphs.get(pkg.dir) ?? null);
		return {
			file: d.file,
			line: d.line,
			exported: d.exported,
			signature: signatureAt(await show(d.file), d.line),
			package: pkg?.name ?? null,
			published:
				pkg === null || !d.exported
					? null
					: (published.get(pkg.dir)?.get(`${name}\n${d.file}`) ?? null),
			callers:
				pkg === null || graph === null ? null : callersIn(graph, pkg.dir, d, name, keep.callers),
		};
	};
	const names: NameFact[] = await Promise.all(
		found.map(async (f) => ({
			name: f.name,
			calledIn: f.calledIn,
			definitions: await Promise.all(f.kept.map((d) => definition(f.name, d))),
			more: f.more,
			mentionedIn: f.mentionedIn,
		})),
	);
	return {names, paths, pages: read.map((r) => r.fact), refs: mentions.refs};
}

/**
 * The Facts service on the repo in `dir`, read at HEAD. Any failure of git
 * fails the whole gathering; a package code-graph cannot read only leaves its
 * callers and publication unknown.
 */
export function localFacts(dir: string, options: LocalFactsOptions = {}) {
	return Layer.succeed(Facts, {
		gather: (mentions) =>
			Effect.tryPromise({
				try: () => gather(dir, mentions, options),
				catch: () => ({_tag: "facts_failed" as const}),
			}),
	});
}
