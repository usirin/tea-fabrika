// Experiment 181: how mutation testing splits into a fast check per pull request and a daily run.
// Today's version: packages/pipeline/src/stages/mutation/. No model, no key, no spend.
//
// Every command reads a folder and writes one JSON file under OUT (default: a temp folder).
//
//   node experiments/181-fast-and-daily-mutation.ts count <folder>
//     every mutant of the whole codebase, instrumented and never run; per area and per mutator
//   node experiments/181-fast-and-daily-mutation.ts prs <n>
//     the last <n> merged pull requests: changed source lines -> mutants, at their own merge commit
//   node experiments/181-fast-and-daily-mutation.ts pick <folder> <setName> <file>...
//     a fixed sample of leaf mutants (the seed is 181), and the Stryker `mutate` ranges for it
//   node experiments/181-fast-and-daily-mutation.ts batch <folder> <mutants.json> <tsc args...>
//     typecheck many mutants at once and split the group when an error cannot be pinned
//   node experiments/181-fast-and-daily-mutation.ts replay <report.json>
//     what each policy would have cost and missed, from one real Stryker report
//   node experiments/181-fast-and-daily-mutation.ts sets <copy>
//     the planted bugs of 121 and 139 in today's code, and every mutant of one small file
//   node experiments/181-fast-and-daily-mutation.ts run <copy> <set> <arm>
//     one real Stryker run on a throwaway copy; arm `today` or `fast...`
//   node experiments/181-fast-and-daily-mutation.ts compare <set> [armA] [armB]
//     two arms, mutant by mutant, against the old labels
//
// `experiments/` is outside the typecheck. Run with nice -n 15 or 19, and the API keys unset.

import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT ?? mkdtempSync(join(tmpdir(), "exp181-"));
const SEED = 181;

const pipelineRequire = createRequire(join(ROOT, "packages/pipeline/package.json"));
const instrumenterPath = pipelineRequire.resolve("@stryker-mutator/instrumenter");
const {Instrumenter} = await import(instrumenterPath);
const {shouldIgnore} = await import(join(ROOT, "packages/pipeline/src/stages/mutation/ignorer.ts"));

const quiet = () => {};
const logger = Object.fromEntries(
	["trace", "debug", "info", "warn", "error", "fatal"].map((k) => [k, quiet]),
);
for (const k of ["Trace", "Debug", "Info", "Warn", "Error", "Fatal"])
	logger[`is${k}Enabled`] = () => false;

const OPTIONS = {plugins: null, excludedMutations: [], ignorers: [{shouldIgnore}]};

/** Lines and columns from 0, as the instrumenter gives them. */
type Made = {
	fileName: string;
	mutatorName: string;
	replacement: string;
	status?: string;
	location: {start: {line: number; column: number}; end: {line: number; column: number}};
};

const isSource = (path: string) =>
	/\.[cm]?[jt]sx?$/.test(path) &&
	!/\.(test|spec|laws\.test)\.[cm]?[jt]sx?$/.test(path) &&
	!/\.d\.[cm]?ts$/.test(path);

/** Whole files, all lines, as the instrumenter takes them. */
const instrument = async (
	files: ReadonlyArray<{name: string; content: string; mutate?: unknown}>,
): Promise<Made[]> => {
	const out = await new Instrumenter(logger).instrument(
		files.map((f) => ({name: f.name, content: f.content, mutate: f.mutate ?? true})),
		OPTIONS,
	);
	return out.mutants;
};

/** A mutant whose range holds another mutant's range. Asking Stryker for it pulls the inner one in. */
const holds = (a: Made, b: Made) => {
	if (a === b || a.fileName !== b.fileName) return false;
	const s = a.location.start,
		e = a.location.end,
		t = b.location.start,
		u = b.location.end;
	const startsIn = s.line < t.line || (s.line === t.line && s.column <= t.column);
	const endsIn = e.line > u.line || (e.line === u.line && e.column >= u.column);
	return (
		startsIn &&
		endsIn &&
		!(s.line === t.line && s.column === t.column && e.line === u.line && e.column === u.column)
	);
};

/** The mutants with no other mutant inside their range. O(n log n) per file is not needed at this size. */
const leavesIn = (mutants: readonly Made[]) => {
	const byFile = Map.groupBy(mutants, (m) => m.fileName);
	return [...byFile.values()].flatMap((list) => list.filter((a) => !list.some((b) => holds(a, b))));
};

