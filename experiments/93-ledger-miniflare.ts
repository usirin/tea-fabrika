// Experiment 93: one Durable Object class as the ledger everywhere. On Cloudflare for a team,
// and inside Miniflare (workerd as a Node library) for one person on a laptop, its data
// persisted to disk. And: is Miniflare fit to run as a long-lived local process?
//
// ONLY=install|laws|kill|hosts|node|file|measure|soak|memory (comma list; default all).
// SOAK_MIN (default 30), KILL_EVERY_MIN (default 5), KILLS (law 7 repeats, default 5),
// MEM_MIN (each of the memory probe's three phases, default 3), MEM_READ_MIN (the read
// phase alone), MEM_TAG (the key its result is saved under, default "memory").
// No key, no model, no network beyond 127.0.0.1. Results: results/93-ledger-miniflare.json.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative} from "node:path";
// biome-ignore lint/plugin: law 10 reads the Durable Object's own file; nothing here fakes D1.
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import {Miniflare} from "miniflare";
import {fetchPost, httpClient, type LedgerClient} from "./93-ledger/client.ts";
import {
	fresh,
	type LawResult,
	law1Claims,
	law2Appends,
	law3Fencing,
	law4Expiry,
	law5Stop,
	law6View,
} from "./93-ledger/laws.ts";
import {nodePool, openNodeDb} from "./93-ledger/node-ledger.ts";
import {append, type Row} from "./93-ledger/sql.ts";
import {ledgerOptions} from "./93-ledger/worker.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/93-ledger-miniflare.json");
const HOST = here("93-ledger/host.ts");
const RACER = here("93-ledger/racer.ts");
const GRACE_MS = 1000;
const LEDGER = "acme-app";

const only = new Set(
	(process.env.ONLY ?? "install,laws,kill,hosts,node,file,measure,soak,memory").split(","),
);
const SOAK_MIN = Number(process.env.SOAK_MIN ?? "30");
const KILL_EVERY_MIN = Number(process.env.KILL_EVERY_MIN ?? "5");
const KILLS = Number(process.env.KILLS ?? "5");

const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? Number.NaN : (s[Math.floor((s.length - 1) / 2)] ?? Number.NaN);
};
const fmt = (n: number, d = 0) => n.toFixed(d);
const tempDir = (tag: string) => mkdtempSync(join(tmpdir(), `exp93-${tag}-`));

const printLaws = (title: string, laws: LawResult[]) => {
	console.log(`\n## ${title}`);
	for (const l of laws) console.log(`${l.pass ? "PASS" : "FAIL"}  ${l.law}\n      ${l.numbers}`);
};

// ---------------------------------------------------------------- processes

type Proc = {pid: number; ppid: number; pgid: number; rssKb: number; comm: string};
const ps = (): Proc[] =>
	execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,rss=,comm="], {encoding: "utf8"})
		.split("\n")
		.flatMap((line) => {
			const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
			return m
				? [
						{
							pid: Number(m[1]),
							ppid: Number(m[2]),
							pgid: Number(m[3]),
							rssKb: Number(m[4]),
							comm: m[5] ?? "",
						},
					]
				: [];
		});
const group = (pgid: number) => ps().filter((p) => p.pgid === pgid);
const rss = (pgid: number) => {
	const g = group(pgid);
	const workerd = g.filter((p) => p.comm.includes("workerd")).reduce((a, p) => a + p.rssKb, 0);
	const node = g.filter((p) => !p.comm.includes("workerd")).reduce((a, p) => a + p.rssKb, 0);
	return {workerdMb: workerd / 1024, nodeMb: node / 1024, procs: g.length};
};

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port"))));
		});
	});

type Host = {
	proc: ChildProcess;
	pid: number;
	url: string;
	spawnToReadyMs: number;
	innerMs: number;
	err: string[];
};

/** Starts Miniflare in a child process, its own process group so a SIGKILL takes workerd too. */
const startHost = (persist: string, port: number): Promise<Host> =>
	new Promise((resolve, reject) => {
		const t0 = performance.now();
		const proc = spawn(process.execPath, ["--no-warnings", HOST], {
			env: {...process.env, PERSIST: persist, PORT: String(port), GRACE_MS: String(GRACE_MS)},
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const err: string[] = [];
		proc.stderr?.on("data", (d: Buffer) => err.push(d.toString()));
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error(`host not ready in 60 s: ${err.join("")}`)),
			60_000,
		);
		proc.stdout?.on("data", (d: Buffer) => {
			buf += d.toString();
			const line = buf.split("\n").find((l) => l.startsWith("{"));
			if (!line) return;
			clearTimeout(timer);
			const j = JSON.parse(line);
			resolve({
				proc,
				pid: Number(proc.pid),
				url: String(j.ready),
				spawnToReadyMs: performance.now() - t0,
				innerMs: Number(j.ms),
				err,
			});
		});
		proc.on("exit", (code) => {
			clearTimeout(timer);
			if (!buf.includes("{")) reject(new Error(`host exited ${code}: ${err.join("")}`));
		});
	});

