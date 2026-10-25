// Experiment 149: what a wifi blip does to a running lane, and the smallest change that makes a
// blip a non-event. Write-up: 149-wifi-blips.md.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/149-wifi-blips.ts            # STEP=blips
//   STEP=kill    a killed host A, and how long its ticket stays stuck before host B takes it
//   STEP=control no cut at all: the baseline
//   STEP=report  the tables, from results/149-wifi-blips.json
//
// The rig, all on this laptop, nothing deployed, no agent, no model, $0:
//
//   - the ledger's real Durable Object in Miniflare (the same code Cloudflare runs), and a second
//     one with the changed rule in 149-wifi-blips/patient/rules.ts;
//   - a fake code host (an HTTP server here) that counts each comment by its key;
//   - per run, two small TCP proxies (149-wifi-blips/proxy.ts) between host A and the ledger and
//     code host, which can `refuse` or `hang` on command;
//   - host A and host B as child processes (149-wifi-blips/pool.ts), each serving a scripted lane
//     (149-wifi-blips/lane.ts) on `serve`, today's or the patient copy.
//
// Each run: A claims the lane's name and runs it; B (in `withB` cells) serves the same name and
// waits; the owner sends an answer into the lane's inbox every 3 s. At a random point 4 to 14 s in,
// A's link drops for DROP seconds, then comes back. The run ends once the lane has stepped again
// after the link is back (plus 6 s), or ttl + 60 s after it. Then the ledger and the code host are
// read, and the run is scored.
//
// CONFIGS= a comma list of T30,T120,T300,P30,P120,P30h (default all), MODES=refuse,hang,
// PRESENCE=alone,withB, DROPS=2,10,30,60,300 (seconds), RUNS=20 a drop, PERIOD_MS=2000.
import {type ChildProcess, spawn} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer as createHttp} from "node:http";
import {stripTypeScriptTypes} from "node:module";
import {createServer as createNet} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {cast, Ledger, type Row} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {ledgerOptions} from "@kampus/fabrika/local";
import {homeOf} from "@kampus/pipeline/asks/ledger";
import {planOf, taskId, ticketId} from "@kampus/pipeline/ids";
import {Effect, ManagedRuntime} from "effect";
import {Miniflare} from "miniflare";
import {LinkProxy, type Mode} from "./149-wifi-blips/proxy.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/149-wifi-blips.json");
const POOL = here("149-wifi-blips/pool.ts");
const PATIENT = here("149-wifi-blips/patient/");
const STEP = process.env.STEP ?? "blips";
const list = (v: string | undefined, d: string) => (v ?? d).split(",").filter((s) => s !== "");
const RUNS = Number(process.env.RUNS ?? 20);
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 2000);
const DROPS = list(process.env.DROPS, "2,10,30,60,300").map(Number);
const MODES = list(process.env.MODES, "refuse,hang") as Mode[];
const PRESENCE = list(process.env.PRESENCE, "alone,withB") as Presence[];

type Presence = "alone" | "withB";
type LedgerKind = "today" | "patient";
interface Config {
	readonly variant: "today" | "patient";
	readonly ttlMs: number;
	readonly renewEveryMs: number;
	readonly graceMs: number;
	readonly ledger: LedgerKind;
	readonly about: string;
}
const CONFIGS: Record<string, Config> = {
	T30: {
		variant: "today",
		ttlMs: 30_000,
		renewEveryMs: 10_000,
		graceMs: 0,
		ledger: "today",
		about: "today: ttl 30 s, renew 10 s",
	},
	T120: {
		variant: "today",
		ttlMs: 120_000,
		renewEveryMs: 10_000,
		graceMs: 0,
		ledger: "today",
		about: "today's code, ttl 2 min, renew 10 s",
	},
	T300: {
		variant: "today",
		ttlMs: 300_000,
		renewEveryMs: 10_000,
		graceMs: 0,
		ledger: "today",
		about: "today's code, ttl 5 min, renew 10 s",
	},
	P30: {
		variant: "patient",
		ttlMs: 30_000,
		renewEveryMs: 10_000,
		graceMs: 600_000,
		ledger: "patient",
		about: "patient host + fence until the next claim, ttl 30 s, renew 10 s, grace 10 min",
	},
	P120: {
		variant: "patient",
		ttlMs: 120_000,
		renewEveryMs: 10_000,
		graceMs: 600_000,
		ledger: "patient",
		about: "patient host + fence until the next claim, ttl 2 min, renew 10 s, grace 10 min",
	},
	P30h: {
		variant: "patient",
		ttlMs: 30_000,
		renewEveryMs: 10_000,
		graceMs: 600_000,
		ledger: "today",
		about: "patient host on today's ledger rule, ttl 30 s",
	},
};
const CONFIG_NAMES = list(process.env.CONFIGS, Object.keys(CONFIGS).join(","));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const log = (s: string) => console.log(s);

