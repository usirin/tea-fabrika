// Experiment 91: laws over several machines at once, and "eventually" laws.
//
// The world, the search and the laws live in wip/src/laws/world/; the tests
// there run the small worlds. This script measures: first the raw blowup of
// two and three lanes with no reduction, then what each option adds, what
// partial-order reduction and symmetry each take off, the laws and planted
// mistakes, the "every lane ends" check, and how far each kind of run goes
// inside the normal suite's 1 s and a separate script's 5 minutes.
//
// Run with
//   node --max-old-space-size=12000 experiments/91-world-laws.ts
//
//   ONLY=measure|options|reductions|laws|eventually|limits   one part
//   BUDGET_S=<seconds>   stop a ladder once one run takes longer (default 300)
//   MOST=<states>        stop any one run at this many states (default 4000000)
//
// No model, no key, no network. Writes results/91-world-laws.json.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {asksAtTheFirstStall} from "../wip/src/laws/loop.ts";
import {forgetsMissingReview} from "../wip/src/laws/ship.ts";
import {describeLanes, type LanesOptions, lanesWorld, REAL} from "../wip/src/laws/world/lanes.ts";
import {
	askLeavesByAnAnswer,
	asksReachTheOwner,
	deskWorld,
	dropsAnAskOnProgress,
	ignoresAFailedPost,
	LANE_LAWS,
	mergesPastTheQueue,
	waitsForEver,
} from "../wip/src/laws/world/laws.ts";
import {type Report, search} from "../wip/src/laws/world/search.ts";

const OUT = resolve(import.meta.dirname, "results", "91-world-laws.json");
const BUDGET_MS = Number(process.env.BUDGET_S ?? 300) * 1000;
const MOST = Number(process.env.MOST ?? 4_000_000);
const ONLY = process.env.ONLY;
const DEPTH = 400;

const BASE: LanesOptions = {
	lanes: 2,
	tickets: "own",
	queue: true,
	cap: 2,
	forms: ["pass", "fail 1"],
};
const out: Record<string, unknown> = {};

type Mode = {readonly por?: boolean; readonly symmetry?: boolean; readonly eventually?: boolean};
const lawsFor = (o: LanesOptions) => (o.desk ? [...LANE_LAWS, asksReachTheOwner] : LANE_LAWS);
function run(o: LanesOptions, mode: Mode = {}): Report {
	return search(lanesWorld(o), {laws: lawsFor(o), depth: DEPTH, most: MOST, ...mode});
}
const brief = (r: Report) => ({
	states: r.states,
	steps: r.steps,
	depth: r.layers.length - 1,
	ms: r.ms,
	complete: r.complete,
	widest: r.widest,
	alphabet: r.alphabet,
	broken: r.broken.map((b) => b.law),
	lassos: r.lassos?.length ?? null,
	dead: r.dead?.length ?? null,
});
const mb = () => Math.round(process.memoryUsage().heapUsed / 1e6);
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const part = (name: string) => ONLY === undefined || ONLY === name;

// ---------------------------------------------------------------- 1. measure first

if (part("measure")) {
	console.log("\n1. Measure first: no reduction, states kept by depth (cumulative)\n");
	const rows = [];
	for (const lanes of [1, 2, 3]) {
		const o = {...BASE, lanes};
		const r = run(o);
		let sum = 0;
		const cumulative = r.layers.map((n) => (sum += n));
		const at = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80].map((d) => cumulative[d] ?? sum);
		console.log(
			`${pad(describeLanes(o), 52)} ${pad(r.states, 9)} states ${pad(r.steps, 9)} steps ${pad(`${r.ms} ms`, 10)} depth ${r.layers.length - 1} ${r.complete ? "complete" : "CUT"}, ${mb()} MB`,
		);
		console.log(`   by depth 5,10,15,20,25,30,40,50,60,80: ${at.join(" ")}`);
		rows.push({options: describeLanes(o), ...brief(r), cumulative});
	}
	out.measure = rows;
}

// ---------------------------------------------------------------- 2. what each option adds