const walk = (dir: string, out: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist" || name === ".git" || name === "docs") continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (isSource(p)) out.push(p);
	}
	return out;
};

/** The areas of the whole codebase; the rest of the repo (experiments, fixtures, blog) is no product code. */
const AREAS = ["packages", "programs", "apps", "packs", "wip", "legacy", "oxlint-plugins", "next"];

const count = async (folder: string) => {
	const started = Date.now();
	const rows: Array<{
		area: string;
		file: string;
		mutants: number;
		ignored: number;
		leaves: number;
		lines: number;
		mutatedLines: number;
		byMutator: Record<string, number>;
	}> = [];
	for (const area of AREAS) {
		const at = join(folder, area);
		if (!existsSync(at)) continue;
		for (const name of walk(at)) {
			const rel = relative(folder, name);
			if (!/\/src\//.test(rel) && area !== "oxlint-plugins") continue;
			const content = readFileSync(name, "utf8");
			let made: Made[];
			try {
				made = await instrument([{name, content}]);
			} catch {
				rows.push({
					area,
					file: rel,
					mutants: -1,
					ignored: 0,
					leaves: 0,
					lines: 0,
					mutatedLines: 0,
					byMutator: {},
				});
				continue;
			}
			const kept = made.filter((m) => m.status !== "Ignored");
			const byMutator: Record<string, number> = {};
			for (const m of kept) byMutator[m.mutatorName] = (byMutator[m.mutatorName] ?? 0) + 1;
			rows.push({
				area: rel.split("/").slice(0, 2).join("/"),
				file: rel,
				mutants: kept.length,
				ignored: made.length - kept.length,
				leaves: leavesIn(kept).length,
				lines: content.split("\n").length,
				mutatedLines: new Set(kept.map((m) => m.location.start.line)).size,
				byMutator,
			});
		}
	}
	const failed = rows.filter((r) => r.mutants < 0).map((r) => r.file);
	const ok = rows.filter((r) => r.mutants >= 0);
	const sum = (k: "mutants" | "leaves" | "lines" | "mutatedLines" | "ignored", xs = ok) =>
		xs.reduce((s, r) => s + r[k], 0);
	const areas = Map.groupBy(ok, (r) => r.area);
	const totalMutators: Record<string, number> = {};
	for (const r of ok)
		for (const [k, v] of Object.entries(r.byMutator))
			totalMutators[k] = (totalMutators[k] ?? 0) + v;
	const result = {
		files: ok.length,
		failed,
		mutants: sum("mutants"),
		ignored: sum("ignored"),
		leaves: sum("leaves"),
		lines: sum("lines"),
		mutatedLines: sum("mutatedLines"),
		areas: Object.fromEntries(
			[...areas]
				.map(([k, v]) => [
					k,
					{
						files: v.length,
						mutants: sum("mutants", v),
						leaves: sum("leaves", v),
						mutatedLines: sum("mutatedLines", v),
						lines: sum("lines", v),
					},
				])
				.sort((a, b) => (b[1] as {mutants: number}).mutants - (a[1] as {mutants: number}).mutants),
		),
		mutators: totalMutators,
		wallMs: Date.now() - started,
		top: [...ok]
			.sort((a, b) => b.mutants - a.mutants)
			.slice(0, 12)
			.map((r) => ({file: r.file, mutants: r.mutants})),
	};
	writeFileSync(join(OUT, "count.json"), JSON.stringify(result, null, 1));
	console.log(JSON.stringify(result, null, 1));
};

const git = (...args: string[]) =>
	execFileSync("git", args, {cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28});

/** The added lines of one merge, as spans per source file. */
const addedSpans = (commit: string) => {
	const diff = git("diff", "--unified=0", "--no-renames", `${commit}^`, commit);
	const spans = new Map<string, Array<{from: number; to: number}>>();
	let file: string | null = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const name = line.slice(4).replace(/^b\//, "");
			file =
				name !== "/dev/null" && isSource(name) && AREAS.includes(name.split("/")[0] ?? "")
					? name
					: null;
		}
		const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk !== null && file !== null) {
			const n = Number(hunk[2] ?? 1);
			if (n > 0)
				(spans.get(file) ?? spans.set(file, []).get(file))?.push({
					from: Number(hunk[1]),
					to: Number(hunk[1]) + n - 1,
				});
		}
	}
	return spans;
};