type Json = Record<string, unknown>;
const readJson = (path: string): Json => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
};
const results: Json = readJson(RESULTS);
/**
 * Keep one cell's summary in the results file, read again first, so two harnesses running side by
 * side do not drop each other's cells. Each run's own score goes to RUNS_FILE, if given (it is big,
 * and not kept in the repo).
 */
const record = (section: string, key: string, summary: Json, runs: readonly Scored[]) => {
	const now = readJson(RESULTS);
	now.at = results.at;
	now.settings = results.settings;
	now[section] = {...((now[section] ?? {}) as Json), [key]: summary};
	Object.assign(results, now);
	writeFileSync(RESULTS, `${JSON.stringify(now, null, "\t")}\n`);
	const file = process.env.RUNS_FILE;
	if (file !== undefined) {
		const all = readJson(file);
		all[`${section}/${key}`] = runs;
		writeFileSync(file, JSON.stringify(all));
	}
};

// ---------------------------------------------------------------- the pieces

const freePort = () =>
	new Promise<number>((ok) => {
		const s = createNet();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			const port = typeof a === "object" && a !== null ? a.port : 0;
			s.close(() => ok(port));
		});
	});

/** The fake code host: one comment per key, counted. */
const world = new Map<string, {count: number; id: number; run: string}>();
let worldIds = 0;
const startWorld = async () => {
	const port = await freePort();
	const server = createHttp((req, res) => {
		let body = "";
		req.on("data", (d) => {
			body += d;
		});
		req.on("end", () => {
			const b = JSON.parse(body || "{}") as {key?: string; run?: string};
			const key = b.key ?? "";
			if (req.url === "/comment") {
				const had = world.get(key);
				if (had) had.count++;
				else world.set(key, {count: 1, id: ++worldIds, run: b.run ?? ""});
				res.end(JSON.stringify({id: world.get(key)?.id ?? null}));
			} else res.end(JSON.stringify({id: world.get(key)?.id ?? null}));
		});
	});
	await new Promise<void>((ok) => server.listen(port, "127.0.0.1", () => ok()));
	return {port, close: () => new Promise<void>((ok) => server.close(() => ok()))};
};

const home = mkdtempSync(join(tmpdir(), "exp149-home-"));
const childEnv = () => {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) if (k !== "TYPESAFE_API_KEY") env[k] = v;
	env.FABRIKA_HOME = home;
	return env;
};

interface Pool {
	readonly proc: ChildProcess;
	readonly pgid: number;
	send: (o: Json) => void;
	readonly exited: Promise<void>;
}
const groups = new Set<number>();
const signal = (pgid: number, sig: NodeJS.Signals) => {
	try {
		process.kill(-pgid, sig);
	} catch {
		// gone already
	}
};
process.on("exit", () => {
	for (const g of groups) signal(g, "SIGKILL");
});

/** Every event the pools printed, by run. */
const events = new Map<string, Json[]>();
const eventsOf = (run: string) => {
	let e = events.get(run);
	if (e === undefined) {
		e = [];
		events.set(run, e);
	}
	return e;
};

