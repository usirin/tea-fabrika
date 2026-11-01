// Experiment 99: OTP's monitors, links and supervisor on the tea-host package, and what happens
// to a message that crashes its program every time.
//
// ONLY: a comma list of plants|machine|tree|escalate (default all).
//   plants    each planted mistake in the ledger's rules (98's and 99's): which laws it breaks
//   machine   the host, supervisor, monitor and call machines' laws (packages/pipeline/src/laws/tea-host.ts)
//   tree      the fault runs: RUNS (small,small,small,large). Three host processes serve a
//             supervisor, three children and a watcher on one local ledger; the harness kills
//             hosts, freezes one, plants defects in children and sends one poison message.
//   escalate  one host, dead letters off (MAX_DELIVERIES=off), one poison message: what OTP's
//             restart intensity alone does with it.
// Results: results/99-monitors-supervisor.json.
//
// Node at the edge, as 93 to 98: processes in their own groups and their signals
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
import {here, pct, r1} from "./98-tea-host-package/harness.ts";
import {runOnce} from "./99-monitors-supervisor/tree-run.ts";

const RESULTS = here("results/99-monitors-supervisor.json");
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const ALL = "plants,machine,tree,escalate";
const only = new Set((process.env.ONLY ?? ALL).split(","));
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");

async function plants() {
	const dir = mkdtempSync(join(tmpdir(), "exp99-plant-"));
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
		checkHost(Number(process.env.HOST_DEPTH ?? "9")),
		checkSupervisor(Number(process.env.SUP_DEPTH ?? "5")),
		checkMonitors(Number(process.env.MON_DEPTH ?? "8")),
		checkCalls(Number(process.env.CALL_DEPTH ?? "7")),
	];
	for (const r of all) {
		console.log(`\n## laws: ${r.machine} (${r.states} states, ${Math.round(r.ms)} ms)`);
		for (const law of r.laws)
			console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
		for (const p of r.planted)
			console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
	}
	results.machine = all.map((r) => ({...r, ms: Math.round(r.ms)}));
	save();
}

type Run = Awaited<ReturnType<typeof runOnce>>;
const pass = (r: Run) => {
	const childExits = r.exits.total;
	return {
		everyCrashRestarted: r.restarts.notRestarted.length === 0,
		exitsArePlantedPlusPoison:
			r.exits.other.length === 0 &&
			r.exits.defects.exited === r.exits.defects.planted &&
			childExits === r.exits.defects.planted + r.exits.poisonCrashes,
		poisonSetAsideOnce:
			r.poison.setAside.length === 1 && r.poison.setAside[0]?.rev === r.poison.rev,
		everyDeathReportedOnce:
			r.reported.twice.length === 0 &&
			r.reported.never.length === 0 &&
			r.reported.notAnExit.length === 0,
		noDownForTakeover:
			r.downs.phantom.length === 0 && r.exits.afterKillAll === 0 && r.takeovers > 0,
		countsExact: r.counts.every((c) => c.exact),
		noTwoWriters: r.writerBreaks.length === 0,
		supervisorRunning:
			r.supervisor?.phase === "running" && r.supervisor.restarted === r.restarts.total,
		noHostErrors: r.errors.length === 0,
	};
};

async function tree() {
	const runs: (Run & {pass: ReturnType<typeof pass>})[] = [];
	for (const [i, preset] of RUNS.entries()) {
		if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
		const r = await runOnce(preset, i + 1, {
			mode: "tree",
			maxDeliveries: 3,
			intensity: 5,
			periodMs: 5000,
		});
		const p = pass(r);
		console.log(
			`${preset} ${i + 1}: exits ${r.exits.total} (defects ${r.exits.defects.exited}/${r.exits.defects.planted}, poison ${r.exits.poisonCrashes}), restarts ${r.restarts.total} p50 ${r.restarts.restartMs.p50} ms, back up p50 ${r.restarts.backUpMs.p50} ms; DOWN ${r.downs.real} real + ${r.downs.noproc} noproc, delivery p50 ${r.downs.deliveryMs.p50} ms; reported ${r.reported.deaths}/${r.reported.watchedExits} deaths (gaps ${r.reported.gaps.join(" ") || "none"}); takeovers ${r.takeovers}; counts ${r.counts.map((c) => `${c.count}/${c.want}`).join(" ")}`,
		);
		for (const [k, v] of Object.entries(p)) if (!v) console.log(`  FAIL ${k}`);
		runs.push({...r, pass: p});
		results.tree = runs;
		save();
	}
	const all = (f: (r: Run) => readonly number[]) => runs.flatMap(f);
	const restart = all((r) => r.restarts.each.map((e) => e.restartMs));
	const backUp = all((r) =>
		r.restarts.each.flatMap((e) => (e.backUpMs === null ? [] : [e.backUpMs])),
	);
	const down = all((r) => r.downs.deliverySamples);
	const summary = {
		runs: runs.length,
		allPass: runs.every((r) => Object.values(r.pass).every(Boolean)),
		pooled: {
			note: "every sample of every run, ms. restart: exit to restarted; backUp: exit to the program running again; down: DOWN written to DOWN first read",
			restart: {n: restart.length, p50: r1(pct(restart, 50)), p99: r1(pct(restart, 99))},
			backUp: {n: backUp.length, p50: r1(pct(backUp, 50)), p99: r1(pct(backUp, 99))},
			down: {n: down.length, p50: r1(pct(down, 50)), p99: r1(pct(down, 99))},
		},
	};
	console.log(JSON.stringify(summary, null, 1));
	results.treeSummary = summary;
	save();
}

async function escalate() {
	const r = await runOnce("small", 1, {
		mode: "escalate",
		maxDeliveries: null,
		intensity: 3,
		periodMs: 5000,
	});
	console.log(
		`escalate: ${r.poison.childrenDown.length} children taken down with the supervisor; sup down ${r.poison.supDownMs} ms after the poison (${r.poison.supDownWhy}); poison crashes ${r.exits.poisonCrashes}; set aside ${r.poison.setAside.length}; poison still in the inbox: ${r.poison.stillInInbox}; reported ${r.reported.deaths}/${r.reported.watchedExits} deaths (gaps ${r.reported.gaps.join(" ") || "none"}, twice ${r.reported.twice.length}, never ${r.reported.never.join(" ") || "none"})`,
	);
	results.escalate = r;
	save();
}

const sections: Record<string, () => Promise<void> | void> = {plants, machine, tree, escalate};
for (const name of ALL.split(",")) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
process.exit(0);
