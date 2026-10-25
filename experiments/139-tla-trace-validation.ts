// Experiment 139: tie experiment 116's TLA+ spec of the hosted lane to the real code, two ways.
//
//   trace   Trace validation (Cirstea, Kuppe, Loillier, Merz, arXiv 2404.16075). Run the real
//           hosted lane on generated child endings and pauses, read each run's ledger log as a
//           behaviour of the spec (packages/pipeline/src/hosted/lane-trace.ts), and have TLC
//           check every run against the spec: 139's HostedLaneV2 and 116's HostedLane as written.
//   paths   First TLC checks 116's laws on the v2 spec (the three .cfg files). Then tests from
//           the spec (MongoDB's Realm Sync way, VLDB 2020). TLC dumps the spec's state
//           graph; every path from the start to a state at rest becomes a script for the
//           children; each script drives the real lane (`driveCase`), and the run must make the
//           lane's moves the path makes and pass TLC's trace check.
//   setup, sample, typecheck, run, split, report
//           Both, beside the repo's own tests and 116's property test, on a fixed-seed sample of
//           150 of StrykerJS's mutants of hosted/lane.ts and stages/lane/machine.ts. Stryker calls
//           this script as `mutant` for each; it runs each arm as a child (`arm <name>`). `split`
//           then says which test files caught each mutant the tests arm caught.
//
// Run with (Stryker and TLC are not in the workspace)
//   TLA2TOOLS=<tla2tools.jar, v1.6.0 runs on Java 8> node experiments/139-tla-trace-validation.ts trace
//   TLA2TOOLS=<jar> node experiments/139-tla-trace-validation.ts paths
//   WORK=<scratch dir outside the repo> node experiments/139-tla-trace-validation.ts setup
//   WORK=<dir> STRYKER=<dir>/node_modules/.bin/stryker node experiments/139-tla-trace-validation.ts sample
//   WORK=<dir> node experiments/139-tla-trace-validation.ts typecheck
//   WORK=<dir> STRYKER=<stryker> TLA2TOOLS=<jar> CONCURRENCY=6 node experiments/139-tla-trace-validation.ts run
//   WORK=<dir> node experiments/139-tla-trace-validation.ts split
//   WORK=<dir> node experiments/139-tla-trace-validation.ts report
// `setup` copies this checkout's files (tracked and new, not ignored) into WORK/tree and installs
// there offline; every later mutant step works in that copy, never here. Stryker 9.6.1, installed
// with `npm i --prefix <dir> @stryker-mutator/core@9.6.1`. Every test, typecheck and Stryker run
// is under `nice -n 15`, with TYPESAFE_API_KEY not passed on. No model, no key, no network. $0.
// Writes results/139-tla-trace-validation.json, one part per step.

import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {type Exited, runChild} from "@kampus/pipeline/child";
import {type Ending, LIMIT_MS, traceCase, type Variant} from "@kampus/pipeline/hosted/lane-ends";
import {
	driveCase,
	isLaneStep,
	type Push,
	type Script,
	type SpecState,
	type Step,
	stepsOf,
} from "@kampus/pipeline/hosted/lane-trace";
import {Arbitrary, Effect, FileSystem, Path, Schema} from "effect";
import {
	checkTraces,
	type Graph,
	modelCheck,
	stateGraph,
	type TraceSpec,
} from "./139-tla-trace-validation/tlc.ts";

const HERE = import.meta.dirname;
const ROOT = HERE.slice(0, HERE.lastIndexOf("/"));
const OUT = `${HERE}/results/139-tla-trace-validation.json`;
const SCRIPTS = `${HERE}/results/139-tla-trace-validation-scripts.json`;
const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const JAR = env("TLA2TOOLS", "");
const WORK = env("WORK", "");
const TREE = `${WORK}/tree`;

/** The most children a generated case names. */
const MOST = 7;
/**
 * The spec's bound for the trace runs. A case names up to 7 children; when all 7 say done, the
 * lane starts an 8th, past the list, which writes `stuck`: the spec's last child.
 */
const N_RUNS = MOST + 1;
/** The bound for the spec's paths: small enough to walk every path. */
const N_PATHS = 3;

/** The files Stryker mutates. */
const FILES = [
	"packages/pipeline/src/hosted/lane.ts",
	"packages/pipeline/src/stages/lane/machine.ts",
];
const SEED = 139;
const SIZE = 150;

// ---------------------------------------------------------------- results, one part per step

const savePart = (key: string, part: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const old = (yield* fs.exists(OUT)) ? JSON.parse(yield* fs.readFileString(OUT)) : {};
		yield* fs.writeFileString(OUT, `${JSON.stringify({...old, [key]: part}, null, "\t")}\n`);
		console.log(`wrote part ${key} of results/139-tla-trace-validation.json`);
	});

const needJar = () => {
	if (JAR === "") throw new Error("set TLA2TOOLS to a tla2tools.jar");
	return JAR;
};

const timed = <A, E, R>(e: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const a = yield* e;
		return {a, ms: Math.round(performance.now() - t0)};
	});

// ---------------------------------------------------------------- Q1: trace validation

/** Virtual milliseconds a child may pause: none, a tick, one poll of the lane, two, four. */
const Wait = Schema.Literals([0, 50, 150, 300, 600]);
/** Half the children say done, so runs go past the first child; a quarter stuck, a quarter no row. */
const EndingArb = Arbitrary.schema(Schema.Literals([0, 1, 2, 3])).pipe(
	Arbitrary.map((i): Ending => (i < 2 ? "row_done" : i === 2 ? "row_stuck" : "no_row")),
);
const ChildArb = Arbitrary.all({
	ending: EndingArb,
	before: Arbitrary.schema(Wait),
	after: Arbitrary.schema(Wait),
});
/** Up to 7 children; a child past the list writes `stuck` at once. */
const CasesArb = Arbitrary.array(ChildArb, {maxLength: MOST});
type Gen = typeof CasesArb extends Arbitrary.Arbitrary<infer A> ? A : never;