/** Per merged pull request on main: changed source lines, mutants on them, one per line, leaves. */
const prs = async (n: number) => {
	const merges = git("log", "origin/main", `-n${n}`, "--first-parent", "--format=%H %s")
		.trim()
		.split("\n");
	const rows = [];
	for (const row of merges) {
		const sha = row.slice(0, 40);
		const subject = row.slice(41);
		const pr = /\(#(\d+)\)$/.exec(subject)?.[1] ?? null;
		const spans = addedSpans(sha);
		const files = [];
		for (const [file, list] of spans) {
			let content: string;
			try {
				content = git("show", `${sha}:${file}`);
			} catch {
				continue;
			}
			files.push({
				name: join("/x", file),
				content,
				mutate: list.map((s) => ({
					start: {line: s.from - 1, column: 0},
					end: {line: s.to - 1, column: Number.MAX_SAFE_INTEGER},
				})),
			});
		}
		let made: Made[] = [];
		let broke = 0;
		for (const f of files) {
			try {
				made = made.concat(await instrument([f]));
			} catch {
				broke++;
			}
		}
		const kept = made.filter((m) => m.status !== "Ignored");
		const leaves = leavesIn(kept);
		const lines = [...spans.values()].flat().reduce((s, x) => s + x.to - x.from + 1, 0);
		const key = (m: Made) => `${m.fileName}:${m.location.start.line}`;
		rows.push({
			pr,
			subject: subject.slice(0, 60),
			files: spans.size,
			lines,
			mutants: kept.length,
			leaves: leaves.length,
			linesWithMutant: new Set(kept.map(key)).size,
			linesWithLeaf: new Set(leaves.map(key)).size,
			broke,
		});
	}
	writeFileSync(join(OUT, "prs.json"), JSON.stringify(rows, null, 1));
	console.log(JSON.stringify(rows.filter((r) => r.lines > 0)));
};

/** The same generator as the step's `sampleOf`: mulberry32 and a shuffle. */
const seeded = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};
const sample = <T>(items: readonly T[], seed: number, most: number): T[] => {
	const at = items.map((_, i) => i);
	const next = seeded(seed);
	for (let i = at.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[at[i], at[j]] = [at[j] as number, at[i] as number];
	}
	return at
		.slice(0, most)
		.sort((x, y) => x - y)
		.map((i) => items[i] as T);
};

/** Fixed sample, the mutate ranges for it, and how many mutants asking for those ranges pulls in. */
const pick = async (folder: string, name: string, files: readonly string[], most = 150) => {
	const read = files.map((f) => ({
		name: join(folder, f),
		content: readFileSync(join(folder, f), "utf8"),
	}));
	const made = (await instrument(read)).filter((m) => m.status !== "Ignored");
	const leaves = leavesIn(made);
	const allPick = sample(made, SEED, Math.min(most, made.length));
	const leafPick = sample(leaves, SEED, Math.min(most, leaves.length));
	const range = (m: Made) =>
		`${relative(folder, m.fileName)}:${m.location.start.line + 1}:${m.location.start.column}-${m.location.end.line + 1}:${m.location.end.column}`;
	const pulled = (list: readonly Made[]) =>
		made.filter((m) => list.some((p) => p === m || holds(p, m))).length;
	const json = (list: readonly Made[]) =>
		list.map((m) => ({
			file: relative(folder, m.fileName),
			line: m.location.start.line + 1,
			column: m.location.start.column + 1,
			end: {line: m.location.end.line + 1, column: m.location.end.column + 1},
			mutator: m.mutatorName,
			replacement: m.replacement,
		}));
	const summary = {
		name,
		made: made.length,
		leaves: leaves.length,
		allPick: allPick.length,
		pulledByAll: pulled(allPick),
		leafPick: leafPick.length,
		pulledByLeaf: pulled(leafPick),
	};
	writeFileSync(
		join(OUT, `pick-${name}.json`),
		JSON.stringify(
			{
				...summary,
				all: json(allPick),
				leaf: json(leafPick),
				everything: json(made),
				mutateAll: allPick.map(range),
				mutateLeaf: leafPick.map(range),
			},
			null,
			1,
		),
	);
	console.log(JSON.stringify(summary));
};

type Listed = {
	file: string;
	line: number;
	column: number;
	end: {line: number; column: number};
	mutator: string;
	replacement: string;
};

const offsetOf = (text: string, at: {line: number; column: number}) => {
	let off = 0;
	for (let l = 1; l < at.line; l++) off = text.indexOf("\n", off) + 1;
	return off + at.column - 1;
};

