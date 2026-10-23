// Experiment 115: does the world search find today's hosted lane hang?
//
// The lane is the real reducer (packages/pipeline/src/stages/lane/machine.ts). The host, its
// children, the ledger and the lane's child Sub are a model (packages/pipeline/src/laws/world/
// hosted.ts). The search is experiment 91's (laws/world/search.ts), unchanged.
//
// Three wirings of the Sub and the host:
//   today    the Sub ends only when the child's outcome row is there, as hosted/lane.ts does now;
//            a child may end with no row
//   fixed    the Sub also ends on the child's EXIT: no row is stuck:no_outcome (a sketch, not the
//            code)
//   assumed  today's Sub, with every child writing its row before it ends: what the lane assumes
//
// Two "eventually" laws on each, under weak fairness: every child the lane starts ends with a
// child_over, and every lane ends. Each with the lane's Cmds always answered ok, then also refused.
//
// Run with
//   node experiments/115-child-ends.ts
//
// No model, no key, no network. Writes results/115-child-ends.json.

import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {
	type EndOf,
	type Hosted,
	type HostedOptions,
	hostedWorld,
	laneOver,
	notWaitingOnAChild,
} from "@kampus/pipeline/laws/world/hosted";
import {type Report, type Safety, search} from "@kampus/pipeline/laws/world/search";

const OUT = resolve(import.meta.dirname, "results", "115-child-ends.json");
const DEPTH = 400;
const TIMES = 5;

const WIRINGS: readonly (readonly [string, HostedOptions])[] = [
	["today", {sub: "today"}],
	["fixed", {sub: "fixed"}],
	["assumed", {sub: "today", always: true}],
];
const LAWS: readonly (readonly [string, EndOf])[] = [
	["every child ends with a child_over", notWaitingOnAChild],
	["every lane ends", laneOver],
];

/** The median time of a few runs, and the last run's report. */
function timed(run: () => Report): {readonly r: Report; readonly ms: number} {
	const times: number[] = [];
	let r = run();
	for (let i = 0; i < TIMES; i++) {
		const started = performance.now();
		r = run();
		times.push(performance.now() - started);
	}
	times.sort((a, b) => a - b);
	return {r, ms: Math.round((times[Math.floor(TIMES / 2)] as number) * 10) / 10};
}

const rows = [];
console.log("\nThe eventually laws, under weak fairness\n");
for (const [wiring, base] of WIRINGS)
	for (const errors of [false, true])
		for (const [lawName, end] of LAWS) {
			const o = {...base, errors};
			const {r, ms} = timed(() =>
				search(hostedWorld(o, end), {laws: [], depth: DEPTH, eventually: true}),
			);
			const holds = r.complete && r.lassos?.length === 0 && r.dead?.length === 0;
			console.log(
				`${wiring.padEnd(8)} ${(errors ? "refusals" : "all ok").padEnd(9)} ${lawName.padEnd(34)} ${String(r.states).padStart(5)} states ${String(r.steps).padStart(5)} steps depth ${r.layers.length - 1} ${ms} ms: ${holds ? "holds" : "BROKEN"}`,
			);
			for (const l of r.lassos ?? []) {
				console.log(`   lasso, ${l.prefix.length} steps to the loop:`);
				for (const s of l.prefix) console.log(`     ${s}`);
				console.log(`   then round and round: ${l.cycle.join(", ")}`);
			}
			for (const d of r.dead ?? []) console.log(`   dead state after: ${d.path.join(", ")}`);
			rows.push({
				wiring,
				errors,
				law: lawName,
				states: r.states,
				steps: r.steps,
				depth: r.layers.length - 1,
				ms,
				complete: r.complete,
				holds,
				lassos: r.lassos,
				dead: r.dead,
			});
		}

// A law that passes because the model never gets anywhere would be noise. So each wiring must
// reach a lane that merged: a safety "law" that breaks there prints the shortest way to it.
const reaches = (name: string, at: (w: Hosted) => boolean): Safety<Hosted> => ({
	name,
	check: (_prev, _move, next) => (at(next) ? "reached" : null),
});
const WITNESSES = [
	reaches("the lane ends done", (w) => w.lane.phase === "over" && w.lane.outcome.kind === "done"),
	reaches(
		"the lane ends stuck on a child with no row",
		(w) =>
			w.lane.phase === "over" && w.lane.report.problems.some((p) => p.endsWith(": no_outcome")),
	),
];
const witnesses = [];
console.log("\nWhat each wiring can reach (shortest path)\n");
for (const [wiring, o] of WIRINGS) {
	const r = search(hostedWorld(o), {laws: WITNESSES, depth: DEPTH});
	for (const w of WITNESSES) {
		const found = r.broken.find((b) => b.law === w.name);
		console.log(
			`${wiring.padEnd(8)} ${w.name.padEnd(44)} ${found === undefined ? "never" : `${found.path.length} steps`}`,
		);
		witnesses.push({wiring, reach: w.name, path: found?.path ?? null});
	}
}

writeFileSync(
	OUT,
	`${JSON.stringify({depth: DEPTH, times: TIMES, rows, witnesses}, null, "\t")}\n`,
);
console.log(`\nwrote ${OUT.slice(OUT.indexOf("experiments/"))}`);
