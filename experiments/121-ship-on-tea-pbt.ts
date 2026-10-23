// Experiment 121: ship's laws moved onto tea's own property tests (`@demlik/tea/pbt`, on
// fast-check). On the mutants of experiment 119, what do they catch?
//
// Two runs, never mixed in one number:
//   run 1  today's five laws, moved as they are (`RUN_1` in `laws/ship-pbt.ts`);
//   run 2  run 1 and the two new laws, which outcome a run gives and a ready pull request lands
//          (`RUN_2`).
// And one extra pass, counted in neither: `S`, the saved-state property alone.
// Each mutant runs the property set on 5 seeds, a fixed number of runs each, one child process a
// seed with a time limit. The answer for each mutant is set beside 119's two arms for it: A, our
// every-order search, and B, the random walks.
//
// The mutants: a fixed sample of 150 of 119's 569 ship mutants (drawn with seed 119120, the same
// sample experiment 120 uses), and two named ones, 502 and 516 (515 is in the sample). Every other
// mutant exits at once and is not counted.
//
// Run with (Stryker is not in the workspace: install it once, anywhere outside the repo)
//   npm i --prefix <dir> @stryker-mutator/core@9.6.1
//   STRYKER=<dir>/node_modules/.bin/stryker RUNS=1,2 CONCURRENCY=8 node experiments/121-ship-on-tea-pbt.ts run
//   node experiments/121-ship-on-tea-pbt.ts report      # joins Stryker's reports with the rows and with 119
//   node experiments/121-ship-on-tea-pbt.ts calibrate   # how many runs a property set does in 10 s
// Stryker runs under `nice -n 15`, so the laptop's own apps come first. Stryker calls this same
// script once per mutant (`mutant <run>`), which runs each seed as a child (`props <run> <seed>`).
// The run's files go to runs/121/. No model, no key, no network. Writes
// results/121-ship-on-tea-pbt.json.