/** SIGKILL to the whole group (node and workerd), then wait until no process of it is left. */
const killGroup = async (h: Host) => {
	process.kill(-h.pid, "SIGKILL");
	for (let i = 0; i < 100 && group(h.pid).length > 0; i++) await sleep(50);
	return group(h.pid).length;
};

const stopHost = async (h: Host) => {
	process.kill(h.pid, "SIGTERM");
	for (let i = 0; i < 100 && group(h.pid).length > 0; i++) await sleep(50);
	if (group(h.pid).length > 0) await killGroup(h);
};

const clientFor = (url: string): LedgerClient => httpClient(fetchPost(url), LEDGER);

/** Every event, page by page. */
const readAll = async (c: LedgerClient): Promise<Row[]> => {
	const all: Row[] = [];
	for (;;) {
		const last = all.at(-1);
		const page = await c.read(last ? Number(last.pos) : 0, 5000);
		all.push(...page);
		if (page.length < 5000) return all;
	}
};

const wid = (r: Row): string | null => {
	const d = JSON.parse(String(r.data ?? "{}"));
	return typeof d.wid === "string" ? d.wid : null;
};

/** pos gapless from 1; rev gapless from 1 per stream. */
const gaps = (rows: Row[]) => {
	let posGaps = 0;
	rows.forEach((r, i) => {
		if (Number(r.pos) !== i + 1) posGaps++;
	});
	const byStream = new Map<string, number[]>();
	for (const r of rows) {
		const s = String(r.stream);
		const list = byStream.get(s) ?? [];
		list.push(Number(r.rev));
		byStream.set(s, list);
	}
	let revGaps = 0;
	for (const revs of byStream.values()) {
		revs.sort((a, b) => a - b);
		revs.forEach((v, i) => {
			if (v !== i + 1) revGaps++;
		});
	}
	return {posGaps, revGaps, streams: byStream.size};
};

// ---------------------------------------------------------------- install size

const du = (p: string) =>
	Number(execFileSync("du", ["-sk", p], {encoding: "utf8"}).split("\t")[0]) / 1024;

function install() {
	const root = realpathSync(here("../node_modules/miniflare"));
	const seen = new Map<string, number>();
	const walk = (pkgDir: string) => {
		if (seen.has(pkgDir)) return;
		seen.set(pkgDir, du(pkgDir));
		// pnpm: a package's dependencies sit beside it in its own node_modules folder.
		const parent = dirname(pkgDir);
		const nm = basename(parent).startsWith("@") ? dirname(parent) : parent;
		for (const name of readdirSync(nm)) {
			const dirs = name.startsWith("@")
				? readdirSync(join(nm, name)).map((n) => join(nm, name, n))
				: [join(nm, name)];
			for (const d of dirs) {
				const real = realpathSync(d);
				if (real !== pkgDir && existsSync(join(real, "package.json"))) walk(real);
			}
		}
	};
	walk(root);
	const named = (needle: string) =>
		[...seen.entries()].filter(([p]) => p.includes(needle)).reduce((a, [, mb]) => a + mb, 0);
	const out = {
		miniflareMb: seen.get(root) ?? 0,
		workerdBinaryMb: named("@cloudflare/workerd-"),
		workerdPkgMb: named("/workerd@"),
		sharpMb: named("sharp"),
		closureMb: [...seen.values()].reduce((a, b) => a + b, 0),
		packages: seen.size,
		biggest: [...seen.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 6)
			.map(([p, mb]) => `${p.split("/node_modules/").at(-1)} ${fmt(mb, 1)} MB`),
	};
	console.log("\n## Install size");
	console.log(JSON.stringify(out, null, 2));
	results.install = out;
}

// ---------------------------------------------------------------- laws 1-6 in process

async function laws() {
	const dir = tempDir("laws");
	const starts: number[] = [];
	// Cold start: three fresh Miniflares, first one counts as the cold one.
	for (let i = 0; i < 3; i++) {
		const t0 = performance.now();
		const cold = tempDir("cold");
		const m = new Miniflare(ledgerOptions({persist: cold, graceMs: GRACE_MS}));
		await m.ready;
		starts.push(performance.now() - t0);
		await m.dispose();
		rmSync(cold, {recursive: true, force: true});
	}
	const t0 = performance.now();
	const mf = new Miniflare(ledgerOptions({persist: dir, graceMs: GRACE_MS}));
	await mf.ready;
	const readyMs = performance.now() - t0;
	const c = httpClient(
		(p, body) => mf.dispatchFetch(`http://ledger${p}`, {method: "POST", body}),
		LEDGER,
	);
	const f0 = performance.now();
	await c.claim(fresh("first"), "h", 0, 1000);
	const firstCallMs = performance.now() - f0;
	const f1 = performance.now();
	await c.lease("nothing");
	const secondCallMs = performance.now() - f1;

	// RPC from Node, not just fetch: the same object through Miniflare's namespace proxy.
	const ns = await mf.getDurableObjectNamespace("LEDGER");
	const stub = ns.get(ns.idFromName(LEDGER));
	const rpcSays = await Reflect.apply(Reflect.get(stub, "lease"), stub, ["nothing"]).then(
		(v: unknown) => `stub.lease from Node: ${JSON.stringify(v)}`,
		(e: unknown) => `stub.lease from Node failed: ${e instanceof Error ? e.message : String(e)}`,
	);

	const out: LawResult[] = [];
	out.push(await law1Claims(c));
	out.push(...(await law2Appends(c)));
	out.push(await law3Fencing(c));
	out.push(...(await law4Expiry(c, GRACE_MS)));
	out.push(await law5Stop(c));
	out.push(await law6View(c));
	printLaws("Laws 1-6, Miniflare in this process", out);

	const rates = await appendRates(c, "in-process dispatchFetch");
	const probes = await sqlProbes(c);
	await mf.dispose();
	results.laws = {
		coldStartMs: starts,
		readyMs,
		firstCallMs,
		secondCallMs,
		rpcSays,
		laws: out,
		rates,
		probes,
	};
	console.log(
		`cold start ${starts.map((s) => fmt(s)).join(", ")} ms; ready ${fmt(readyMs)} ms; first call ${fmt(firstCallMs, 1)} ms; second ${fmt(secondCallMs, 1)} ms`,
	);
	rmSync(dir, {recursive: true, force: true});
}

