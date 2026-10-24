// Experiment 126: is the core ready to build on? The core is `packages/fabrika`. This script does
// the counting for parts 1 and 2; the reading and the verdicts are in 126-core-ready.md.
//
//   node experiments/126-core-ready.ts contract            # part 1: every name the old pipeline imports from the core
//   WORK=<scratch dir outside the repo> node experiments/126-core-ready.ts setup      # a copy of HEAD, Stryker added
//   WORK=<dir> node experiments/126-core-ready.ts sample     # every mutant of the core, a fixed-seed sample of 150
//   WORK=<dir> node experiments/126-core-ready.ts typecheck  # each sampled mutant alone through the repo's own tsc
//   WORK=<dir> node experiments/126-core-ready.ts prime      # one mutant alone, then the sample's same-node siblings marked as run
//   WORK=<dir> node experiments/126-core-ready.ts run        # Stryker 10.1.1, vitest runner, the core's tests, on the sample only
//   WORK=<dir> node experiments/126-core-ready.ts report     # writes experiments/results/126-core-ready.json
//   WORK=<dir> node experiments/126-core-ready.ts wider      # the ones that lived, again, with the old pipeline's tests too
//
// The copy is `git archive HEAD` with its own fresh git history, so Stryker's in-place edits never
// touch this checkout. Every child runs with TYPESAFE_API_KEY removed, every test, typecheck and
// Stryker run under nice -n 15. Network: pnpm installs only. No agent, no model, no Jev. $0.

import {spawnSync} from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {join, relative} from "node:path";
import {pathToFileURL} from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const WORK = process.env.WORK ?? "";
const TREE = join(WORK, "tree");
const RESULTS = join(ROOT, "experiments/results/126-core-ready.json");
const CORE = "packages/fabrika/src";
const PIPELINE = "packages/pipeline/src";
const STRYKER = "10.1.1";
const SEED = 126;
const SIZE = 150;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const REPORT = "reports/mutation126.json";

// ---------------------------------------------------------------- helpers

interface Ran {
	readonly code: number;
	readonly out: string;
	readonly ms: number;
}

/** A child with the Jev key removed, under nice -n 15 unless `plain`. */
function run(cmd: string, args: readonly string[], cwd: string, plain = false): Ran {
	const env = {...process.env};
	delete env.TYPESAFE_API_KEY;
	const t0 = Date.now();
	const [file, rest] = plain ? [cmd, args] : ["nice", ["-n", "15", cmd, ...args]];
	const r = spawnSync(file, rest, {cwd, env, encoding: "utf8", maxBuffer: 1 << 28});
	return {code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t0};
}