import {spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import type {Sub} from "@demlik/tea";
// Types only at the top: the modules load after a mutant is chosen, so one not chosen exits at once.
import type {Property, ShipLike} from "@kampus/pipeline/laws/ship-pbt";
import type {Ship} from "@kampus/pipeline/stages/ship/machine";
import {Result} from "effect";

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const HERE = import.meta.dirname;
const ROOT = HERE.slice(0, HERE.lastIndexOf("/"));
const RUN = env("RUN_DIR", `${ROOT}/runs/121`);
const OUT = `${HERE}/results/121-ship-on-tea-pbt.json`;
const OLD = `${HERE}/results/119-mutation-testing.json`;
const SEEDS = [1, 2, 3, 4, 5];
/**
 * Runs a property, every property: run 1's five take about 10 s together on a quiet machine
 * (`calibrate`: 2.8 s at 10,000 runs), run 2's seven about 12.4 s.
 */
const NUM_RUNS = Number(env("NUM_RUNS", "35000"));
const SEED_MS = 300_000;
const MAX_WORKERS = 8;

/** The files Stryker edits: experiment 119's, unchanged since. */
const FILES = [
	"packages/pipeline/src/stages/ship/machine.ts",
	"packages/pipeline/src/stages/ship/gate.ts",
];

/** 150 of 119's ship mutants, drawn at random with seed 119120: experiment 120's sample too. */
const SAMPLE = [
	2, 10, 11, 14, 16, 26, 28, 29, 34, 36, 39, 41, 42, 43, 44, 46, 52, 53, 58, 59, 61, 64, 69, 76, 82,
	83, 87, 90, 92, 99, 103, 106, 107, 108, 110, 112, 113, 118, 120, 122, 124, 131, 132, 135, 136,
	138, 145, 146, 147, 150, 159, 162, 165, 168, 173, 175, 178, 179, 186, 187, 188, 189, 194, 195,
	199, 204, 208, 215, 217, 219, 237, 240, 243, 246, 252, 253, 269, 270, 272, 273, 280, 291, 296,
	299, 311, 314, 315, 317, 318, 322, 331, 337, 339, 344, 346, 347, 350, 358, 359, 364, 366, 367,
	377, 378, 381, 395, 398, 400, 402, 404, 406, 411, 414, 415, 426, 429, 430, 431, 440, 446, 447,
	456, 458, 463, 464, 467, 473, 481, 482, 485, 487, 488, 490, 491, 492, 494, 499, 503, 504, 508,
	511, 512, 513, 515, 536, 545, 548, 553, 559, 565,
].map(String);
/** The three where 119's walks disagreed between seeds. 515 is in the sample. */
const NAMED = ["502", "515", "516"];
const CHOSEN: ReadonlySet<string> = new Set([...SAMPLE, ...NAMED]);

// ---------------------------------------------------------------- one seed, in a child

/** One property on one seed: did it break, how, and what it cost. */
interface Prop {
	readonly name: string;
	readonly caught: boolean;
	/** `law`: a law said no. `throw`: the machine threw, or a law could not read what it sent. */
	readonly how: "law" | "throw" | null;
	readonly why: string | null;
	/** Lists tried until the first that broke it, and how often fast-check shrank that one. */
	readonly tests: number | null;
	readonly shrinks: number | null;
	readonly ms: number;
	readonly cpu: number;
}
interface Seeded {
	readonly seed: number;
	readonly props: readonly Prop[];
}

const pbtModule = () => import("@kampus/pipeline/laws/ship-pbt");
type Pbt = Awaited<ReturnType<typeof pbtModule>>;
/**
 * The properties of a run. `S`, an extra pass counted in neither run: the saved-state property
 * alone, with the write in flight on the state's own head (with any head it breaks on the real
 * machine, so it would catch every mutant).
 */
const setOf = (pbt: Pbt, run: string): readonly Property[] =>
	run === "2"
		? pbt.RUN_2
		: run === "S"
			? [{name: pbt.SAVED, run: (_machine, opts) => pbt.fromSavedState(opts, true)}]
			: pbt.RUN_1;

/** One property, run once, said as a `Prop`. */
const runProp = <S extends Ship, U extends Sub>(
	pbt: Pbt,
	machine: ShipLike<S, U>,
	p: Property,
	seed: number,
	numRuns: number,
): Prop => {
	const t = performance.now();
	const c = process.cpuUsage();
	const r = Result.try({try: () => p.run(machine, {numRuns, seed}), catch: (e) => e});
	const used = process.cpuUsage(c);
	const ms = Math.round(performance.now() - t);
	const cpu = Math.round((used.user + used.system) / 1000);
	if (Result.isSuccess(r))
		return {name: p.name, caught: false, how: null, why: null, tests: null, shrinks: null, ms, cpu};
	const e = r.failure;
	const said = e instanceof Error ? e.message : `${e}`;
	const cause = e instanceof Error ? e.cause : undefined;
	const law = cause instanceof pbt.LawBroken;
	const why = law
		? cause.why
		: cause instanceof Error
			? `${cause.name}: ${cause.message}`
			: said.split("\n")[0];
	const num = (re: RegExp) => {
		const m = said.match(re);
		return m === null ? null : Number(m[1]);
	};
	return {
		name: p.name,
		caught: true,
		how: law ? "law" : "throw",
		why: (why ?? "").slice(0, 400),
		tests: num(/failed after (\d+) tests?/),
		shrinks: num(/Shrunk (\d+) times?/),
		ms,
		cpu,
	};
};

const props = async (run: string, seed: number): Promise<Seeded> => {
	const pbt = await pbtModule();
	const {ship} = await import("@kampus/pipeline/stages/ship/machine");
	return {seed, props: setOf(pbt, run).map((p) => runProp(pbt, ship, p, seed, NUM_RUNS))};
};

// ---------------------------------------------------------------- one mutant, as Stryker calls it

/** A child's answer, or why there is none: it ran past its limit, or crashed. */
type Ran<T> =
	| {readonly ok: true; readonly why: null; readonly ms: number; readonly value: T}
	| {readonly ok: false; readonly why: string; readonly ms: number; readonly value: null};
interface Row {
	readonly id: string;
	readonly run: string;
	readonly numRuns: number;
	readonly seeds: readonly Ran<Seeded>[];
	readonly ms: number;
}

/** A crash, said short: the error line and the first place it was thrown, with repo-relative paths. */
const crashOf = (stderr: string): string => {
	const lines = stderr.split("\n").map((l) => l.trim());
	const i = lines.findIndex((l) => /^[A-Za-z]*Error\b/.test(l));
	const said = i < 0 ? (lines.filter((l) => l !== "").at(-1) ?? "") : lines[i];
	const at = i < 0 ? "" : (lines.slice(i + 1).find((l) => l.startsWith("at ")) ?? "");
	return `${said} ${at}`.replaceAll(`file://${ROOT}/`, "").replaceAll(ROOT, "").trim();
};

/** One seed in a child process, so a mutant that loops for good stops at a limit. */
const child = <T>(args: readonly string[], ms: number): Ran<T> => {
	const started = performance.now();
	// Node at this edge: a child process with a wall-time limit, which an Effect run cannot stop in sync code.
	const r = spawnSync(process.execPath, [import.meta.filename, ...args], {
		encoding: "utf8",
		timeout: ms,
		maxBuffer: 64 * 1024 * 1024,
		env: process.env,
	});
	const took = Math.round(performance.now() - started);
	const line = r.stdout?.trim().split("\n").at(-1) ?? "";
	if (r.error !== undefined || r.signal !== null)
		return {ok: false as const, why: "timeout", ms: took, value: null};
	if (r.status !== 0 || !line.startsWith("{"))
		return {ok: false as const, why: `crash: ${crashOf(r.stderr)}`, ms: took, value: null};
	return {ok: true as const, why: null, ms: took, value: JSON.parse(line)};
};

const caughtOn = (s: Ran<Seeded>) => !s.ok || s.value.props.some((p) => p.caught);

const mutant = (run: string) => {
	const id = process.env.__STRYKER_ACTIVE_MUTANT__ ?? "none";
	// Not chosen: exit at once. Stryker counts it as survived; the report leaves it out.
	if (id !== "none" && !CHOSEN.has(id)) return;
	const started = performance.now();
	const seeds = SEEDS.map((seed) => child<Seeded>(["props", run, String(seed)], SEED_MS));
	const row: Row = {id, run, numRuns: NUM_RUNS, seeds, ms: Math.round(performance.now() - started)};
	mkdirSync(`${RUN}/run${run}`, {recursive: true});
	writeFileSync(`${RUN}/run${run}/${id}.json`, JSON.stringify(row));
	const caught = seeds.some(caughtOn);
	console.log(`run ${run}, mutant ${id}: ${caught ? "caught" : "missed"}, ${row.ms} ms`);
	process.exitCode = caught ? 1 : 0;
};

// ---------------------------------------------------------------- Stryker

const run = () => {
	const stryker = process.env.STRYKER;
	if (stryker === undefined) throw new Error("set STRYKER to the stryker binary");
	const workers = Math.min(MAX_WORKERS, Number(env("CONCURRENCY", String(MAX_WORKERS))));
	mkdirSync(RUN, {recursive: true});
	for (const k of env("RUNS", "1,2").split(",")) {
		const config = {
			$schema:
				"https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/core/schema/stryker-schema.json",
			testRunner: "command",
			commandRunner: {command: `node experiments/121-ship-on-tea-pbt.ts mutant ${k}`},
			dryRunTimeoutMinutes: 240,
			mutate: FILES,
			inPlace: true,
			concurrency: workers,
			coverageAnalysis: "off",
			timeoutMS: 30 * 60_000,
			timeoutFactor: 4,
			reporters: ["json", "clear-text", "progress"],
			jsonReporter: {fileName: `runs/121/run${k}.mutation.json`},
			tempDirName: "runs/121/stryker-tmp",
			cleanTempDir: true,
		};
		const path = `${RUN}/run${k}.stryker.json`;
		writeFileSync(path, JSON.stringify(config, null, "\t"));
		// Low priority, so the laptop's own apps come first; Stryker's children inherit it.
		const r = spawnSync("nice", ["-n", "15", stryker, "run", path], {
			cwd: ROOT,
			stdio: "inherit",
			env: process.env,
		});
		if (r.status !== 0) throw new Error(`stryker failed on run ${k}`);
	}
};

// ---------------------------------------------------------------- calibrate

/**
 * Time of each property on the real code at 10,000 runs, wall and CPU, and the runs that fit run 1
 * in 10 s. On a busy laptop wall time runs long, so the smaller of the two is the guide.
 */
const calibrate = async () => {
	const pbt = await pbtModule();
	const {ship} = await import("@kampus/pipeline/stages/ship/machine");
	const at = 10_000;
	const ran = [1, 2, 3].flatMap((seed) => pbt.RUN_2.map((p) => runProp(pbt, ship, p, seed, at)));
	const per = (of: (r: Prop) => number) =>
		Object.fromEntries(
			pbt.RUN_2.map((p) => [p.name, median(ran.filter((r) => r.name === p.name).map(of)) ?? 0]),
		);
	const sum = (of: Record<string, number>, set: readonly Property[]) =>
		set.reduce((total, p) => total + (of[p.name] ?? 0), 0);
	const w = per((r) => r.ms);
	const c = per((r) => r.cpu);
	const run1 = Math.min(sum(w, pbt.RUN_1), sum(c, pbt.RUN_1));
	const run2 = Math.min(sum(w, pbt.RUN_2), sum(c, pbt.RUN_2));
	const numRuns = Math.round((at * 10_000) / run1 / 1000) * 1000;
	return {
		at,
		wallMs: w,
		cpuMs: c,
		run1Ms: run1,
		run2Ms: run2,
		numRuns,
		run2MsThen: Math.round((run2 * numRuns) / at),
	};
};

// ---------------------------------------------------------------- the report

interface StrykerMutant {
	readonly id: string;
	readonly mutatorName: string;
	readonly replacement?: string;
	readonly status: string;
	readonly location: {
		readonly start: {readonly line: number; readonly column: number};
		readonly end: {readonly line: number; readonly column: number};
	};
}

const slice = (source: string, m: StrykerMutant) => {
	const lines = source.split("\n");
	const {start, end} = m.location;
	if (start.line === end.line)
		return (lines[start.line - 1] ?? "").slice(start.column - 1, end.column - 1);
	return [
		(lines[start.line - 1] ?? "").slice(start.column - 1),
		...lines.slice(start.line, end.line - 1),
		(lines[end.line - 1] ?? "").slice(0, end.column - 1),
	].join("\n");
};

const short = (s: string, n = 160) => {
	const one = s.replace(/\s+/g, " ").trim();
	return one.length > n ? `${one.slice(0, n)}...` : one;
};

const readJson = <T>(path: string): T | null =>
	Result.getOrElse(
		Result.try(() => JSON.parse(readFileSync(path, "utf8")) as T),
		() => null,
	);

/** One of 119's mutants, as its results file keeps it. */
interface Old {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly mutator: string;
	readonly from: string;
	readonly to: string;
	readonly kind: string;
	readonly a?: {
		readonly killed: boolean;
		readonly why?: string;
		readonly failed?: readonly {readonly check: string}[];
	};
}

/**
 * Where 119 caught a mutant: by the ship machine's own laws (`ship`, its one-machine check), only
 * by the lanes worlds (two or more machines), or by a crash of our checker. 119's two arms agreed on
 * every mutant, so arm A's full list of checks stands for both.
 */
const whereOf = (was: Old | undefined): "ship" | "worlds" | "crash" | "no row" | null => {
	if (was === undefined || (was.kind !== "both" && was.kind !== "only A")) return null;
	if (was.a === undefined) return "no row";
	if (was.a.why !== undefined) return "crash";
	return was.a.failed?.some((f) => f.check === "ship") === true ? "ship" : "worlds";
};

const median = (xs: readonly number[]) => {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? (s[mid] ?? 0) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
};

/** Both / only tea pbt / only the other / neither. */
const versus = (rows: readonly {readonly tea: boolean; readonly other: boolean}[]) => ({
	both: rows.filter((r) => r.tea && r.other).length,
	onlyTea: rows.filter((r) => r.tea && !r.other).length,
	onlyOther: rows.filter((r) => !r.tea && r.other).length,
	neither: rows.filter((r) => !r.tea && !r.other).length,
});

const report = async () => {
	const old = new Map(
		(readJson<{mutants: Old[]}>(OLD)?.mutants ?? []).map((m) => [m.id, m] as const),
	);
	const runs: Record<string, unknown> = {};
	const caughtBy: Record<string, Map<string, ReadonlySet<string>>> = {};
	for (const k of ["1", "2", "S"]) {
		const json = readJson<{files: Record<string, {source: string; mutants: StrykerMutant[]}>}>(
			`${RUN}/run${k}.mutation.json`,
		);
		if (json === null) continue;
		const mutants = [];
		const differs: string[] = [];
		const caughtHere = new Map<string, ReadonlySet<string>>();
		caughtBy[k] = caughtHere;
		for (const [file, entry] of Object.entries(json.files)) {
			const path = file.replace(`${ROOT}/`, "");
			for (const m of entry.mutants) {
				if (!CHOSEN.has(m.id)) continue;
				const from = short(slice(entry.source, m));
				const to = short(m.replacement ?? "");
				const was = old.get(m.id);
				const same =
					was !== undefined &&
					was.file === path &&
					was.line === m.location.start.line &&
					was.mutator === m.mutatorName &&
					was.from === from &&
					was.to === to;
				if (!same) differs.push(m.id);
				const row = readJson<Row>(`${RUN}/run${k}/${m.id}.json`);
				const seeds = row?.seeds ?? [];
				const loads = row !== null && seeds.some((s) => s.ok);
				// No row: the mutant breaks loading the module, so every test fails.
				const crashed = row === null || !loads;
				const props = seeds.flatMap((s) => (s.ok ? s.value.props : []));
				const caughtNames = new Set(props.filter((p) => p.caught).map((p) => p.name));
				caughtHere.set(m.id, caughtNames);
				// A seed that ran past its limit or crashed fails the test run too.
				const stopped = seeds.filter((s) => !s.ok).length;
				const tea = crashed || caughtNames.size > 0 || stopped > 0;
				const seedsCaught = seeds.filter(caughtOn).length;
				const firsts = seeds.flatMap((s) => {
					if (!s.ok) return [];
					const ms = s.value.props.filter((p) => p.caught).map((p) => p.ms);
					return ms.length === 0 ? [] : [Math.min(...ms)];
				});
				const b = was !== undefined && (was.kind === "both" || was.kind === "only B");
				const a = was !== undefined && (was.kind === "both" || was.kind === "only A");
				// Our checker by a law: it named a law, not a crash of its own.
				const aLaw = a && was?.a?.why === undefined && (was?.a?.failed?.length ?? 0) > 0;
				mutants.push({
					id: m.id,
					named: NAMED.includes(m.id),
					file: path,
					line: m.location.start.line,
					mutator: m.mutatorName,
					from,
					to,
					stryker: m.status,
					old: was?.kind ?? null,
					tea,
					crashed,
					stopped,
					a,
					aLaw,
					b,
					where: whereOf(was),
					how: crashed
						? "no load"
						: props.some((p) => p.caught && p.how === "law")
							? "law"
							: caughtNames.size > 0
								? "throw"
								: stopped > 0
									? "stopped"
									: null,
					seedsCaught,
					laws: Object.fromEntries(
						[...caughtNames].map((name) => {
							const ps = props.filter((p) => p.name === name && p.caught);
							return [
								name,
								{
									seeds: ps.length,
									how: [...new Set(ps.map((p) => p.how))],
									why: short(ps[0]?.why ?? "", 240),
									tests: ps.map((p) => p.tests),
									shrinks: ps.map((p) => p.shrinks),
								},
							];
						}),
					),
					why: crashed ? (seeds.find((s) => !s.ok)?.why ?? "the module does not load") : null,
					ms: row?.ms ?? null,
					firstMs: median(firsts),
				});
			}
		}
		mutants.sort((x, y) => Number(x.id) - Number(y.id));
		const counted = mutants.filter((m) => SAMPLE.includes(m.id));
		const time = (of: typeof mutants) => median(of.flatMap((m) => (m.ms === null ? [] : [m.ms])));
		const withRow = counted.filter((m) => !m.crashed);
		runs[k] = {
			count: counted.length,
			differsFrom119: differs,
			stopped: withRow.filter((m) => m.stopped > 0).map((m) => m.id),
			caught: counted.filter((m) => m.tea).length,
			byLawOrThrow: withRow.filter((m) => m.tea).length,
			noLoad: counted.filter((m) => m.crashed).length,
			vsB: versus(counted.map((m) => ({tea: m.tea, other: m.b}))),
			vsA: versus(counted.map((m) => ({tea: m.tea, other: m.a}))),
			vsALaw: versus(counted.map((m) => ({tea: m.tea, other: m.aLaw}))),
			/** By how tea pbt caught it: a law said no, the machine threw, the module did not load. */
			byHow: Object.fromEntries(
				["law", "throw", "no load", "stopped"].map((h) => [
					h,
					counted.filter((m) => m.how === h).length,
				]),
			),
			/** 119's catches, by where 119 caught them, and how many of each tea pbt caught. */
			by119Where: Object.fromEntries(
				["ship", "worlds", "crash", "no row"].map((w) => {
					const of = counted.filter((m) => m.where === w);
					return [w, {in119: of.length, caught: of.filter((m) => m.tea).length}];
				}),
			),
			allSeeds: withRow.filter((m) => m.tea && m.seedsCaught === SEEDS.length).length,
			someSeeds: withRow.filter((m) => m.tea && m.seedsCaught < SEEDS.length).length,
			byLaw: Object.fromEntries(
				[...new Set(withRow.flatMap((m) => Object.keys(m.laws)))].map((name) => [
					name,
					withRow.filter((m) => name in m.laws).length,
				]),
			),
			byThrow: withRow.filter((m) => Object.values(m.laws).some((l) => l.how.includes("throw")))
				.length,
			timeMs: {
				medianCaught: time(withRow.filter((m) => m.tea)),
				medianMissed: time(withRow.filter((m) => !m.tea)),
				medianFirstCatch: median(withRow.flatMap((m) => (m.firstMs === null ? [] : [m.firstMs]))),
				total: withRow.reduce((sum, m) => sum + (m.ms ?? 0), 0),
			},
			named: mutants.filter((m) => m.named),
			mutants,
		};
	}
	// Run 2's extra catches: caught there by a new law, by none of today's five.
	const pbt = await pbtModule();
	const today = new Set(pbt.RUN_1.map((p) => p.name));
	const two = caughtBy["2"] ?? new Map();
	const one = caughtBy["1"] ?? new Map();
	const onlyNew = [...two].filter(
		([id, names]) => SAMPLE.includes(id) && names.size > 0 && ![...names].some((n) => today.has(n)),
	);
	// Run 2 holds run 1's five on the same seeds and runs: they must catch the same mutants.
	const unlike = [...two].filter(([id, names]) => {
		const a = [...(one.get(id) ?? [])].sort().join("|");
		const b = [...names]
			.filter((n) => today.has(n))
			.sort()
			.join("|");
		return one.has(id) && a !== b;
	});
	const reach = pbt.reach(2000, 7);
	const saved = SEEDS.map((seed) => {
		const r = Result.try({
			try: () => pbt.fromSavedState({numRuns: NUM_RUNS, seed}),
			catch: (e) => e,
		});
		if (Result.isSuccess(r)) return {seed, found: false};
		const e = r.failure;
		const said = e instanceof Error ? e.message : `${e}`;
		const cause = e instanceof Error && e.cause instanceof pbt.LawBroken ? e.cause.why : said;
		return {seed, found: true, why: cause, tests: Number(said.match(/after (\d+) tests?/)?.[1])};
	});
	const out = {
		numRuns: NUM_RUNS,
		seeds: SEEDS,
		files: FILES,
		sample: SAMPLE,
		named: NAMED,
		properties: {run1: pbt.RUN_1.map((p) => p.name), run2: pbt.RUN_2.map((p) => p.name)},
		run1: runs["1"] ?? null,
		run2: runs["2"] ?? null,
		run2OnlyNew: onlyNew.map(([id, names]) => ({id, laws: [...names]})),
		run2UnlikeRun1: unlike.map(([id]) => id),
		/** The extra pass, counted in neither run: the saved-state property alone, on the sample. */
		savedPass: runs.S ?? null,
		/** Of those, the ones run 2 missed. */
		savedPassBeyondRun2: [...(caughtBy.S ?? new Map())]
			.filter(([id, names]) => SAMPLE.includes(id) && names.size > 0 && two.get(id)?.size === 0)
			.map(([id]) => id),
		reach,
		saved,
	};
	for (const k of ["1", "2", "S"]) {
		const r = runs[k] as Record<string, unknown> | undefined;
		if (r === undefined) continue;
		const {mutants: _m, named: _n, ...summary} = r;
		console.log(`run ${k}`, JSON.stringify(summary, null, 2));
	}
	console.log("run 2, only the new laws:", JSON.stringify(out.run2OnlyNew));
	console.log("run 2 unlike run 1 on today's five:", JSON.stringify(out.run2UnlikeRun1));
	console.log("saved-state pass, beyond run 2:", JSON.stringify(out.savedPassBeyondRun2));
	console.log("saved state:", JSON.stringify(saved));
	writeFileSync(
		OUT,
		`${JSON.stringify(out, null, "\t")}\n`
			// No path from this machine in a saved answer: every path is repo-relative.
			.replaceAll(`file://${ROOT}/`, "")
			.replaceAll(`${ROOT}/`, ""),
	);
	console.log("wrote experiments/results/121-ship-on-tea-pbt.json");
};

// ---------------------------------------------------------------- main

const [mode, ...args] = process.argv.slice(2);
if (mode === "props")
	console.log(JSON.stringify(await props(args[0] ?? "1", Number(args[1] ?? "1"))));
else if (mode === "mutant") mutant(args[0] ?? "1");
else if (mode === "run") run();
else if (mode === "report") await report();
else if (mode === "calibrate") console.log(JSON.stringify(await calibrate(), null, 2));
else throw new Error("mode: run, report, calibrate, mutant <run>, props <run> <seed>");