/** `text` with these mutants in, last first so earlier offsets hold. They must not overlap. */
const withAll = (text: string, list: readonly Listed[]) => {
	const sorted = [...list].sort((a, b) => offsetOf(text, b) - offsetOf(text, a));
	let out = text;
	for (const m of sorted) {
		const put = m.mutator === "LogicalOperator" ? `(${m.replacement})` : m.replacement;
		out = out.slice(0, offsetOf(text, m)) + put + out.slice(offsetOf(text, m.end));
	}
	return out;
};

const overlap = (a: Listed, b: Listed) =>
	a.file === b.file &&
	!(
		a.end.line < b.line ||
		(a.end.line === b.line && a.end.column <= b.column) ||
		b.end.line < a.line ||
		(b.end.line === a.line && b.end.column <= a.column)
	);

/**
 * Typecheck many mutants in as few runs as it can. Groups of mutants that do not overlap go in
 * together. An error on a mutant's own line rejects that mutant. An error on no mutant's line
 * cannot be pinned, so the group splits in two and each half runs again. Alone, a mutant is
 * rejected by any new error at all. SINGLE=1 runs one per mutant, the control.
 * Measured wrong: on `whole` the batch and the control differed on 21 of 139 mutants, since a
 * mutant's type change can show up as an error on another mutant's line. Only "no error at all,
 * accept the group" is safe.
 */
const batch = (folder: string, listFile: string, command: readonly string[]) => {
	const data = JSON.parse(readFileSync(listFile, "utf8"));
	const list: Listed[] = Array.isArray(data) ? data : data.leaf;
	const originals = new Map(
		[...new Set(list.map((m) => m.file))].map((f) => [f, readFileSync(join(folder, f), "utf8")]),
	);
	let runs = 0;
	let ms = 0;
	const check = (group: readonly Listed[]) => {
		const files = Map.groupBy(group, (m) => m.file);
		for (const [f, ms2] of files)
			writeFileSync(join(folder, f), withAll(originals.get(f) as string, ms2));
		const t = Date.now();
		const r = spawnSync(command[0] as string, command.slice(1), {
			cwd: folder,
			encoding: "utf8",
			maxBuffer: 1 << 28,
		});
		ms += Date.now() - t;
		runs++;
		for (const f of files.keys()) writeFileSync(join(folder, f), originals.get(f) as string);
		const errors: Array<{file: string; line: number}> = [];
		for (const l of (r.stdout + r.stderr).split("\n")) {
			const e = /^(.+?)\((\d+),\d+\): error /.exec(l);
			if (e !== null) errors.push({file: e[1] as string, line: Number(e[2])});
		}
		return {errors, code: r.status};
	};
	// The base must be clean, or nothing can be read.
	const base = check([]);
	if (base.errors.length > 0 || base.code !== 0)
		throw new Error(`the base is not clean: ${JSON.stringify(base).slice(0, 400)}`);
	const rejected = new Set<Listed>();
	const accepted = new Set<Listed>();
	const go = (group: readonly Listed[]): void => {
		if (group.length === 0) return;
		const {errors} = check(group);
		if (errors.length === 0) {
			for (const m of group) accepted.add(m);
			return;
		}
		if (group.length === 1) {
			rejected.add(group[0] as Listed);
			return;
		}
		const hit = group.filter((m) =>
			errors.some((e) => folderFile(e.file, m.file) && e.line >= m.line && e.line <= m.end.line),
		);
		const unpinned = errors.filter(
			(e) =>
				!group.some((m) => folderFile(e.file, m.file) && e.line >= m.line && e.line <= m.end.line),
		);
		for (const m of hit) rejected.add(m);
		const rest = group.filter((m) => !hit.includes(m));
		if (rest.length === 0) return;
		if (unpinned.length === 0) {
			// Every error was pinned: the rest may have been hidden by nothing else in those lines.
			go(rest);
			return;
		}
		const mid = Math.floor(rest.length / 2);
		go(rest.slice(0, mid));
		go(rest.slice(mid));
	};
	const folderFile = (reported: string, file: string) =>
		reported.endsWith(file) || file.endsWith(reported.replace(/^(\.\.\/)+/, ""));
	// Non-overlapping groups, in order.
	const groups: Listed[][] = [];
	for (const m of list) {
		// SINGLE=1 is the control: one run per mutant, the answer batching must match.
		const g = process.env.SINGLE ? undefined : groups.find((x) => !x.some((y) => overlap(y, m)));
		if (g === undefined) groups.push([m]);
		else g.push(m);
	}
	for (const g of groups) go(g);
	const id = (m: Listed) => `${m.file}:${m.line}:${m.column}:${m.mutator}:${m.replacement}`;
	const result = {
		mutants: list.length,
		groups: groups.length,
		runs,
		ms,
		rejected: rejected.size,
		accepted: accepted.size,
		rejectedIds: [...rejected].map(id),
		acceptedIds: [...accepted].map(id),
	};
	const name = `batch-${process.env.SINGLE ? "single-" : ""}${listFile.split("/").at(-1)}`;
	writeFileSync(join(OUT, name), JSON.stringify(result, null, 1));
	const {rejectedIds: _r, acceptedIds: _a, ...small} = result;
	console.log(JSON.stringify(small));
};