const startPool = (cfg: Json): Promise<Pool> =>
	new Promise((ok, fail) => {
		const proc = spawn(
			"nice",
			[
				"-n",
				"15",
				process.execPath,
				"--disable-warning=ExperimentalWarning",
				POOL,
				JSON.stringify(cfg),
			],
			{detached: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv()},
		);
		const pgid = Number(proc.pid);
		groups.add(pgid);
		let buf = "";
		let err = "";
		const pool: Pool = {
			proc,
			pgid,
			send: (o) => proc.stdin?.write(`${JSON.stringify(o)}\n`),
			exited: new Promise((r) => proc.on("exit", () => r())),
		};
		proc.stdout?.on("data", (d: Buffer) => {
			buf += d.toString();
			const parts = buf.split("\n");
			buf = parts.pop() ?? "";
			for (const p of parts) {
				if (p.trim() === "") continue;
				const o = JSON.parse(p) as Json;
				if ("ready" in o) ok(pool);
				else if (typeof o.run === "string") eventsOf(o.run).push(o);
			}
		});
		proc.stderr?.on("data", (d: Buffer) => {
			err += d.toString();
			if (err.length > 4000) err = err.slice(-4000);
		});
		proc.on("exit", (code) => {
			groups.delete(pgid);
			if (code !== 0 && code !== null)
				log(`pool ${cfg.role} ended ${code}: ${err.replace(/\/[^\s:)]+/g, "<path>").slice(-800)}`);
			fail(new Error("pool ended before ready"));
		});
	});
const stopPool = async (p: Pool) => {
	p.proc.stdin?.end();
	await Promise.race([p.exited, sleep(5000)]);
	signal(p.pgid, "SIGKILL");
	groups.delete(p.pgid);
};

/** The patient ledger: the same worker, with ./149-wifi-blips/patient/rules.ts. */
const patientOptions = (direct: number) => {
	const base = ledgerOptions({persist: false, direct, graceMs: 600_000});
	const modules = ["durable-object", "rules"].map((name) => {
		const path = `${PATIENT}${name}.ts`;
		return {
			type: "ESModule" as const,
			path,
			contents: stripTypeScriptTypes(readFileSync(path, "utf8")),
		};
	});
	return {...base, modules, modulesRoot: PATIENT};
};

const startLedgers = async () => {
	const today = new Miniflare(ledgerOptions({persist: false, direct: 0, graceMs: 1000}));
	const patient = new Miniflare(patientOptions(0));
	await Promise.all([today.ready, patient.ready]);
	const urls: Record<LedgerKind, string> = {
		today: (await today.unsafeGetDirectURL()).origin,
		patient: (await patient.unsafeGetDirectURL()).origin,
	};
	return {urls, dispose: () => Promise.all([today.dispose(), patient.dispose()])};
};

// ---------------------------------------------------------------- one run

interface RunPlan {
	readonly id: string;
	readonly n: number;
	readonly drop: number;
	readonly mode: Mode | "none";
	readonly kill: boolean;
}

type Scored = Json & {readonly drop: number};

let runCounter = 0;
const openProxies = new Set<LinkProxy>();
const objectOf = (id: string) => `exp149-${process.pid}-${id}`;

const readAll = (rt: ManagedRuntime.ManagedRuntime<Ledger, unknown>, stream: string) =>
	rt.runPromise(
		Effect.gen(function* () {
			const l = yield* Ledger;
			return yield* l.readStream(stream, 0, 10_000);
		}),
	);

const parse = (r: Row): Json => {
	try {
		return JSON.parse(r.data ?? "null") as Json;
	} catch {
		return {};
	}
};

const percentile = (xs: readonly number[], p: number) => {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? null;
};

