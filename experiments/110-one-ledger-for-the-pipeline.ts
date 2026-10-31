// Experiment 110: one ledger for the pipeline. The pipeline's facts and claims live on the
// tea-host's Ledger (packages/pipeline/src/asks/ledger.ts and claims.ts), not in a JSONL
// file of their own. A claim is the ledger's lease on the ticket's name, so a lost lease fences
// the old holder. Write-up: 110-one-ledger-for-the-pipeline.md.
//
// ONLY: a comma list of laws|flow|race|freeze (default all).
//   laws    the pipeline's laws (asks/laws.ts) on the Durable Object in Miniflare, node:sqlite and
//           memory; then two planted mistakes, each of which a law must catch
//   flow    one ticket's life (plan, approve, lane, claim, a scripted review, release) as a child
//           process on a Miniflare ledger: a control run, then KILLS runs SIGKILLed mid-flow and
//           started again; each run's folded state must equal the control's
//   race    two processes claim the same ticket at the same moment, ROUNDS times
//   freeze  a holder SIGSTOPped past its lease while another lane takes the ticket, then woken:
//           how many of its late writes the ledger took (FREEZES times)
// KILLS=20, ROUNDS=50, FREEZES=5, TTL_MS=1000, PAUSE_MS=150.
// Results: results/110-one-ledger-for-the-pipeline.json.
//
// Node at the edge, as 93 to 102: the harness starts each child in its own process group and
// signals the whole group. The Miniflare ledger runs in this process; a killed child loses only
// itself, as a crashed pipeline process would.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import {Effect, Layer} from "effect";
import {Miniflare} from "miniflare";
import {layerHttp} from "../packages/fabrika/src/host/http.ts";
import {type LawResult, layerPlanted} from "../packages/fabrika/src/host/laws.ts";
import {layerMemory, memoryService} from "../packages/fabrika/src/host/memory.ts";
import {layerSqlite} from "../packages/fabrika/src/host/sqlite.ts";
import {ledgerOptions} from "../packages/fabrika/src/host/worker-options.ts";
import {claim, layerLanes} from "../packages/pipeline/src/asks/claims.ts";
import {runPipelineLaws} from "../packages/pipeline/src/asks/laws.ts";
import {factsOf, Ledger, readFacts, ticketName} from "../packages/pipeline/src/asks/ledger.ts";
import {foldLedger} from "../packages/pipeline/src/asks/rules.ts";
import {laneId, ticketId} from "../packages/pipeline/src/ids.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/110-one-ledger-for-the-pipeline.json");
const CHILD = here("110-one-ledger-for-the-pipeline/child.ts");
const only = new Set((process.env.ONLY ?? "laws,flow,race,freeze").split(","));
const KILLS = Number(process.env.KILLS ?? 20);
const ROUNDS = Number(process.env.ROUNDS ?? 50);
const FREEZES = Number(process.env.FREEZES ?? 5);
const TTL_MS = Number(process.env.TTL_MS ?? 1000);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 150);
const GRACE_MS = 1000;

const results: Record<string, unknown> = {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (line: string) => console.log(line);

// ---------------------------------------------------------------- child process groups

type Child = {
	proc: ChildProcess;
	pgid: number;
	lines: Record<string, unknown>[];
	exited: Promise<number | null>;
	err: () => string;
};
const groups = new Set<number>();
const signal = (pgid: number, sig: NodeJS.Signals) => {
	// oxlint-disable-next-line fabrika/no-raw-try-catch -- node at the edge: signalling a process group that may be gone already
	try {
		process.kill(-pgid, sig);
	} catch {
		// the group is gone already
	}
};
const alive = (pgid: number) =>
	execFileSync("ps", ["-A", "-o", "pgid="], {encoding: "utf8"})
		.split("\n")
		.some((l) => Number(l.trim()) === pgid);
const killGroup = async (pgid: number) => {
	signal(pgid, "SIGCONT");
	signal(pgid, "SIGKILL");
	for (let i = 0; i < 100 && alive(pgid); i++) await sleep(20);
	groups.delete(pgid);
};
process.on("exit", () => {
	for (const g of groups) signal(g, "SIGKILL");
});

const child = (args: readonly string[]): Child => {
	const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CHILD, ...args], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const pgid = Number(proc.pid);
	groups.add(pgid);
	const lines: Record<string, unknown>[] = [];
	let buf = "";
	let err = "";
	proc.stdout?.on("data", (d: Buffer) => {
		buf += d.toString();
		const parts = buf.split("\n");
		buf = parts.pop() ?? "";
		for (const p of parts) if (p.trim() !== "") lines.push(JSON.parse(p));
	});
	proc.stderr?.on("data", (d: Buffer) => {
		err += d.toString();
	});
	const exited = new Promise<number | null>((r) =>
		proc.on("exit", (code) => {
			groups.delete(pgid);
			r(code);
		}),
	);
	return {proc, pgid, lines, exited, err: () => err.replace(/\/[^\s:)]+/g, "<path>").slice(0, 600)};
};
const until = async (c: Child, seen: (l: Record<string, unknown>) => boolean, ms = 30_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const hit = c.lines.find(seen);
		if (hit !== undefined) return hit;
		await sleep(5);
	}
	throw new Error(`waited ${ms} ms: ${JSON.stringify(c.lines.slice(-3))} ${c.err()}`);
};
const ended = async (c: Child) => {
	const code = await c.exited;
	if (code !== 0) throw new Error(`a child ended ${code}: ${c.err()}`);
};