async function appendRates(c: LedgerClient, label: string, n = 1000) {
	const s = fresh("seq");
	let t0 = performance.now();
	for (let i = 0; i < n; i++) {
		const r = await c.append(s, i, {kind: "note", writer: "w", data: {i}});
		if (!r.ok) throw new Error(`sequential append ${i}: ${r.why}`);
	}
	const seqPerS = n / ((performance.now() - t0) / 1000);
	const tag = fresh("conc");
	const revs = new Map<number, number>();
	t0 = performance.now();
	let failed = 0;
	await Promise.all(
		Array.from({length: 50}, async (_, w) => {
			for (let i = 0; i < (2 * n) / 50; i++) {
				const r = await c.append(`${tag}-${w}`, revs.get(w) ?? 0, {kind: "note", writer: `w${w}`});
				if (r.ok) revs.set(w, r.rev);
				else failed++;
			}
		}),
	);
	const concPerS = (2 * n) / ((performance.now() - t0) / 1000);
	const out = {
		label,
		sequentialPerS: seqPerS,
		concurrent50PerS: concPerS,
		concurrentFailed: failed,
	};
	console.log(
		`rates (${label}): sequential ${fmt(seqPerS)}/s, 50 in flight ${fmt(concPerS)}/s, failed ${failed}`,
	);
	return out;
}

const PROBES = [
	"SELECT sqlite_version() AS v",
	"BEGIN",
	"BEGIN IMMEDIATE",
	"SAVEPOINT a",
	"PRAGMA journal_mode",
	"PRAGMA foreign_keys",
	"PRAGMA busy_timeout = 1000",
	"ATTACH DATABASE ':memory:' AS other",
	"VACUUM",
	"CREATE TABLE _cf_mine (a)",
	"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
	`SELECT json_extract('{"a":1}', '$.a') AS a, '{"a":1}' ->> '$.a' AS b`,
	"SELECT unixepoch() > 0 AS t",
	"CREATE VIRTUAL TABLE fts_probe USING fts5(x)",
	"SELECT 9007199254740993 AS big",
	"SELECT typeof(randomblob(4)) AS t",
];
const sqlProbes = async (c: LedgerClient) => {
	const out: Record<string, string> = {};
	for (const p of PROBES) {
		const r = await c.tryExec(p);
		out[p] = r.ok ? `ok ${JSON.stringify(r.rows).slice(0, 120)}` : `error: ${r.error}`;
	}
	return out;
};

// ---------------------------------------------------------------- law 7: SIGKILL and restart