/** One run of the real lane on one generated case, read for v2's bound and for 116's. */
interface Traced {
	readonly variant: Variant;
	readonly input: Gen;
	readonly ended: boolean;
	readonly steps: readonly Step[];
	readonly v1: readonly Step[];
	readonly ms: number;
}

const traceOne = (variant: Variant, input: Gen) =>
	timed(
		traceCase({
			endings: input.map((c) => c.ending),
			pauses: input.map((c) => ({before: c.before, after: c.after})),
			variant,
			limitMs: LIMIT_MS,
			settle: true,
		}),
	).pipe(
		Effect.map(
			({a, ms}): Traced => ({
				variant,
				input,
				ended: a.ended,
				steps: stepsOf(a.log, N_RUNS),
				v1: stepsOf(a.log, 3),
				ms,
			}),
		),
	);

/** The same runs, as read for 116's bound of 3 children. */
const asV1 = (runs: readonly Traced[]) => runs.map((r) => ({...r, steps: r.v1}));

const casesOf = (count: number, seed: number) =>
	Arbitrary.sampleEffect(CasesArb, {count, seed}).pipe(Effect.orDie);

const keyOf = (steps: readonly Step[]) => JSON.stringify(steps.map((s) => [s.act, s.k, s.to]));

/** Runs with the same steps, once each: TLC checks the distinct traces. */
const distinct = (runs: readonly Traced[]) => {
	const by = new Map<string, {run: Traced; count: number}>();
	for (const r of runs) {
		const k = keyOf(r.steps);
		const had = by.get(k);
		by.set(k, {run: had?.run ?? r, count: (had?.count ?? 0) + 1});
	}
	return [...by.values()];
};

const show = (s: SpecState) =>
	`lane=${s.lane} cur=${s.cur} proc=${s.proc.map((p) => p[0]).join("")} row=${s.row.map((r) => r[0]).join("")} exit=${s.exit.map(Number).join("")} seen=${s.seen.map(Number).join("")}`;

/**
 * Why a run was rejected, in words, from the run alone. A reading aid for the write-up: TLC's
 * verdict is the answer, this only names the first event TLC could not match.
 */
const whyRejected = (steps: readonly Step[], at: number, spec: TraceSpec): string => {
	const e = steps[at];
	const before = at === 0 ? null : (steps[at - 1]?.to ?? null);
	if (e === undefined) {
		const last = steps[steps.length - 1]?.to;
		if (last === undefined) return "rest: an empty run";
		const k = last.cur - 1;
		if (spec.fixed && last.lane === "running" && last.exit[k] === true && last.row[k] === "none")
			return "rest: the lane still waits on a child that ended with no row (SeeExit owed)";
		const owedExit = last.proc.findIndex((p, i) => p === "down" && last.exit[i] !== true);
		if (owedExit >= 0) return `rest: child ${owedExit + 1}'s EXIT never came (Deliver owed)`;
		if (last.lane === "over") return "rest: the lane never exited";
		return `rest: something owed is left (${show(last)})`;
	}
	if (e.act === "Exit") return spec.against === "v1" ? "Exit: 116 has no lane exit" : "Exit";
	if (e.act === "TooMany") return `Start(${e.k}): a child past N = ${spec.n}`;
	if (e.act === "Ended") return "the lane is over without taking a child's end";
	if (e.act === "Deliver" && before?.lane === "gone")
		return `Deliver(${e.k}) after the lane exited`;
	if (e.act === "SeeExit" && !spec.fixed) return "SeeExit: today's spec has no wait on the EXIT";
	if (e.act === "SeeRow" && before !== null) {
		const row = before.row[e.k - 1];
		if (spec.against === "v1" && row === "stuck" && e.to.lane === "over")
			return "SeeRow on a stuck row: the lane stops; 116 goes on";
		if (spec.against === "v1" && e.k === spec.n && e.to.lane === "ready")
			return `SeeRow(${e.k}): the lane goes on past N = ${spec.n}; 116 stops`;
	}
	return `${e.act}(${e.k}) lands on ${show(e.to)}`;
};

interface Checked {
	readonly spec: TraceSpec;
	readonly variant: Variant;
	readonly runs: number;
	readonly distinct: number;
	readonly accepted: number;
	readonly rejected: number;
	/** Rejected runs by the reason read from the run, with one example's events. */
	readonly why: Readonly<Record<string, {count: number; input: Gen; events: readonly string[]}>>;
	readonly tlcMs: number;
}

const checkRuns = (spec: TraceSpec, variant: Variant, runs: readonly Traced[]) =>
	Effect.gen(function* () {
		const once = distinct(runs);
		const r = yield* checkTraces(
			needJar(),
			spec,
			once.map((o) => o.run.steps),
		);
		if (!r.ok) return yield* Effect.die(new Error(`TLC failed:\n${r.out}`));
		const why: Record<string, {count: number; input: Gen; events: readonly string[]}> = {};
		let accepted = 0;
		let rejected = 0;
		for (const [i, o] of once.entries()) {
			const v = r.verdicts[i];
			if (v === undefined) continue;
			if (v.accepted) {
				accepted += o.count;
				continue;
			}
			rejected += o.count;
			const w = whyRejected(o.run.steps, v.at, spec);
			const had = why[w];
			why[w] = {
				count: (had?.count ?? 0) + o.count,
				input: had?.input ?? o.run.input,
				events:
					had?.events ??
					o.run.steps.slice(0, v.at + 1).map((s) => `${s.act}(${s.k}) ${show(s.to)}`),
			};
		}
		return {
			spec,
			variant,
			runs: runs.length,
			distinct: once.length,
			accepted,
			rejected,
			why,
			tlcMs: r.ms,
		} satisfies Checked;
	});

const label = (c: Checked) =>
	`${c.variant} runs vs ${c.spec.against} (N=${c.spec.n}, Fixed=${c.spec.fixed}): ${c.accepted} accepted, ${c.rejected} rejected of ${c.runs} (${c.distinct} distinct), TLC ${c.tlcMs} ms`;