/** One run: A serves, B waits (maybe), a cut and a return, then the score. */
async function oneRun(
	o: RunPlan,
	cfg: Config,
	url: string,
	worldPort: number,
	a: Pool | ((plan: RunPlan) => Promise<Pool>),
	b: Pool | null,
): Promise<Scored> {
	const name = `lane:${o.n}`;
	const ticket = `o/r#${o.n}`;
	const object = objectOf(o.id);
	const home =
		homeOf({type: "reviewed", plan: planOf(ticketId(ticket)), task: taskId("t1"), open: 1}) ?? "";
	const rt = ManagedRuntime.make(layerHttp({url, ledger: object}));
	const target = new URL(url);
	const ledgerProxy = new LinkProxy(await freePort(), {
		host: target.hostname,
		port: Number(target.port),
	});
	const worldProxy = new LinkProxy(await freePort(), {host: "127.0.0.1", port: worldPort});
	// A run that throws leaves its proxies listening; main stops what is left here at the end.
	openProxies.add(ledgerProxy).add(worldProxy);
	await ledgerProxy.start();
	await worldProxy.start();
	const ev = eventsOf(o.id);
	const firstAt = (pred: (e: Json) => boolean, from = 0) =>
		ev.find((e) => (e.at as number) >= from && pred(e));
	const until = async (pred: () => boolean, ms: number) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (pred()) return true;
			await sleep(100);
		}
		return false;
	};
	await rt.runPromise(
		Effect.gen(function* () {
			const l = yield* Ledger;
			yield* l.register(home, "user:owner");
			return yield* l.register(name, "user:owner");
		}),
	);
	const aPool = typeof a === "function" ? await a(o) : a;
	const serveCmd = (ledger: string, worldUrl: string) => ({
		do: "serve",
		run: o.id,
		ledger,
		object,
		name,
		ticket,
		world: worldUrl,
	});
	aPool.send(
		serveCmd(`http://127.0.0.1:${ledgerProxy.port}`, `http://127.0.0.1:${worldProxy.port}`),
	);
	const started = (e: Json) => e.ev === "program" && e.phase === "started";
	if (!(await until(() => firstAt(started) !== undefined, 30_000)))
		throw new Error(`${o.id}: A never started`);
	const t0 = (firstAt(started)?.at as number) ?? Date.now();
	if (b !== null) b.send(serveCmd(url, `http://127.0.0.1:${worldPort}`));
	// The owner's answers, every 3 s, straight to the ledger.
	let asked = 0;
	const answering = setInterval(() => {
		const j = ++asked;
		rt.runPromise(cast(name, `ans:${j}`, {ask: `a${j}`}, "user:owner")).catch(() => {});
	}, 3000);
	const cutAt = t0 + rand(4000, 14_000);
	await sleep(Math.max(0, cutAt - Date.now()));
	const cut = Date.now();
	const bellsBefore = ledgerProxy.openBells;
	if (o.kill) signal(aPool.pgid, "SIGKILL");
	else if (o.mode !== "none") {
		await ledgerProxy.set(o.mode);
		await worldProxy.set(o.mode);
	}
	await sleep(o.drop * 1000);
	const bellsInHang = ledgerProxy.openBells;
	if (!o.kill && o.mode !== "none") {
		await ledgerProxy.set("pass");
		await worldProxy.set("pass");
	}
	const back = Date.now();
	const stepped = () => firstAt((e) => e.ev === "step" && (e.from as number) > back, back);
	await until(() => stepped() !== undefined, cfg.ttlMs + 60_000);
	await sleep(6000);
	clearInterval(answering);
	aPool.send({do: "stop", run: o.id});
	b?.send({do: "stop", run: o.id});
	await sleep(1500);
	const end = Date.now();

	// ------------------------------------------------ the score
	const registry = await readAll(rt, name);
	const claims = registry.filter((r) => r.kind === "claimed");
	const aHolder = (h: string) => h.startsWith("A-");
	const notes = (await readAll(rt, `${home}/inbox`)).filter((r) => r.kind === "reviewed");
	const ks = notes.map((r) => Number(parse(r).open));
	const counts = new Map<number, number>();
	for (const k of ks) counts.set(k, (counts.get(k) ?? 0) + 1);
	const K = Math.max(0, ...ks);
	const missing = [...Array(K).keys()].map((i) => i + 1).filter((k) => !counts.has(k)).length;
	const doubled = [...counts.values()].filter((c) => c > 1).length;
	const ordered = ks.every((k, i) => i === 0 || k > (ks[i - 1] ?? 0));
	const state = await readAll(rt, `${name}/state`);
	const last = state.at(-1);
	const answers = ((last ? (parse(last).state as Json | undefined) : undefined)?.answers ??
		[]) as string[];
	const inbox = (await readAll(rt, `${name}/inbox`)).filter((r) => r.kind === "cast");
	const answersDoubled = answers.length - new Set(answers).size;
	const keys = [...world.entries()].filter(([, v]) => v.run === o.id);
	const outsideDoubled = keys.filter(([, v]) => v.count > 1).length;
	const outsideMissing = [...Array(Math.max(0, K - 1)).keys()]
		.map((i) => i + 1)
		.filter((k) => k % 4 === 0 && !keys.some(([key]) => key.endsWith(`#comment:k${k}`))).length;
	const steps = ev.filter((e) => e.ev === "step");
	const stepCounts = new Map<number, number>();
	for (const s of steps) stepCounts.set(s.k as number, (stepCounts.get(s.k as number) ?? 0) + 1);
	const redone = [...stepCounts.values()].filter((c) => c > 1).length;
	const programStarts = ev.filter(started);
	const resumed = firstAt(
		(e) => e.ev === "step" && e.role === "A" && (e.from as number) > back,
		back,
	);
	const firstNote = notes.find((r) => r.at > back);
	const landedWhileAway = notes.filter((r) => r.at > cut && r.at < back).length;
	const away = firstAt((e) => e.ev === "link" && e.state === "away", cut);
	const live = firstAt((e) => e.ev === "link" && e.state === "live", back);
	const slowAfter = ev.some(
		(e) => e.ev === "link" && e.state === "slow" && (e.at as number) >= back,
	);
	const died = registry.some((r) => r.kind === "exited") || ev.some((e) => e.ev === "host_died");
	const crashed = ev.find((e) => e.ev === "program" && e.phase === "ended" && e.how === "crashed");
	const takeover = programStarts.find((e) => e.role === "B");
	const scored: Scored = {
		id: o.id,
		drop: o.drop,
		mode: o.kill ? "kill" : o.mode,
		// kept: A's first claim lasted the whole run. reclaimed: A lost it and claimed again itself.
		kept: claims.length === 1 && claims.every((c) => aHolder(c.writer)),
		reclaimed: claims.length > 1 && claims.every((c) => aHolder(c.writer)),
		claims: claims.length,
		restarts: Math.max(0, programStarts.length - 1),
		died,
		crashed: crashed === undefined ? null : String(crashed.why ?? "").slice(0, 160),
		steps: K,
		missing,
		doubled,
		ordered,
		landedWhileAway,
		redone,
		answersSent: inbox.length,
		answersTaken: answers.length,
		answersDoubled,
		outsideWrites: keys.length,
		outsideDoubled,
		outsideMissing,
		resumedMs: resumed === undefined ? null : (resumed.at as number) - back,
		firstNoteMs: firstNote === undefined ? null : firstNote.at - back,
		takeoverMs: takeover === undefined ? null : (takeover.at as number) - cut,
		awayMs: away === undefined ? null : (away.at as number) - cut,
		liveMs: live === undefined ? null : (live.at as number) - back,
		slowAfter,
		bells: {before: bellsBefore, during: bellsInHang, conns: ledgerProxy.counts.sockets},
		late: ledgerProxy.counts.late,
		reset: ledgerProxy.counts.reset,
		hostWords: [
			...new Set(
				ev
					.filter((e) => e.ev === "renew" || e.ev === "lease_end" || e.ev === "phase")
					.map((e) => `${e.role}:${e.ev}:${e.answer ?? e.to ?? ""}`),
			),
		],
		lastMs: end - t0,
	};
	await ledgerProxy.stop();
	await worldProxy.stop();
	openProxies.delete(ledgerProxy);
	openProxies.delete(worldProxy);
	await rt.dispose();
	return scored;
}