async function kill() {
	const persist = tempDir("kill");
	const port = await freePort();
	let h = await startHost(persist, port);
	const c = clientFor(h.url);
	const rounds: Record<string, unknown>[] = [];
	const acked = new Map<string, {stream: string; rev: number; pos: number}>();
	let orphan = "";
	let splitBrain: Record<string, unknown> | null = null;

	for (let k = 0; k < KILLS; k++) {
		const leaseStream = `l7-lease-${k}`;
		const cl = await c.claim(leaseStream, "h", 0, 4000);
		let unknown = 0;
		let stop = false;
		const writers = Array.from({length: 8}, async (_, w) => {
			const s = `l7-${k}-${w}`;
			let rev = 0;
			while (!stop) {
				const id = `${k}.${w}.${rev + 1}`;
				try {
					const r = await c.append(s, rev, {kind: "note", writer: `w${w}`, data: {wid: id}});
					if (!r.ok) throw new Error(`append ${s}: ${r.why}`);
					acked.set(id, {stream: s, rev: r.rev, pos: r.pos});
					rev = r.rev;
				} catch {
					unknown++;
					return;
				}
			}
		});
		await sleep(800 + Math.random() * 700);
		const killedAt = Date.now();
		const left = await killGroup(h);
		stop = true;
		await Promise.all(writers);
		const r0 = performance.now();
		h = await startHost(persist, port);
		const restartMs = performance.now() - r0;
		// Touch nothing until the lease and its grace are well past, so the alarm must fire alone.
		await sleep(Math.max(0, killedAt + 4000 + GRACE_MS + 2500 - Date.now()));
		const firstTouch = Date.now();
		const rows = await readAll(c);
		const byWid = new Map(rows.flatMap((r) => (wid(r) ? [[wid(r), r] as const] : [])));
		let lost = 0;
		for (const [id, a] of acked) {
			const r = byWid.get(id);
			if (!r || Number(r.pos) !== a.pos || Number(r.rev) !== a.rev || r.stream !== a.stream) lost++;
		}
		const expired = rows.find((r) => r.stream === leaseStream && r.kind === "lease_expired");
		const g = gaps(rows);
		rounds.push({
			round: k,
			claimOk: cl.ok,
			processesLeftAfterKill: left,
			restartMs,
			events: rows.length,
			acked: acked.size,
			lostAcked: lost,
			inFlightAtKill: unknown,
			...g,
			alarmFiredAlone: expired ? Number(expired.at) < firstTouch : false,
			alarmFiredMsAfterExpiry: expired && cl.ok ? Number(expired.at) - cl.expiresAt : null,
		});
		console.log(`kill ${k}: ${JSON.stringify(rounds.at(-1))}`);
	}

	// A plain SIGKILL to node alone: does workerd die with it, or is it left holding the port?
	{
		const before = group(h.pid).map((p) => `${p.pid}:${p.comm.split("/").at(-1)}`);
		process.kill(h.pid, "SIGKILL");
		await sleep(1500);
		const after = group(h.pid);
		const answers = await c.lease("x").then(
			() => "still answers",
			() => "no answer",
		);
		await sleep(10_000);
		const later = group(h.pid).length;
		orphan = `before ${before.join(" ")}; 1.5 s after SIGKILL to node only: ${after.length} left (${after.map((p) => p.comm.split("/").at(-1)).join(",")}), port ${answers}; 11.5 s after: ${later} left`;
		console.log(`node-only kill: ${orphan}`);
		if (later > 0) splitBrain = await twoOnOneFolder(persist, c);
		if (group(h.pid).length > 0) process.kill(-h.pid, "SIGKILL");
		await sleep(300);
	}

	const lawPass = rounds.every(
		(r) => r.lostAcked === 0 && r.posGaps === 0 && r.revGaps === 0 && r.alarmFiredAlone === true,
	);
	const law: LawResult = {
		law: `7. SIGKILL the child Miniflare mid-run, restart, ${KILLS} times`,
		pass: lawPass,
		numbers: `${rounds.length} kills; lost acked ${rounds.reduce((a, r) => a + Number(r.lostAcked), 0)}; pos gaps ${rounds.reduce((a, r) => a + Number(r.posGaps), 0)}; rev gaps ${rounds.reduce((a, r) => a + Number(r.revGaps), 0)}; alarm fired alone after restart ${rounds.filter((r) => r.alarmFiredAlone).length}/${rounds.length}; restart median ${fmt(median(rounds.map((r) => Number(r.restartMs))))} ms`,
	};
	printLaws("Law 7, SIGKILL and restart", [law]);
	results.kill = {law, rounds, nodeOnlyKill: orphan, splitBrain};
	rmSync(persist, {recursive: true, force: true});
}

/**
 * The orphan case: the old workerd still serves the folder, and a new host starts on the same
 * folder (a restart that does not know the old one lives). Race claims through both at once.
 */
async function twoOnOneFolder(persist: string, orphan: LedgerClient) {
	const second = await startHost(persist, await freePort()).then(
		(h2) => h2,
		(e: unknown) => (e instanceof Error ? e.message : String(e)),
	);
	if (typeof second === "string") return {secondHostStarted: false, error: second};
	const fresh2 = clientFor(second.url);
	const streams = Array.from({length: 20}, (_, i) => `l7-split-${i}`);
	const answers = await Promise.all(
		streams.flatMap((s) =>
			[orphan, fresh2].flatMap((cl, side) =>
				Array.from({length: 5}, (_, i) =>
					cl.claim(s, `side${side}-${i}`, 0, 60_000).then(
						(r) => ({s, side, r: r.ok ? "ok" : r.why}),
						(e: unknown) => ({s, side, r: `error ${e instanceof Error ? e.message : String(e)}`}),
					),
				),
			),
		),
	);
	const wins = new Map<string, number>();
	const tallies: Record<string, number> = {};
	for (const a of answers) {
		tallies[`side${a.side} ${a.r}`] = (tallies[`side${a.side} ${a.r}`] ?? 0) + 1;
		if (a.r === "ok") wins.set(a.s, (wins.get(a.s) ?? 0) + 1);
	}
	const viaOrphan = await orphan.readStream("l7-split-0").then(
		(r) => r.length,
		() => -1,
	);
	const viaSecond = await fresh2.readStream("l7-split-0").then(
		(r) => r.length,
		() => -1,
	);
	const out = {
		secondHostStarted: true,
		tickets: streams.length,
		ticketsWithTwoWinners: [...wins.values()].filter((n) => n > 1).length,
		ticketsWithOneWinner: [...wins.values()].filter((n) => n === 1).length,
		answers: tallies,
		eventsOnTicket0: {viaOrphan, viaSecond},
	};
	console.log(`two workerds on one folder: ${JSON.stringify(out)}`);
	await killGroup(second);
	return out;
}