/**
 * What each policy would have cost and missed, from one real Stryker report: no test runs.
 * `uncaught`: a line where some mutant lived. One-per-line is drawn 200 times, as the seed decides
 * which mutant stands for a line, and reports the mean.
 */
const replay = (reportFile: string) => {
	const report = JSON.parse(readFileSync(reportFile, "utf8"));
	type Row = {
		file: string;
		line: number;
		status: string;
		ms: number;
		static: boolean;
		leaf: boolean;
		mutator: string;
	};
	const rows: Row[] = [];
	for (const [file, entry] of Object.entries(report.files) as Array<
		[
			string,
			{
				mutants: Array<{
					status: string;
					duration?: number;
					static?: boolean;
					mutatorName: string;
					location: {start: {line: number; column: number}; end: {line: number; column: number}};
				}>;
			},
		]
	>) {
		const list = entry.mutants.filter((m) => m.status !== "Ignored");
		const asMade = (m: (typeof list)[number]) =>
			({fileName: file, mutatorName: m.mutatorName, replacement: "", location: m.location}) as Made;
		for (const m of list) {
			const me = asMade(m);
			rows.push({
				file,
				line: m.location.start.line,
				status: m.status,
				ms: m.duration ?? 0,
				static: m.static === true,
				mutator: m.mutatorName,
				leaf: !list.some((o) => o !== m && holds(me, asMade(o))),
			});
		}
	}
	const LIVE = new Set(["Survived", "NoCoverage"]);
	const lineKey = (r: Row) => `${r.file}:${r.line}`;
	const seconds = (xs: readonly Row[]) => Math.round(xs.reduce((s, r) => s + r.ms, 0) / 1000);
	const uncaughtLines = new Set(rows.filter((r) => LIVE.has(r.status)).map(lineKey));
	const measure = (xs: readonly Row[]) => {
		const seen = new Set(xs.filter((r) => LIVE.has(r.status)).map(lineKey));
		return {
			mutants: xs.length,
			sumSeconds: seconds(xs),
			survivors: xs.filter((r) => LIVE.has(r.status)).length,
			uncaughtLines: seen.size,
			ofUncaughtLines: uncaughtLines.size,
		};
	};
	const onePerLine = (pool: readonly Row[], seed: number) => {
		const next = seeded(seed);
		const lines = Map.groupBy(pool, lineKey);
		return [...lines.values()].map((list) => list[Math.floor(next() * list.length)] as Row);
	};
	const mean = (make: (seed: number) => readonly Row[]) => {
		const runs = Array.from({length: 200}, (_, i) => measure(make(SEED + i)));
		const avg = (k: "mutants" | "sumSeconds" | "survivors" | "uncaughtLines") =>
			Math.round((runs.reduce((s, r) => s + r[k], 0) / runs.length) * 10) / 10;
		return {
			mutants: avg("mutants"),
			sumSeconds: avg("sumSeconds"),
			survivors: avg("survivors"),
			uncaughtLines: avg("uncaughtLines"),
			ofUncaughtLines: uncaughtLines.size,
		};
	};
	const hung = rows.filter((r) => r.status === "Killed" && r.ms >= 50_000);
	const noHang = (xs: readonly Row[]) =>
		xs.map((r) => (r.status === "Killed" && r.ms >= 50_000 ? {...r, ms: 10_000} : r));
	const dynamic = rows.filter((r) => !r.static);
	const result = {
		all: measure(rows),
		byStatus: Object.fromEntries(
			[...Map.groupBy(rows, (r) => `${r.static ? "static" : "normal"}:${r.status}`)].map(
				([k, v]) => [k, {n: v.length, seconds: seconds(v)}],
			),
		),
		hungAtTheLimit: {n: hung.length, seconds: seconds(hung)},
		withShortTestLimit: measure(noHang(rows)),
		noStatic: measure(dynamic),
		noStaticShortLimit: measure(noHang(dynamic)),
		onePerLine: mean((seed) => onePerLine(rows, seed)),
		onePerLineLeafNoStatic: mean((seed) =>
			noHang(
				onePerLine(
					dynamic.filter((r) => r.leaf),
					seed,
				),
			),
		),
		leafNoStatic: measure(noHang(dynamic.filter((r) => r.leaf))),
	};
	console.log(JSON.stringify(result, null, 1));
};

