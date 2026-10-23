// Experiment 119: on mutants nobody wrote for either tool, does our checker catch any that
// property tests miss?
//
// StrykerJS makes small edits (mutants) to the real stage reducers. For each mutant, two arms run
// the same laws and worlds, at today's bounds, none of them changed:
//   A  our checkers: `laws/explore.ts` on the machine's laws, `laws/world/search.ts` on the worlds;
//   B  experiment 118's property walks (`laws/walk.ts`, `laws/sample.ts`) on the same laws and
//      worlds: 5 seeds, 10 s each (a seed counts at 1 s when it caught within 1,000 ms), then the
//      swarm walk where the plain one missed on some seed.
// B walks the whole suite as one property: the first choice picks which law and world to walk.
// Where A killed a mutant and B's suite missed on some seed, B gets a second go the way 118 ran
// it: 10 s a seed on each check A broke, alone.
//
// Run with (Stryker is not in the workspace: install it once, anywhere outside the repo)
//   npm i --prefix <dir> @stryker-mutator/core@9.6.1
//   STRYKER=<dir>/node_modules/.bin/stryker GROUPS=ship,loop CONCURRENCY=8 node experiments/119-mutation-testing.ts run
//   node experiments/119-mutation-testing.ts report        # joins Stryker's report with the rows
// Stryker calls this same script once per mutant (`mutant`), which runs each arm as a child
// process (`arm A`, `arm B`, `arm F`) with a time limit. The run's files go to runs/119/.
// No model, no key, no network. Writes results/119-mutation-testing.json.

import {spawnSync} from "node:child_process";
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {explore, type Law, type Update, type World} from "@kampus/pipeline/laws/explore";
import * as loop from "@kampus/pipeline/laws/loop";
import * as review from "@kampus/pipeline/laws/review";
import {CHOICE, sample} from "@kampus/pipeline/laws/sample";
import * as ship from "@kampus/pipeline/laws/ship";
import {type Machine, type Walked, walk, walkEnds, walkWorld} from "@kampus/pipeline/laws/walk";
import {type LanesOptions, lanesWorld} from "@kampus/pipeline/laws/world/lanes";
import {asksReachTheOwner, LANE_LAWS} from "@kampus/pipeline/laws/world/laws";
import {type Safety, type System, search} from "@kampus/pipeline/laws/world/search";
import {MAX_WAITS as REVIEW_MAX_WAITS} from "@kampus/pipeline/stages/review/machine";
import {MAX_WAITS as SHIP_MAX_WAITS} from "@kampus/pipeline/stages/ship/machine";
import {Arbitrary, Effect, Result} from "effect";

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const HERE = import.meta.dirname;
const ROOT = HERE.slice(0, HERE.lastIndexOf("/"));
const RUN = env("RUN_DIR", `${ROOT}/runs/119`);
const OUT = `${HERE}/results/119-mutation-testing.json`;
const BUDGET_MS = 10_000;
const SHORT_MS = 1_000;
const SEEDS = [1, 2, 3, 4, 5];
const ONE_LENGTH = 60;
const WORLD_LENGTH = 150;
const ENDS_LIMIT = 400;
const WORLD_DEPTH = 200;
const ARM_A_MS = 180_000;
const ARM_B_MS = 600_000;

/** The files Stryker edits, by group. Each is a reducer the laws step, or a rule only it calls. */
const FILES: Record<string, readonly string[]> = {
	ship: [
		"packages/pipeline/src/stages/ship/machine.ts",
		"packages/pipeline/src/stages/ship/gate.ts",
	],
	loop: [
		"packages/pipeline/src/stages/operate/machine.ts",
		"packages/pipeline/src/stages/operate/stop.ts",
	],
	review: ["packages/pipeline/src/stages/review/machine.ts"],
};

// ---------------------------------------------------------------- the checks, as today's tests run them

/** One failing run: the check, the law, why, and the steps. */
interface Failed {
	readonly check: string;
	readonly law: string;
	readonly why: string;
	readonly path: readonly string[];
}

/** One check our checker runs, and the walks a property test takes over the same thing. */
interface Check {
	readonly name: string;
	readonly ours: () => Failed | null;
	readonly walks: readonly Walker[];
}

interface Walker {
	readonly check: string;
	readonly length: number;
	readonly walk: (choices: readonly number[]) => Walked;
	/** The swarm walk: one machine only. */
	readonly swarm: ((choices: readonly number[]) => Walked) | null;
}

