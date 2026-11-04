// Experiment 208's numbers, in three parts:
//
//   agree   the generated lines, read by 204's two readers and by 208's: on how many does the
//           compiler give a different answer from the run-time reader?
//   cost    204's method, on both sketches side by side: 0, 1, 10 and 100 literal lines, type
//           instantiations and check time, the median of RUNS runs.
//   depth   the longest line 208's compiler reads, without flags as 204 measured it, and with a
//           15-digit ticket on every stage.
//
//   nice -n 19 node experiments/208-typed-line-gaps/measure.ts
//   RUNS=3 nice -n 19 node experiments/208-typed-line-gaps/measure.ts
//
// It copies each sketch into a temp folder, writes a file there, and runs each compiler on it with
// `--extendedDiagnostics`, one at a time. No network, no model, $0. Writes
// experiments/results/208-typed-line-gaps.json.

import {spawnSync} from "node:child_process";
import {cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {read as read204} from "../204-typed-lines/parse.ts";
import {asks as asks204} from "../204-typed-lines/programs/asks.ts";
import {probe as probe204} from "../204-typed-lines/programs/probe.ts";
import {ticket as ticket204} from "../204-typed-lines/programs/ticket.ts";
import {tracker as tracker204} from "../204-typed-lines/programs/tracker.ts";
import {programs} from "./desk.ts";
import {generated} from "./generated.ts";
import {read} from "./parse.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const runs = Number(process.env.RUNS ?? "3");

/** The two sketches: where each lives, and its run-time reader with its own programs. */
const sketches = [
	{
		name: "204",
		dir: join(here, "..", "204-typed-lines"),
		files: ["register.ts", "schemas.ts", "line.ts", "open.ts"],
		answer: (line: string) => {
			const got = read204(line, {
				asks: asks204,
				ticket: ticket204,
				tracker: tracker204,
				probe: probe204,
			});
			return got._tag === "line" ? "ok" : got.why;
		},
	},
	{
		name: "208",
		dir: here,
		files: ["register.ts", "schemas.ts", "spelling.ts", "line.ts", "open.ts"],
		answer: (line: string) => {
			const got = read(line, programs);
			return got._tag === "line" ? "ok" : got.why;
		},
	},
];
type Sketch = (typeof sketches)[number];

interface Compiler {
	readonly name: string;
	readonly command: string;
}

/** The repo's TypeScript 7 (patched by @effect/tsgo), and the tsgo preview. */
function compilers(): Compiler[] {
	const pnpm = join(root, "node_modules", ".pnpm");
	const preview = readdirSync(pnpm).find((d) => d.startsWith("@typescript+native-preview@"));
	const list: Compiler[] = [
		{name: "tsc 7.0.2", command: join(root, "node_modules", ".bin", "tsc")},
	];
	if (preview !== undefined)
		list.push({
			name: `tsgo ${preview.split("@")[2] ?? "?"}`,
			command: join(pnpm, preview, "node_modules", "@typescript", "native-preview", "bin", "tsgo"),
		});
	return list;
}

function setUp(s: Sketch): string {
	const dir = mkdtempSync(join(tmpdir(), `exp208-${s.name}-`));
	for (const f of s.files) cpSync(join(s.dir, f), join(dir, f));
	cpSync(join(s.dir, "programs"), join(dir, "programs"), {recursive: true});
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
				noErrorTruncation: true,
				types: [],
			},
			include: ["*.ts", "programs/*.ts"],
		}),
	);
	return dir;
}

interface Ran {
	readonly ok: boolean;
	readonly ms: number;
	readonly instantiations: number | null;
	readonly checkMs: number | null;
	readonly memoryKb: number | null;
	readonly text: string;
}