// The Stryker tryouts. They run in place, so <copy> is a throwaway copy of the repo with its own
// node_modules (git archive, then pnpm install), and never this checkout.

const norm = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
type Set181 = Listed & {
	from: string;
	id?: string;
	kind119?: string;
	caught121?: {stryker?: string} | null;
	killedBy?: string[];
};

/**
 * The planted bugs of 121 and 139, found again in today's code. Lines moved since, so a mutant
 * matches on file, mutator, original text and replacement, and the nearest line wins.
 * `whole` is every mutant of one small file, so one-per-line can be measured exactly.
 */
const sets = async (copy: string) => {
	const text = (f: string) => readFileSync(join(copy, f), "utf8");
	const offset = (t: string, at: {line: number; column: number}) => {
		let o = 0;
		for (let l = 0; l < at.line; l++) o = t.indexOf("\n", o) + 1;
		return o + at.column;
	};
	const listed = async (files: readonly string[], ignored = true) =>
		(await instrument(files.map((f) => ({name: join(copy, f), content: text(f)}))))
			.filter((m) => ignored || m.status !== "Ignored")
			.map((m): Set181 => {
				const file = relative(copy, m.fileName);
				const {start, end} = m.location;
				return {
					file,
					line: start.line + 1,
					column: start.column + 1,
					end: {line: end.line + 1, column: end.column + 1},
					mutator: m.mutatorName,
					replacement: m.replacement,
					from: text(file).slice(offset(text(file), start), offset(text(file), end)),
				};
			});
	const match = (
		pool: readonly Set181[],
		want: {file: string; mutator: string; to: string; from: string; line: number},
		used: Set<Set181>,
	) =>
		pool
			.filter(
				(m) =>
					!used.has(m) &&
					m.file === want.file &&
					m.mutator === want.mutator &&
					norm(m.replacement) === norm(want.to) &&
					norm(m.from) === norm(want.from),
			)
			.sort((a, b) => Math.abs(a.line - want.line) - Math.abs(b.line - want.line))[0];
	const saved = (name: string) =>
		JSON.parse(readFileSync(join(copy, "experiments/results", name), "utf8"));
	const j119 = saved("119-mutation-testing.json");
	const j121 = saved("121-ship-on-tea-pbt.json");
	const j139 = saved("139-tla-trace-validation.json");
	const by = new Map(j119.mutants.map((x: {id: string}) => [x.id, x]));
	const run2 = new Map((j121.run2.mutants as Array<{id: string}>).map((m) => [m.id, m]));
	const ship = await listed(j121.files);
	const used = new Set<Set181>();
	const set121 = (j121.sample as string[]).flatMap((id) => {
		const w = by.get(id) as {
			file: string;
			mutator: string;
			to: string;
			from: string;
			line: number;
			kind: string;
		};
		const f = match(ship, w, used);
		if (f === undefined) return [];
		used.add(f);
		return [{...f, id, kind119: w.kind, caught121: run2.get(id) ?? null}];
	});
	writeFileSync(join(OUT, "set-ship121.json"), JSON.stringify(set121, null, 1));
	const lane = await listed([
		"packages/pipeline/src/hosted/lane.ts",
		"packages/pipeline/src/stages/lane/machine.ts",
	]);
	const used2 = new Set<Set181>();
	const set139 = (
		j139.mutants.mutants as Array<{key: string; original: string; id: string; killedBy: string[]}>
	).flatMap((m) => {
		const k = /^(.+?)@(\d+):\d+-\d+:\d+ (\w+) ([\s\S]*)$/.exec(m.key) as RegExpExecArray;
		const f = match(
			lane,
			{
				file: k[1] as string,
				line: Number(k[2]),
				mutator: k[3] as string,
				to: k[4] as string,
				from: m.original,
			},
			used2,
		);
		if (f === undefined) return [];
		used2.add(f);
		return [{...f, id: m.id, killedBy: m.killedBy}];
	});
	writeFileSync(join(OUT, "set-lane139.json"), JSON.stringify(set139, null, 1));
	const whole = await listed(["packages/pipeline/src/stages/mutation/scope.ts"], false);
	writeFileSync(join(OUT, "set-whole.json"), JSON.stringify(whole, null, 1));
	console.log(
		JSON.stringify({ship121: set121.length, lane139: set139.length, whole: whole.length}),
	);
};