if (part("options")) {
	console.log("\n2. Two lanes, no reduction: what each option adds\n");
	const variants: [string, LanesOptions][] = [
		["base", BASE],
		["no queue", {...BASE, queue: false}],
		["one ticket, no claim", {...BASE, tickets: "same", claim: "none"}],
		["one ticket, claim cas", {...BASE, tickets: "same", claim: "cas"}],
		["desk", {...BASE, desk: true}],
		["no clocks", {...BASE, clocks: false}],
		["red CI", {...BASE, red: true}],
		["eject", {...BASE, eject: true}],
		["idle builder", {...BASE, idle: true}],
		["outsider 1", {...BASE, outsider: 1}],
		["errors", {...BASE, errors: true}],
		["1 restart", {...BASE, restarts: 1}],
		["cap 3", {...BASE, cap: 3}],
		["third form (fail both)", {...BASE, forms: ["pass", "fail 1", "fail both"]}],
		["flaky CI", {...BASE, flaky: true}],
	];
	const rows = [];
	for (const [name, o] of variants) {
		const r = run(o);
		console.log(
			`${pad(name, 24)} ${pad(r.states, 9)} states ${pad(`${r.ms} ms`, 10)} depth ${pad(r.layers.length - 1, 4)} alphabet ${pad(r.alphabet, 4)} widest ${r.widest} ${r.complete ? "" : "CUT"}`,
		);
		rows.push({variant: name, ...brief(r)});
	}
	out.options = rows;
}

// ---------------------------------------------------------------- 3. reductions

if (part("reductions")) {
	console.log("\n3. Reductions: states and time, full / partial order / symmetry / both\n");
	const configs: [string, LanesOptions][] = [
		["2 lanes", BASE],
		["2 lanes, no queue", {...BASE, queue: false}],
		["2 lanes, one ticket", {...BASE, tickets: "same", claim: "none"}],
		["2 lanes, red + errors", {...BASE, red: true, errors: true}],
		["2 lanes, flaky CI", {...BASE, flaky: true}],
		["3 lanes", {...BASE, lanes: 3}],
		["3 lanes, no queue", {...BASE, lanes: 3, queue: false}],
	];
	const modes: [string, Mode][] = [
		["full", {}],
		["por", {por: true}],
		["sym", {symmetry: true}],
		["both", {por: true, symmetry: true}],
	];
	const rows = [];
	for (const [name, o] of configs) {
		const row: Record<string, unknown> = {config: name};
		const cells: string[] = [];
		let laws: string | null = null;
		let agree = true;
		for (const [mode, m] of modes) {
			const r = run(o, m);
			const found = r.broken
				.map((b) => b.law)
				.sort()
				.join("; ");
			if (r.complete) {
				if (laws === null) laws = found;
				else if (found !== laws) agree = false;
			}
			row[mode] = brief(r);
			cells.push(`${pad(`${r.states}${r.complete ? "" : "+"}`, 9)} ${pad(`${r.ms} ms`, 9)}`);
		}
		row.agree = agree;
		console.log(
			`${pad(name, 24)} ${cells.join(" | ")} ${agree ? "same laws found" : "LAWS DIFFER"}`,
		);
		rows.push(row);
	}
	out.reductions = rows;
}

// ---------------------------------------------------------------- 4. laws and planted mistakes