const trace = Effect.gen(function* () {
	const count = Number(env("COUNT", "300"));
	const seed = Number(env("SEED", "139"));
	const cases = yield* casesOf(count, seed);
	const runs: Record<Variant, Traced[]> = {today: [], fixed: []};
	const wall: Record<Variant, number> = {today: 0, fixed: 0};
	for (const variant of ["fixed", "today"] as const) {
		const t0 = performance.now();
		for (const input of cases) runs[variant].push(yield* traceOne(variant, input));
		wall[variant] = Math.round(performance.now() - t0);
		console.log(`${variant}: ${count} runs in ${wall[variant]} ms`);
	}
	const plans: [TraceSpec, Variant, readonly Traced[]][] = [
		[{against: "v2", n: N_RUNS, fixed: true}, "fixed", runs.fixed],
		[{against: "v2", n: N_RUNS, fixed: false}, "today", runs.today],
		[{against: "v2", n: N_RUNS, fixed: true}, "today", runs.today],
		[{against: "v2", n: N_RUNS, fixed: false}, "fixed", runs.fixed],
		[{against: "v1", n: 3, fixed: true}, "fixed", asV1(runs.fixed)],
		[{against: "v1", n: 3, fixed: false}, "today", asV1(runs.today)],
	];
	const checks: Checked[] = [];
	for (const [spec, variant, rs] of plans) {
		const c = yield* checkRuns(spec, variant, rs);
		checks.push(c);
		console.log(label(c));
		for (const [w, x] of Object.entries(c.why)) console.log(`   ${x.count}  ${w}`);
	}
	// Two orders the spec allows and 116 did not foresee or the runs might never show.
	const afterGone = (rs: readonly Traced[]) =>
		rs.filter((r) => {
			const gone = r.steps.findIndex((s) => s.act === "Exit");
			return gone >= 0 && r.steps.slice(gone).some((s) => s.act === "End");
		}).length;
	const overlap = (rs: readonly Traced[]) =>
		rs.filter((r) =>
			r.steps.some(
				(s, i) =>
					s.act === "Start" &&
					s.k > 1 &&
					!r.steps.slice(0, i).some((x) => x.act === "End" && x.k === s.k - 1),
			),
		).length;
	for (const variant of ["fixed", "today"] as const)
		console.log(
			`${variant}: a child exits after the lane did in ${afterGone(runs[variant])} runs; the next child starts before the last exits in ${overlap(runs[variant])}`,
		);
	const children = (rs: readonly Traced[]) =>
		rs.map((r) => r.steps.filter((s) => s.act === "Start" || s.act === "TooMany").length);
	const ms = (rs: readonly Traced[]) => rs.map((r) => r.ms).sort((a, b) => a - b);
	const median = (xs: readonly number[]) => xs[Math.floor(xs.length / 2)] ?? 0;
	yield* savePart("trace", {
		count,
		seed,
		wallMs: wall,
		medianRunMs: {today: median(ms(runs.today)), fixed: median(ms(runs.fixed))},
		mostChildren: {
			today: Math.max(...children(runs.today)),
			fixed: Math.max(...children(runs.fixed)),
		},
		endedRuns: {
			today: runs.today.filter((r) => r.ended).length,
			fixed: runs.fixed.filter((r) => r.ended).length,
		},
		childExitsAfterLane: {today: afterGone(runs.today), fixed: afterGone(runs.fixed)},
		nextStartsBeforeLastExits: {today: overlap(runs.today), fixed: overlap(runs.fixed)},
		checks,
	});
});

// ---------------------------------------------------------------- Q2: tests from the spec's paths

/** What a step of the graph is: the action TLC named, for which child, and the row's kind. */
const moveOf = (from: SpecState, to: SpecState, act: string) => {
	const at = (xs: readonly unknown[], ys: readonly unknown[]) =>
		xs.findIndex((x, i) => x !== ys[i]) + 1;
	if (act === "WriteRow") {
		const k = at(from.row, to.row);
		return {act, k, kind: to.row[k - 1] as "done" | "stuck"};
	}
	if (act === "Start" || act === "End") return {act, k: at(from.proc, to.proc)};
	if (act === "Deliver") return {act, k: at(from.exit, to.exit)};
	if (act === "SeeRow" || act === "SeeExit") return {act, k: at(from.seen, to.seen)};
	return {act, k: from.cur};
};

/** One script from the spec, the lane's moves its paths make, and how many paths gave it. */
export interface PathScript {
	readonly script: Script;
	readonly lane: readonly string[];
	readonly paths: number;
}

/** Every path from the start to a state with no way on, as scripts for the children, once each. */
const scriptsOf = (g: Graph) => {
	const by = new Map<string, {script: Script; lane: string[]; paths: number}>();
	let paths = 0;
	const walk = (id: string, pushes: Push[], lane: string[]) => {
		const out = g.edges.get(id) ?? [];
		const from = g.states.get(id);
		if (from === undefined) throw new Error(`no state ${id}`);
		if (out.length === 0) {
			paths += 1;
			const script = {pushes: [...pushes], laneSteps: lane.length};
			const key = JSON.stringify([script, lane]);
			const had = by.get(key);
			by.set(key, {script, lane: [...lane], paths: (had?.paths ?? 0) + 1});
			return;
		}
		for (const e of out) {
			const to = g.states.get(e.to);
			if (to === undefined) throw new Error(`no state ${e.to}`);
			const m = moveOf(from, to, e.act);
			if (m.act === "WriteRow" && "kind" in m && m.kind !== undefined)
				walk(e.to, [...pushes, {act: "WriteRow", k: m.k, kind: m.kind, after: lane.length}], lane);
			else if (m.act === "End")
				walk(e.to, [...pushes, {act: "End", k: m.k, after: lane.length}], lane);
			else if (m.act === "Deliver") walk(e.to, pushes, lane);
			else walk(e.to, pushes, [...lane, `${m.act}(${m.k})`]);
		}
	};
	walk(g.init, [], []);
	return {paths, scripts: [...by.values()]};
};