/** A reducer that throws on a walk breaks "update throws", as `walk` says it for one machine. */
const guarded =
	(run: (choices: readonly number[]) => Walked) =>
	(choices: readonly number[]): Walked =>
		Result.match(
			Result.try({
				try: () => run(choices),
				catch: (e) => (e instanceof Error ? e.message : `${e}`),
			}),
			{
				onSuccess: (w) => w,
				onFailure: (why) => ({broke: {law: "update throws", why}, path: []}),
			},
		);

/** One machine, explored to `depth` (the bound today's test gives it). */
const one = <S, M extends {readonly type: string}, C>(
	name: string,
	machine: Machine<S, M, C>,
	depth: number,
): Check => ({
	name,
	ours: () => {
		const r = explore({...machine, laws: machine.laws(), depth});
		const b = r.broken[0];
		return b === undefined
			? null
			: {check: name, law: b.law, why: b.why, path: b.path.map(machine.show)};
	},
	walks: [
		{
			check: name,
			length: ONE_LENGTH,
			walk: guarded((cs) => walk(machine, cs)),
			swarm: guarded((cs) => walk(machine, cs, undefined, true)),
		},
	],
});

/** A world, searched to depth 200 as `world.test.ts` does, with "every lane ends" when it asks for it. */
const world = <W, N>(
	name: string,
	sys: System<W, N>,
	laws: readonly Safety<W, N>[],
	eventually: boolean,
): Check => ({
	name,
	ours: () => {
		const r = Result.try({
			try: () => search(sys, {laws, depth: WORLD_DEPTH, eventually}),
			catch: (e) => (e instanceof Error ? e.message : `${e}`),
		});
		if (Result.isFailure(r)) return {check: name, law: "update throws", why: r.failure, path: []};
		const b = r.success.broken[0];
		if (b !== undefined) return {check: name, law: b.law, why: b.why, path: b.path};
		const lasso = r.success.lassos?.[0];
		if (lasso !== undefined)
			return {
				check: name,
				law: "every lane ends",
				why: `L${lasso.lane + 1} goes round a fair loop for good`,
				path: [...lasso.prefix, ...lasso.cycle],
			};
		const dead = r.success.dead?.[0];
		if (dead !== undefined)
			return {
				check: name,
				law: "every lane ends",
				why: `L${dead.lane + 1} is open and nothing must happen`,
				path: dead.path,
			};
		return null;
	},
	walks: [
		{
			check: name,
			length: WORLD_LENGTH,
			walk: guarded((cs) => walkWorld(sys, laws, cs)),
			swarm: null,
		},
		...(eventually
			? [
					{
						check: `${name}, every lane ends`,
						length: WORLD_LENGTH,
						walk: guarded((cs) => walkEnds(sys, cs, ENDS_LIMIT)),
						swarm: null,
					},
				]
			: []),
	],
});

const loopMachine = (
	w: World<loop.Loop, Parameters<typeof loop.showLoopMsg>[0], loop.LoopCmd>,
	laws: () => readonly Law<
		loop.Loop,
		Parameters<typeof loop.showLoopMsg>[0],
		loop.LoopCmd
	>[] = loop.loopLaws,
) => ({init: loop.loopInit, update: loop.loopStep, world: w, laws, show: loop.showLoopMsg});
const ending = (last: number) => () => [...loop.loopLaws(), loop.endsBy(last)];

// The worlds of world.test.ts that run the real reducers (`REAL`): every one that must hold.
const TWO: LanesOptions = {lanes: 2, tickets: "own", queue: true, forms: ["pass", "fail 1"]};
const ONE: LanesOptions = {...TWO, lanes: 1};
const SAME: LanesOptions = {...TWO, tickets: "same", forms: ["pass"]};
const SAME_FAIL: LanesOptions = {...TWO, tickets: "same", fails: 1};
const NO_QUEUE: LanesOptions = {...TWO, queue: false};
const WORLDS: readonly Check[] = [
	world("world: two lanes, own tickets", lanesWorld(TWO), LANE_LAWS, true),
	world("world: no queue", lanesWorld(NO_QUEUE), LANE_LAWS, true),
	world("world: no queue, up to date", lanesWorld({...NO_QUEUE, upToDate: true}), LANE_LAWS, false),
	world("world: one ticket", lanesWorld(SAME), LANE_LAWS, true),
	world("world: one ticket, may fail", lanesWorld(SAME_FAIL), LANE_LAWS, true),
	world("world: desk", lanesWorld({...ONE, desk: true}), [asksReachTheOwner], false),
	world("world: desk, eventually", lanesWorld({...ONE, desk: true}), [asksReachTheOwner], true),
	world(
		"world: desk, fail 1",
		lanesWorld({...ONE, desk: true, forms: ["fail 1"]}),
		[asksReachTheOwner],
		true,
	),
	world(
		"world: desk, outsider",
		lanesWorld({...ONE, desk: true, queue: false, outsider: 2}),
		[asksReachTheOwner],
		true,
	),
];

