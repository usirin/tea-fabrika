// Experiment 100: experiment 99's one supervisor grown into an OTP supervision tree: one_for_all
// and rest_for_one, a supervisor under a supervisor, the supervisor calls, shutdown timeouts,
// restart and re-arm backoff, and dead letters sent back.
//
// ONLY: a comma list of plants|machine|tree|escalate (default all).
//   plants    each planted mistake in the ledger's rules (98's to 100's): which laws it breaks
//   machine   the host, supervisor (each strategy), monitor and call machines' laws
//             (packages/pipeline/src/laws/tea-host.ts), each with its planted mistakes
//   tree      the fault runs: RUNS (small,small,small,large). Three host processes serve a
//             two-level tree and a watcher on one local ledger; the harness makes calls, kills
//             hosts, freezes the watcher's host while a child crashes, plants crashes, a crash
//             loop and a poison message, sends the dead letter back, then kills every host.
//   escalate  the crash loop never fixed: one level gives up per give-up, up to the top.
// Results: results/100-supervision-tree.json.
//
// Node at the edge, as 93 to 99: processes in their own groups and their signals
// (./98-tea-host-package/harness.ts). The ledger, the hosts and everything they write go through
// `@kampus/fabrika`.
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layerPlanted, PLANTED, type Planted, runLaws} from "@kampus/fabrika/laws";
import {
	checkCalls,
	checkHost,
	checkMonitors,
	checkSupervisor,
} from "@kampus/pipeline/laws/tea-host";
import {Effect} from "effect";
import {here, pct, r1} from "./98-tea-host-package/harness.ts";
import {type Mode, type Preset, runOnce} from "./100-supervision-tree/run.ts";

const RESULTS = here("results/100-supervision-tree.json");
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const ALL = "plants,machine,tree,escalate";
const only = new Set((process.env.ONLY ?? ALL).split(","));
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");