/** What one driven run says about one script. */
interface DrivenRun {
	readonly at: number;
	readonly stalled: boolean;
	/** The lane made the moves the path makes, in its order. */
	readonly sameLane: boolean;
	/** The children's moves and the lane's came in the path's own order (Deliver aside). */
	readonly samePath: boolean;
	readonly steps: readonly Step[];
	readonly ms: number;
}

const laneOf = (steps: readonly Step[]) =>
	steps.filter((s) => isLaneStep(s.act)).map((s) => `${s.act}(${s.k})`);
const orderOf = (steps: readonly Step[]) =>
	steps.filter((s) => s.act !== "Deliver").map((s) => `${s.act}(${s.k})`);
const pathOrder = (p: PathScript) => {
	const out: string[] = [];
	let i = 0;
	for (const push of p.script.pushes) {
		while (i < push.after) out.push(p.lane[i++] ?? "");
		out.push(`${push.act}(${push.k})`);
	}
	while (i < p.lane.length) out.push(p.lane[i++] ?? "");
	return out;
};

const driveAll = (variant: Variant, scripts: readonly PathScript[]) =>
	Effect.gen(function* () {
		const out: DrivenRun[] = [];
		for (const [at, p] of scripts.entries()) {
			const {a, ms} = yield* timed(driveCase({variant, script: p.script, n: N_PATHS}));
			out.push({
				at,
				stalled: a.stalled !== null,
				sameLane: JSON.stringify(laneOf(a.steps)) === JSON.stringify(p.lane),
				samePath: JSON.stringify(orderOf(a.steps)) === JSON.stringify(pathOrder(p)),
				steps: a.steps,
				ms,
			});
		}
		return out;
	});

/** A driven run passes: no stall, the path's lane moves, and TLC accepts its trace. */
const judgeDriven = (fixed: boolean, runs: readonly DrivenRun[]) =>
	Effect.gen(function* () {
		const r = yield* checkTraces(
			needJar(),
			{against: "v2", n: N_PATHS, fixed},
			runs.map((x) => x.steps),
		);
		if (!r.ok) return yield* Effect.die(new Error(`TLC failed:\n${r.out}`));
		return runs.map((x, i) => ({
			...x,
			accepted: r.verdicts[i]?.accepted === true,
			passed: !x.stalled && x.sameLane && r.verdicts[i]?.accepted === true,
		}));
	});

const graphs = (jar: string) =>
	Effect.gen(function* () {
		const out: Record<
			Variant,
			{scripts: PathScript[]; paths: number; distinct: number | null; ms: number}
		> = {
			fixed: {scripts: [], paths: 0, distinct: null, ms: 0},
			today: {scripts: [], paths: 0, distinct: null, ms: 0},
		};
		for (const variant of ["fixed", "today"] as const) {
			const g = yield* stateGraph(jar, `v2-${variant}`);
			const {paths, scripts} = scriptsOf(g.graph);
			out[variant] = {scripts, paths, distinct: g.distinct, ms: g.ms};
		}
		return out;
	});

const pathsStep = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	// 116's laws on the v2 spec first: the fixed wait keeps them, today's breaks the first, and
	// the last child is reachable (NeverTheLast must break).
	const laws = [];
	for (const cfg of ["v2-fixed", "v2-today", "v2-reach"]) {
		const c = yield* modelCheck(needJar(), cfg);
		laws.push(c);
		console.log(
			`${cfg}: ${c.passed ? "every law holds" : `breaks: ${c.broke}`}, ${c.distinct} states, ${c.ms} ms`,
		);
	}
	const g = yield* graphs(needJar());
	yield* fs.writeFileString(
		SCRIPTS,
		`${JSON.stringify({fixed: g.fixed.scripts, today: g.today.scripts}, null, "\t")}\n`,
	);
	const part: Record<string, unknown> = {};
	for (const spec of ["fixed", "today"] as const) {
		const s = g[spec];
		console.log(
			`spec ${spec}: ${s.distinct} states, ${s.paths} paths, ${s.scripts.length} scripts, TLC ${s.ms} ms`,
		);
		for (const variant of ["fixed", "today"] as const) {
			const t0 = performance.now();
			const runs = yield* judgeDriven(spec === "fixed", yield* driveAll(variant, s.scripts));
			const wall = Math.round(performance.now() - t0);
			const failed = runs.filter((r) => !r.passed);
			const row = {
				scripts: runs.length,
				passed: runs.length - failed.length,
				stalled: runs.filter((r) => r.stalled).length,
				otherLane: runs.filter((r) => !r.sameLane).length,
				rejected: runs.filter((r) => !r.accepted).length,
				samePath: runs.filter((r) => r.samePath).length,
				wallMs: wall,
				failed: failed.slice(0, 5).map((r) => ({
					script: s.scripts[r.at]?.script,
					lane: s.scripts[r.at]?.lane,
					got: laneOf(r.steps),
				})),
			};
			part[`${spec} spec, ${variant} lane`] = row;
			console.log(
				`  ${variant} lane: ${row.passed} of ${row.scripts} pass (stalled ${row.stalled}, other lane moves ${row.otherLane}, TLC rejects ${row.rejected}); followed the path exactly ${row.samePath}; ${wall} ms`,
			);
		}
	}
	yield* savePart("paths", {
		n: N_PATHS,
		laws,
		specs: {
			fixed: {
				states: g.fixed.distinct,
				paths: g.fixed.paths,
				scripts: g.fixed.scripts.length,
				tlcMs: g.fixed.ms,
			},
			today: {
				states: g.today.distinct,
				paths: g.today.paths,
				scripts: g.today.scripts.length,
				tlcMs: g.today.ms,
			},
		},
		runs: part,
	});
});

// ---------------------------------------------------------------- the arms, one child each