// The machine tests of laws.test.ts that must hold, at their bounds.
const MACHINES: Record<string, readonly Check[]> = {
	ship: [
		one(
			"ship",
			{
				init: ship.shipInit,
				update: ship.shipStep as Update<ship.Keeping, ship.AnyShipMsg, ship.ShipCmd>,
				world: ship.shipWorld() as World<ship.Keeping, ship.AnyShipMsg, ship.ShipCmd>,
				laws: () => ship.shipLaws<ship.Keeping>(),
				show: ship.showShipMsg,
			},
			2 * SHIP_MAX_WAITS + 20,
		),
	],
	review: [
		one(
			"review",
			{
				init: review.reviewInit,
				update: review.reviewStep,
				world: review.reviewWorld(),
				laws: review.reviewLaws,
				show: review.showReviewMsg,
			},
			2 * REVIEW_MAX_WAITS + 8,
		),
	],
	loop: [
		one("loop", loopMachine(loop.loopWorld()), 14),
		one("loop, one head", loopMachine(loop.loopWorld({heads: ["A"]})), 14),
		one("loop, echoes", loopMachine(loop.loopWorld({echoes: true})), 7),
		one(
			"loop, ends by round 3",
			loopMachine(loop.loopWorld({reviews: 4, heads: ["A"], opens: [1]}), ending(3)),
			20,
		),
		one(
			"loop, ends by round 6",
			loopMachine(loop.loopWorld({reviews: 7, heads: ["A"], opens: [1, 2]}), ending(6)),
			26,
		),
	],
};

/** Every group's checks: the machine's own, then the worlds, which step every real reducer. */
const checksOf = (group: string): readonly Check[] => [...(MACHINES[group] ?? []), ...WORLDS];

// ---------------------------------------------------------------- the arms

/** Arm A: every check, by our checkers. A mutant is killed when any check fails. */
const armA = (group: string) => {
	const started = performance.now();
	const failed: (Failed & {readonly ms: number})[] = [];
	for (const c of checksOf(group)) {
		const t = performance.now();
		const f = c.ours();
		if (f !== null) failed.push({...f, ms: Math.round(performance.now() - t)});
	}
	return {killed: failed.length > 0, ms: Math.round(performance.now() - started), failed};
};

/** One property over the whole suite: the first choice picks the walk, the rest walk it. */
const suiteWalk =
	(walkers: readonly Walker[], swarm: boolean) =>
	(cs: readonly number[]): Walked => {
		const w = walkers[(cs[0] ?? 0) % walkers.length] as Walker;
		const run = swarm ? (w.swarm ?? w.walk) : w.walk;
		const r = run(cs.slice(1, 1 + w.length + (swarm ? 1 : 0)));
		return r.broke === null ? r : {...r, broke: {...r.broke, law: `${w.check}: ${r.broke.law}`}};
	};

const seeds = (run: (cs: readonly number[]) => Walked, length: number) =>
	Effect.gen(function* () {
		const out = [];
		for (const seed of SEEDS) {
			const s = yield* sample(run, {ms: BUDGET_MS, seed, length});
			out.push({seed, ...s, length: s.path?.length ?? null});
		}
		return out;
	});

const tally = (runs: readonly {readonly caught: boolean; readonly ms: number}[]) => ({
	short: runs.filter((r) => r.caught && r.ms <= SHORT_MS).length,
	long: runs.filter((r) => r.caught).length,
});

/** Arm B: the suite as one property, plain then swarm where plain missed on some seed. */
const armB = (group: string) =>
	Effect.gen(function* () {
		const walkers = checksOf(group).flatMap((c) => c.walks);
		const length = 1 + Math.max(...walkers.map((w) => w.length));
		const plain = yield* seeds(suiteWalk(walkers, false), length);
		const missed = plain.some((s) => !s.caught);
		const swarm = missed ? yield* seeds(suiteWalk(walkers, true), length + 1) : null;
		return {plain, swarm};
	});

/** Arm B again, the way 118 ran it: each named check alone, 10 s a seed, plain and swarm. */
const armF = (group: string, names: readonly string[]) =>
	Effect.gen(function* () {
		const out = [];
		for (const name of names) {
			const c = checksOf(group).find((x) => x.name === name);
			if (c === undefined) continue;
			for (const w of c.walks) {
				const plain = yield* seeds(w.walk, w.length);
				const swarm = w.swarm === null ? null : yield* seeds(w.swarm, w.length + 1);
				out.push({check: w.check, plain, swarm});
			}
		}
		return out;
	});

