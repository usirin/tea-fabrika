// Experiment 90: walk every order of messages through the real reducers.
//
// The laws and the runner live in wip/src/laws/; the tests there run each
// machine to a small bound. This script runs them further and measures the
// blowup: states kept, steps taken and time, against the depth bound and the
// size of the world (how many heads, how many fact sets, echoes on or off).
//
// Run with
//   node experiments/90-reducer-laws.ts
//
//   ONLY=ship|review|build|loop   one machine
//   BUDGET_S=<seconds>            stop a row's deeper runs once one takes longer (default 20)
//   MOST=<states>                 stop any one run at this many states (default 1500000)
//
// No model, no key, no network. Writes results/90-reducer-laws.json.

import {mkdirSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import * as build from "@kampus/fabrika/pipeline/laws/build";
import {explore, type Law, type Update, type World} from "@kampus/fabrika/pipeline/laws/explore";
import * as loop from "@kampus/fabrika/pipeline/laws/loop";
import * as review from "@kampus/fabrika/pipeline/laws/review";
import * as ship from "@kampus/fabrika/pipeline/laws/ship";

const OUT = resolve(import.meta.dirname, "results", "90-reducer-laws.json");
const BUDGET_MS = Number(process.env.BUDGET_S ?? 20) * 1000;
const MOST = Number(process.env.MOST ?? 1_500_000);
const ONLY = process.env.ONLY;

interface Row {
	readonly machine: string;
	readonly world: string;
	readonly depth: number;
	readonly states: number;
	readonly steps: number;
	readonly widest: number;
	readonly ms: number;
	readonly complete: boolean;
	readonly capped: boolean;
	readonly broken: readonly string[];
}

const rows: Row[] = [];

/** One world, run at each depth until it ends, hits the state cap, or a run takes longer than the budget. */
function sweep<S, M extends {readonly type: string}, C>(
	machine: string,
	world: string,
	setup: {
		readonly init: S;
		readonly update: Update<S, M, C>;
		readonly world: () => World<S, M, C>;
		readonly laws: () => readonly Law<S, M, C>[];
	},
	depths: readonly number[],
): void {
	if (ONLY !== undefined && ONLY !== machine) return;
	for (const depth of depths) {
		const r = explore({
			init: setup.init,
			update: setup.update,
			world: setup.world(),
			laws: setup.laws(),
			depth,
			most: MOST,
		});
		const row: Row = {
			machine,
			world,
			depth,
			states: r.states,
			steps: r.steps,
			widest: r.widest,
			ms: r.ms,
			complete: r.complete,
			capped: r.capped,
			broken: r.broken.map((b) => b.law),
		};
		rows.push(row);
		console.log(
			[
				machine.padEnd(6),
				world.padEnd(26),
				`d${depth}`.padStart(4),
				String(r.states).padStart(9),
				String(r.steps).padStart(10),
				String(r.widest).padStart(6),
				`${(r.ms / 1000).toFixed(1)}s`.padStart(7),
				r.complete ? "ends" : r.capped ? "capped" : "",
			].join("  "),
		);
		if (r.complete || r.capped || r.ms > BUDGET_MS) break;
	}
}

const D = (...ds: number[]) => ds;
console.log(
	["machine", "world".padEnd(26), "depth", "   states", "     steps", "widest", "   time", ""].join(
		"  ",
	),
);

const shipSetup = (world: ship.ShipWorldOptions) => ({
	init: ship.shipInit,
	update: ship.shipStep,
	world: () => ship.shipWorld(world),
	laws: () => ship.shipLaws(),
});
// Fact sets per head, counted from the world, so the label follows it.
const narrow = ship.factsAt("A", "narrow").length;
const wide = ship.factsAt("A", "wide").length;
sweep("ship", `2 heads, ${narrow} fact sets`, shipSetup({}), D(2, 4, 6, 8, 10, 14, 20, 30, 40));
sweep("ship", `3 heads, ${narrow} fact sets`, shipSetup({heads: ["A", "B", "C"]}), D(4, 8, 14, 20));
sweep("ship", `2 heads, ${wide} fact sets`, shipSetup({facts: "wide"}), D(2, 4, 6, 8));
sweep("ship", `2 heads, ${narrow} sets, echoes`, shipSetup({echoes: true}), D(4, 6, 8, 10, 12));

const reviewSetup = (world: review.ReviewWorldOptions) => ({
	init: review.reviewInit,
	update: review.reviewStep,
	world: () => review.reviewWorld(world),
	laws: () => review.reviewLaws(),
});
sweep("review", "1 head", reviewSetup({heads: ["A"]}), D(2, 4, 6, 8, 10, 14, 20));
sweep("review", "2 heads", reviewSetup({}), D(2, 4, 6, 8, 10, 14));
sweep("review", "3 heads", reviewSetup({heads: ["A", "B", "C"]}), D(4, 6, 8, 10));
sweep("review", "2 heads, echoes", reviewSetup({echoes: true}), D(4, 6, 8, 10));

const buildSetup = (echoes: boolean) => ({
	init: build.buildInit,
	update: build.buildStep,
	world: () => build.buildWorld({echoes}),
	laws: () => build.buildLaws(),
});
sweep("build", "4 forms", buildSetup(false), D(4, 6, 8, 10, 14));
sweep("build", "4 forms, echoes", buildSetup(true), D(4, 6, 8, 10, 14, 20));

const loopSetup = (world: loop.LoopWorldOptions) => ({
	init: loop.loopInit,
	update: loop.loopStep,
	world: () => loop.loopWorld(world),
	laws: () => loop.loopLaws(),
});
sweep("loop", "1 head, caps 1 and 2", loopSetup({heads: ["A"]}), D(4, 8, 12, 16));
sweep("loop", "2 heads, caps 1 and 2", loopSetup({}), D(4, 8, 12, 16));
sweep("loop", "2 heads, cap 3", loopSetup({caps: [3]}), D(4, 8, 12, 16, 20));
sweep("loop", "2 heads, cap 4", loopSetup({caps: [4]}), D(8, 12, 16, 20, 24));
sweep("loop", "3 heads, caps 1 and 2", loopSetup({heads: ["A", "B", "C"]}), D(4, 8, 12, 16));
sweep("loop", "2 heads, caps 1 and 2, echoes", loopSetup({echoes: true}), D(4, 6, 8, 10, 12));

mkdirSync(resolve(import.meta.dirname, "results"), {recursive: true});
writeFileSync(OUT, `${JSON.stringify({budgetMs: BUDGET_MS, most: MOST, rows}, null, "\t")}\n`);
console.log(`\nwrote ${rows.length} rows to results/90-reducer-laws.json`);