/** A Stryker plugin: the arid rule, plus "not picked is ignored unless a picked mutant is under it". */
const IGNORER = `import {readFileSync} from "node:fs";
const arid = (await import(process.env.ARID)).shouldIgnore;
const picked = JSON.parse(readFileSync(process.env.PICKS, "utf8")).map((m) => ({file: m.file, start: {line: m.line, column: m.column - 1}, end: {line: m.end.line, column: m.end.column - 1}}));
const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
function shouldIgnore(path) {
	const a = arid(path);
	if (a !== undefined) return a;
	if (process.env.NOPICK) return undefined;
	const loc = path.node.loc;
	if (!loc) return undefined;
	const name = path.hub?.file?.opts?.filename;
	const here = name === undefined ? picked : picked.filter((m) => process.env.FOLDER + "/" + m.file === name);
	return here.some((m) => before(loc.start, m.start) && before(m.end, loc.end)) ? undefined : "sampled: not picked";
}
export const strykerPlugins = [{kind: "Ignore", name: "sampled", value: {shouldIgnore}}];
`;

/** A Stryker plugin: each answer as it comes, so a stopped run keeps what it learned. */
const STREAM = `import {appendFileSync} from "node:fs";
class Stream {
	static inject = [];
	onMutantTested(m) {
		appendFileSync(process.env.STREAM, JSON.stringify({id: m.id, status: m.status, ms: m.duration, line: m.location?.start?.line, mutator: m.mutatorName, at: Date.now()}) + "\\n");
	}
}
export const strykerPlugins = [{kind: "Reporter", name: "stream", injectableClass: Stream}];
`;

/** Left out of both arms: they start nested runs, or fail under Stryker in the copy before any mutant. */
const LEFT_OUT = [
	"packages/pipeline/src/stages/pipeline/program.test.ts",
	"packages/pipeline/src/stages/mutation/stryker.test.ts",
	"packages/pipeline/src/stages/mutation/stryker.start.test.ts",
	"packages/pipeline/src/stages/pipeline/github.test.ts",
];

/**
 * One arm on one set. `today`: per-test coverage, 60 s over each mutant and each test, as the step.
 * `fast...`: static mutants ignored, Stryker's default 5 s, 10 s per test. EXTRA is JSON merged into
 * the config, for the `incremental` runs; STREAM=<file> keeps each answer as it comes.
 */
const run = (copy: string, set: string, arm: string) => {
	const fast = arm.startsWith("fast");
	const stryker = join(copy, "packages/pipeline/node_modules/@stryker-mutator");
	const picks = join(OUT, `set-${set}.json`);
	const list: Listed[] = JSON.parse(readFileSync(picks, "utf8"));
	const report = join(OUT, `report-${set}-${arm}.json`);
	const vitest = `vitest.exp181.${arm}.config.ts`;
	writeFileSync(
		join(copy, vitest),
		`import base from "./vitest.config.ts";
import {mergeConfig, defineConfig} from "vitest/config";
export default mergeConfig(base, defineConfig({test: {exclude: [...(base.test?.exclude ?? []), "**/node_modules/**", "**/dist/**", ${LEFT_OUT.map((s) => JSON.stringify(s)).join(", ")}], ${fast ? "testTimeout: 10_000, hookTimeout: 10_000" : ""}}}));
`,
	);
	writeFileSync(join(OUT, "ignorer.mjs"), IGNORER);
	writeFileSync(join(OUT, "stream.mjs"), STREAM);
	writeFileSync(join(OUT, "no-tsconfig.json"), "{}");
	const config = {
		testRunner: "vitest",
		vitest: {configFile: vitest},
		plugins: [
			join(stryker, "vitest-runner/dist/src/index.js"),
			join(OUT, "ignorer.mjs"),
			...(process.env.STREAM ? [join(OUT, "stream.mjs")] : []),
		],
		ignorers: ["sampled"],
		coverageAnalysis: "perTest",
		mutate: [
			...new Set(
				list.map((m) => `${m.file}:${m.line}:${m.column - 1}-${m.end.line}:${m.end.column - 1}`),
			),
		],
		inPlace: true,
		concurrency: 2,
		reporters: ["json", "progress-append-only", ...(process.env.STREAM ? ["stream"] : [])],
		jsonReporter: {fileName: report},
		tempDirName: join(OUT, `tmp-${set}-${arm}`),
		tsconfigFile: join(OUT, "no-tsconfig.json"),
		timeoutMS: fast ? 5000 : 60_000,
		disableTypeChecks: false,
		...(fast ? {ignoreStatic: true} : {}),
		...JSON.parse(process.env.EXTRA ?? "{}"),
	};
	const file = join(OUT, `stryker-${set}-${arm}.json`);
	writeFileSync(file, JSON.stringify(config, null, 1));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PICKS: picks,
		FOLDER: copy,
		ARID: join(copy, "packages/pipeline/src/stages/mutation/ignorer.ts"),
	};
	const started = Date.now();
	spawnSync("nice", ["-n", "19", "node", join(stryker, "core/bin/stryker.js"), "run", file], {
		cwd: copy,
		env,
		stdio: "ignore",
	});
	console.log(
		JSON.stringify({set, arm, wallSeconds: Math.round((Date.now() - started) / 1000), report}),
	);
};