// ---------------------------------------------------------------- the quiet rerun: a fixed number of walks

/**
 * `sample`, stopped by a count of walks instead of the clock. The inputs are the same ones
 * `sample` draws (batches of 100, seed `<seed>:<round>`), so a busy machine changes nothing.
 */
const counted = (
	run: (cs: readonly number[]) => Walked,
	o: {readonly walks: number; readonly seed: number; readonly length: number},
) =>
	Effect.gen(function* () {
		const choices = Arbitrary.array(Arbitrary.schema(CHOICE), {maxLength: o.length});
		const started = performance.now();
		let runs = 0;
		for (let round = 0; runs < o.walks; round++) {
			const r = yield* Arbitrary.checkEffect(choices, (cs) => run(cs).broke === null, {
				runs: 100,
				size: o.length * 4,
				seed: `${o.seed}:${round}`,
				maxShrinks: 5_000,
			});
			if (r._tag === "Falsified") {
				const shrunk = run(r.shrunkInput);
				return {
					seed: o.seed,
					caught: true,
					ms: Math.round(performance.now() - started),
					runs: runs + r.runs,
					path: shrunk.path,
					why: shrunk.broke?.why ?? null,
				} satisfies Seeded;
			}
			runs += 100;
		}
		return {
			seed: o.seed,
			caught: false,
			ms: Math.round(performance.now() - started),
			runs,
			path: null,
			why: null,
		} satisfies Seeded;
	});

const countedSeeds = (run: (cs: readonly number[]) => Walked, length: number, walks: number) =>
	Effect.gen(function* () {
		const out: Seeded[] = [];
		for (const seed of SEEDS) out.push(yield* counted(run, {walks, seed, length}));
		return out;
	});

/** Walks in 10 s on a quiet machine, by walk name: the suite plain, the suite swarm, each check alone. */
type Counts = Readonly<Record<string, number>>;
const SUITE = "suite";
const SUITE_SWARM = "suite, swarm";

/** How many walks each walk gets in 10 s, here, on no mutant: the median of the 5 seeds. */
const calibrate = (group: string) =>
	Effect.gen(function* () {
		const walkers = checksOf(group).flatMap((c) => c.walks);
		const length = 1 + Math.max(...walkers.map((w) => w.length));
		const median = (xs: readonly Seeded[]) =>
			[...xs.map((x) => x.runs)].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
		const counts: Record<string, number> = {
			[SUITE]: median(yield* seeds(suiteWalk(walkers, false), length)),
			[SUITE_SWARM]: median(yield* seeds(suiteWalk(walkers, true), length + 1)),
		};
		// Each check alone: one seed of 10 s is enough to size it.
		for (const w of walkers) {
			counts[w.check] = (yield* sample(w.walk, {ms: BUDGET_MS, seed: 1, length: w.length})).runs;
			if (w.swarm !== null)
				counts[`${w.check}, swarm`] = (yield* sample(w.swarm, {
					ms: BUDGET_MS,
					seed: 1,
					length: w.length + 1,
				})).runs;
		}
		return counts;
	});

/** Arm B on a quiet machine, by count: the suite, plain and swarm, then each check our checker broke, alone. */
const armQ = (group: string, counts: Counts) =>
	Effect.gen(function* () {
		const a = armA(group);
		const walkers = checksOf(group).flatMap((c) => c.walks);
		const length = 1 + Math.max(...walkers.map((w) => w.length));
		const plain = yield* countedSeeds(suiteWalk(walkers, false), length, counts[SUITE] ?? 0);
		const swarm = yield* countedSeeds(
			suiteWalk(walkers, true),
			length + 1,
			counts[SUITE_SWARM] ?? 0,
		);
		const focused = [];
		for (const name of new Set(a.failed.map((f) => f.check))) {
			const c = checksOf(group).find((x) => x.name === name);
			for (const w of c?.walks ?? []) {
				const p = yield* countedSeeds(w.walk, w.length, counts[w.check] ?? 0);
				const s =
					w.swarm === null
						? null
						: yield* countedSeeds(w.swarm, w.length + 1, counts[`${w.check}, swarm`] ?? 0);
				focused.push({check: w.check, plain: p, swarm: s});
			}
		}
		return {a, plain, swarm, focused};
	});
type ArmQ = Effect.Success<ReturnType<typeof armQ>>;

/** The ids to run again: every "only A", and every one where B's seeds disagreed. */
const QUIET_IDS = (group: string) => `${RUN}/quiet-${group}.json`;

/**
 * Run inside a Stryker dry run, so the files hold every mutant: each chosen mutant alone, one
 * child process at a time, with nothing else running.
 */
