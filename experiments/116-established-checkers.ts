// Experiment 116: do established tools find the hosted lane's hang (experiment 115), and what does
// each cost?
//
//   property  Effect 4's own Arbitrary.checkEffect over generated child endings, on the real hosted
//             lane through the real host and the in-memory ledger, under TestClock
//             (packages/pipeline/src/hosted/lane-ends.ts). Today's lane must break the law; the
//             fixed lane, built inside that file, must keep it. Today's run is here only, so
//             `pnpm test` stays green
//   TLA+      the spec in 116-established-checkers/HostedLane.tla, checked by TLC. Only when
//             TLA2TOOLS names a tla2tools.jar (v1.6.0 runs on Java 8). The jar is never in the repo
//
// Run with
//   node experiments/116-established-checkers.ts
//   TLA2TOOLS=<path to tla2tools.jar> node experiments/116-established-checkers.ts
//
// No model, no key, no network. Writes results/116-established-checkers.json.

import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runChild} from "@kampus/pipeline/child";
import {type Ending, LIMIT_MS, laneEnds, runCase} from "@kampus/pipeline/hosted/lane-ends";
import {Effect, FileSystem, Path} from "effect";

const SEEDS = [1, 2, 3, 4, 5];
const RUNS = 100;
const HERE = import.meta.dirname;
const SPEC_DIR = `${HERE}/116-established-checkers`;
const OUT = `${HERE}/results/116-established-checkers.json`;
const round = (ms: number) => Math.round(ms * 10) / 10;

const timed = <A, E, R>(e: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const a = yield* e;
		return {a, ms: round(performance.now() - t0)};
	});

// ---------------------------------------------------------------- the property

const property = Effect.gen(function* () {
	const today = [];
	for (const seed of SEEDS) {
		const {a: r, ms} = yield* timed(laneEnds("today", {check: {runs: RUNS, seed}}));
		if (r._tag !== "Falsified") {
			today.push({seed, result: r._tag, ms});
			continue;
		}
		const shrunk = r.shrunkInput as readonly Ending[];
		const replay = yield* runCase({endings: shrunk, variant: "today", limitMs: LIMIT_MS});
		today.push({
			seed,
			result: r._tag,
			ms,
			runs: r.runs,
			shrinks: r.shrinks,
			first: r.initialInput,
			shrunk,
			replay,
		});
	}
	const fixed = [];
	for (const seed of SEEDS) {
		// And it read every row a child wrote: 115's doubt on its fix.
		const {a: r, ms} = yield* timed(laneEnds("fixed", {rows: true, check: {runs: RUNS, seed}}));
		fixed.push({seed, result: r._tag, ms, runs: r._tag === "Passed" ? r.runs : null});
	}
	const assumed = [];
	for (const seed of SEEDS) {
		const {a: r, ms} = yield* timed(
			laneEnds("today", {kinds: ["row_done", "row_stuck"], check: {runs: RUNS, seed}}),
		);
		assumed.push({seed, result: r._tag, ms});
	}
	return {limitMs: LIMIT_MS, runs: RUNS, today, fixed, assumed};
});

// ---------------------------------------------------------------- TLC

const CHECKS = [
	{cfg: "today", deadlock: false, says: "today: every started child is seen to end"},
	{cfg: "today-ends", deadlock: false, says: "today: every lane ends"},
	{cfg: "today", deadlock: true, says: "today: TLC's own deadlock check, no property"},
	{cfg: "fixed", deadlock: false, says: "fixed: both laws"},
	{cfg: "reach", deadlock: false, says: "not noise: a lane can end with every child's row"},
] as const;

/** What one TLC run printed, read. */
const readTlc = (out: string) => {
	const lines = out.split("\n");
	const states = /(\d+) states generated, (\d+) distinct states found/.exec(out);
	const depth = /depth of the complete state graph search is (\d+)/.exec(out);
	const trace = lines.filter((l) => /^State \d+: /.test(l)).map((l) => l.replace(/ line .*$/, ""));
	return {
		version: lines.find((l) => l.startsWith("TLC2 Version")) ?? null,
		error: lines.find((l) => l.startsWith("Error: ") && !l.includes("behavior")) ?? null,
		passed: out.includes("No error has been found"),
		generated: states === null ? null : Number(states[1]),
		distinct: states === null ? null : Number(states[2]),
		depth: depth === null ? null : Number(depth[1]),
		trace,
	};
};

const tlc = (jar: string, meta: string) =>
	Effect.gen(function* () {
		const out = [];
		for (const c of CHECKS) {
			const args = [
				"-XX:+UseParallelGC",
				"-cp",
				jar,
				"tlc2.TLC",
				...(c.deadlock ? [] : ["-deadlock"]),
				"-workers",
				"1",
				"-metadir",
				`${meta}/${c.cfg}-${c.deadlock}`,
				"-config",
				`${c.cfg}.cfg`,
				"HostedLane",
			];
			const {a: run, ms} = yield* timed(
				runChild("java", args, {cwd: SPEC_DIR, env: {PATH: process.env.PATH ?? ""}}),
			);
			out.push({...c, wallMs: ms, ...readTlc(run.out + run.err)});
		}
		return out;
	});

// ---------------------------------------------------------------- lines written

const FILES = [
	"packages/pipeline/src/hosted/lane-ends.ts",
	"packages/pipeline/src/hosted/lane-ends.test.ts",
	"experiments/116-established-checkers/HostedLane.tla",
	"experiments/116-established-checkers/today.cfg",
	"experiments/116-established-checkers/today-ends.cfg",
	"experiments/116-established-checkers/fixed.cfg",
	"experiments/116-established-checkers/reach.cfg",
];

const main = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const root = path.resolve(HERE, "..");
	const lines: Record<string, number> = {};
	for (const f of FILES)
		lines[f] = (yield* fs.readFileString(path.join(root, f))).trimEnd().split("\n").length;

	const prop = yield* property;
	for (const t of prop.today)
		console.log(`property today seed ${t.seed}: ${t.result} in ${t.ms} ms`, JSON.stringify(t));
	for (const t of prop.fixed)
		console.log(`property fixed seed ${t.seed}: ${t.result} in ${t.ms} ms`);
	for (const t of prop.assumed)
		console.log(`property assumed seed ${t.seed}: ${t.result} in ${t.ms} ms`);

	const jar = process.env.TLA2TOOLS ?? "";
	const meta = yield* fs.makeTempDirectoryScoped({prefix: "tlc-116-"});
	const checks = jar === "" ? null : yield* tlc(jar, meta);
	if (checks === null) console.log("TLC skipped: TLA2TOOLS names no jar");
	else
		for (const c of checks)
			console.log(
				`TLC ${c.says}: ${c.passed ? "passed" : c.error} (${c.distinct} distinct states, ${c.trace.length} states in its trace, ${c.wallMs} ms wall)`,
			);

	yield* fs.writeFileString(
		OUT,
		`${JSON.stringify({lines, property: prop, tlc: checks}, null, "\t")}\n`,
	);
	console.log(`wrote ${path.relative(root, OUT)}`);
}).pipe(Effect.scoped);

// Node at this edge: the runtime runs the script, with Node's file system and child processes.
await Effect.runPromise(main.pipe(Effect.provide(nodeServices)));