async function plants() {
	const dir = mkdtempSync(join(tmpdir(), "exp100-plant-"));
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
		checkSupervisor(Number(process.env.SUP_DEPTH ?? "6")),
		checkMonitors(Number(process.env.MON_DEPTH ?? "8")),
		checkCalls(Number(process.env.CALL_DEPTH ?? "7")),
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const pass = (r: Run) => {
	const loopGaveUp = r.escalation.supRestGaveUp;
	const common = {
		strategiesStopAndStartTheRightSiblingsInOrder:
			r.episodes.length > 0 && r.episodes.every((e) => e.ok) && r.giveUps.every((g) => g.ok),
		noUnexplainedStopOrStart: r.unexplained.length === 0,
		// 2 ms of slack: the wait is a host's timer against the ledger's clock (two processes, and
		// Node's timers may fire a millisecond early). Early by more is a real miss.
		backoffNeverEarly: r.backoff.each.every((b) => b.lateMs >= -2),
		downOncePerRealExit:
			r.downs.phantom.length === 0 &&
			r.downs.unseen.length === 0 &&
			r.downs.reportedTwice.length === 0 &&
			r.downs.reportedNotExit.length === 0 &&
			r.downs.neverReported.length === 0,
		noTwoWriters: r.writerBreaks.length === 0,
		noHostErrors: r.errors.length === 0,
	};
	if (r.mode === "escalate")
		return {
			...common,
			// sup:rest: its intensity (3) passed 4 times; top restarts it 3 times, then gives up.
			oneLevelPerGiveUp:
				loopGaveUp === 4 &&
				r.escalation.topRestartedSupRest === 3 &&
				same(r.escalation.eachGiveUp, [
					"restarted sup:rest",
					"restarted sup:rest",
					"restarted sup:rest",
					"exited top",
				]) &&
				r.escalation.supAllRestarted === 0 &&
				r.escalation.topExited.length === 1,
			topTakesItsTreeDown:
				r.treeDown.everyNameDown &&
				r.treeDown.supAllChildrenBeforeIt?.childrenFirst === true &&
				r.treeDown.supAllChildrenBeforeIt.supAllBeforeTop &&
				same(r.treeDown.supAllChildrenBeforeIt.stopOrder, ["a:3", "a:2", "a:1"]) &&
				r.treeDown.downForTop === 1,
		};
	return {
		...common,
		callsAnsweredOnceEach: r.callsOk !== null && Object.values(r.callsOk).every(Boolean),
		shutdownKinds:
			r.shutdown.a3.every((s) => s.startsWith("killed by sup:all")) &&
			// a:2 traps the shutdown and ends itself, unless its host is frozen: then the kill at
			// its 300 ms timeout.
			r.shutdown.a2.every((s) => s === "shutdown" || s === "killed by sup:all (its host frozen)") &&
			r.shutdown.r3KillAfterSignalMs.length > 0 &&
			r.shutdown.r3KillAfterSignalMs.every((ms) => ms >= 100),
		// The crash loop: sup:rest gives up once; top restarts it once; nothing else escalates.
		oneLevelPerGiveUp:
			loopGaveUp === 1 &&
			r.escalation.topRestartedSupRest === 1 &&
			same(r.escalation.eachGiveUp, ["restarted sup:rest"]) &&
			r.escalation.topExited.length === 0,
		// Both freezes (one shorter than the lease, one longer) had a crash in them; every DOWN
		// written while frozen was read, once (downOncePerRealExit), after it was written.
		downsAfterTheFreeze:
			new Set(r.downs.freeze.map((d) => d.freezeMs)).size === 2 &&
			r.downs.freeze.every((d) => d.readMs >= 0),
		noDownForTakeover: r.exitsAfterKillAll === 0 && r.takeovers > 0,
		countsExact: r.counts.every((c) => c.exact),
		deadLetterResentOnce:
			r.deadLetter.setAside.length === 1 &&
			r.deadLetter.setAside[0]?.rev === r.deadLetter.rev &&
			r.deadLetter.poisonCrashes === 3 &&
			r.deadLetter.crashesAfterRedrive === 0 &&
			same(
				r.deadLetter.redrives.map((x) => ("dup" in x ? x.dup : x.how)),
				[false, true],
			) &&
			r.deadLetter.resentRows === 1,
	};
};

const summarize = (r: Run) =>
	`episodes ${r.episodes.filter((e) => e.ok).length}/${r.episodes.length} ok (${r.episodes.filter((e) => e.cut).length} cut), give-ups ${r.giveUps.length}, unexplained ${r.unexplained.length}; sup:rest gave up ${r.escalation.supRestGaveUp}, top restarted it ${r.escalation.topRestartedSupRest}; backoff waits ${r.backoff.each.map((b) => `${b.waitMs}/${b.plannedMs}`).join(" ")}; restart p50 ${r.restartMs.p50} ms; DOWN ${r.downs.real} real + ${r.downs.noproc} noproc (fixed 50 ms re-arm ~${r.downs.noprocIfFixed50Ms}), delivery p50 ${r.downs.deliveryMs.p50} p99 ${r.downs.deliveryMs.p99} ms; freeze ${r.downs.freeze.map((d) => `${d.down} (${d.freezeMs} ms freeze of ${d.frozenHost}) read ${d.readMs} ms after by ${d.readBy.join("+")}`).join(", ") || "none"}; takeovers ${r.takeovers}; counts ${r.counts.map((c) => `${c.count}/${c.want}`).join(" ")}`;

const report = (r: Run, p: Record<string, boolean>) => {
	for (const [k, v] of Object.entries(p)) if (!v) console.log(`  FAIL ${k}`);
	for (const e of r.episodes.filter((x) => !x.ok))
		console.log(
			`  episode ${e.sup} ${e.child}: want ${e.expected.join(", ")}; got ${e.observed.join(", ")}`,
		);
	for (const g of r.giveUps.filter((x) => !x.ok))
		console.log(
			`  give-up ${g.sup}: want ${g.expectedStops.join(", ")}; got ${g.observed.join(", ")}`,
		);
	if (r.unexplained.length > 0) console.log(`  unexplained: ${r.unexplained.join("; ")}`);
	for (const e of r.errors) console.log(`  host ${e.host}: ${e.stderr}`);
};

async function tree() {
	const runs: (Run & {pass: ReturnType<typeof pass>})[] = [];
	for (const [i, preset] of RUNS.entries()) {
		if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
		const r = await runOnce(preset satisfies Preset, i + 1, "tree" satisfies Mode);
		const p = pass(r);
		console.log(`${preset} ${i + 1}: ${summarize(r)}`);
		report(r, p);
		runs.push({...r, pass: p});
		results.tree = runs;
		save();
	}
	const all = (f: (r: Run) => readonly number[]) => runs.flatMap(f);
	const restart = all((r) => r.restartSamples);
	const down = all((r) => r.downs.deliverySamples);
	const wait = all((r) => r.backoff.each.map((b) => b.waitMs));
	const late = all((r) => r.backoff.each.map((b) => b.lateMs));
	const lateAwake = all((r) => r.backoff.each.filter((b) => !b.supFrozen).map((b) => b.lateMs));
	const freeze = all((r) => r.downs.freeze.map((d) => d.readMs));
	const st = (xs: readonly number[]) => ({
		n: xs.length,
		p50: r1(pct(xs, 50)),
		p99: r1(pct(xs, 99)),
	});
	const summary = {
		runs: runs.length,
		allPass: runs.every((r) => Object.values(r.pass).every(Boolean)),
		pooled: {
			note: "every sample of every run, ms. restart: a worker's exit to its restarted row (backoff included); down: DOWN written to DOWN first read; backoffWait: crash to restart under sup:rest's backoff; backoffLate: that wait less the planned one; backoffLateAwake: the same, less the crashes while sup:rest's own host was frozen; freezeDown: a DOWN written while the watcher's host was frozen, to its first read",
			restart: st(restart),
			down: st(down),
			backoffWait: st(wait),
			backoffLate: st(late),
			backoffLateAwake: st(lateAwake),
			freezeDown: st(freeze),
			noproc: all((r) => [r.downs.noproc]),
			noprocIfFixed50Ms: all((r) => [r.downs.noprocIfFixed50Ms]),
		},
	};
	console.log(JSON.stringify(summary, null, 1));
	results.treeSummary = summary;
	save();
}

async function escalate() {
	const r = await runOnce("small", 1, "escalate");
	const p = pass(r);
	console.log(
		`escalate: sup:rest gave up ${r.escalation.supRestGaveUp}, top restarted it ${r.escalation.topRestartedSupRest}, after each give-up: ${r.escalation.eachGiveUp.join(", ")}; top exited (${r.escalation.topExited.join(", ")}); sup:all stop order ${r.treeDown.supAllChildrenBeforeIt?.stopOrder.join(" ")}; every name down ${r.treeDown.everyNameDown}; DOWN for top ${r.treeDown.downForTop}; backoff waits ${r.backoff.each.map((b) => `${b.waitMs}/${b.plannedMs}`).join(" ")}`,
	);
	report(r, p);
	results.escalate = {...r, pass: p};
	save();
}

const sections: Record<string, () => Promise<void> | void> = {plants, machine, tree, escalate};
for (const name of ALL.split(",")) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
process.exit(0);
