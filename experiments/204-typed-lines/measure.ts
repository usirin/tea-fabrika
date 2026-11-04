// Experiment 204's numbers: how long the compiler takes to check 1, 10 and 100 literal lines, how
// many type instantiations that costs, and the longest line before it gives up.
//
//   nice -n 19 node experiments/204-typed-lines/measure.ts
//   TS6=<an unpacked typescript@6.0.3>/bin/tsc RUNS=3 nice -n 19 node experiments/204-typed-lines/measure.ts
//
// It copies the sketch into a temp folder, writes a file of `open` calls there, and runs each
// compiler on it with `--extendedDiagnostics`, one at a time. No network, no model, $0. Writes
// experiments/results/204-typed-lines.json.

import {spawnSync} from "node:child_process";
import {cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const runs = Number(process.env.RUNS ?? "3");

/** The compilers: the repo's TypeScript 7 (patched by @effect/tsgo), the tsgo preview, and TypeScript 6 when given. */
interface Compiler {
	readonly name: string;
	readonly command: string;
	readonly args: string[];
}

function compilers(): Compiler[] {
	const pnpm = join(root, "node_modules", ".pnpm");
	const preview = readdirSync(pnpm).find((d) => d.startsWith("@typescript+native-preview@"));
	const list: Compiler[] = [
		{name: "tsc 7.0.2", command: join(root, "node_modules", ".bin", "tsc"), args: []},
	];
	if (preview !== undefined)
		list.push({
			name: `tsgo ${preview.split("@")[2] ?? "?"}`,
			command: join(pnpm, preview, "node_modules", "@typescript", "native-preview", "bin", "tsgo"),
			args: [],
		});
	if (process.env.TS6 !== undefined)
		list.push({name: "tsc 6.0.3", command: process.execPath, args: [process.env.TS6]});
	return list;
}

function setUp(): string {
	const dir = mkdtempSync(join(tmpdir(), "exp204-"));
	for (const f of ["register.ts", "schemas.ts", "line.ts", "open.ts"])
		cpSync(join(here, f), join(dir, f));
	cpSync(join(here, "programs"), join(dir, "programs"), {recursive: true});
	symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2023",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				allowImportingTsExtensions: true,
				types: [],
			},
			include: ["*.ts", "programs/*.ts"],
		}),
	);
	return dir;
}

/** n different lines, so the compiler can cache none of them. */
const lines = (n: number): string[] =>
	Array.from({length: n}, (_, i) =>
		i % 3 === 0
			? `ticket --ticket ${i + 1} | ticket`
			: i % 3 === 1
				? `asks --ask a-approve-${i} | ticket`
				: `tracker | ticket --ticket ${i + 1} | ticket`,
	);

const callsFile = (all: readonly string[]): string =>
	[
		'import {open} from "./open.ts";',
		'const via = {_tag: "key", keys: "enter"} as const;',
		"export const calls = [",
		...all.map((l) => `\topen({line: ${JSON.stringify(l)}, from: "t1", via}),`),
		"];",
		"",
	].join("\n");

interface Ran {
	readonly ok: boolean;
	readonly ms: number;
	readonly instantiations: number | null;
	readonly checkMs: number | null;
	readonly memoryKb: number | null;
	readonly codes: string[];
}

function run(c: {command: string; args: string[]}, dir: string): Ran {
	const start = performance.now();
	const out = spawnSync(c.command, [...c.args, "-p", dir, "--extendedDiagnostics"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const ms = performance.now() - start;
	const text = `${out.stdout}${out.stderr}`;
	const num = (re: RegExp): number | null => {
		const m = re.exec(text);
		return m?.[1] === undefined ? null : Number(m[1].replaceAll(",", ""));
	};
	const check = num(/Check time:\s+([\d.]+)s/);
	return {
		ok: out.status === 0,
		ms: Math.round(ms),
		instantiations: num(/Instantiations:\s+([\d,]+)/),
		checkMs: check === null ? null : Math.round(check * 1000),
		memoryKb: num(/Memory used:\s+([\d,]+)K/),
		codes: [...new Set([...text.matchAll(/error (TS\d+)/g)].map((m) => m[1] ?? ""))],
	};
}

const median = (xs: number[]): number =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** A line of k stages, each `ticket >ticket <ticket`: three words a stage, every pipe checked. */
const long = (k: number): string =>
	Array.from({length: k}, (_, i) => (i === 0 ? "ticket >ticket" : "ticket <ticket >ticket")).join(
		" | ",
	);

function deepest(c: {command: string; args: string[]}, dir: string) {
	const ok = (k: number) => {
		writeFileSync(join(dir, "calls.ts"), callsFile([long(k)]));
		return run(c, dir);
	};
	let good = 1;
	let bad = 0;
	let codes: string[] = [];
	for (let k = 16; k <= 4096; k *= 2) {
		const r = ok(k);
		if (!r.ok) {
			bad = k;
			codes = r.codes;
			break;
		}
		good = k;
	}
	if (bad === 0) return {stages: good, words: 0, chars: long(good).length, codes, capped: true};
	while (bad - good > 1) {
		const mid = Math.floor((good + bad) / 2);
		const r = ok(mid);
		if (r.ok) good = mid;
		else {
			bad = mid;
			codes = r.codes;
		}
	}
	const text = long(good);
	return {stages: good, words: text.split(" ").length, chars: text.length, codes};
}

const dir = setUp();
const results = [];
try {
	for (const c of compilers()) {
		const sizes = [];
		for (const n of [0, 1, 10, 100]) {
			writeFileSync(join(dir, "calls.ts"), callsFile(lines(n)));
			const all = Array.from({length: runs}, () => run(c, dir));
			const first = all[0];
			sizes.push({
				lines: n,
				ok: all.every((r) => r.ok),
				wallMs: median(all.map((r) => r.ms)),
				checkMs: median(all.map((r) => r.checkMs ?? 0)),
				instantiations: first?.instantiations ?? null,
				memoryKb: first?.memoryKb ?? null,
			});
		}
		const depth = deepest(c, dir);
		results.push({compiler: c.name, sizes, depth});
		console.log(JSON.stringify({compiler: c.name, sizes, depth}));
	}
} finally {
	rmSync(dir, {recursive: true, force: true});
}
writeFileSync(
	join(root, "experiments", "results", "204-typed-lines.json"),
	`${JSON.stringify({at: new Date().toISOString(), runs, results}, null, "\t")}\n`,
);