function run(c: Compiler, dir: string): Ran {
	const start = performance.now();
	const out = spawnSync(c.command, ["-p", dir, "--extendedDiagnostics"], {
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
		text,
	};
}

const median = (xs: number[]): number =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

// --- agree: one typed constant per line, so tsc names each line where the two readers differ

const lawFile = (rows: readonly {readonly line: string; readonly why: string}[]): string =>
	[
		'import type {Answer} from "./line.ts";',
		...rows.map(
			(r, i) => `export const c${i}: Answer<${JSON.stringify(r.line)}> = ${JSON.stringify(r.why)};`,
		),
		"",
	].join("\n");

function agree(c: Compiler, s: Sketch) {
	const dir = setUp(s);
	try {
		const rows = generated.map((g) => ({line: g.line, why: s.answer(g.line)}));
		writeFileSync(join(dir, "law.ts"), lawFile(rows));
		const r = run(c, dir);
		const wrong = [...r.text.matchAll(/law\.ts\((\d+),\d+\): error (TS\d+): (.*)/g)].map((m) => {
			const row = rows[Number(m[1]) - 2];
			const said = /to type '(.*)'\.$/.exec(m[3] ?? "")?.[1];
			return {line: row?.line, runtime: row?.why, compiler: said ?? m[3], code: m[2]};
		});
		const runtimeOk = rows.filter((x) => x.why === "ok").length;
		return {
			lines: rows.length,
			runtimeOk,
			disagree: wrong.length,
			compilerTakesRuntimeRefuses: wrong.filter((w) => w.compiler === '"ok"').length,
			compilerRefusesRuntimeTakes: wrong.filter((w) => w.runtime === "ok").length,
			wrong,
			instantiations: r.instantiations,
			checkMs: r.checkMs,
		};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

// --- cost: 204's method, word for word

/** n different lines, so the compiler can cache none of them. 204's own list. */
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

function cost(c: Compiler, s: Sketch) {
	const dir = setUp(s);
	try {
		return [0, 1, 10, 100].map((n) => {
			writeFileSync(join(dir, "calls.ts"), callsFile(lines(n)));
			const all = Array.from({length: runs}, () => run(c, dir));
			const first = all[0];
			return {
				lines: n,
				ok: all.every((r) => r.ok),
				wallMs: median(all.map((r) => r.ms)),
				checkMs: median(all.map((r) => r.checkMs ?? 0)),
				instantiations: first?.instantiations ?? null,
				memoryKb: first?.memoryKb ?? null,
			};
		});
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

// --- depth: the longest line, by bisection

const stage = (flagged: boolean) => (i: number) =>
	`ticket${flagged ? " --ticket 123456789012345" : ""}${i === 0 ? "" : " <ticket"} >ticket`;
const long = (k: number, flagged: boolean): string =>
	Array.from({length: k}, (_, i) => stage(flagged)(i)).join(" | ");

function deepest(c: Compiler, flagged: boolean) {
	const s = sketches[1];
	if (s === undefined) throw new Error("no 208 sketch");
	const dir = setUp(s);
	try {
		const ok = (k: number) => {
			writeFileSync(join(dir, "calls.ts"), callsFile([long(k, flagged)]));
			return run(c, dir);
		};
		let good = 1;
		let bad = 0;
		let codes: string[] = [];
		const codesOf = (r: Ran) => [
			...new Set([...r.text.matchAll(/error (TS\d+)/g)].map((m) => m[1] ?? "")),
		];
		for (let k = 16; k <= 4096; k *= 2) {
			const r = ok(k);
			if (!r.ok) {
				bad = k;
				codes = codesOf(r);
				break;
			}
			good = k;
		}
		while (bad - good > 1) {
			const mid = Math.floor((good + bad) / 2);
			const r = ok(mid);
			if (r.ok) good = mid;
			else {
				bad = mid;
				codes = codesOf(r);
			}
		}
		const text = long(good, flagged);
		return {flagged, stages: good, words: text.split(" ").length, chars: text.length, codes};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

const results = [];
for (const c of compilers()) {
	const agreeBy = sketches.map((s) => ({sketch: s.name, ...agree(c, s)}));
	const costBy = sketches.map((s) => ({sketch: s.name, sizes: cost(c, s)}));
	const depth = [deepest(c, false), deepest(c, true)];
	const row = {compiler: c.name, agree: agreeBy, cost: costBy, depth};
	results.push(row);
	console.log(
		JSON.stringify({
			compiler: c.name,
			agree: agreeBy.map(({wrong: _, ...rest}) => rest),
			cost: costBy,
			depth,
		}),
	);
}
writeFileSync(
	join(root, "experiments", "results", "208-typed-line-gaps.json"),
	`${JSON.stringify({at: new Date().toISOString(), runs, results}, null, "\t")}\n`,
);