// ---------------------------------------------------------------- law 8: two hosts over HTTP

type Raced = {who: string; won: string[]; counts: Record<string, number>};

/** Two racer processes on the same 20 tickets, 10 claims each per ticket, fired at one instant. */
async function race(url: string, tag: string, inflight: number) {
	const streams = Array.from({length: 20}, (_, i) => `l8-${tag}-${Date.now().toString(36)}-${i}`);
	const startAt = Date.now() + 2000;
	const run = (who: string) =>
		new Promise<Raced>((resolve, reject) => {
			let out = "";
			const p = spawn(process.execPath, ["--no-warnings", RACER], {
				env: {
					...process.env,
					BASE: url,
					LEDGER,
					STREAMS: streams.join(","),
					PER: "10",
					START_AT: String(startAt),
					WHO: who,
					INFLIGHT: String(inflight),
				},
				stdio: ["ignore", "pipe", "inherit"],
			});
			p.stdout?.on("data", (d: Buffer) => {
				out += d.toString();
			});
			p.on("exit", () =>
				out ? resolve(JSON.parse(out)) : reject(new Error(`${who} said nothing`)),
			);
		});
	const [a, b] = await Promise.all([run("hostA"), run("hostB")]);
	const c = clientFor(url);
	let one = 0;
	let two = 0;
	let none = 0;
	let unheard = 0;
	for (const s of streams) {
		const wins = [...a.won, ...b.won].filter((x) => x === s).length;
		const claimed = (await c.readStream(s)).filter((e) => e.kind === "claimed").length;
		if (wins > 1 || claimed > 1) two++;
		else if (wins === 1 && claimed === 1) one++;
		else if (claimed === 1) unheard++;
		else none++;
	}
	return {tickets: streams.length, one, two, none, unheard, a, b};
}

async function hosts() {
	const persist = tempDir("hosts");
	const h = await startHost(persist, await freePort());
	const capped = await race(h.url, "capped", 32);
	const burst = await race(h.url, "burst", 0);
	const say = (r: Awaited<ReturnType<typeof race>>) =>
		`exactly one winner ${r.one}, two or more ${r.two}, no claim landed ${r.none}, landed but its caller got an error ${r.unheard}; hostA won ${r.a.won.length}, hostB ${r.b.won.length}; answers A ${JSON.stringify(r.a.counts)}, B ${JSON.stringify(r.b.counts)}`;
	const laws: LawResult[] = [
		{
			law: "8. two Node processes race claims on one Miniflare over HTTP (32 in flight each)",
			pass: capped.one === capped.tickets,
			numbers: `${capped.tickets} tickets x 10 claims from each host: ${say(capped)}`,
		},
		{
			law: "8b. the same with no cap: 200 new connections at once from each process",
			pass: burst.two === 0,
			numbers: `${say(burst)} (pass = never two winners; a reset request is an error the caller sees)`,
		},
	];
	printLaws("Law 8, two hosts", laws);
	results.hosts = {laws};
	await stopHost(h);
	rmSync(persist, {recursive: true, force: true});
}

// ---------------------------------------------------------------- law 9: same SQL on node:sqlite

async function nodeSqlite() {
	const dir = tempDir("node");
	const pool = nodePool(join(dir, "ledger.sqlite"), 8, GRACE_MS);
	const out: LawResult[] = [];
	out.push(await law1Claims(pool.client));
	out.push(...(await law2Appends(pool.client)));
	out.push(await law3Fencing(pool.client));
	out.push(await law5Stop(pool.client));
	out.push(await law6View(pool.client));
	const pooled = await appendRates(pool.client, "node:sqlite, 8 threads");
	await pool.close();
	// Each probe on a fresh connection, so a BEGIN left open cannot lock the next one out.
	const probes: Record<string, string> = {};
	for (const p of PROBES) {
		const conn = openNodeDb(join(dir, "probe.sqlite"));
		try {
			probes[p] = `ok ${JSON.stringify(conn.raw.prepare(p).all()).slice(0, 120)}`;
		} catch (e) {
			probes[p] = `error: ${e instanceof Error ? e.message : String(e)}`;
		}
		conn.close();
	}
	// One connection, no threads: the floor a solo ledger in-process would have.
	const one = openNodeDb(join(dir, "one.sqlite"));
	const t0 = performance.now();
	for (let i = 0; i < 5000; i++) append(one.db, Date.now(), "s", i, {kind: "note", writer: "w"});
	const directPerS = 5000 / ((performance.now() - t0) / 1000);
	const version = String(one.raw.prepare("SELECT sqlite_version() AS v").get()?.v);
	one.close();
	printLaws("Law 9, the same SQL on node:sqlite (8 threads, one file)", out);
	console.log(
		`node:sqlite direct, one connection: ${fmt(directPerS)} appends/s; sqlite ${version}`,
	);
	results.node = {laws: out, pooled, directPerS, sqliteVersion: version, probes};
	rmSync(dir, {recursive: true, force: true});
}