let ledgers = 0;
const freshLedger = (tag: string) => `${tag}-${Date.now().toString(36)}-${ledgers++}`;
const on = <A>(url: string, ledger: string, e: Effect.Effect<A, never, Ledger>) =>
	Effect.runPromise(e.pipe(Effect.provide(layerHttp({url, ledger})), Effect.scoped));

// ---------------------------------------------------------------- laws

async function laws(url: string) {
	const dir = mkdtempSync(join(tmpdir(), "exp110-laws-"));
	const run = (layer: Layer.Layer<Ledger, unknown>) =>
		Effect.runPromise(runPipelineLaws().pipe(Effect.provide(layer), Effect.scoped));
	const brief = (rs: readonly LawResult[]) => ({
		held: rs.filter((r) => r.pass).length,
		of: rs.length,
		broken: rs.filter((r) => !r.pass).map((r) => r.law.split(".")[0]),
	});
	const misread = Layer.effect(
		Ledger,
		Effect.sync(() => {
			const inner = memoryService();
			const moved = (s: string) =>
				s.replace(/^(pipeline\/ticket\/[^#]+#)(\d+)\//, (_, h, n) => `${h}${Number(n) + 1}/`);
			return Ledger.of({
				...inner,
				read: (from, limit, prefix) =>
					inner
						.read(from, limit, prefix)
						.pipe(Effect.map((rs) => rs.map((r) => ({...r, stream: moved(r.stream)})))),
			});
		}),
	);
	const out = {
		durableObject: brief(await run(layerHttp({url, ledger: freshLedger("laws")}))),
		sqlite: brief(await run(layerSqlite({path: join(dir, "laws.sqlite"), threads: 4}))),
		memory: brief(await run(layerMemory())),
		plantNoGuard: brief(
			await run(
				layerPlanted(
					join(dir, "no-guard.sqlite"),
					"no guard (95 and 96: an unfenced write under a name lands)",
				),
			),
		),
		plantMisread: brief(await run(misread)),
	};
	results.laws = out;
	say(`laws: ${JSON.stringify(out)}`);
}

// ---------------------------------------------------------------- flow

/** One flow on its own ledger; `killAfter`: SIGKILL its group once it printed that step, then start it again. */
async function flowRun(url: string, killAfter: number | null) {
	const ledger = freshLedger("flow");
	const args = ["flow", url, ledger, String(TTL_MS), String(PAUSE_MS)];
	const started = Date.now();
	let killedAt: number | null = null;
	if (killAfter !== null) {
		const first = child(args);
		await until(first, (l) => l.step === killAfter);
		await sleep(Math.floor(Math.random() * PAUSE_MS));
		killedAt = Number(first.lines.filter((l) => "step" in l).at(-1)?.step ?? 0);
		await killGroup(first.pgid);
	}
	const second = child(args);
	await ended(second);
	const done = second.lines.find((l) => "done" in l);
	const entries = await on(url, ledger, readFacts);
	const lane = entries.find((e) => e.fact.type === "lane")?.fact;
	const lease =
		lane?.type === "lane"
			? await on(
					url,
					ledger,
					Effect.flatMap(Ledger, (l) => Effect.orDie(l.lease(ticketName(lane.ticket)))),
				)
			: null;
	const leaseLive = lease !== null && lease.expires_at > Date.now();
	return {entries, done, killedAt, ms: Date.now() - started, leaseLive};
}

async function flow(url: string) {
	const control = await flowRun(url, null);
	const folded = foldLedger(control.entries);
	const runs: {
		killedAfterStep: number | null;
		sameFacts: boolean;
		sameFold: boolean;
		ms: number;
	}[] = [];
	for (let i = 0; i < KILLS; i++) {
		const r = await flowRun(url, 1 + (i % 5));
		runs.push({
			killedAfterStep: r.killedAt,
			sameFacts: isDeepStrictEqual(r.entries, control.entries),
			sameFold: isDeepStrictEqual(foldLedger(r.entries), folded),
			ms: r.ms,
		});
		say(
			`flow ${i + 1}/${KILLS}: killed after step ${r.killedAt}, same fold ${runs.at(-1)?.sameFold}, ${r.ms} ms`,
		);
	}
	const out = {
		controlFacts: control.entries.length,
		controlKinds: control.entries.map((e) => e.fact.type),
		controlLeaseLive: control.leaseLive,
		kills: KILLS,
		sameFold: runs.filter((r) => r.sameFold).length,
		sameFacts: runs.filter((r) => r.sameFacts).length,
		killedAfterStep: runs.map((r) => r.killedAfterStep),
		msMax: Math.max(...runs.map((r) => r.ms)),
	};
	results.flow = out;
	say(`flow: ${JSON.stringify(out)}`);
}

// ---------------------------------------------------------------- race

async function race(url: string) {
	const ledger = freshLedger("race");
	const go = join(mkdtempSync(join(tmpdir(), "exp110-race-")), "go");
	const children = ["L1", "L2"].map((lane) =>
		child(["race", url, ledger, lane, String(ROUNDS), "40", go]),
	);
	await Promise.all(children.map((k) => until(k, (l) => l.ready === true)));
	writeFileSync(go, String(Date.now() + 300));
	await Promise.all(children.map(ended));
	const rows = await on(
		url,
		ledger,
		Effect.flatMap(Ledger, (l) => Effect.orDie(l.read(0, 100_000, "pipeline"))),
	);
	let oneWinner = 0;
	let agreed = 0;
	for (let round = 1; round <= ROUNDS; round++) {
		const name = ticketName(ticketId(`o/r#${round}`));
		const claims = rows.filter((r) => r.stream === name && r.kind === "claimed");
		if (claims.length === 1) oneWinner++;
		const told = children.map((k) => k.lines.find((l) => l.told === round)?.holder);
		if (told.every((t) => t === claims[0]?.writer)) agreed++;
	}
	const refused = children.map((k) => Number(k.lines.find((l) => "refused" in l)?.refused ?? 0));
	const out = {rounds: ROUNDS, oneWinner, agreed, refused: refused.reduce((a, b) => a + b, 0)};
	results.race = out;
	say(`race: ${JSON.stringify(out)}`);
}

// ---------------------------------------------------------------- freeze

async function freezeOnce(url: string, i: number) {
	const ledger = freshLedger("freeze");
	const T = ticketId(`o/r#${i + 1}`);
	const holder = child(["hold", url, ledger, T, String(TTL_MS), "100"]);
	await until(holder, (l) => "held" in l);
	await until(holder, (l) => l.wrote === 3);
	signal(holder.pgid, "SIGSTOP");
	const stoppedAt = Date.now();
	// The lease runs out while it sleeps; another lane, in this process, takes the ticket.
	await sleep(TTL_MS + GRACE_MS + 200);
	const taken = await Effect.runPromise(
		claim(T, laneId("L2")).pipe(
			Effect.provide(
				layerLanes({ttlMs: 30_000}).pipe(Layer.provideMerge(layerHttp({url, ledger}))),
			),
			Effect.scoped,
		),
	);
	const before = holder.lines.length;
	signal(holder.pgid, "SIGCONT");
	const wokeAt = Date.now();
	await sleep(1500);
	await killGroup(holder.pgid);
	const afterWake = holder.lines.slice(before).filter((l) => "wrote" in l);
	const rows = await on(
		url,
		ledger,
		Effect.flatMap(Ledger, (l) => Effect.orDie(l.readStream(factsOf(ticketName(T))))),
	);
	const name = await on(
		url,
		ledger,
		Effect.flatMap(Ledger, (l) => Effect.orDie(l.readStream(ticketName(T)))),
	);
	const takenPos = name.filter((r) => r.kind === "claimed").at(-1)?.pos ?? Number.POSITIVE_INFINITY;
	return {
		taken,
		frozenMs: wokeAt - stoppedAt,
		writesBefore:
			holder.lines.filter((l) => "wrote" in l && l.word === "ok").length -
			afterWake.filter((l) => l.word === "ok").length,
		lateTried: afterWake.length,
		lateRefused: afterWake.filter((l) => l.word === "fenced").length,
		lateAcceptedByLedger: rows.filter((r) => r.writer === "L1" && r.pos > takenPos).length,
	};
}

async function freeze(url: string) {
	const runs = [];
	for (let i = 0; i < FREEZES; i++) {
		const r = await freezeOnce(url, i);
		runs.push(r);
		say(`freeze ${i + 1}/${FREEZES}: ${JSON.stringify(r)}`);
	}
	const out = {
		freezes: FREEZES,
		takenByL2: runs.filter((r) => r.taken === "L2").length,
		lateTried: runs.reduce((a, r) => a + r.lateTried, 0),
		lateRefused: runs.reduce((a, r) => a + r.lateRefused, 0),
		lateAccepted: runs.reduce((a, r) => a + r.lateAcceptedByLedger, 0),
		runs,
	};
	results.freeze = out;
	say(`freeze: ${JSON.stringify({...out, runs: undefined})}`);
}

// ---------------------------------------------------------------- main

const mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
try {
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	results.at = new Date().toISOString().slice(0, 10);
	results.settings = {KILLS, ROUNDS, FREEZES, TTL_MS, PAUSE_MS, node: process.version};
	if (only.has("laws")) await laws(url);
	if (only.has("flow")) await flow(url);
	if (only.has("race")) await race(url);
	if (only.has("freeze")) await freeze(url);
	save();
} finally {
	for (const g of groups) await killGroup(g);
	await mf.dispose();
}