/** An arm's answer for the active mutant: killed or not, and why. */
interface ArmSays {
	readonly killed: boolean;
	readonly why: string;
	readonly ms: number;
}

/**
 * Trace validation's arm: Q1's 300 fixed-seed cases on both lanes, each checked against its own
 * spec.
 */
const armTrace = Effect.gen(function* () {
	const cases = yield* casesOf(Number(env("ARM_COUNT", "300")), SEED);
	for (const variant of ["fixed", "today"] as const) {
		const runs: Traced[] = [];
		for (const input of cases) runs.push(yield* traceOne(variant, input));
		const c = yield* checkRuns(
			{against: "v2", n: N_RUNS, fixed: variant === "fixed"},
			variant,
			runs,
		);
		if (c.rejected > 0) return {killed: true, why: `${variant}: ${Object.keys(c.why).join("; ")}`};
	}
	return {killed: false, why: ""};
});

/** The spec's tests' arm: every saved script on both lanes, each against its own spec. */
const armPaths = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const saved = JSON.parse(yield* fs.readFileString(SCRIPTS)) as Record<Variant, PathScript[]>;
	for (const variant of ["fixed", "today"] as const) {
		const runs = yield* judgeDriven(variant === "fixed", yield* driveAll(variant, saved[variant]));
		const bad = runs.find((r) => !r.passed);
		if (bad !== undefined)
			return {
				killed: true,
				why: `${variant}: script ${bad.at}${bad.stalled ? " stalled" : ""}${bad.sameLane ? "" : " other lane moves"}${bad.accepted ? "" : " rejected"}`,
			};
	}
	return {killed: false, why: ""};
});

const vitestArm = (files: readonly string[]) =>
	Effect.gen(function* () {
		const r = yield* runChild(
			"nice",
			["-n", "15", `${ROOT}/node_modules/.bin/vitest`, ...files, "--run"],
			{cwd: ROOT, env: childEnv()},
		);
		const failed = /(\d+) failed/.exec(r.out);
		return {
			killed: r.code !== 0,
			why: r.code === 0 ? "" : `exit ${r.code}${failed ? `, ${failed[1]} failed` : ""}`,
		};
	});

/** The environment a child gets: no key, and Stryker's active mutant passed on. */
const childEnv = (): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const k of [
		"PATH",
		"HOME",
		"TMPDIR",
		"TLA2TOOLS",
		"WORK",
		"ARM_COUNT",
		"__STRYKER_ACTIVE_MUTANT__",
	])
		if (process.env[k] !== undefined) out[k] = process.env[k] ?? "";
	return out;
};

const ARM_NAMES = ["tests", "property", "trace", "paths"] as const;
type Arm = (typeof ARM_NAMES)[number];
const isArm = (s: string | undefined): s is Arm => ARM_NAMES.some((a) => a === s);
/** Real-time limit on one arm: a mutant that loops for good is killed by it. */
const ARM_MS = 180_000;

const armOf = (name: Arm) => {
	switch (name) {
		case "tests":
			return vitestArm(["related", ...FILES]);
		case "property":
			return vitestArm(["packages/pipeline/src/hosted/lane-ends.test.ts"]);
		case "trace":
			return armTrace.pipe(Effect.orDie);
		case "paths":
			return armPaths.pipe(Effect.orDie);
	}
};

/** One arm on the active mutant, its answer as one JSON line. A defect is a kill, said as one. */
const armStep = (name: Arm) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const says = yield* armOf(name).pipe(
			Effect.catchDefect((d) =>
				Effect.succeed({killed: true, why: `defect: ${String(d).slice(0, 300)}`}),
			),
		);
		console.log(JSON.stringify({...says, ms: Math.round(performance.now() - t0)}));
	});

// ---------------------------------------------------------------- mutants

interface Mutant {
	readonly id: string;
	readonly key: string;
	readonly file: string;
	readonly mutator: string;
	readonly replacement: string;
	readonly start: {readonly line: number; readonly column: number};
	readonly end: {readonly line: number; readonly column: number};
	readonly original: string;
}

const needWork = () => {
	if (WORK === "") throw new Error("set WORK to a scratch folder outside the repo");
};

const readJson = <A>(file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return JSON.parse(yield* fs.readFileString(file)) as A;
	});

const writeJson = (file: string, value: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.writeFileString(file, `${JSON.stringify(value, null, "\t")}\n`);
	});

const offsetOf = (text: string, at: {line: number; column: number}) => {
	let off = 0;
	for (let l = 1; l < at.line; l++) off = text.indexOf("\n", off) + 1;
	return off + at.column;
};

/** A tiny seeded generator (mulberry32), so the sample is the same on every run. */
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

const shuffled = <T>(items: readonly T[], seed: number) => {
	const out = [...items];
	const next = seeded(seed);
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
};

const low = (file: string, args: readonly string[], cwd: string) =>
	runChild("nice", ["-n", "15", file, ...args], {cwd, env: childEnv()});

/** Copy this checkout's files into WORK/tree and install there, offline. */
const setup = Effect.gen(function* () {
	needWork();
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (yield* fs.exists(TREE)) yield* fs.remove(TREE, {recursive: true});
	const ls = yield* runChild("git", ["ls-files", "-co", "--exclude-standard"], {
		cwd: ROOT,
		env: childEnv(),
	});
	const files = ls.out.split("\n").filter((f) => f !== "");
	for (const f of files) {
		if (!(yield* fs.exists(path.join(ROOT, f)))) continue;
		yield* fs.makeDirectory(path.dirname(path.join(TREE, f)), {recursive: true});
		yield* fs.copyFile(path.join(ROOT, f), path.join(TREE, f));
	}
	const install = yield* low("pnpm", ["install", "--frozen-lockfile", "--offline"], TREE);
	console.log(`copied ${files.length} files; pnpm install exit ${install.code}`);
	if (install.code !== 0) return yield* Effect.die(new Error(install.out + install.err));
});