function must(cmd: string, args: readonly string[], cwd: string): string {
	const r = run(cmd, args, cwd, true);
	if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.code}\n${r.out}`);
	return r.out;
}

function readJson<T>(file: string): T {
	return JSON.parse(readFileSync(file, "utf8"));
}

function saveJson(file: string, value: unknown): void {
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
}

/** The results file holds both parts; each step writes its own key and keeps the others. */
function saveResults(part: Record<string, unknown>): void {
	const old = existsSync(RESULTS) ? readJson<Record<string, unknown>>(RESULTS) : {};
	saveJson(RESULTS, {...old, ...part});
}

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
	);
}

const isTest = (f: string): boolean => /\.test\.ts$/.test(f);

function needWork(): void {
	if (WORK === "" || WORK.startsWith(ROOT))
		throw new Error("set WORK to a folder outside the repo");
}

/** A tiny seeded generator (mulberry32), so the sample is the same on every run. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
	const out = [...items];
	const next = seeded(seed);
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		const a = out[i];
		const b = out[j];
		if (a === undefined || b === undefined) continue;
		out[i] = b;
		out[j] = a;
	}
	return out;
}

/** The core's folder a file sits in: program, host, shell, agents, or top for the entry files. */
function folderOf(file: string): string {
	const rest = file.startsWith(`${CORE}/`) ? file.slice(CORE.length + 1) : file;
	const first = rest.split("/")[0] ?? "";
	return rest.includes("/") ? first : "top";
}

// ---------------------------------------------------------------- part 1: the contract

interface Imported {
	readonly from: string;
	readonly name: string;
	readonly file: string;
	readonly type: boolean;
}

/** Every named import and re-export from `@kampus/fabrika` or a subpath, in one file's text. */
function importsOf(file: string, text: string): Imported[] {
	const out: Imported[] = [];
	const named =
		/(?:^|\n)\s*(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*"(@kampus\/fabrika(?:\/[^"]*)?)"/g;
	for (const m of text.matchAll(named)) {
		const allType = m[2] !== undefined;
		const from = m[4] ?? "";
		for (const part of (m[3] ?? "").split(",")) {
			const p = part.trim();
			if (p === "") continue;
			const type = allType || p.startsWith("type ");
			const name = (p.replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "").trim();
			out.push({from, name, file, type});
		}
	}
	const star =
		/(?:^|\n)\s*(?:import|export)\s+\*\s+(?:as\s+(\w+)\s+)?from\s*"(@kampus\/fabrika[^"]*)"/g;
	for (const m of text.matchAll(star))
		out.push({from: m[2] ?? "", name: `* as ${m[1] ?? "(all)"}`, file, type: false});
	const dynamic = /import\(\s*"(@kampus\/fabrika[^"]*)"\s*\)/g;
	for (const m of text.matchAll(dynamic))
		out.push({from: m[1] ?? "", name: "import()", file, type: false});
	return out;
}

/** The core's public names: the package's export map, `export * from` followed down. */
function publicNames(): Record<string, string[]> {
	const pkg = readJson<{exports: Record<string, string>}>(
		join(ROOT, "packages/fabrika/package.json"),
	);
	const namesOf = (file: string, seen: Set<string>): string[] => {
		if (seen.has(file) || !existsSync(file)) return [];
		seen.add(file);
		const text = readFileSync(file, "utf8");
		const names: string[] = [];
		const dir = join(file, "..");
		for (const m of text.matchAll(/(?:^|\n)export\s+\*\s+from\s+"(\.[^"]+)"/g))
			names.push(...namesOf(join(dir, m[1] ?? ""), seen));
		for (const m of text.matchAll(/(?:^|\n)export\s+\*\s+as\s+(\w+)\s+from/g))
			names.push(m[1] ?? "");
		for (const m of text.matchAll(/(?:^|\n)export\s+(?:type\s+)?\{([^}]*)\}/g))
			for (const part of (m[1] ?? "").split(",")) {
				const p = part.trim().replace(/^type\s+/, "");
				if (p !== "") names.push((p.split(/\s+as\s+/)[1] ?? p.split(/\s+as\s+/)[0] ?? "").trim());
			}
		const decl =
			/(?:^|\n)export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum|namespace)\s+(\w+)/g;
		for (const m of text.matchAll(decl)) names.push(m[1] ?? "");
		return names;
	};
	const out: Record<string, string[]> = {};
	for (const [sub, target] of Object.entries(pkg.exports)) {
		if (!target.endsWith(".ts")) continue;
		const from = sub === "." ? "@kampus/fabrika" : `@kampus/fabrika/${sub.slice(2)}`;
		out[from] = [...new Set(namesOf(join(ROOT, "packages/fabrika", target), new Set()))].sort();
	}
	return out;
}

function contract() {
	const consumers: Record<string, string[]> = {
		pipeline: walk(join(ROOT, PIPELINE)),
		app: walk(join(ROOT, "apps/fabrika/src")),
		programs: walk(join(ROOT, "programs")).filter((f) => !f.includes("node_modules")),
		packs: walk(join(ROOT, "packs")).filter((f) => !f.includes("node_modules")),
		tutorials: walk(join(ROOT, "docs/tutorials")).filter((f) => !f.includes("node_modules")),
		wip: walk(join(ROOT, "wip/src")),
		legacy: walk(join(ROOT, "legacy/src")),
		experiments: walk(join(ROOT, "experiments")).filter((f) => !f.includes("/results/")),
	};
	const coreTests = walk(join(ROOT, CORE))
		.filter(isTest)
		.map((f) => readFileSync(f, "utf8"))
		.join("\n");
	const pub = publicNames();
	const byConsumer: Record<string, Imported[]> = {};
	for (const [who, files] of Object.entries(consumers))
		byConsumer[who] = files
			.filter((f) => /\.tsx?$/.test(f))
			.flatMap((f) => importsOf(relative(ROOT, f), readFileSync(f, "utf8")));
	const pipe = byConsumer.pipeline ?? [];
	const rows = new Map<
		string,
		{from: string; name: string; files: Set<string>; srcFiles: Set<string>; type: boolean}
	>();
	for (const i of pipe) {
		const key = `${i.from} ${i.name}`;
		const row = rows.get(key) ?? {
			from: i.from,
			name: i.name,
			files: new Set<string>(),
			srcFiles: new Set<string>(),
			type: i.type,
		};
		row.files.add(i.file);
		if (!isTest(i.file)) row.srcFiles.add(i.file);
		rows.set(key, row);
	}
	const named = (n: string) => new RegExp(`\\b${n.replace(/[$]/g, "\\$")}\\b`).test(coreTests);
	const names = [...rows.values()]
		.map((r) => ({
			from: r.from,
			name: r.name,
			type: r.type,
			files: r.files.size,
			srcFiles: r.srcFiles.size,
			public: (pub[r.from] ?? []).includes(r.name),
			inCoreTests: r.name.startsWith("*") || r.name === "import()" ? null : named(r.name),
		}))
		.sort(
			(a, b) => a.from.localeCompare(b.from) || b.files - a.files || a.name.localeCompare(b.name),
		);
	const subpaths: Record<string, {names: number; uses: number; files: number; public: number}> = {};
	for (const r of names) {
		const s = subpaths[r.from] ?? {names: 0, uses: 0, files: 0, public: (pub[r.from] ?? []).length};
		s.names += 1;
		s.uses += r.files;
		subpaths[r.from] = s;
	}
	for (const [from, s] of Object.entries(subpaths))
		s.files = new Set(pipe.filter((i) => i.from === from).map((i) => i.file)).size;
	const usedByAnyone = new Set(
		Object.values(byConsumer)
			.flat()
			.map((i) => `${i.from} ${i.name}`),
	);
	const unused: Record<string, string[]> = {};
	for (const [from, list] of Object.entries(pub))
		unused[from] = list.filter((n) => !usedByAnyone.has(`${from} ${n}`));
	const otherUsers: Record<string, number> = {};
	for (const [who, list] of Object.entries(byConsumer))
		if (who !== "pipeline") otherUsers[who] = new Set(list.map((i) => `${i.from} ${i.name}`)).size;
	const out = {
		pipelineFiles: new Set(pipe.map((i) => i.file)).size,
		pipelineSrcFiles: new Set(pipe.filter((i) => !isTest(i.file)).map((i) => i.file)).size,
		distinctNames: names.length,
		subpaths,
		names,
		notPublic: names.filter((n) => !n.public && !n.name.startsWith("*")),
		notInCoreTests: names.filter((n) => n.inCoreTests === false && !n.type),
		publicCount: Object.fromEntries(Object.entries(pub).map(([k, v]) => [k, v.length])),
		unusedPublic: unused,
		otherUsers,
	};
	saveResults({contract: out});
	console.log(
		`pipeline: ${out.pipelineFiles} files import from the core (${out.pipelineSrcFiles} not tests), ${out.distinctNames} distinct names`,
	);
	for (const [from, s] of Object.entries(subpaths))
		console.log(
			`  ${from}: ${s.names} names of ${s.public} public, ${s.uses} uses, ${s.files} files`,
		);
	console.log(
		`not public: ${out.notPublic.map((n) => `${n.from} ${n.name}`).join(", ") || "none"}`,
	);
	console.log(
		`values not named in any core test: ${out.notInCoreTests.map((n) => `${n.name} (${n.from}, ${n.files})`).join(", ")}`,
	);
	console.log(`other users: ${JSON.stringify(otherUsers)}`);
	return out;
}

// ---------------------------------------------------------------- setup

function setup() {
	needWork();
	mkdirSync(TREE, {recursive: true});
	if (!existsSync(join(TREE, "package.json"))) {
		const archive = join(WORK, "head.tar");
		must("git", ["archive", "-o", archive, "HEAD"], ROOT);
		must("tar", ["-x", "-f", archive, "-C", TREE], WORK);
		must("git", ["init", "-q"], TREE);
		must("git", ["add", "-A"], TREE);
		must(
			"git",
			["-c", "user.name=126", "-c", "user.email=126@example.invalid", "commit", "-qm", "HEAD"],
			TREE,
		);
	}
	must("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], TREE);
	if (!existsSync(join(TREE, "node_modules/@stryker-mutator/vitest-runner")))
		must(
			"pnpm",
			[
				"add",
				"-w",
				"-D",
				"--prefer-offline",
				`@stryker-mutator/core@${STRYKER}`,
				`@stryker-mutator/vitest-runner@${STRYKER}`,
			],
			TREE,
		);
	const tests = run(join(TREE, "node_modules/.bin/vitest"), ["run", CORE], TREE);
	const tsc = run(
		join(TREE, "node_modules/.bin/tsc"),
		["--noEmit", "-p", "."],
		join(TREE, "packages/fabrika"),
	);
	const summary = /Tests\s+(\d+) passed/.exec(tests.out)?.[1] ?? "?";
	console.log(`core tests: exit ${tests.code}, ${summary} passed, ${tests.ms} ms`);
	console.log(`core typecheck: exit ${tsc.code}, ${tsc.ms} ms`);
	saveJson(join(WORK, "setup.json"), {
		tests: {code: tests.code, ms: tests.ms, passed: summary},
		tsc,
	});
}

// ---------------------------------------------------------------- part 2: the sample

interface Pos {
	readonly line: number; // 1-based, as an editor shows it
	readonly column: number; // 0-based, as Babel counts it
}
interface Row {
	readonly key: string;
	readonly file: string;
	readonly folder: string;
	readonly mutator: string;
	readonly replacement: string;
	readonly start: Pos;
	readonly end: Pos;
	readonly original: string;
}

interface ApiMutant {
	readonly fileName: string;
	readonly mutatorName: string;
	readonly replacement: string;
	readonly location: {
		readonly start: {readonly line: number; readonly column: number};
		readonly end: {readonly line: number; readonly column: number};
	};
}

const keyOf = (file: string, mutator: string, replacement: string, s: Pos, e: Pos): string =>
	`${file}@${s.line}:${s.column}-${e.line}:${e.column} ${mutator} ${replacement}`;

function offsetOf(text: string, p: Pos): number {
	let line = 1;
	let i = 0;
	while (line < p.line) {
		const nl = text.indexOf("\n", i);
		if (nl < 0) break;
		i = nl + 1;
		line++;
	}
	return i + p.column;
}

/** A tracked file under packages/ differs from HEAD (the copy's own config files are not there). */
const sourceChanged = (): boolean =>
	must("git", ["status", "--porcelain", "--", "packages"], TREE).trim() !== "";

const inside = (outer: Row, inner: Row): boolean =>
	(outer.start.line < inner.start.line ||
		(outer.start.line === inner.start.line && outer.start.column <= inner.start.column)) &&
	(outer.end.line > inner.end.line ||
		(outer.end.line === inner.end.line && outer.end.column >= inner.end.column));

/** The core's source files that Stryker mutates: no tests, no type declarations. */
const sourceFiles = (): string[] =>
	walk(join(TREE, CORE))
		.filter((f) => f.endsWith(".ts") && !isTest(f) && !f.endsWith(".d.ts"))
		.sort();

async function sample() {
	needWork();
	// pnpm links core in; the instrumenter sits beside core's real folder, not at the tree's root.
	const req = createRequire(
		realpathSync(join(TREE, "node_modules/@stryker-mutator/core/package.json")),
	);
	const mod = await import(pathToFileURL(req.resolve("@stryker-mutator/instrumenter")).href);
	const quiet = () => {};
	const logger = {
		trace: quiet,
		debug: quiet,
		info: quiet,
		warn: console.warn,
		error: console.error,
		fatal: console.error,
		isTraceEnabled: () => false,
		isDebugEnabled: () => false,
		isInfoEnabled: () => false,
		isWarnEnabled: () => true,
		isErrorEnabled: () => true,
		isFatalEnabled: () => true,
	};
	const files = sourceFiles().map((name) => ({
		name,
		content: readFileSync(name, "utf8"),
		mutate: true,
	}));
	const instrumenter = new mod.Instrumenter(logger);
	const result: {mutants: readonly ApiMutant[]} = await instrumenter.instrument(files, {
		plugins: null,
		excludedMutations: [],
		ignorers: [],
	});
	const texts = new Map(files.map((f) => [f.name, f.content]));
	const all: Row[] = result.mutants.map((m) => {
		const start = {line: m.location.start.line + 1, column: m.location.start.column};
		const end = {line: m.location.end.line + 1, column: m.location.end.column};
		const file = relative(TREE, m.fileName);
		const text = texts.get(m.fileName) ?? "";
		const original = text.slice(offsetOf(text, start), offsetOf(text, end));
		return {
			key: keyOf(file, m.mutatorName, m.replacement, start, end),
			file,
			folder: folderOf(file),
			mutator: m.mutatorName,
			replacement: m.replacement,
			start,
			end,
			original,
		};
	});
	const picked = shuffled(all, SEED).slice(0, SIZE);
	const byFolder: Record<string, {all: number; sample: number}> = {};
	for (const r of all) {
		const f = byFolder[r.folder] ?? {all: 0, sample: 0};
		f.all += 1;
		byFolder[r.folder] = f;
	}
	for (const r of picked) {
		const f = byFolder[r.folder] ?? {all: 0, sample: 0};
		f.sample += 1;
		byFolder[r.folder] = f;
	}
	// What else Stryker will make: every mutant inside a sampled one's range whose node holds a
	// sampled location. Those run too, and are left out of every count.
	const extras = all.filter(
		(m) =>
			!picked.some((p) => p.key === m.key) &&
			picked.some((p) => p.file === m.file && inside(p, m)) &&
			picked.some((p) => p.file === m.file && inside(m, p)),
	);
	saveJson(join(WORK, "all-mutants.json"), all);
	saveJson(join(WORK, "sample.json"), picked);
	console.log(
		`${files.length} files, ${all.length} mutants; sample ${picked.length}, seed ${SEED}`,
	);
	console.log(`by folder: ${JSON.stringify(byFolder)}`);
	console.log(`extras Stryker will also run (not counted): ${extras.length}`);
	saveJson(join(WORK, "sample-summary.json"), {
		files: files.length,
		mutants: all.length,
		byFolder,
		extras: extras.map((e) => e.key),
	});
}

// ---------------------------------------------------------------- part 2: the typecheck

interface Checked {
	readonly key: string;
	readonly refused: boolean;
	readonly errors: readonly string[];
	readonly ms: number;
}

/** Each sampled mutant put in alone, the repo's own tsc (Effect's checks patched in), put back. */
function typecheck() {
	needWork();
	const pkg = join(TREE, "packages/fabrika");
	const tsc = join(TREE, "node_modules/.bin/tsc");
	if (sourceChanged()) throw new Error("the tree has changes; is a Stryker run going?");
	const clean = run(tsc, ["--noEmit", "-p", "."], pkg);
	if (clean.code !== 0) throw new Error(`the clean tree does not typecheck:\n${clean.out}`);
	const picked = readJson<Row[]>(join(WORK, "sample.json"));
	const out: Checked[] = [];
	for (const m of picked) {
		const file = join(TREE, m.file);
		const text = readFileSync(file, "utf8");
		const a = offsetOf(text, m.start);
		const b = offsetOf(text, m.end);
		if (text.slice(a, b) !== m.original) throw new Error(`${m.key}: the text moved`);
		writeFileSync(file, `${text.slice(0, a)}${m.replacement}${text.slice(b)}`);
		const r = run(tsc, ["--noEmit", "-p", "."], pkg);
		writeFileSync(file, text);
		const errors = r.out
			.split("\n")
			.filter((l) => /error TS\d+/.test(l))
			.slice(0, 3);
		out.push({key: m.key, refused: r.code !== 0, errors, ms: r.ms});
	}
	if (sourceChanged()) throw new Error("a file was not put back");
	saveJson(join(WORK, "typecheck.json"), out);
	console.log(`typecheck: ${out.filter((c) => c.refused).length} of ${out.length} refused`);
}

// ---------------------------------------------------------------- part 2: Stryker

/**
 * An ignorer that keeps only nodes holding a sampled location. With the mutate ranges (only nodes
 * inside a sampled one), Stryker makes the sampled mutants, the other mutants on the same node,
 * and the few on nodes between two nested sampled ones.
 */
const samplePlugin = (
	sampleFile: string,
) => `// Experiment 126: keep only the nodes that hold a sampled mutant.
import {readFileSync} from "node:fs";
import {relative} from "node:path";
const sample = JSON.parse(readFileSync(${JSON.stringify(sampleFile)}, "utf8"));
const holds = (loc, m) =>
  (loc.start.line < m.start.line || (loc.start.line === m.start.line && loc.start.column <= m.start.column)) &&
  (loc.end.line > m.end.line || (loc.end.line === m.end.line && loc.end.column >= m.end.column));