// ---------------------------------------------------------------- law 10: just a file

const headerVersion = (file: string) => {
	const b = readFileSync(file).subarray(96, 100);
	const n = b.readUInt32BE(0);
	return `${Math.floor(n / 1_000_000)}.${Math.floor(n / 1000) % 1000}.${n % 1000}`;
};

async function file() {
	const persist = tempDir("file");
	const h = await startHost(persist, await freePort());
	const c = clientFor(h.url);
	const s = fresh("l10");
	let rev = 0;
	for (let i = 0; i < 100; i++) {
		const r = await c.append(s, rev, {kind: "note", writer: "w", data: {i}});
		if (r.ok) rev = r.rev;
	}
	await c.claim(fresh("l10-lease"), "h", 0, 60_000);
	const viaDo = (await readAll(c)).length;
	await stopHost(h);
	const files: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d, {withFileTypes: true})) {
			if (e.isDirectory()) walk(join(d, e.name));
			else files.push(relative(persist, join(d, e.name)));
		}
	};
	walk(persist);
	const objectFile = files.find((f) => f.endsWith(".sqlite") && !f.endsWith("metadata.sqlite"));
	let viaFile = -1;
	let tables: string[] = [];
	let fileVersion = "";
	let readError = "";
	let walLeft = false;
	if (objectFile) {
		const full = join(persist, objectFile);
		walLeft = existsSync(`${full}-wal`) && readFileSync(`${full}-wal`).length > 0;
		fileVersion = headerVersion(full);
		try {
			const db = new DatabaseSync(full, {readOnly: true});
			viaFile = Number(db.prepare("SELECT count(*) AS n FROM events").get()?.n);
			tables = db
				.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
				.all()
				.map((r) => String(r.name));
			db.close();
		} catch (e) {
			readError = e instanceof Error ? e.message : String(e);
		}
	}
	const layout = files.map((f) => f.replace(/[0-9a-f]{64}/, "<object id, 64 hex>"));
	const law: LawResult = {
		law: "10. after stopping Miniflare, the object's .sqlite is just a file",
		pass: viaFile === viaDo && viaDo > 0,
		numbers: `events via the DO ${viaDo}, via node:sqlite read-only ${viaFile}${readError ? ` (${readError})` : ""}; WAL left non-empty after a clean stop: ${walLeft}; header says written by SQLite ${fileVersion}; tables ${tables.join(", ")}`,
	};
	printLaws("Law 10, just a file", [law]);
	console.log(`layout under the persist folder: ${layout.join("  ")}`);
	results.file = {law, layout, tables, fileVersion};
	rmSync(persist, {recursive: true, force: true});
}

// ---------------------------------------------------------------- measures of the child host

async function measure() {
	const persist = tempDir("measure");
	const port = await freePort();
	const spawns: number[] = [];
	const inner: number[] = [];
	let h = await startHost(persist, port);
	spawns.push(h.spawnToReadyMs);
	inner.push(h.innerMs);
	const idle = rss(h.pid);
	let c = clientFor(h.url);
	let t0 = performance.now();
	await c.claim(fresh("first"), "h", 0, 1000);
	const firstCallMs = performance.now() - t0;
	const rates = await appendRates(c, "child host over HTTP");
	const loaded = rss(h.pid);
	// Restart on the same data: what a daemon pays after a crash.
	const firstAfterRestart: number[] = [];
	for (let i = 0; i < 4; i++) {
		await stopHost(h);
		h = await startHost(persist, port);
		spawns.push(h.spawnToReadyMs);
		inner.push(h.innerMs);
		c = clientFor(h.url);
		t0 = performance.now();
		await c.lease("x");
		firstAfterRestart.push(performance.now() - t0);
	}
	await stopHost(h);
	const out = {
		spawnToReadyMs: spawns,
		miniflareReadyMs: inner,
		firstCallMs,
		firstCallAfterRestartMs: firstAfterRestart,
		rssIdle: idle,
		rssAfterLoad: loaded,
		rates,
	};
	console.log("\n## Measures, child host");
	console.log(JSON.stringify(out, null, 2));
	results.measure = out;
	rmSync(persist, {recursive: true, force: true});
}

// ---------------------------------------------------------------- soak