/** Every mutant Stryker's instrumenter makes of FILES, and a fixed-seed sample of SIZE. */
const sample = Effect.gen(function* () {
	needWork();
	const fs = yield* FileSystem.FileSystem;
	const stryker = env("STRYKER", "");
	if (stryker === "") return yield* Effect.die(new Error("set STRYKER to the stryker binary"));
	const base = stryker.slice(0, stryker.indexOf("/node_modules/"));
	const mod = yield* Effect.promise(
		() => import(`${base}/node_modules/@stryker-mutator/instrumenter/dist/src/index.js`),
	);
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
	const files: {name: string; content: string; mutate: true}[] = [];
	for (const f of FILES)
		files.push({
			name: `${TREE}/${f}`,
			content: yield* fs.readFileString(`${TREE}/${f}`),
			mutate: true,
		});
	const result = (yield* Effect.promise(() =>
		new mod.Instrumenter(logger).instrument(files, {
			plugins: null,
			excludedMutations: [],
			ignorers: [],
		}),
	)) as {
		mutants: readonly {
			id: string;
			fileName: string;
			mutatorName: string;
			replacement: string;
			location: {start: {line: number; column: number}; end: {line: number; column: number}};
		}[];
	};
	const texts = new Map(files.map((f) => [f.name, f.content]));
	const all: Mutant[] = result.mutants.map((m) => {
		const start = {line: m.location.start.line + 1, column: m.location.start.column};
		const end = {line: m.location.end.line + 1, column: m.location.end.column};
		const file = m.fileName.slice(TREE.length + 1);
		const text = texts.get(m.fileName) ?? "";
		return {
			id: m.id,
			key: `${file}@${start.line}:${start.column}-${end.line}:${end.column} ${m.mutatorName} ${m.replacement}`,
			file,
			mutator: m.mutatorName,
			replacement: m.replacement,
			start,
			end,
			original: text.slice(offsetOf(text, start), offsetOf(text, end)),
		};
	});
	const picked = shuffled(all, SEED).slice(0, SIZE);
	yield* writeJson(`${WORK}/all-mutants.json`, all);
	yield* writeJson(`${WORK}/sample.json`, picked);
	const byFile = (xs: readonly Mutant[]) =>
		Object.fromEntries(FILES.map((f) => [f, xs.filter((x) => x.file === f).length]));
	console.log(
		`${all.length} mutants ${JSON.stringify(byFile(all))}; sample ${picked.length} ${JSON.stringify(byFile(picked))}, seed ${SEED}`,
	);
});

/**
 * A file's text with one mutant put in by hand, as Stryker's own code has it; null: the text moved.
 * Stryker swaps a node of the tree, so a logical operator's new text goes in brackets: put in bare,
 * `a && b || c` inside `... && d` would read as `(a && b) || (c && d)`, not Stryker's mutant.
 */
const withMutant = (text: string, m: Mutant): string | null => {
	const a = offsetOf(text, m.start);
	const b = offsetOf(text, m.end);
	if (text.slice(a, b) !== m.original) return null;
	const put = m.mutator === "LogicalOperator" ? `(${m.replacement})` : m.replacement;
	return `${text.slice(0, a)}${put}${text.slice(b)}`;
};

type TscSays = {id: string; refused: boolean; errors: string[]};

/**
 * Each sampled mutant put in alone, the repo's own tsc (Effect's checks patched in), put back.
 * ONLY=<id,id> checks those again and keeps the rest of WORK/typecheck.json.
 */
const typecheck = Effect.gen(function* () {
	needWork();
	const fs = yield* FileSystem.FileSystem;
	const tsc = `${TREE}/node_modules/.bin/tsc`;
	const pkg = `${TREE}/packages/pipeline`;
	const clean = yield* low(tsc, ["--noEmit", "-p", "."], pkg);
	if (clean.code !== 0)
		return yield* Effect.die(new Error(`the clean copy does not typecheck:\n${clean.out}`));
	const only = env("ONLY", "")
		.split(",")
		.filter((s) => s !== "");
	const picked = (yield* readJson<Mutant[]>(`${WORK}/sample.json`)).filter(
		(m) => only.length === 0 || only.includes(m.id),
	);
	const out: TscSays[] =
		only.length === 0 ? [] : yield* readJson<TscSays[]>(`${WORK}/typecheck.json`);
	for (const m of picked) {
		const file = `${TREE}/${m.file}`;
		const text = yield* fs.readFileString(file);
		const mutated = withMutant(text, m);
		if (mutated === null) return yield* Effect.die(new Error(`${m.key}: the text moved`));
		yield* fs.writeFileString(file, mutated);
		const r: Exited = yield* low(tsc, ["--noEmit", "-p", "."], pkg).pipe(
			Effect.ensuring(fs.writeFileString(file, text).pipe(Effect.orDie)),
		);
		const checked = {
			id: m.id,
			refused: r.code !== 0,
			errors: r.out
				.split("\n")
				.filter((l) => /error TS\d+/.test(l))
				.slice(0, 2),
		};
		const at = out.findIndex((c) => c.id === m.id);
		if (at === -1) out.push(checked);
		else out[at] = checked;
		if (only.length > 0) console.log(m.id, checked.refused ? "refused" : "accepted");
	}
	yield* writeJson(`${WORK}/typecheck.json`, out);
	console.log(`typecheck: ${out.filter((c) => c.refused).length} of ${out.length} refused`);
});