const fileOf = (path) => {
  const name = path.node.loc?.filename ?? path.hub?.file?.opts?.filename;
  return name === undefined ? undefined : relative(process.cwd(), name);
};
export const strykerPlugins = [
  {
    kind: "Ignore",
    name: "sample126",
    value: {
      shouldIgnore(path) {
        const loc = path.node.loc;
        if (loc == null) return undefined;
        const file = fileOf(path);
        const mine = sample.filter((m) => file === undefined || m.file === file);
        return mine.some((m) => holds(loc, m)) ? undefined : "126: not in the sample";
      },
    },
  },
];
`;

// mergeConfig would add the include list to the base one, so the base's test settings are spread.
const vitestConfig = (include: readonly string[]) => `import {defineConfig} from "vitest/config";
import base from "./vitest.config.ts";

// Experiment 126: only these tests, with the repo's own time limits.
export default defineConfig({...base, test: {...base.test, include: ${JSON.stringify(include)}}});
`;
/** The main run: the core's own tests. */
const CORE_TESTS = [`${CORE}/**/*.test.ts`];
/** The wider run: the core's tests and the old pipeline's, which test the core from outside. */
const WIDER_TESTS = [...CORE_TESTS, `${PIPELINE}/**/*.test.ts`];

const INCREMENTAL = "reports/stryker-incremental-126.json";
const rangeOf = (m: Row): string =>
	`${m.file}:${m.start.line}:${m.start.column}-${m.end.line}:${m.end.column}`;

interface IncrementalMutant {
	id: string;
	mutatorName: string;
	replacement?: string;
	status: string;
	location: {start: {line: number; column: number}; end: {line: number; column: number}};
	coveredBy?: string[];
	killedBy?: string[];
}
interface Incremental {
	files: Record<string, {language: string; source: string; mutants: IncrementalMutant[]}>;
	testFiles?: Record<string, {tests: {id: string}[]}>;
}

/**
 * Stryker has no option to run one mutant by id. The mutate ranges and the ignorer narrow it to
 * the sampled nodes, but a node's other mutants come along (a condition's `true` and `false`).
 * So one sampled mutant runs alone first, with `--incremental` on, which writes every test into
 * Stryker's incremental file. Then each extra goes into that file as already run, covered by every
 * test. Stryker reuses an old result that no new test covers, so the main run runs the sample alone.
 */
function prime() {
	needWork();
	const picked = readJson<Row[]>(join(WORK, "sample.json"));
	const all = readJson<Row[]>(join(WORK, "all-mutants.json"));
	const extras = new Set(readJson<{extras: string[]}>(join(WORK, "sample-summary.json")).extras);
	const extraRows = all.filter((m) => extras.has(m.key));
	const first = picked.find(
		(p) => !extraRows.some((e) => e.file === p.file && (inside(p, e) || inside(e, p))),
	);
	if (first === undefined) throw new Error("no sampled mutant stands alone");
	const s = stryker([rangeOf(first)], "prime");
	const inc = readJson<Incremental>(join(TREE, INCREMENTAL));
	const done = inc.files[first.file]?.mutants.find(
		(m) => m.mutatorName === first.mutator && m.replacement === first.replacement,
	);
	if (done === undefined) throw new Error(`the primed mutant is not in ${INCREMENTAL}`);
	const dl = done.location.start.line - first.start.line;
	const dc = done.location.start.column - first.start.column;
	const tests = Object.values(inc.testFiles ?? {}).flatMap((f) => f.tests.map((t) => t.id));
	for (const e of extraRows) {
		const file = inc.files[e.file] ?? {
			language: "typescript",
			source: readFileSync(join(TREE, e.file), "utf8"),
			mutants: [],
		};
		file.mutants.push({
			id: `126-extra-${file.mutants.length}`,
			mutatorName: e.mutator,
			replacement: e.replacement,
			status: "Survived",
			location: {
				start: {line: e.start.line + dl, column: e.start.column + dc},
				end: {line: e.end.line + dl, column: e.end.column + dc},
			},
			coveredBy: tests,
			killedBy: [],
		});
		inc.files[e.file] = file;
	}
	saveJson(join(TREE, INCREMENTAL), inc);
	saveJson(join(WORK, "prime.json"), {
		first: first.key,
		status: done.status,
		code: s.code,
		ms: s.ms,
		tests: tests.length,
		extras: extraRows.length,
		offset: {line: dl, column: dc},
	});
	console.log(
		`primed with ${first.key} (${done.status}); ${tests.length} tests; ${extraRows.length} extras written as done`,
	);
}

interface Pass {
	/** The rows the ignorer keeps. */
	readonly sampleFile: string;
	readonly tests: readonly string[];
	/** Reuse the primed results (the main run), or run every kept node (the wider run). */
	readonly incremental: boolean;
}

const MAIN: Pass = {sampleFile: "sample.json", tests: CORE_TESTS, incremental: true};

function stryker(mutate: readonly string[], label: string, pass: Pass = MAIN): Ran {
	const busy = run("pgrep", ["-f", "stryker.js run"], WORK, true);
	if (busy.out.trim() !== "") throw new Error(`another Stryker is running: ${busy.out.trim()}`);
	writeFileSync(join(TREE, "stryker-sample126.mjs"), samplePlugin(join(WORK, pass.sampleFile)));
	writeFileSync(join(TREE, "vitest.stryker126.config.ts"), vitestConfig(pass.tests));
	const config = {
		packageManager: "pnpm",
		plugins: ["@stryker-mutator/vitest-runner", "./stryker-sample126.mjs"],
		ignorers: ["sample126"],
		testRunner: "vitest",
		vitest: {configFile: "vitest.stryker126.config.ts", related: false},
		coverageAnalysis: "perTest",
		inPlace: true,
		concurrency: CONCURRENCY,
		mutate,
		incremental: pass.incremental,
		incrementalFile: INCREMENTAL,
		reporters: ["json", "clear-text"],
		jsonReporter: {fileName: REPORT},
		clearTextReporter: {allowColor: false, logTests: false, reportMutants: false},
		tempDirName: ".stryker-tmp",
		cleanTempDir: true,
		timeoutMS: 60_000,
	};
	saveJson(join(TREE, "stryker126.config.json"), config);
	const s = run(
		"node",
		[
			join(TREE, "node_modules/@stryker-mutator/core/bin/stryker.js"),
			"run",
			"stryker126.config.json",
		],
		TREE,
	);
	writeFileSync(join(WORK, `stryker-${label}.log`), s.out);
	if (existsSync(join(TREE, REPORT)))
		copyFileSync(join(TREE, REPORT), join(WORK, `mutation126-${label}.json`));
	if (sourceChanged()) throw new Error("Stryker left a source file changed");
	console.log(`stryker ${label}: exit ${s.code}, ${Math.round(s.ms / 1000)} s; log in WORK`);
	return s;
}

function strykerRun() {
	needWork();
	if (!existsSync(join(WORK, "prime.json"))) throw new Error("run `prime` first");
	const picked = readJson<Row[]>(join(WORK, "sample.json"));
	const s = stryker([...new Set(picked.map(rangeOf))], "run");
	const reused = /(\d+) of (\d+) mutant result\(s\) are reused/.exec(s.out);
	saveJson(join(WORK, "stryker-run.json"), {
		code: s.code,
		ms: s.ms,
		reused: reused === null ? null : {reused: Number(reused[1]), of: Number(reused[2])},
	});
}

// ---------------------------------------------------------------- report

interface ReportMutant {
	readonly mutatorName: string;
	readonly replacement?: string;
	readonly status: string;
	readonly statusReason?: string;
	readonly coveredBy?: readonly string[];
	readonly killedBy?: readonly string[];
	readonly static?: boolean;
	readonly location: {
		readonly start: {readonly line: number; readonly column: number};
		readonly end: {readonly line: number; readonly column: number};
	};
}

/**
 * The hand check of the survivors, read one by one in 126-core-ready.md. `real` is a change a
 * caller would see that no test catches; `harmless` is a change no caller can see.
 */
const HAND: Record<string, {verdict: "real" | "harmless" | "unsure"; why: string}> = {
	"packages/fabrika/src/agents/acp/program.ts@206:16-206:56 ObjectLiteral {}": {
		verdict: "harmless",
		why: "the acp session's drawing loses its acp.agent span attribute; only a trace reads it",
	},
	"packages/fabrika/src/agents/acp/transcript.ts@441:2-441:20 ConditionalExpression true": {
		verdict: "real",
		why: "while a turn is cancelling the status line says `turn N`, not `cancelling`; display only",
	},
	"packages/fabrika/src/program/program.ts@1410:5-1410:31 ConditionalExpression true": {
		verdict: "real",
		why: "a pipe whose writer never started leaves the reader's input open; the reader waits for good",
	},
	"packages/fabrika/src/program/shape.ts@236:6-236:39 ConditionalExpression true": {
		verdict: "real",
		why: "fit keeps notes (description, title) under items or anyOf and turns arrays into objects",
	},
	'packages/fabrika/src/program/shape.ts@228:47-228:60 StringLiteral ""': {
		verdict: "harmless",
		why: "the core writes its definitions under $defs (shape.ts:108); only a draft-07 shape from elsewhere differs",
	},
	"packages/fabrika/src/host/host.ts@525:8-525:28 ConditionalExpression false": {
		verdict: "real",
		why: "a host never hears another's claim from the registry; it learns at the next renew instead",
	},
	'packages/fabrika/src/host/host.ts@528:29-528:44 StringLiteral ""': {
		verdict: "real",
		why: "a watching host never hears lease_expired; it takes over only when its own claim timer fires",
	},
	"packages/fabrika/src/host/memory.ts@648:54-648:77 StringLiteral ``": {
		verdict: "real",
		why: "a hold repeating an earlier charge's id is held again, not answered as a repeat",
	},
	"packages/fabrika/src/host/laws.ts@626:18-626:54 MethodExpression got.some((r, i) => r.rev === i + 2)":
		{
			verdict: "real",
			why: "law T passes a tail that hands events on out of order; no planted mistake reorders a tail",
		},
	"packages/fabrika/src/host/laws.ts@134:6-134:15 EqualityOperator late < 0": {
		verdict: "harmless",
		why: "only which steps a verdict calls late changes; a late step fails nothing either way",
	},
	"packages/fabrika/src/host/tail.ts@62:4-62:27 AssignmentOperator m.events -= rows.length": {
		verdict: "harmless",
		why: "the tail's event meter counts down; only a caller that passes `meters` to measure reads it",
	},
};

/**
 * Code that runs where no mutant can be switched on: the vitest runner turns a mutant on through
 * vitest's inject, inside the test's own process. The ledger's SQL runs in worker threads (sqlite)
 * and in workerd (the Durable Object); in this process only the migrations at open and the
 * planted-mistake ledger run it, and that test wants the laws to fail. The fake agent is a child.
 */
const OUT_OF_SIGHT = new Set<string>([
	"packages/fabrika/src/host/durable-object.ts",
	"packages/fabrika/src/host/rules.ts",
	"packages/fabrika/src/host/sqlite-driver.ts",
	"packages/fabrika/src/host/sqlite-worker.ts",
	"packages/fabrika/src/agents/acp/fake-agent.ts",
	"packages/fabrika/src/shell/bin.ts",
]);

interface Report {
	readonly files: Record<string, {readonly mutants: readonly ReportMutant[]}>;
	readonly testFiles?: Record<string, {readonly tests: readonly {readonly id: string}[]}>;
}

/** A Stryker JSON report's mutants by the sample's key, and each test id's file. */
function readReport(label: string) {
	const rep = readJson<Report>(join(WORK, `mutation126-${label}.json`));
	const got = new Map<string, ReportMutant>();
	for (const [name, f] of Object.entries(rep.files)) {
		const file = name.startsWith("/") ? relative(TREE, name) : name;
		for (const m of f.mutants) {
			// The report counts columns from 1; Babel and the sample count them from 0.
			const s = {line: m.location.start.line, column: m.location.start.column - 1};
			const e = {line: m.location.end.line, column: m.location.end.column - 1};
			got.set(keyOf(file, m.mutatorName, m.replacement ?? "", s, e), m);
		}
	}
	const testFile = new Map<string, string>();
	for (const [name, f] of Object.entries(rep.testFiles ?? {}))
		for (const t of f.tests) testFile.set(t.id, name.startsWith("/") ? relative(TREE, name) : name);
	return {got, testFile};
}

/**
 * The mutants that lived the main run (survived, or no core test ran them), run again with the old
 * pipeline's tests too: how much of the core is tested only from outside it. Same nodes, so a
 * node's other mutants come along (28 here); they are left out of every count.
 */
function wider() {
	needWork();
	const main = readJson<{mutants: {rows: {key: string; status: string}[]}}>(RESULTS).mutants.rows;
	const lived = new Set(
		main.filter((r) => r.status === "Survived" || r.status === "NoCoverage").map((r) => r.key),
	);
	const rows = readJson<Row[]>(join(WORK, "sample.json")).filter((m) => lived.has(m.key));
	saveJson(join(WORK, "lived.json"), rows);
	const s = stryker([...new Set(rows.map(rangeOf))], "wider", {
		sampleFile: "lived.json",
		tests: WIDER_TESTS,
		incremental: false,
	});
	const {got, testFile} = readReport("wider");
	const out = rows.map((m) => {
		const r = got.get(m.key);
		const by = [...new Set((r?.killedBy ?? []).map((id) => testFile.get(id) ?? id))];
		return {key: m.key, status: r?.status ?? "Missing", killedBy: by};
	});
	const count: Record<string, number> = {};
	for (const r of out) count[r.status] = (count[r.status] ?? 0) + 1;
	saveResults({wider: {tests: WIDER_TESTS, ms: s.ms, code: s.code, count, rows: out}});
	console.log(`wider, ${rows.length} that lived the core's tests: ${JSON.stringify(count)}`);
	for (const r of out.filter((x) => x.status === "Killed"))
		console.log(`  killed ${r.key.split("\n")[0]} by ${r.killedBy.join(", ")}`);
}