// ---------------------------------------------------------------- cells

const summarize = (rs: readonly Scored[]) => {
	const n = rs.length;
	const count = (f: (r: Scored) => boolean) => rs.filter(f).length;
	const sum = (f: (r: Scored) => number) => rs.reduce((a, r) => a + f(r), 0);
	const ms = (f: (r: Scored) => number | null) => rs.map(f).filter((x): x is number => x !== null);
	const resumed = ms((r) => r.resumedMs as number | null);
	const away = ms((r) => r.awayMs as number | null);
	const live = ms((r) => r.liveMs as number | null);
	const takeover = ms((r) => r.takeoverMs as number | null);
	return {
		runs: n,
		kept: count((r) => r.kept === true),
		reclaimed: count((r) => r.reclaimed === true),
		noRestart: count((r) => r.restarts === 0 && r.claims === 1),
		died: count((r) => r.died === true),
		missing: sum((r) => r.missing as number),
		doubledFacts: sum((r) => r.doubled as number),
		outOfOrder: count((r) => r.ordered !== true),
		redoneSteps: sum((r) => r.redone as number),
		answersDoubled: sum((r) => r.answersDoubled as number),
		outsideDoubled: sum((r) => r.outsideDoubled as number),
		outsideMissing: sum((r) => r.outsideMissing as number),
		resumed: resumed.length,
		resumedMedianMs: percentile(resumed, 0.5),
		resumedP95Ms: percentile(resumed, 0.95),
		resumedMaxMs: resumed.length ? Math.max(...resumed) : null,
		takeovers: takeover.length,
		takeoverMedianMs: percentile(takeover, 0.5),
		takeoverMaxMs: takeover.length ? Math.max(...takeover) : null,
		awayMedianMs: percentile(away, 0.5),
		liveMedianMs: percentile(live, 0.5),
		slowAfter: count((r) => r.slowAfter === true),
		late: sum((r) => r.late as number),
		crashes: [...new Set(rs.map((r) => r.crashed).filter((c) => c !== null))].slice(0, 3),
	};
};