const quiet = (group: string) => {
	mkdirSync(`${RUN}/quiet`, {recursive: true});
	// CRASHES=1: only say why arm A crashed, for each mutant it crashed on.
	if (env("CRASHES", "0") === "1") {
		const crashed: readonly string[] = JSON.parse(
			readFileSync(`${RUN}/crashes-${group}.json`, "utf8"),
		);
		const out: Record<string, string | null> = {};
		for (const id of crashed) out[id] = child<ArmA>(["arm", "A", group], ARM_A_MS, id).why;
		writeFileSync(`${RUN}/quiet/${group}-crashes.json`, JSON.stringify(out, null, "\t"));
		return;
	}
	const ids: readonly string[] = JSON.parse(readFileSync(QUIET_IDS(group), "utf8"));
	const counts = child<Counts>(["calibrate", group], ARM_B_MS);
	if (!counts.ok) throw new Error(`calibrate: ${counts.why}`);
	writeFileSync(`${RUN}/quiet/${group}-counts.json`, JSON.stringify(counts.value));
	console.log(`counts ${JSON.stringify(counts.value)}`);
	for (const id of ids) {
		const q = child<ArmQ>(["arm", "Q", group, JSON.stringify(counts.value)], ARM_B_MS * 4, id);
		writeFileSync(`${RUN}/quiet/${group}-${id}.json`, JSON.stringify({id, group, q}));
		console.log(`quiet ${group}#${id}: ${q.ok ? "ok" : q.why}`);
	}
};

// ---------------------------------------------------------------- the loop sample

/** The loop has too many mutants for the time cap: a seeded random 150 of them run, the rest exit at once. */
const SAMPLE_SEED = 119;
const SAMPLE_SIZE = 150;

/** Every mutant id in the instrumented files, while Stryker has them in place. */
const poolOf = (group: string): readonly number[] => {
	const ids = new Set<number>();
	for (const f of FILES[group] ?? [])
		for (const m of readFileSync(`${ROOT}/${f}`, "utf8").matchAll(/stryMutAct_9fa48\("(\d+)"\)/g))
			ids.add(Number(m[1]));
	return [...ids].sort((a, b) => a - b);
};

/** Mulberry32, seeded: the same 150 every time. */
const sampleOf = (pool: readonly number[]): ReadonlySet<string> => {
	let t = SAMPLE_SEED;
	const next = () => {
		t = (t + 0x6d2b79f5) | 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
	};
	const xs = [...pool];
	for (let i = xs.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[xs[i], xs[j]] = [xs[j] as number, xs[i] as number];
	}
	return new Set(xs.slice(0, SAMPLE_SIZE).map(String));
};
const SAMPLED: Record<string, boolean> = {loop: true};

// ---------------------------------------------------------------- one mutant, as Stryker calls it

const mutantId = () => process.env.__STRYKER_ACTIVE_MUTANT__ ?? "none";

/** One seed of a property test, as `seeds` gives it. */
interface Seeded {
	readonly seed: number;
	readonly caught: boolean;
	readonly ms: number;
	readonly runs: number;
	readonly path: readonly string[] | null;
	readonly why: string | null;
}
type ArmA = ReturnType<typeof armA>;
interface ArmB {
	readonly plain: readonly Seeded[];
	readonly swarm: readonly Seeded[] | null;
}
type ArmF = readonly (ArmB & {readonly check: string})[];
/** An arm's answer, or why there is none: it ran past its limit, or crashed. */
type Ran<T> =
	| {readonly ok: true; readonly why: null; readonly ms: number; readonly value: T}
	| {readonly ok: false; readonly why: string; readonly ms: number; readonly value: null};
/** What `mutant` writes for one mutant. */
interface Row {
	readonly id: string;
	readonly group: string;
	readonly a: Ran<ArmA>;
	readonly b: Ran<ArmB>;
	readonly f: Ran<ArmF> | null;
}

/** A crash, said short: the error line and the first place it was thrown, with repo-relative paths. */
const crashOf = (stderr: string): string => {
	const lines = stderr.split("\n").map((l) => l.trim());
	const i = lines.findIndex((l) => /^[A-Za-z]*Error\b/.test(l));
	const said = i < 0 ? (lines.filter((l) => l !== "").at(-1) ?? "") : lines[i];
	const at = i < 0 ? "" : (lines.slice(i + 1).find((l) => l.startsWith("at ")) ?? "");
	const top = lines[0]?.startsWith("file://") === true ? lines[0] : "";
	return `${said} ${at} ${top}`.replaceAll(`file://${ROOT}/`, "").replaceAll(ROOT, "").trim();
};