if (part("laws")) {
	console.log("\n4. Laws on the real code, and planted mistakes\n");
	const ONE = {...BASE, lanes: 1};
	const SAME: LanesOptions = {...BASE, tickets: "same", forms: ["pass"]};
	// One round each, so the no-claim worlds stay small; the reviewer may pass or fail.
	const SAME_FAIL: LanesOptions = {...BASE, tickets: "same", cap: 1};
	const NO_QUEUE: LanesOptions = {...BASE, queue: false};
	const forgets = {...SAME, claim: "none" as const, steps: {...REAL, ship: forgetsMissingReview}};
	const runs: [string, LanesOptions, Mode][] = [
		["real: 2 lanes, own tickets, queue", BASE, {eventually: true}],
		["real: 2 lanes, own tickets, no queue", NO_QUEUE, {eventually: true}],
		["real: 2 lanes, no queue, up-to-date rule", {...NO_QUEUE, upToDate: true}, {}],
		["real: 2 lanes on one ticket", SAME, {eventually: true}],
		["real: 2 lanes on one ticket, pass or fail, cap 1", SAME_FAIL, {eventually: true}],
		["real: 2 lanes on one ticket, pass or fail, cap 2", {...BASE, tickets: "same"}, {}],
		["real: 1 lane, desk told each round, cap 2", {...ONE, desk: true}, {}],
		["real: 1 lane, desk, cap 4", {...ONE, desk: true, cap: 4}, {}],
		[
			"real: 1 lane, desk, cap 4, three forms",
			{...ONE, desk: true, cap: 4, forms: ["pass", "fail 1", "fail both"]},
			{},
		],
		["plant: no claim", {...SAME, claim: "none"}, {}],
		["plant: claim read then written", {...SAME, claim: "read_then_write"}, {}],
		["plant: merge door blind to main, no queue", {...NO_QUEUE, door: "no_main"}, {}],
		["plant: no merge door, no queue", {...NO_QUEUE, door: "none"}, {}],
		[
			"plant: ship merges past the queue",
			{...BASE, steps: {...REAL, ship: mergesPastTheQueue}},
			{},
		],
		[
			"plant: ship merges past the queue, no door",
			{...BASE, door: "none", steps: {...REAL, ship: mergesPastTheQueue}},
			{},
		],
		["plant: no claim, pass or fail", {...SAME_FAIL, claim: "none"}, {}],
		["plant: no claim, no door, pass or fail", {...SAME_FAIL, claim: "none", door: "none"}, {}],
		["plant: ship takes a missing review as passed, no claim", forgets, {}],
		[
			"plant: ship takes a missing review as passed, no claim, no door",
			{...forgets, door: "none"},
			{},
		],
		[
			"plant: loop asks at the first stall (desk, cap 4)",
			{...ONE, desk: true, cap: 4, steps: {...REAL, loop: asksAtTheFirstStall}},
			{},
		],
		[
			"plant: ship waits with no count (flaky CI)",
			{...ONE, flaky: true, steps: {...REAL, ship: waitsForEver}},
			{eventually: true},
		],
		[
			"plant: loop ignores a failed post (errors)",
			{...ONE, errors: true, steps: {...REAL, loop: ignoresAFailedPost}},
			{eventually: true},
		],
	];
	const rows = [];
	for (const [name, o, mode] of runs) {
		const r = run(o, mode);
		console.log(`== ${name}: ${r.states} states, ${r.ms} ms`);
		for (const b of r.broken)
			console.log(
				`   BROKEN ${b.law} (${b.path.length} steps)\n     ${b.why}\n     ${b.path.join(" / ")}`,
			);
		for (const l of r.lassos ?? [])
			console.log(
				`   LASSO lane ${l.lane + 1}\n     prefix: ${l.prefix.join(" / ")}\n     cycle:  ${l.cycle.join(" / ")}`,
			);
		for (const d of r.dead ?? []) console.log(`   DEAD lane ${d.lane + 1}: ${d.path.join(" / ")}`);
		rows.push({run: name, ...brief(r), found: r.broken, lassoList: r.lassos, deadList: r.dead});
	}
	for (const [name, fold] of [
		["real: the desk alone", undefined],
		["plant: a desk that drops an ask on progress", dropsAnAskOnProgress],
	] as const) {
		const r = search(deskWorld({rounds: 6, counts: [0, 1, 2], fold}), {
			laws: [askLeavesByAnAnswer],
			depth: 60,
		});
		console.log(`== ${name}: ${r.states} states, ${r.ms} ms`);
		for (const b of r.broken)
			console.log(`   BROKEN ${b.law}\n     ${b.why}\n     ${b.path.join(" / ")}`);
		rows.push({run: name, ...brief(r), found: r.broken});
	}
	out.laws = rows;
}