async function cell(
	name: string,
	cfg: Config,
	mode: Mode | "none",
	presence: Presence,
	drops: readonly number[],
	urls: Record<LedgerKind, string>,
	worldPort: number,
) {
	const poolCfg = (role: "A" | "B") => ({
		role,
		variant: cfg.variant,
		ttlMs: cfg.ttlMs,
		renewEveryMs: cfg.renewEveryMs,
		graceMs: cfg.graceMs,
		periodMs: PERIOD_MS,
	});
	const a = await startPool(poolCfg("A"));
	const b = presence === "withB" ? await startPool(poolCfg("B")) : null;
	const plans: RunPlan[] = [];
	for (const drop of drops)
		for (let i = 0; i < RUNS; i++) {
			const n = ++runCounter;
			plans.push({id: `${name}-${mode}-${presence}-${drop}-${i}`, n, drop, mode, kill: false});
		}
	const t = Date.now();
	const scored = await Promise.all(
		plans.map(async (p, i) => {
			await sleep(i * 40);
			try {
				return await oneRun(p, cfg, urls[cfg.ledger], worldPort, a, b);
			} catch (e) {
				return {id: p.id, drop: p.drop, error: String(e)} as Scored;
			}
		}),
	);
	await stopPool(a);
	if (b !== null) await stopPool(b);
	const byDrop: Record<string, unknown> = {};
	for (const drop of drops)
		byDrop[`${drop}s`] = summarize(scored.filter((r) => r.drop === drop && !("error" in r)));
	const errors = scored.filter((r) => "error" in r).map((r) => String(r.error).slice(0, 200));
	const key = `${name}/${mode}/${presence}`;
	record("blips", key, {about: cfg.about, byDrop, errors}, scored);
	log(`${key}: ${Math.round((Date.now() - t) / 1000)} s, errors ${errors.length}`);
	for (const drop of drops) {
		const s = byDrop[`${drop}s`] as ReturnType<typeof summarize>;
		log(
			`  ${drop}s kept ${s.kept}/${s.runs} reclaimed ${s.reclaimed} noRestart ${s.noRestart} died ${s.died} dbl facts ${s.doubledFacts} outside ${s.outsideDoubled} answers ${s.answersDoubled} redone ${s.redoneSteps} missing ${s.missing} resumed p50 ${s.resumedMedianMs} p95 ${s.resumedP95Ms} max ${s.resumedMaxMs} (${s.resumed}) away ${s.awayMedianMs} live ${s.liveMedianMs} takeovers ${s.takeovers}`,
		);
	}
}