/** Run one arm in a child process, so a mutant that loops for good or blows up stops at a limit. */
const child = <T>(args: readonly string[], ms: number, mutant?: string): Ran<T> => {
	const started = performance.now();
	// Node at this edge: a child process with a wall-time limit, which an Effect run cannot stop in sync code.
	const r = spawnSync(process.execPath, [import.meta.filename, ...args], {
		encoding: "utf8",
		timeout: ms,
		maxBuffer: 64 * 1024 * 1024,
		env: mutant === undefined ? process.env : {...process.env, __STRYKER_ACTIVE_MUTANT__: mutant},
	});
	const took = Math.round(performance.now() - started);
	const line = r.stdout?.trim().split("\n").at(-1) ?? "";
	if (r.error !== undefined || r.signal !== null)
		return {ok: false as const, why: "timeout", ms: took, value: null};
	if (r.status !== 0 || !line.startsWith("{"))
		return {
			ok: false as const,
			why: `crash: ${crashOf(r.stderr)}`,
			ms: took,
			value: null,
		};
	return {ok: true as const, why: null, ms: took, value: JSON.parse(line)};
};

const anyCaught = (runs: readonly {readonly caught: boolean}[] | null) =>
	runs?.some((r) => r.caught) ?? false;

const mutant = (group: string) => {
	const id = mutantId();
	if (SAMPLED[group] === true) {
		const chosen = sampleOf(poolOf(group));
		writeFileSync(
			`${RUN}/sample-${group}.json`,
			JSON.stringify([...chosen].sort((x, y) => +x - +y)),
		);
		// Not in the sample: Stryker counts it as survived; the report leaves it out.
		if (id !== "none" && !chosen.has(id)) return;
	}
	const a = child<ArmA>(["arm", "A", group], ARM_A_MS);
	const b = child<ArmB>(["arm", "B", group], ARM_B_MS);
	const aKilled = a.ok ? a.value.killed : true;
	const bKilled = b.ok ? anyCaught(b.value.plain) || anyCaught(b.value.swarm) : true;
	const bAll = b.ok && tally(b.value.plain).long === SEEDS.length;
	const names = a.ok ? [...new Set(a.value.failed.map((x) => x.check))] : [];
	const f =
		a.ok && aKilled && !bAll
			? child<ArmF>(["arm", "F", group, JSON.stringify(names)], ARM_B_MS)
			: null;
	const row: Row = {id, group, a, b, f};
	mkdirSync(`${RUN}/rows`, {recursive: true});
	writeFileSync(`${RUN}/rows/${id}.json`, JSON.stringify(row));
	console.log(
		`mutant ${id}: A ${aKilled ? "killed" : "survived"}, B ${bKilled ? "killed" : "survived"}`,
	);
	// Stryker's own verdict: killed when either arm killed it. Each arm's own verdict is in the row.
	process.exitCode = aKilled || bKilled ? 1 : 0;
};

// ---------------------------------------------------------------- Stryker, and the report

const run = () => {
	const groups = env("GROUPS", "ship,loop").split(",");
	const stryker = process.env.STRYKER;
	if (stryker === undefined) throw new Error("set STRYKER to the stryker binary");
	mkdirSync(RUN, {recursive: true});
	// QUIET=1: a dry run only, whose one command runs the chosen mutants again, alone (`quiet`).
	const quietly = env("QUIET", "0") === "1";
	for (const group of groups) {
		const config = {
			$schema:
				"https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/core/schema/stryker-schema.json",
			testRunner: "command",
			commandRunner: {
				command: `node experiments/119-mutation-testing.ts ${quietly ? "quiet" : "mutant"} ${group}`,
			},
			dryRunOnly: quietly,
			dryRunTimeoutMinutes: 240,
			mutate: FILES[group],
			inPlace: true,
			concurrency: Number(env("CONCURRENCY", "8")),
			coverageAnalysis: "off",
			timeoutMS: 30 * 60_000,
			timeoutFactor: 4,
			reporters: ["json", "clear-text", "progress"],
			jsonReporter: {fileName: `runs/119/${group}.mutation.json`},
			tempDirName: "runs/119/stryker-tmp",
			cleanTempDir: true,
		};
		const path = `${RUN}/${group}.stryker.json`;
		writeFileSync(path, JSON.stringify(config, null, "\t"));
		const r = spawnSync(stryker, ["run", path], {cwd: ROOT, stdio: "inherit", env: process.env});
		if (r.status !== 0) throw new Error(`stryker failed on ${group}`);
	}
};

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