/** Stryker calls this for each mutant: a sampled one tsc accepts runs every arm, each a child. */
const mutant = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const id = process.env.__STRYKER_ACTIVE_MUTANT__;
	if (id === undefined) return;
	const picked = yield* readJson<Mutant[]>(`${WORK}/sample.json`);
	const refused = new Set(
		(yield* readJson<{id: string; refused: boolean}[]>(`${WORK}/typecheck.json`))
			.filter((c) => c.refused)
			.map((c) => c.id),
	);
	if (!picked.some((m) => m.id === id) || refused.has(id)) return;
	yield* fs.makeDirectory(`${WORK}/arms`, {recursive: true});
	const says: Record<string, ArmSays> = {};
	for (const name of ARM_NAMES) {
		const t0 = performance.now();
		const r = yield* runChild(
			"nice",
			["-n", "15", "node", `${HERE}/139-tla-trace-validation.ts`, "arm", name],
			{
				cwd: ROOT,
				env: childEnv(),
			},
		).pipe(Effect.timeoutOption(ARM_MS));
		const ms = Math.round(performance.now() - t0);
		if (r._tag === "None") says[name] = {killed: true, why: "timeout", ms};
		else {
			const line = r.value.out.trim().split("\n").pop() ?? "";
			const parsed = (() => {
				try {
					return JSON.parse(line) as {killed: boolean; why: string};
				} catch {
					return {killed: true, why: `exit ${r.value.code}: ${r.value.err.slice(-200)}`};
				}
			})();
			says[name] = {...parsed, ms};
		}
		yield* writeJson(`${WORK}/arms/${id}.json`, says);
	}
	if (Object.values(says).some((s) => s.killed)) process.exitCode = 1;
});

const run = Effect.gen(function* () {
	needWork();
	const stryker = env("STRYKER", "");
	if (stryker === "") return yield* Effect.die(new Error("set STRYKER to the stryker binary"));
	const config = {
		$schema:
			"https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/core/schema/stryker-schema.json",
		testRunner: "command",
		commandRunner: {command: "node experiments/139-tla-trace-validation.ts mutant"},
		mutate: FILES,
		inPlace: true,
		coverageAnalysis: "off",
		concurrency: Number(env("CONCURRENCY", "6")),
		reporters: ["json"],
		jsonReporter: {fileName: `${WORK}/stryker-report.json`},
		tempDirName: `${WORK}/stryker-tmp`,
		timeoutMS: 4 * ARM_MS + 60_000,
	};
	yield* writeJson(`${WORK}/stryker.json`, config);
	const t0 = performance.now();
	const r = yield* runChild("nice", ["-n", "15", stryker, "run", `${WORK}/stryker.json`], {
		cwd: TREE,
		env: childEnv(),
	});
	const fs = yield* FileSystem.FileSystem;
	yield* fs.writeFileString(`${WORK}/stryker.log`, r.out + r.err);
	console.log(
		`stryker exit ${r.code} in ${Math.round((performance.now() - t0) / 1000)} s; log in WORK/stryker.log`,
	);
});

/** One vitest run in the copy, with its JSON report: each test file and how it did; null: out of time. */
const vitestFiles = (filters: readonly string[], ms: number) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const json = `${WORK}/vitest.json`;
		if (yield* fs.exists(json)) yield* fs.remove(json);
		const r = yield* low(
			`${TREE}/node_modules/.bin/vitest`,
			[...filters, "--run", "--reporter=json", `--outputFile=${json}`],
			TREE,
		).pipe(Effect.timeoutOption(ms));
		if (r._tag === "None" || !(yield* fs.exists(json))) return null;
		const rep = yield* readJson<{testResults: {name: string; status: string}[]}>(json);
		return rep.testResults.map((t) => ({
			file: t.name.slice(TREE.length + 1),
			passed: t.status === "passed",
		}));
	});

/**
 * For each mutant the repo's tests caught: which test files failed. The tests arm runs every test
 * related to FILES, 116's property test and 139's own examples among them; this splits its kills.
 * Each mutant is put in by hand, as in `typecheck`, after Stryker is done with the copy. When the
 * whole run is out of time, each file runs alone, with a minute each.
 */
const split = Effect.gen(function* () {
	needWork();
	const fs = yield* FileSystem.FileSystem;
	const clean = yield* vitestFiles(["related", ...FILES], ARM_MS);
	if (clean === null || clean.some((t) => !t.passed))
		return yield* Effect.die(new Error("the clean copy's related tests do not pass"));
	const picked = yield* readJson<Mutant[]>(`${WORK}/sample.json`);
	const out: Record<string, readonly string[]> = {};
	for (const m of picked) {
		const armsFile = `${WORK}/arms/${m.id}.json`;
		if (!(yield* fs.exists(armsFile))) continue;
		const arms = yield* readJson<Partial<Record<Arm, ArmSays>>>(armsFile);
		if (arms.tests?.killed !== true) continue;
		const file = `${TREE}/${m.file}`;
		const text = yield* fs.readFileString(file);
		const mutated = withMutant(text, m);
		if (mutated === null) return yield* Effect.die(new Error(`${m.key}: the text moved`));
		yield* fs.writeFileString(file, mutated);
		const failing = Effect.gen(function* () {
			const all = yield* vitestFiles(["related", ...FILES], ARM_MS);
			if (all !== null) return all.filter((t) => !t.passed).map((t) => t.file);
			const each: string[] = [];
			for (const t of clean) {
				const one = yield* vitestFiles([t.file], 60_000);
				if (one === null) each.push(`${t.file} (timeout)`);
				else if (one.some((x) => !x.passed)) each.push(t.file);
			}
			return each;
		});
		out[m.id] = yield* failing.pipe(
			Effect.ensuring(fs.writeFileString(file, text).pipe(Effect.orDie)),
		);
		console.log(m.id, out[m.id]?.join(", "));
	}
	yield* writeJson(`${WORK}/split.json`, out);
});