function report() {
	needWork();
	const picked = readJson<Row[]>(join(WORK, "sample.json"));
	const checked = new Map(readJson<Checked[]>(join(WORK, "typecheck.json")).map((c) => [c.key, c]));
	const {got} = readReport("run");
	const rows = picked.map((m) => {
		const r = got.get(m.key);
		const c = checked.get(m.key);
		const stryker = r?.status ?? "Missing";
		const status = c?.refused === true ? "CompileError" : stryker;
		return {
			file: m.file,
			line: m.start.line,
			folder: m.folder,
			mutator: m.mutator,
			original: m.original.length > 120 ? `${m.original.slice(0, 117)}...` : m.original,
			replacement: m.replacement.length > 120 ? `${m.replacement.slice(0, 117)}...` : m.replacement,
			stryker,
			refused: c?.refused ?? null,
			status,
			static: r?.static ?? false,
			covered: r?.coveredBy?.length ?? 0,
			killedBy: r?.killedBy ?? [],
			outOfSight: OUT_OF_SIGHT.has(m.file),
			hand: HAND[m.key] ?? null,
			key: m.key,
		};
	});
	const count = (list: readonly {status: string}[]) => {
		const out: Record<string, number> = {};
		for (const r of list) out[r.status] = (out[r.status] ?? 0) + 1;
		return out;
	};
	const strykerOnly = count(rows.map((r) => ({status: r.stryker})));
	const folders = [...new Set(rows.map((r) => r.folder))].sort();
	const perFolder = Object.fromEntries(
		folders.map((f) => [f, count(rows.filter((r) => r.folder === f))]),
	);
	const refusedButLived = rows.filter(
		(r) => r.refused === true && (r.stryker === "Survived" || r.stryker === "NoCoverage"),
	);
	const out = {
		seed: SEED,
		size: SIZE,
		stryker: STRYKER,
		sample: readJson<unknown>(join(WORK, "sample-summary.json")),
		setup: readJson<unknown>(join(WORK, "setup.json")),
		run: readJson<unknown>(join(WORK, "stryker-run.json")),
		overall: count(rows),
		strykerAlone: strykerOnly,
		perFolder,
		refusedButLived: refusedButLived.length,
		outOfSight: count(rows.filter((r) => r.outOfSight)),
		hand: count(rows.flatMap((r) => (r.hand === null ? [] : [{status: r.hand.verdict}]))),
		missing: rows.filter((r) => r.stryker === "Missing").map((r) => r.key),
		rows,
	};
	saveResults({mutants: out});
	console.log(`overall, typecheck first: ${JSON.stringify(out.overall)}`);
	console.log(`Stryker alone: ${JSON.stringify(strykerOnly)}`);
	for (const f of folders) console.log(`  ${f}: ${JSON.stringify(perFolder[f])}`);
	console.log(`refused by tsc but lived in Stryker: ${refusedButLived.length}`);
	console.log(`out of Stryker's sight: ${JSON.stringify(out.outOfSight)}`);
	console.log(`hand check: ${JSON.stringify(out.hand)}`);
	console.log(`missing from Stryker's report: ${out.missing.length}`);
	for (const r of rows.filter((x) => x.status === "Survived" || x.status === "NoCoverage"))
		console.log(
			`${r.status === "Survived" ? "S" : "N"} ${r.folder} ${r.file}:${r.line} ${r.mutator}: ${JSON.stringify(r.original)} -> ${JSON.stringify(r.replacement)}${r.outOfSight ? " (out of sight)" : ""}`,
		);
}

// ----------------------------------------------------------------

const step = process.argv[2] ?? "";
if (step === "contract") contract();
else if (step === "setup") setup();
else if (step === "sample") await sample();
else if (step === "typecheck") typecheck();
else if (step === "prime") prime();
else if (step === "run") strykerRun();
else if (step === "report") report();
else if (step === "wider") wider();
else console.log("steps: contract | setup | sample | typecheck | prime | run | report | wider");