/** Two arms on one set, mutant by mutant, and each against the old labels of 119, 121 and 139. */
const compare = (set: string, armA = "today", armB = "fast") => {
	const list: Set181[] = JSON.parse(readFileSync(join(OUT, `set-${set}.json`), "utf8"));
	const key = (f: string, l: number, c: number, m: string, r: string) => `${f}:${l}:${c}:${m}:${r}`;
	type Answer = {status: string; static?: boolean; duration?: number};
	const load = (arm: string) => {
		const r = JSON.parse(readFileSync(join(OUT, `report-${set}-${arm}.json`), "utf8"));
		const out = new Map<string, Answer>();
		for (const [f, e] of Object.entries(r.files) as Array<
			[
				string,
				{
					mutants: Array<
						Answer & {
							location: {start: {line: number; column: number}};
							mutatorName: string;
							replacement: string;
						}
					>;
				},
			]
		>)
			for (const m of e.mutants)
				out.set(
					key(
						f.replace(/^.*?(?=(packages|programs|apps)\/)/, ""),
						m.location.start.line,
						m.location.start.column,
						m.mutatorName,
						m.replacement,
					),
					m,
				);
		return out;
	};
	const a = load(armA);
	const b = load(armB);
	const group = (s?: string) =>
		s === "Killed" || s === "Timeout" || s === "RuntimeError"
			? "caught"
			: s === "Survived" || s === "NoCoverage"
				? "lives"
				: s === "Ignored"
					? "ignored"
					: (s ?? "missing");
	const moves: Record<string, number> = {};
	const labels: Record<string, Record<string, number>> = {};
	for (const m of list) {
		const k = key(m.file, m.line, m.column, m.mutator, m.replacement);
		const move = `${group(a.get(k)?.status)}->${group(b.get(k)?.status)}`;
		moves[move] = (moves[move] ?? 0) + 1;
		const label =
			m.kind119 !== undefined
				? `119:${m.kind119}|121:${m.caught121?.stryker ?? "?"}`
				: m.killedBy !== undefined
					? `139:${m.killedBy.includes("tests") ? "tests" : m.killedBy.length > 0 ? "other" : "nothing"}`
					: "none";
		const row = (labels[label] ??= {});
		row[move] = (row[move] ?? 0) + 1;
	}
	console.log(JSON.stringify({set, size: list.length, moves, labels}, null, 1));
};

const [command, ...args] = process.argv.slice(2);
if (command === "sets") await sets(args[0] as string);
else if (command === "run") run(args[0] as string, args[1] as string, args[2] as string);
else if (command === "compare") compare(args[0] as string, args[1], args[2]);
else if (command === "count") await count(args[0] ?? ROOT);
else if (command === "prs") await prs(Number(args[0] ?? 40));
else if (command === "pick") await pick(args[0] as string, args[1] as string, args.slice(2));
else if (command === "batch") batch(args[0] as string, args[1] as string, args.slice(2));
else if (command === "replay") replay(args[0] as string);
else
	console.log(
		"replay <report.json> | count <folder> | prs <n> | pick <folder> <name> <file>... | batch <folder> <list.json> <typecheck...>",
	);