async function soak() {
	const persist = tempDir("soak");
	const port = await freePort();
	let h = await startHost(persist, port);
	const c = clientFor(h.url);
	const endAt = Date.now() + SOAK_MIN * 60_000;
	const acked = new Map<string, {stream: string; rev: number; pos: number}>();
	const unknown = new Set<string>();
	const answers: Record<string, number> = {};
	const unexpected: string[] = [];
	const count = (k: string) => {
		answers[k] = (answers[k] ?? 0) + 1;
	};
	let up = true;
	let netErrors = 0;
	let raceRounds = 0;
	let raceBad = 0;
	const kills: Record<string, unknown>[] = [];
	const rssSamples: {min: number; workerdMb: number; nodeMb: number; diskMb: number}[] = [];
	const t0 = Date.now();
	const seen = new Map<number, string>();
	let tailGaps = 0;

	const waitUp = async () => {
		while (!up && Date.now() < endAt) await sleep(100);
	};
	const writer = async (w: number) => {
		let n = 0;
		while (Date.now() < endAt) {
			await waitUp();
			const s = `soak-${w}-${n++}`;
			let pending: string | null = null;
			try {
				if (n % 20 === 0) {
					const rs = await Promise.all(
						Array.from({length: 5}, (_, i) => c.claim(s, `w${w}-${i}`, 0, 3000)),
					);
					raceRounds++;
					if (rs.filter((r) => r.ok).length !== 1) raceBad++;
					continue;
				}
				const cl = await c.claim(s, `w${w}`, 0, 3000);
				count(`claim ${cl.ok ? "ok" : cl.why}`);
				if (!cl.ok) {
					unexpected.push(`fresh ticket claim ${cl.why}`);
					continue;
				}
				let rev = cl.rev;
				const notes = 1 + Math.floor(Math.random() * 5);
				const abandon = Math.random() < 0.2;
				for (let i = 0; i < notes; i++) {
					pending = `${s}.${i}`;
					const r = await c.append(
						s,
						rev,
						{kind: "note", writer: `w${w}`, data: {wid: pending}},
						cl.fence,
					);
					count(`append ${r.ok ? "ok" : r.why}`);
					if (!r.ok) break;
					acked.set(pending, {stream: s, rev: r.rev, pos: r.pos});
					pending = null;
					rev = r.rev;
					if (!abandon && i % 2 === 0)
						count(`renew ${(await c.renew(s, cl.fence, 3000)).ok ? "ok" : "no"}`);
					await sleep(25);
				}
				if (Math.random() < 0.1) {
					await c.cancel(s, "owner");
					const rr = await c.renew(s, cl.fence, 3000);
					count(`renew after cancel ${rr.ok ? "ok" : rr.why}`);
					if (rr.ok) unexpected.push("renew after cancel said ok");
				}
				await sleep(25);
			} catch (e) {
				netErrors++;
				if (pending) unknown.add(pending);
				if (up && !(e instanceof TypeError))
					unexpected.push(e instanceof Error ? e.message : String(e));
				await sleep(200);
			}
		}
	};
	const tail = async () => {
		let from = 0;
		while (Date.now() < endAt) {
			try {
				const rows = await c.read(from, 1000);
				for (const r of rows) {
					if (Number(r.pos) !== from + 1) tailGaps++;
					from = Number(r.pos);
					seen.set(from, `${r.stream}:${r.rev}:${r.kind}`);
				}
			} catch {
				// the host is down; the next read picks up where this one stopped
			}
			await sleep(200);
		}
	};
	const killer = async () => {
		let nextKill = t0 + KILL_EVERY_MIN * 60_000;
		let nextRss = t0;
		while (Date.now() < endAt) {
			if (Date.now() >= nextRss) {
				const r = rss(h.pid);
				rssSamples.push({
					min: (Date.now() - t0) / 60_000,
					workerdMb: r.workerdMb,
					nodeMb: r.nodeMb,
					diskMb: du(persist),
				});
				nextRss += 30_000;
			}
			if (Date.now() >= nextKill && endAt - Date.now() > 30_000) {
				const before = rss(h.pid);
				up = false;
				const left = await killGroup(h);
				const r0 = performance.now();
				h = await startHost(persist, port);
				const restartMs = performance.now() - r0;
				up = true;
				kills.push({atMin: (Date.now() - t0) / 60_000, left, restartMs, rssBeforeKill: before});
				console.log(
					`soak kill at ${fmt((Date.now() - t0) / 60_000, 1)} min, restart ${fmt(restartMs)} ms`,
				);
				nextKill += KILL_EVERY_MIN * 60_000;
			}
			await sleep(1000);
		}
	};
	await Promise.all([...Array.from({length: 6}, (_, w) => writer(w)), tail(), killer()]);

	// Let every lease and its grace run out, so the alarm has written each lease_expired.
	await sleep(3000 + GRACE_MS + 4000);
	const rows = await readAll(c);
	const g = gaps(rows);
	const byWid = new Map<string, Row[]>();
	for (const r of rows) {
		const id = wid(r);
		if (id) byWid.set(id, [...(byWid.get(id) ?? []), r]);
	}
	let lost = 0;
	for (const [id, a] of acked) {
		const r = byWid.get(id)?.[0];
		if (!r || Number(r.pos) !== a.pos || Number(r.rev) !== a.rev) lost++;
	}
	const dups = [...byWid.values()].filter((l) => l.length > 1).length;
	const unknownLanded = [...unknown].filter((id) => byWid.has(id)).length;
	let seenLost = 0;
	const byPos = new Map(rows.map((r) => [Number(r.pos), `${r.stream}:${r.rev}:${r.kind}`]));
	for (const [pos, key] of seen) if (byPos.get(pos) !== key) seenLost++;
	const now = Date.now();
	const overdue = await c.tryExec(
		`SELECT count(*) AS n FROM leases WHERE expires_at < ${now - 5000}`,
	);
	const jobsLeft = await c.tryExec("SELECT count(*) AS n FROM jobs");
	const claims = rows.filter((r) => r.kind === "claimed").length;
	const expired = rows.filter((r) => r.kind === "lease_expired").length;
	const finalRss = rss(h.pid);
	await stopHost(h);
	const out = {
		minutes: SOAK_MIN,
		events: rows.length,
		eventsPerMin: rows.length / SOAK_MIN,
		acked: acked.size,
		lostAcked: lost,
		duplicatedWrites: dups,
		unknownOutcome: unknown.size,
		unknownLanded,
		...g,
		tailGaps,
		seenThenLost: seenLost,
		netErrors,
		unexpected: unexpected.length,
		unexpectedSample: unexpected.slice(0, 5),
		answers,
		raceRounds,
		raceWithoutOneWinner: raceBad,
		claims,
		leaseExpiredEvents: expired,
		overdueLeasesLeft: overdue.ok ? overdue.rows[0]?.n : overdue.error,
		jobsLeft: jobsLeft.ok ? jobsLeft.rows[0]?.n : jobsLeft.error,
		kills,
		rssSamples,
		finalRss,
	};
	const pass =
		lost === 0 &&
		dups === 0 &&
		g.posGaps === 0 &&
		g.revGaps === 0 &&
		tailGaps === 0 &&
		seenLost === 0 &&
		raceBad === 0;
	console.log(`\n## Soak ${SOAK_MIN} min: ${pass ? "PASS" : "FAIL"}`);
	console.log(JSON.stringify({...out, rssSamples: undefined}, null, 2));
	console.log(
		`by sample (min: workerd MB / disk MB): ${rssSamples.map((r) => `${fmt(r.min, 1)}: ${fmt(r.workerdMb)}/${fmt(r.diskMb)}`).join("  ")}`,
	);
	results.soak = {pass, ...out};
	rmSync(persist, {recursive: true, force: true});
}