// ---------------------------------------------------------------- 5. every lane ends

if (part("eventually")) {
	console.log("\n5. Every lane ends: fair loops and dead states, on the whole graph\n");
	const ONE = {...BASE, lanes: 1};
	const ALL: Partial<LanesOptions> = {
		red: true,
		flaky: true,
		errors: true,
		restarts: 1,
		idle: true,
		eject: true,
		outsider: 1,
	};
	const runs: [string, LanesOptions][] = [
		["1 lane, every option", {...ONE, ...ALL}],
		[
			"1 lane, every option, cap 3, three forms",
			{...ONE, ...ALL, cap: 3, forms: ["pass", "fail 1", "fail both"]},
		],
		[
			"1 lane, no queue, up-to-date rule, every option",
			{...ONE, ...ALL, queue: false, upToDate: true, eject: false},
		],
		["2 lanes", BASE],
		["2 lanes, errors + 1 restart", {...BASE, errors: true, restarts: 1}],
		["2 lanes, red + eject + idle", {...BASE, red: true, eject: true, idle: true}],
		["2 lanes, flaky CI", {...BASE, flaky: true}],
		["2 lanes, one ticket, no claim", {...BASE, tickets: "same", claim: "none"}],
		["3 lanes", {...BASE, lanes: 3}],
	];
	const rows = [];
	for (const [name, o] of runs) {
		const r = run(o, {eventually: true});
		console.log(
			`${pad(name, 50)} ${pad(r.states, 9)} states ${pad(`${r.ms} ms`, 10)} lassos ${r.lassos?.length} dead ${r.dead?.length} ${r.complete ? "" : "CUT"} ${mb()} MB`,
		);
		for (const l of r.lassos ?? [])
			console.log(
				`   LASSO prefix: ${l.prefix.join(" / ")}\n         cycle: ${l.cycle.join(" / ")}`,
			);
		for (const d of r.dead ?? []) console.log(`   DEAD ${d.path.join(" / ")}`);
		rows.push({run: name, ...brief(r)});
	}
	out.eventually = rows;
}

// ---------------------------------------------------------------- 6. size limits

if (part("limits")) {
	console.log(
		"\n6. Size limits: each ladder adds one thing per row, until a run passes the budget\n",
	);
	const ladder: [string, Partial<LanesOptions>][] = [
		["base", {}],
		["+ red CI", {red: true}],
		["+ errors", {errors: true}],
		["+ 1 restart", {restarts: 1}],
		["+ cap 3", {cap: 3}],
		["+ flaky CI", {flaky: true}],
		["+ third form", {forms: ["pass", "fail 1", "fail both"]}],
	];
	const kinds: [string, Mode][] = [
		["safety, both reductions", {por: true, symmetry: true}],
		["eventually, whole graph", {eventually: true}],
	];
	const rows = [];
	for (const lanes of [1, 2, 3])
		for (const [kind, mode] of kinds) {
			let o: LanesOptions = {...BASE, lanes};
			for (const [step, add] of ladder) {
				o = {...o, ...add};
				const r = run(o, mode);
				console.log(
					`${lanes} lane(s) ${pad(kind, 26)} ${pad(step, 14)} ${pad(`${r.states}${r.complete ? "" : "+"}`, 10)} states ${pad(`${r.ms} ms`, 11)} alphabet ${pad(r.alphabet, 5)} ${mb()} MB`,
				);
				rows.push({lanes, kind, step, ...brief(r)});
				if (r.ms > BUDGET_MS || !r.complete) break;
			}
		}
	out.limits = rows;
}

mkdirSync(resolve(OUT, ".."), {recursive: true});
// One part (ONLY=...) replaces only its own rows; the other parts are kept as they were.
const kept = ONLY !== undefined && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
writeFileSync(OUT, `${JSON.stringify({...kept, ...out}, null, "\t")}\n`);
console.log(`\nwrote ${OUT}`);