/** A killed A, one process per run, and B taking over. */
async function killCell(
	name: string,
	cfg: Config,
	urls: Record<LedgerKind, string>,
	worldPort: number,
) {
	const poolCfg = (role: "A" | "B") => ({
		role,
		variant: cfg.variant,
		ttlMs: cfg.ttlMs,
		renewEveryMs: cfg.renewEveryMs,
		graceMs: cfg.graceMs,
		periodMs: PERIOD_MS,
	});
	const b = await startPool(poolCfg("B"));
	const pools: Pool[] = [];
	const plans: RunPlan[] = [...Array(RUNS).keys()].map((i) => ({
		id: `${name}-kill-${i}`,
		n: ++runCounter,
		drop: 0,
		mode: "none",
		kill: true,
	}));
	const scored = await Promise.all(
		plans.map(async (p, i) => {
			await sleep(i * 100);
			try {
				return await oneRun(
					p,
					cfg,
					urls[cfg.ledger],
					worldPort,
					async () => {
						const a = await startPool(poolCfg("A"));
						pools.push(a);
						return a;
					},
					b,
				);
			} catch (e) {
				return {id: p.id, drop: 0, error: String(e)} as Scored;
			}
		}),
	);
	for (const p of pools) await stopPool(p);
	await stopPool(b);
	const ok = scored.filter((r) => !("error" in r));
	const errors = scored.filter((r) => "error" in r).map((r) => String(r.error).slice(0, 200));
	record("kills", name, {about: cfg.about, summary: summarize(ok), errors}, scored);
	const s = summarize(ok);
	log(
		`kill ${name}: takeovers ${s.takeovers}/${s.runs} median ${s.takeoverMedianMs} max ${s.takeoverMaxMs} dbl ${s.doubledFacts} outside ${s.outsideDoubled} answers ${s.answersDoubled} redone ${s.redoneSteps}`,
	);
}

// ---------------------------------------------------------------- main

if (STEP === "report") {
	const blips = (results.blips ?? {}) as Record<string, {byDrop: Record<string, Json>}>;
	for (const [key, v] of Object.entries(blips)) {
		log(key);
		for (const [drop, s] of Object.entries(v.byDrop))
			log(
				`  ${drop} kept ${s.kept}/${s.runs} noRestart ${s.noRestart} died ${s.died} dbl ${s.doubledFacts}/${s.outsideDoubled}/${s.answersDoubled} redone ${s.redoneSteps} resumed p50 ${s.resumedMedianMs} p95 ${s.resumedP95Ms} max ${s.resumedMaxMs} away ${s.awayMedianMs} live ${s.liveMedianMs}`,
			);
	}
	const kills = (results.kills ?? {}) as Record<string, {summary: Json}>;
	for (const [key, v] of Object.entries(kills)) log(`kill ${key}: ${JSON.stringify(v.summary)}`);
} else {
	const ledgers = await startLedgers();
	const w = await startWorld();
	results.at = new Date().toISOString().slice(0, 10);
	results.settings = {RUNS, PERIOD_MS, node: process.version};
	try {
		if (STEP === "control") {
			await cell("T30", CONFIGS.T30 as Config, "none", "alone", [0], ledgers.urls, w.port);
		} else if (STEP === "kill") {
			for (const name of CONFIG_NAMES)
				await killCell(name, CONFIGS[name] as Config, ledgers.urls, w.port);
		} else {
			for (const name of CONFIG_NAMES)
				for (const mode of MODES)
					for (const presence of PRESENCE)
						await cell(name, CONFIGS[name] as Config, mode, presence, DROPS, ledgers.urls, w.port);
		}
	} finally {
		for (const p of openProxies) await p.stop();
		await w.close();
		await ledgers.dispose();
		rmSync(home, {recursive: true, force: true});
		// A run that threw may still hold a socket or a timer; the work is saved, so leave now.
		process.exit(0);
	}
}
