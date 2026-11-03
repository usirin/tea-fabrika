// Experiment 102: limits a tea program's run cannot pass, kept by the ledger the way a cgroup
// keeps a container's: dollars and tokens a run reports, wall time, and children at once. They
// nest, they survive crashes, restarts and takeovers, and a run that goes over ends `limit:<kind>`
// and is not started again.
//
// ONLY: a comma list of plants|machine|runs (default all).
//   plants    each planted mistake in the ledger's rules (98's to 102's): which laws it breaks
//   machine   the host, supervisor (each strategy), monitor and call machines' laws
//             (packages/pipeline/src/laws/tea-host.ts), each with its planted mistakes
//   runs      the fault runs: RUNS (small,small,small,large). Three host processes serve top
//             over one ticket per case (four in the large run), on one local ledger; stub agents
//             report a made-up cost per turn; the harness SIGKILLs and freezes a builder's host
//             mid-turn.
// Results: results/102-limits.json.
//
// Node at the edge, as 93 to 101: processes in their own groups and their signals
// (./98-tea-host-package/harness.ts). The ledger, the hosts and everything they write go through
// `@kampus/fabrika-old`.
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layerPlanted, PLANTED, type Planted, runLaws} from "@kampus/fabrika-old/laws";
import {
	checkCalls,
	checkHost,
	checkMonitors,
	checkSupervisor,
} from "@kampus/pipeline/laws/tea-host";
import {Effect} from "effect";
import {here} from "./98-tea-host-package/harness.ts";
import {type Preset, runOnce} from "./102-limits/run.ts";

const RESULTS = here("results/102-limits.json");
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const ALL = "plants,machine,runs";
const only = new Set((process.env.ONLY ?? ALL).split(","));
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");

async function plants() {
	const dir = mkdtempSync(join(tmpdir(), "exp102-plant-"));
	const names = Object.keys(PLANTED).filter((k): k is Planted => k in PLANTED);
	const out = await Effect.runPromise(
		Effect.forEach(
			names,
			(planted, i) =>
				runLaws({alarm: true, graceMs: 1000}).pipe(
					Effect.provide(layerPlanted(join(dir, `planted-${i}.sqlite`), planted, 1000)),
					Effect.scoped,
					Effect.map((rs) => {
						const failed = rs.filter((l) => !l.pass);
						return {
							planted,
							failed: failed.map((l) => l.law.split(".")[0] ?? l.law),
							caught: failed.length > 0,
						};
					}),
				),
			{concurrency: 4},
		),
	);
	for (const p of out)
		console.log(
			`${p.caught ? "caught" : "MISSED"}  planted "${p.planted}": fails ${p.failed.join(", ") || "nothing"}`,
		);
	rmSync(dir, {recursive: true, force: true});
	results.plants = out;
	save();
}

function machine() {
	const all = [
		checkHost(Number(process.env.HOST_DEPTH ?? "8")),
		checkSupervisor(Number(process.env.SUP_DEPTH ?? "6")),
		checkMonitors(Number(process.env.MON_DEPTH ?? "7")),
		checkCalls(Number(process.env.CALL_DEPTH ?? "6")),
	];
	for (const r of all) {
		console.log(`\n## laws: ${r.machine} (${r.states} states, ${Math.round(r.ms)} ms)`);
		for (const law of r.laws)
			console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
		for (const [law, how] of Object.entries(r.broken))
			if (!r.laws.includes(law)) console.log(`BROKEN  ${law}: ${String(how).slice(0, 300)}`);
		for (const p of r.planted)
			console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
	}
	results.machine = all.map((r) => ({...r, ms: Math.round(r.ms)}));
	save();
}

type Run = Awaited<ReturnType<typeof runOnce>>;

const summarize = (r: Run) =>
	[
		`turns ${r.spend.turns} ($${r.spend.billedUsd} billed)`,
		`held-only ${r.spend.heldOnlyTurns} (+$${r.spend.heldOverBillUsd} over the bill)`,
		`lost ${r.spend.lostTurns} ($${r.spend.lostUsd})`,
		`charged on stop ${r.spend.chargedOnStop}`,
		`limit ends ${r.limitExits.length}`,
		`over: ${r.spent.map((s) => `${s.name} ${s.kind} ${s.over} (${s.turnsOver} turns${s.admission ? "" : ", no admission"})`).join("; ")}`,
		`wall late ${r.wall.map((w) => `${w.name} ${w.lateMs} ms`).join(", ")}`,
		`bursts ${r.bursts.map((b) => `${b.ticket} ${b.per.map((x) => `${x.ok} ok/${x.maxChildren} max_children`).join(" then ")} (peak ${b.peak})`).join("; ")}`,
	].join("; ");

async function runs() {
	const out: Run[] = [];
	for (const [i, preset] of RUNS.entries()) {
		if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
		const r = await runOnce(preset satisfies Preset, i + 1);
		console.log(`${preset} ${i + 1}: ${summarize(r)}`);
		for (const [k, v] of Object.entries(r.pass)) if (!v) console.log(`  FAIL ${k}`);
		for (const b of [...r.spend.breaks, ...r.spend.totals].slice(0, 20)) console.log(`  ${b}`);
		for (const e of r.errors) console.log(`  host ${e.host}: ${e.stderr}`);
		out.push(r);
		results.runs = out;
		save();
	}
	const summary = {
		runs: out.length,
		allPass: out.every((r) => Object.values(r.pass).every(Boolean)),
		overWithAdmission: out.flatMap((r) => r.spent.filter((s) => s.admission).map((s) => s.over)),
		overNoAdmission: out.flatMap((r) =>
			r.spent
				.filter((s) => !s.admission)
				.map((s) => ({over: s.over, turns: s.turnsOver, agents: s.agents})),
		),
		wallLateMs: out.flatMap((r) => r.wall.map((w) => w.lateMs)),
		lost: out.map((r) => ({turns: r.spend.lostTurns, usd: r.spend.lostUsd})),
		heldOverBill: out.map((r) => r.spend.heldOverBillUsd),
	};
	console.log(JSON.stringify(summary, null, 1));
	results.summary = summary;
	save();
}

const sections: Record<string, () => Promise<void> | void> = {plants, machine, runs};
for (const name of ALL.split(",")) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
process.exit(0);