// ---------------------------------------------------------------- memory: where workerd's RSS goes

/**
 * One child host, no kills, three phases of MEM_MIN each (default 3): steady appends at
 * about 200 a second, then the whole log read again and again, then idle. RSS and the data
 * folder's size every 15 s, to tell growth from writes, from reads, and from nothing.
 */
async function memory() {
	const phaseMs = Number(process.env.MEM_MIN ?? "3") * 60_000;
	const readMs = Number(process.env.MEM_READ_MIN ?? process.env.MEM_MIN ?? "3") * 60_000;
	const persist = tempDir("mem");
	const h = await startHost(persist, await freePort());
	const c = clientFor(h.url);
	const t0 = Date.now();
	const samples: {phase: string; min: number; workerdMb: number; diskMb: number; events: number}[] =
		[];
	let events = 0;
	let phase = "write";
	let done = false;
	const sampler = (async () => {
		while (!done) {
			const r = rss(h.pid);
			samples.push({
				phase,
				min: (Date.now() - t0) / 60_000,
				workerdMb: r.workerdMb,
				diskMb: du(persist),
				events,
			});
			await sleep(15_000);
		}
	})();
	const revs = new Map<number, number>();
	let end = Date.now() + phaseMs;
	while (Date.now() < end) {
		const w = events % 20;
		const r = await c.append(`mem-${w}`, revs.get(w) ?? 0, {
			kind: "note",
			writer: "w",
			data: {i: events},
		});
		if (r.ok) revs.set(w, r.rev);
		events++;
		await sleep(5);
	}
	phase = "read";
	end = Date.now() + readMs;
	let reads = 0;
	while (Date.now() < end) {
		await readAll(c);
		reads++;
	}
	phase = "idle";
	await sleep(phaseMs);
	done = true;
	await sampler;
	await stopHost(h);
	const at = (p: string) => samples.filter((s) => s.phase === p);
	const span = (p: string) => {
		const s = at(p);
		return `${fmt(s[0]?.workerdMb ?? 0)} -> ${fmt(s.at(-1)?.workerdMb ?? 0)} MB`;
	};
	const out = {
		appends: events,
		fullReads: reads,
		write: span("write"),
		read: span("read"),
		idle: span("idle"),
		samples,
	};
	console.log("\n## Memory, one child host, no kills");
	console.log(
		`write ${out.write} (${events} appends); read ${out.read} (${reads} full reads); idle ${out.idle}`,
	);
	console.log(
		samples
			.map((s) => `${fmt(s.min, 1)} ${s.phase} ${fmt(s.workerdMb)}/${fmt(s.diskMb, 1)}`)
			.join("  "),
	);
	results[process.env.MEM_TAG ?? "memory"] = out;
	rmSync(persist, {recursive: true, force: true});
}

// ---------------------------------------------------------------- main

const steps: [string, () => unknown][] = [
	["install", install],
	["laws", laws],
	["kill", kill],
	["hosts", hosts],
	["node", nodeSqlite],
	["file", file],
	["measure", measure],
	["soak", soak],
	["memory", memory],
];
for (const [name, fn] of steps) {
	if (!only.has(name)) continue;
	await fn();
	results.ranAt = new Date().toISOString().slice(0, 10);
	save();
}