const report = Effect.gen(function* () {
	needWork();
	const fs = yield* FileSystem.FileSystem;
	const picked = yield* readJson<Mutant[]>(`${WORK}/sample.json`);
	const checked = new Map(
		(yield* readJson<{id: string; refused: boolean; errors: string[]}[]>(
			`${WORK}/typecheck.json`,
		)).map((c) => [c.id, c]),
	);
	const rep = yield* readJson<{
		files: Record<
			string,
			{
				mutants: {
					id: string;
					mutatorName: string;
					replacement?: string;
					status: string;
					location: {start: {line: number; column: number}; end: {line: number; column: number}};
				}[];
			}
		>;
	}>(`${WORK}/stryker-report.json`);
	// Stryker's report and the instrumenter count columns from different bases; lines, the
	// mutator and the replacement must agree.
	const same = (
		file: string,
		line: number,
		endLine: number,
		mutator: string,
		replacement: string,
	) => `${file}@${line}-${endLine} ${mutator} ${replacement}`;
	const strykerById = new Map<string, {status: string; key: string}>();
	for (const [file, f] of Object.entries(rep.files)) {
		const rel = file.startsWith(TREE) ? file.slice(TREE.length + 1) : file;
		for (const m of f.mutants)
			strykerById.set(m.id, {
				status: m.status,
				key: same(
					rel,
					m.location.start.line,
					m.location.end.line,
					m.mutatorName,
					m.replacement ?? "",
				),
			});
	}
	const rows = [];
	let moved = 0;
	for (const m of picked) {
		const s = strykerById.get(m.id);
		if (
			s !== undefined &&
			s.key !== same(m.file, m.start.line, m.end.line, m.mutator, m.replacement)
		)
			moved += 1;
		const armsFile = `${WORK}/arms/${m.id}.json`;
		const arms = (yield* fs.exists(armsFile))
			? yield* readJson<Record<Arm, ArmSays>>(armsFile)
			: null;
		rows.push({
			...m,
			refused: checked.get(m.id)?.refused ?? null,
			stryker: s?.status ?? null,
			arms,
		});
	}
	if (moved > 0)
		return yield* Effect.die(new Error(`${moved} sampled mutants do not match Stryker's by id`));
	const ran = rows.filter((r) => r.refused === false && r.arms !== null);
	const splitFile = `${WORK}/split.json`;
	const failed = (yield* fs.exists(splitFile))
		? yield* readJson<Record<string, readonly string[]>>(splitFile)
		: {};
	const k = (r: (typeof ran)[number], a: Arm) => r.arms?.[a]?.killed === true;
	const spec = (r: (typeof ran)[number]) => k(r, "trace") || k(r, "paths");
	const count = (p: (r: (typeof ran)[number]) => boolean) => ran.filter(p).length;
	const survivors = ran.filter((r) => ARM_NAMES.every((a) => !k(r, a)));
	const medianMs = (a: Arm) => {
		const xs = ran.map((r) => r.arms?.[a]?.ms ?? 0).sort((x, y) => x - y);
		return xs[Math.floor(xs.length / 2)] ?? 0;
	};
	const byTestFile: Record<string, number> = {};
	for (const files of Object.values(failed))
		for (const f of files) byTestFile[f] = (byTestFile[f] ?? 0) + 1;
	/** A failing file, with split's " (timeout)" taken off. */
	const fileOf = (f: string) => f.replace(/ \(timeout\)$/, "");
	const ours = (f: string) => fileOf(f).endsWith("lane-trace.test.ts");
	const byFile = (xs: readonly Mutant[]) =>
		Object.fromEntries(FILES.map((f) => [f, xs.filter((x) => x.file === f).length]));
	const part = {
		seed: SEED,
		sample: picked.length,
		sampleByFile: byFile(picked),
		refusedByTsc: rows.filter((r) => r.refused === true).length,
		ran: ran.length,
		ranByFile: byFile(ran),
		killed: Object.fromEntries(ARM_NAMES.map((a) => [a, count((r) => k(r, a))])),
		killedByAny: ran.length - survivors.length,
		killedBySpec: count(spec),
		pairs: {
			traceNotProperty: count((r) => k(r, "trace") && !k(r, "property")),
			pathsNotProperty: count((r) => k(r, "paths") && !k(r, "property")),
			propertyNotTrace: count((r) => k(r, "property") && !k(r, "trace")),
			propertyNotPaths: count((r) => k(r, "property") && !k(r, "paths")),
			specNotTests: count((r) => spec(r) && !k(r, "tests")),
			testsNotSpec: count((r) => k(r, "tests") && !spec(r)),
		},
		medianArmMs: Object.fromEntries(ARM_NAMES.map((a) => [a, medianMs(a)])),
		/** Of the mutants the tests arm caught, how many each test file failed on. */
		byTestFile,
		/** Caught by the tests arm only through 139's own example tests. */
		onlyLaneTrace: Object.entries(failed)
			.filter(([, files]) => files.length > 0 && files.every(ours))
			.map(([id]) => id),
		/** Caught by a test file that was there before 139. */
		byOlderTests: Object.values(failed).filter((files) => files.some((f) => !ours(f))).length,
		/** Caught by the spec's arms, and by no test file that was there before 139 nor the property arm. */
		specNotOlderTests: count(
			(r) => spec(r) && !k(r, "property") && !(failed[r.id] ?? []).some((f) => !ours(f)),
		),
		mutants: ran.map((r) => ({
			id: r.id,
			key: r.key,
			original: r.original,
			killedBy: ARM_NAMES.filter((a) => k(r, a)),
			testFiles: failed[r.id] ?? null,
			trace: r.arms?.trace?.why || null,
			paths: r.arms?.paths?.why || null,
		})),
	};
	console.log(JSON.stringify({...part, mutants: part.mutants.length}, null, 1));
	yield* savePart("mutants", part);
});

// ---------------------------------------------------------------- the steps

const [step, arg] = process.argv.slice(2);
const steps = {trace, paths: pathsStep, setup, sample, typecheck, mutant, run, split, report};
const isStep = (s: string | undefined): s is keyof typeof steps =>
	s !== undefined && Object.hasOwn(steps, s);
const main = isStep(step)
	? steps[step]
	: step === "arm" && isArm(arg)
		? armStep(arg)
		: Effect.sync(() =>
				console.log(`steps: ${Object.keys(steps).join(" | ")} | arm <${ARM_NAMES.join("|")}>`),
			);

// Node at this edge: the runtime runs the script, with Node's file system and child processes.
await Effect.runPromise(main.pipe(Effect.provide(nodeServices)));