/** The quiet rerun of one mutant, if it was run again. */
const quietOf = (group: string, id: string) => {
	const read = Result.try(() =>
		JSON.parse(readFileSync(`${RUN}/quiet/${group}-${id}.json`, "utf8")),
	);
	if (Result.isFailure(read)) return null;
	const q: Ran<ArmQ> = read.success.q;
	if (!q.ok) return {kind: "both", why: q.why};
	const {a, plain, swarm, focused} = q.value;
	const caught =
		anyCaught(plain) ||
		anyCaught(swarm) ||
		focused.some((x) => anyCaught(x.plain) || anyCaught(x.swarm));
	return {
		kind: a.killed && caught ? "both" : a.killed ? "only A" : caught ? "only B" : "neither",
		plain: tally(plain),
		swarm: tally(swarm),
		walks: {plain: plain.map((x) => x.runs), swarm: swarm.map((x) => x.runs)},
		focused: focused.map((x) => ({
			check: x.check,
			plain: tally(x.plain),
			swarm: x.swarm === null ? null : tally(x.swarm),
		})),
		ms: q.ms,
	};
};

const report = () => {
	const rows = new Map<string, Row>();
	for (const f of readdirSync(`${RUN}/rows`)) {
		const row: Row = JSON.parse(readFileSync(`${RUN}/rows/${f}`, "utf8"));
		rows.set(`${row.group}:${row.id}`, row);
	}
	const mutants = [];
	for (const group of Object.keys(FILES)) {
		const file = `${RUN}/${group}.mutation.json`;
		const json = Result.try(() => JSON.parse(readFileSync(file, "utf8")));
		if (Result.isFailure(json)) continue;
		const sampled =
			SAMPLED[group] === true
				? new Set<string>(JSON.parse(readFileSync(`${RUN}/sample-${group}.json`, "utf8")))
				: null;
		for (const [path, entry] of Object.entries(
			json.success.files as Record<string, {source: string; mutants: StrykerMutant[]}>,
		))
			for (const m of entry.mutants) {
				if (sampled !== null && !sampled.has(m.id)) continue;
				const row = rows.get(`${group}:${m.id}`);
				if (row === undefined) {
					// The mutant breaks loading the module (a Cmd defined as `{}`): every test fails, so both arms kill it.
					mutants.push({
						group,
						id: m.id,
						file: path,
						line: m.location.start.line,
						mutator: m.mutatorName,
						from: short(slice(entry.source, m)),
						to: short(m.replacement ?? ""),
						stryker: m.status,
						kind: m.status === "Killed" ? "both" : "no row",
						why: "the module does not load",
						varies: false,
						quiet: null,
					});
					continue;
				}
				const {a, b, f} = row;
				const aKilled = a.ok ? a.value.killed : true;
				const bPlain = b.ok ? tally(b.value.plain) : null;
				const bSwarm = b.ok && b.value.swarm !== null ? tally(b.value.swarm) : null;
				const fCaught =
					f?.ok === true && f.value.some((x) => anyCaught(x.plain) || anyCaught(x.swarm));
				const bKilled = b.ok ? (bPlain?.long ?? 0) > 0 || (bSwarm?.long ?? 0) > 0 || fCaught : true;
				const kind =
					aKilled && bKilled ? "both" : aKilled ? "only A" : bKilled ? "only B" : "neither";
				const varies =
					bPlain !== null &&
					((bPlain.long > 0 && bPlain.long < SEEDS.length) ||
						(bSwarm !== null && bSwarm.long > 0 && bSwarm.long < SEEDS.length));
				const q = quietOf(group, m.id);
				const caughtB = b.ok
					? [...b.value.plain, ...(b.value.swarm ?? [])].find((s) => s.caught)
					: undefined;
				mutants.push({
					group,
					id: m.id,
					file: path,
					line: m.location.start.line,
					mutator: m.mutatorName,
					from: short(slice(entry.source, m)),
					to: short(m.replacement ?? ""),
					stryker: m.status,
					kind,
					a: a.ok
						? {
								killed: a.value.killed,
								ms: a.value.ms,
								failed: a.value.failed.map((x) => ({
									check: x.check,
									law: x.law,
									why: short(x.why, 240),
									steps: x.path.length,
									path: x.path,
									ms: x.ms,
								})),
							}
						: {killed: true, why: a.why, ms: a.ms},
					b: b.ok
						? {
								plain: bPlain,
								swarm: bSwarm,
								ms: b.ms,
								first:
									caughtB === undefined
										? null
										: {
												seed: caughtB.seed,
												ms: caughtB.ms,
												runs: caughtB.runs,
												why: caughtB.why === null ? null : short(caughtB.why, 240),
												steps: caughtB.path?.length ?? null,
												path: caughtB.path,
											},
							}
						: {why: b.why, ms: b.ms},
					/** Walks B ran in its 10 s, per seed: fewer on a busy machine. */
					walks: b.ok
						? {
								plain: b.value.plain.map((x) => x.runs),
								swarm: b.value.swarm?.map((x) => x.runs) ?? null,
							}
						: null,
					varies,
					quiet: q,
					focused:
						f === null
							? null
							: f.ok
								? f.value.map((x) => ({
										check: x.check,
										plain: tally(x.plain),
										swarm: x.swarm === null ? null : tally(x.swarm),
									}))
								: {why: f.why},
				});
			}
	}
	// The ones to run again, alone: every "only A", and every one where B's seeds disagreed.
	for (const group of Object.keys(FILES)) {
		const ids = mutants
			.filter((m) => m.group === group && (m.kind === "only A" || m.varies === true))
			.map((m) => m.id);
		if (mutants.some((m) => m.group === group))
			writeFileSync(QUIET_IDS(group), JSON.stringify(ids));
	}
	const count = (k: string) => mutants.filter((m) => m.kind === k).length;
	const quietA = mutants.filter((m) => m.quiet?.kind === "only A").length;
	const byGroup = Object.fromEntries(
		Object.keys(FILES).map((g) => {
			const of = mutants.filter((m) => m.group === g);
			return [
				g,
				{
					mutants: of.length,
					both: of.filter((m) => m.kind === "both").length,
					onlyA: of.filter((m) => m.kind === "only A").length,
					onlyB: of.filter((m) => m.kind === "only B").length,
					neither: of.filter((m) => m.kind === "neither").length,
				},
			];
		}),
	);
	const total = {
		mutants: mutants.length,
		both: count("both"),
		/** From the timed run, many workers at once. */
		onlyA: count("only A"),
		/** Run again alone, by a fixed count of walks: the number that goes in the answer. */
		onlyAQuiet: quietA,
		rerunQuiet: mutants.filter((m) => m.quiet !== null).length,
		onlyB: count("only B"),
		neither: count("neither"),
		noRow: count("no row"),
	};
	console.log(JSON.stringify({total, byGroup}, null, 2));
	for (const m of mutants.filter((x) => x.kind === "only A" || x.kind === "only B"))
		console.log(
			`${m.kind} ${m.group}#${m.id} ${m.file}:${m.line} ${m.mutator}: ${m.from} -> ${m.to}`,
		);
	writeFileSync(
		OUT,
		`${JSON.stringify(
			{
				budgetMs: BUDGET_MS,
				shortMs: SHORT_MS,
				seeds: SEEDS,
				lengths: {one: ONE_LENGTH, world: WORLD_LENGTH, ends: ENDS_LIMIT},
				files: FILES,
				checks: Object.fromEntries(
					Object.keys(FILES).map((g) => [g, checksOf(g).map((c) => c.name)]),
				),
				total,
				byGroup,
				/** Why arm A crashed, by mutant, from a rerun of arm A alone (CRASHES=1). */
				crashes: Object.fromEntries(
					Object.keys(FILES).map((g) => [
						g,
						Result.getOrElse(
							Result.try(() => JSON.parse(readFileSync(`${RUN}/quiet/${g}-crashes.json`, "utf8"))),
							() => null,
						),
					]),
				),
				mutants,
			},
			null,
			"\t",
		)}\n`
			// No path from this machine in a saved answer: every path is repo-relative.
			.replaceAll(`file://${ROOT}/`, "")
			.replaceAll(`${ROOT}/`, ""),
	);
	console.log("wrote experiments/results/119-mutation-testing.json");
};

// ---------------------------------------------------------------- main

const [mode, ...args] = process.argv.slice(2);
if (mode === "arm") {
	const [which, group = "ship", names = "[]"] = args;
	if (which === "A") console.log(JSON.stringify(armA(group)));
	else {
		const effect =
			which === "B"
				? armB(group)
				: which === "Q"
					? armQ(group, JSON.parse(names))
					: armF(group, JSON.parse(names));
		// Node at this edge: the runtime runs the arm, and prints its answer for the parent.
		const value = await Effect.runPromise(effect.pipe(Effect.provide(nodeServices)));
		console.log(JSON.stringify(value));
	}
} else if (mode === "calibrate")
	console.log(
		JSON.stringify(
			await Effect.runPromise(calibrate(args[0] ?? "ship").pipe(Effect.provide(nodeServices))),
		),
	);
else if (mode === "quiet") quiet(args[0] ?? "ship");
else if (mode === "mutant") mutant(args[0] ?? "ship");
else if (mode === "run") run();
else if (mode === "report") report();
else throw new Error("mode: run, report, mutant <group>, arm A|B|F <group>");
