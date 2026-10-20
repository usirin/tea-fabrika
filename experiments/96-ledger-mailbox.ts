// Experiment 96: the ledger as a mailbox. Experiment 94 found three gaps in experiment 93's ledger
// when a tea-host counter ran on it: a lease guarded one stream only, a host had to read the whole
// log to watch one stream, and senders raced on the inbox's rev (42% `stale`). This fixes all
// three in a copy of the ledger (./96-ledger-mailbox/) and proves it two ways: 93's laws and new
// ones on the new ledger, and 94's counter test run again on it.
//
// ONLY: a comma list of laws|kill|hosts|node|file|machine|runs (default all).
//   laws     93's laws 1-6 and the new laws 11, 12, 14, 15 against Miniflare in this process; the
//            tail's wake-up latency
//   kill     law 7 and law 13: SIGKILL the child Miniflare mid-write KILLS times; acknowledged
//            writes, resent ids and a live tail across every kill
//   hosts    law 8: two Node processes race claims over HTTP (93's racer, unchanged)
//   node     law 9: the laws on node:sqlite, 8 threads, one file
//   file     law 10: after stopping, the .sqlite is a plain file, the new column included
//   machine  94's host and counter machine laws (the machines are unchanged; run to confirm)
//   runs     94's counter test on the new ledger
// KILLS (5). RUNS (small,small,small,large), TTL_MS (1000), RENEW_MS (250), STOP_MS (2500),
// RESTART_MS (300), CAP_MB (500), DUP_RATE (0.02), HOST_DEPTH (10), KEEP_LOGS (a folder),
// SAVE_AS (runs): as in experiment 94.
// No key, no model, no network beyond 127.0.0.1. Results: results/96-ledger-mailbox.json.
//
// Node at the edge, as 93's and 94's harnesses: this script starts processes in their own process
// groups and signals whole groups (SIGKILL, SIGSTOP, SIGCONT), and reads their memory with ps.
// Everything it starts that is not Miniflare runs on Effect (./96-ledger-mailbox/).
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
// biome-ignore lint/plugin: law 10 reads the Durable Object's own file; nothing here fakes D1.
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import {applyCell} from "@demlik/tea";
import {Effect, Fiber, Stream} from "effect";
import {Miniflare} from "miniflare";
import {
	type LawResult,
	law1Claims,
	law2Appends,
	law3Fencing,
	law4Expiry,
	law5Stop,
	law6View,
} from "./93-ledger/laws.ts";
import {type Count, type CounterMsg, counter, ZERO} from "./94-tea-host/counter.ts";
import {checkCounter, checkHost} from "./94-tea-host/laws.ts";
import {fetchPost, httpClient, type LedgerClient} from "./96-ledger-mailbox/client.ts";
import {
	fresh,
	law11AppendAny,
	law11RepeatedId,
	law12PrefixFence,
	law14Reads,
} from "./96-ledger-mailbox/laws.ts";
import {nodePool} from "./96-ledger-mailbox/node-ledger.ts";
import {Ledger, type Row as LedgerRow, ledgerLayer} from "./96-ledger-mailbox/service.ts";
import type {Row as SqlRow} from "./96-ledger-mailbox/sql.ts";
import {type Meter, meter, tail} from "./96-ledger-mailbox/tail.ts";
import {ledgerOptions} from "./96-ledger-mailbox/worker.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/96-ledger-mailbox.json");
const RESULTS_94 = here("results/94-tea-host-counter.json");
const DAEMON = here("96-ledger-mailbox/daemon.ts");
const HOST = here("96-ledger-mailbox/host.ts");
const SENDER = here("96-ledger-mailbox/sender.ts");
const ATTACH = here("96-ledger-mailbox/attach.ts");
const RACER = here("93-ledger/racer.ts");
const GRACE_MS = 1000;
const LAW_LEDGER = "acme-app";
const LEDGER = "tea-host";
const NAME = "counter:1";
const REGISTRY = NAME;
const STATE = `${NAME}/state`;
const INBOX = `${NAME}/inbox`;

const only = new Set((process.env.ONLY ?? "laws,kill,hosts,node,file,machine,runs").split(","));
const KILLS = Number(process.env.KILLS ?? "5");
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");
const TTL_MS = Number(process.env.TTL_MS ?? "1000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "250");
const STOP_MS = Number(process.env.STOP_MS ?? "2500");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const CAP_MB = Number(process.env.CAP_MB ?? "500");
const DUP_RATE = process.env.DUP_RATE ?? "0.02";
const KEEP_LOGS = process.env.KEEP_LOGS;
const SAVE_AS = process.env.SAVE_AS ?? "runs";

const FIRST_FAULT_MS = 1500;
const FAULT_EVERY_MS = 3500;
const PRESETS = {
	small: {n: 1000, kills: 2, rate: 25},
	large: {n: 10_000, kills: 3, rate: 150},
} as const;

const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: readonly number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0
		? Number.NaN
		: (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN);
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const tempDir = (tag: string) => mkdtempSync(join(tmpdir(), `exp96-${tag}-`));
/** A child's stderr, kept short and with no file paths: the results file is public. */
const firstLines = (text: string) =>
	text
		.split("\n")
		.filter((l) => !/^\s+at /.test(l))
		.join("\n")
		.replace(/(file:\/\/)?\/[^\s:)]+/g, "<path>")
		.slice(0, 600);
const printLaws = (title: string, laws: readonly LawResult[]) => {
	console.log(`\n## ${title}`);
	for (const l of laws) console.log(`${l.pass ? "PASS" : "FAIL"}  ${l.law}\n      ${l.numbers}`);
};

// ---------------------------------------------------------------- processes

type Proc = {pid: number; pgid: number; rssKb: number; comm: string};
const ps = (): Proc[] =>
	execFileSync("ps", ["-A", "-o", "pid=,pgid=,rss=,comm="], {encoding: "utf8"})
		.split("\n")
		.flatMap((line) => {
			const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
			return m
				? [{pid: Number(m[1]), pgid: Number(m[2]), rssKb: Number(m[3]), comm: m[4] ?? ""}]
				: [];
		});
const group = (pgid: number) => ps().filter((p) => p.pgid === pgid);
const rssOf = (pgid: number) => {
	const g = group(pgid);
	const mb = (ps: Proc[]) => r1(ps.reduce((a, p) => a + p.rssKb, 0) / 1024);
	return {
		workerdMb: mb(g.filter((p) => p.comm.includes("workerd"))),
		nodeMb: mb(g.filter((p) => !p.comm.includes("workerd"))),
	};
};
const signal = (pgid: number, sig: NodeJS.Signals) => {
	// biome-ignore lint/plugin: Node at the edge (see the header); a group already gone throws.
	try {
		process.kill(-pgid, sig);
	} catch {
		// the group is already gone
	}
};
const killGroup = async (pgid: number) => {
	signal(pgid, "SIGKILL");
	for (let i = 0; i < 100 && group(pgid).length > 0; i++) await sleep(20);
	return group(pgid).length;
};
const stopGroup = async (pgid: number) => {
	signal(pgid, "SIGCONT");
	signal(pgid, "SIGTERM");
	for (let i = 0; i < 150 && group(pgid).length > 0; i++) await sleep(20);
	if (group(pgid).length > 0) await killGroup(pgid);
};
const started = new Set<number>();
process.on("exit", () => {
	for (const pgid of started) signal(pgid, "SIGKILL");
});

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port"))));
		});
	});

/** A child in its own process group; every JSON line it prints is kept. */
type Child = {
	proc: ChildProcess;
	pgid: number;
	lines: Record<string, unknown>[];
	err: string[];
	exited: Promise<number | null>;
};
const child = (script: string, env: Record<string, string>): Child => {
	const proc = spawn(process.execPath, ["--no-warnings", script], {
		env: {...process.env, ...env},
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const pgid = Number(proc.pid);
	started.add(pgid);
	const lines: Record<string, unknown>[] = [];
	const err: string[] = [];
	let buf = "";
	proc.stdout?.on("data", (d: Buffer) => {
		buf += d.toString();
		const parts = buf.split("\n");
		buf = parts.pop() ?? "";
		for (const p of parts) if (p.startsWith("{")) lines.push(JSON.parse(p));
	});
	proc.stderr?.on("data", (d: Buffer) => err.push(d.toString()));
	const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
	return {proc, pgid, lines, err, exited};
};
const until = async (what: string, ok: () => boolean, ms: number) => {
	const t0 = Date.now();
	while (!ok()) {
		if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
		await sleep(10);
	}
};

type Daemon = {c: Child; url: string; ms: number};
const startDaemon = async (persist: string, port: number): Promise<Daemon> => {
	const t0 = performance.now();
	const c = child(DAEMON, {PERSIST: persist, PORT: String(port), GRACE_MS: String(GRACE_MS)});
	await until("the ledger", () => c.lines.length > 0 || c.err.join("").includes("Error"), 30_000);
	if (c.lines.length === 0) throw new Error(`the ledger did not start: ${c.err.join("")}`);
	return {c, url: String(c.lines[0]?.ready), ms: performance.now() - t0};
};

const clientFor = (url: string, ledger = LAW_LEDGER): LedgerClient =>
	httpClient(fetchPost(url), ledger);

/** A live tail in this process, collecting what it hands on. Stop it with `stop()`. */
const runTail = (url: string, ledger: string, stream: string, fromRev = 0) => {
	const got: LedgerRow[] = [];
	const m = meter();
	const fiber = Effect.runFork(
		Effect.gen(function* () {
			const l = yield* Ledger;
			yield* Stream.runForEach(tail(l, {base: url, name: ledger, stream, fromRev, meter: m}), (r) =>
				Effect.sync(() => {
					got.push(r);
				}),
			);
		}).pipe(Effect.provide(ledgerLayer(url, ledger, 2))),
	);
	return {got, meter: m, fiber, stop: () => Effect.runPromise(Fiber.interrupt(fiber))};
};

// ---------------------------------------------------------------- laws in this process

/** 15. Wake-ups reach exactly the watchers of the stream written, or of a prefix it sits under. */
async function law15Wakes(url: string, c: LedgerClient): Promise<LawResult> {
	const p = fresh("l15");
	const ws = (q: string) =>
		new Promise<{notes: string[]; sock: WebSocket}>((resolve, reject) => {
			const sock = new WebSocket(`${url.replace(/^http/, "ws")}/${LAW_LEDGER}/tail?${q}`);
			const notes: string[] = [];
			sock.onmessage = (e) => notes.push(String(e.data));
			sock.onopen = () => resolve({notes, sock});
			sock.onerror = () => reject(new Error(`no socket for ${q}`));
		});
	const a = await ws(`stream=${encodeURIComponent(`${p}/a`)}`);
	const pre = await ws(`prefix=${encodeURIComponent(p)}`);
	const both = await ws(
		`stream=${encodeURIComponent(`${p}/a`)}&prefix=${encodeURIComponent(`${p}/a`)}`,
	);
	const other = await ws(`stream=${encodeURIComponent(`${p}x`)}`);
	const tooMany = await new Promise<string>((resolve) => {
		const q = Array.from({length: 11}, (_, i) => `stream=s${i}`).join("&");
		const sock = new WebSocket(`${url.replace(/^http/, "ws")}/${LAW_LEDGER}/tail?${q}`);
		sock.onopen = () => {
			sock.close();
			resolve("opened");
		};
		sock.onerror = () => resolve("refused");
	});
	await c.append(`${p}/a`, "any", {kind: "note", writer: "w"});
	await c.append(`${p}/b/c`, "any", {kind: "note", writer: "w"});
	await c.append(p, "any", {kind: "note", writer: "w"});
	await c.append(`${p}x`, "any", {kind: "note", writer: "w"});
	await c.append(`${p}/a`, "any", {kind: "note", writer: "w", id: "m1"});
	await c.append(`${p}/a`, "any", {kind: "note", writer: "w", id: "m1"});
	const cl = await c.claim(`${p}/a`, "h", 2, 60_000);
	await sleep(200);
	const counts = [a, pre, both, other].map((s) => s.notes.length);
	const first = JSON.parse(a.notes[0] ?? "{}");
	for (const s of [a, pre, both, other]) s.sock.close();
	return {
		law: "15. a write wakes the watchers of its stream and of its prefixes, once each, and no others",
		pass:
			counts.join(",") === "3,5,3,1" &&
			first.stream === `${p}/a` &&
			first.rev === 1 &&
			first.data === undefined &&
			cl.ok &&
			tooMany === "refused",
		numbers: `notices: stream ${p}/a ${counts[0]} (2 appends, a repeated id that wrote nothing, a claim); prefix ${p} ${counts[1]}; stream and prefix on one socket ${counts[2]} (each write once); ${p}x ${counts[3]}; a notice: ${a.notes[0]}; 11 tags: ${tooMany}`,
	};
}

/** How long from an append to the tail handing the event on, appends spaced so the tail is idle. */
async function tailLatency(url: string, c: LedgerClient, n = 200) {
	const s = fresh("lat");
	const t = runTail(url, LAW_LEDGER, s);
	await sleep(300);
	const ms: number[] = [];
	for (let i = 0; i < n; i++) {
		const t0 = performance.now();
		await c.append(s, "any", {kind: "note", writer: "w"});
		while (t.got.length < i + 1) await sleep(0.2);
		ms.push(performance.now() - t0);
		await sleep(10);
	}
	await t.stop();
	return {
		events: n,
		p50Ms: r1(pct(ms, 50)),
		p99Ms: r1(pct(ms, 99)),
		maxMs: r1(Math.max(...ms)),
		reads: t.meter.reads,
		wakes: t.meter.wakes,
	};
}

async function laws() {
	const dir = tempDir("laws");
	const mf = new Miniflare(ledgerOptions({persist: dir, graceMs: GRACE_MS, direct: 0}));
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	const c = clientFor(url);
	const old: LawResult[] = [];
	old.push(await law1Claims(c));
	old.push(...(await law2Appends(c)));
	old.push(await law3Fencing(c));
	old.push(...(await law4Expiry(c, GRACE_MS)));
	old.push(await law5Stop(c));
	old.push(await law6View(c));
	printLaws("93's laws 1-6 on the mailbox ledger, Miniflare in this process", old);
	const neu: LawResult[] = [
		await law11AppendAny(c),
		await law11RepeatedId(c),
		await law12PrefixFence(c),
		await law14Reads(c),
		await law15Wakes(url, c),
	];
	printLaws("New laws, Miniflare in this process", neu);
	const latency = await tailLatency(url, c);
	console.log(`tail latency: ${JSON.stringify(latency)}`);
	await mf.dispose();
	rmSync(dir, {recursive: true, force: true});
	results.laws = {old, new: neu, tailLatency: latency};
	save();
}

// ---------------------------------------------------------------- laws 7 and 13: SIGKILL

/** pos gapless from 1; rev gapless from 1 per stream. */
const gaps = (rows: readonly SqlRow[]) => {
	let posGaps = 0;
	rows.forEach((r, i) => {
		if (Number(r.pos) !== i + 1) posGaps++;
	});
	const byStream = new Map<string, number[]>();
	for (const r of rows) {
		const list = byStream.get(String(r.stream)) ?? [];
		list.push(Number(r.rev));
		byStream.set(String(r.stream), list);
	}
	let revGaps = 0;
	for (const revs of byStream.values()) {
		revs.sort((a, b) => a - b);
		revs.forEach((v, i) => {
			if (v !== i + 1) revGaps++;
		});
	}
	return {posGaps, revGaps};
};

const readEverything = async (c: LedgerClient): Promise<SqlRow[]> => {
	const all: SqlRow[] = [];
	for (;;) {
		const page = await c.read(Number(all.at(-1)?.pos ?? 0), 5000);
		all.push(...page);
		if (page.length < 5000) return all;
	}
};

/**
 * Law 7 (93's, on the new ledger) and law 13 (new): eight writers append at the end of one
 * stream with message ids, as fast as they can; a live tail follows that stream from this
 * process; a lease waits to run out. SIGKILL the whole process group at a random 0.8 to 1.5 s,
 * restart on the same folder and port. A write whose answer the kill swallowed is sent again,
 * same id, after the restart. At the end: every acknowledged write is where it was acknowledged,
 * every id is in the stream exactly once, and the tail handed on revs 1..n, each once, in order.
 */
async function kill() {
	const persist = tempDir("kill");
	const port = await freePort();
	let d = await startDaemon(persist, port);
	const c = clientFor(d.url);
	const STREAM = "l13-mailbox";
	const t = runTail(d.url, LAW_LEDGER, STREAM);
	const rounds: Record<string, unknown>[] = [];
	const acked = new Map<string, {rev: number; pos: number}>();
	const resent: {id: string; answer: string}[] = [];
	const tailSeenAtKill: number[] = [];

	for (let k = 0; k < KILLS; k++) {
		const leaseStream = `l7-lease-${k}`;
		const cl = await c.claim(leaseStream, "h", 0, 4000);
		let stop = false;
		const lost: string[] = [];
		const writers = Array.from({length: 8}, async (_, w) => {
			for (let i = 1; !stop; i++) {
				const id = `${k}.${w}.${i}`;
				// biome-ignore lint/plugin: law 7 as in 93, on the Promise client; a kill ends a writer.
				try {
					const r = await c.append(STREAM, "any", {kind: "inc", writer: `w${w}`, id});
					if (!r.ok) throw new Error(`append-any said ${r.why}`);
					acked.set(id, {rev: r.rev, pos: r.pos});
				} catch {
					lost.push(id);
					return;
				}
			}
		});
		await sleep(800 + Math.random() * 700);
		const killedAt = Date.now();
		const left = await killGroup(d.c.pgid);
		stop = true;
		await Promise.all(writers);
		tailSeenAtKill.push(t.got.length);
		const r0 = performance.now();
		d = await startDaemon(persist, port);
		const restartMs = performance.now() - r0;
		// The answers the kill swallowed: send each again, same id. It lands once, either way.
		for (const id of lost) {
			const r = await c.append(STREAM, "any", {kind: "inc", writer: "resend", id});
			resent.push({id, answer: r.ok ? (r.dup ? "dup" : "ok") : r.why});
			if (r.ok) acked.set(id, {rev: r.rev, pos: r.pos});
		}
		// Touch nothing more until the lease and its grace are past, so the alarm fires alone.
		await sleep(Math.max(0, killedAt + 4000 + GRACE_MS + 2500 - Date.now()));
		const firstTouch = Date.now();
		const rows = await readEverything(c);
		const expired = rows.find((r) => r.stream === leaseStream && r.kind === "lease_expired");
		rounds.push({
			round: k,
			claimOk: cl.ok,
			processesLeftAfterKill: left,
			restartMs: Math.round(restartMs),
			events: rows.length,
			inFlightAtKill: lost.length,
			...gaps(rows),
			alarmFiredAlone: expired ? Number(expired.at) < firstTouch : false,
		});
		console.log(`kill ${k}: ${JSON.stringify(rounds.at(-1))}`);
	}

	const stream = await c.readStream(STREAM);
	await until("the tail to catch up", () => t.got.length >= stream.length, 15_000).catch(() => {});
	await t.stop();
	const rows = await readEverything(c);
	let lostAcked = 0;
	const byId = new Map<string, SqlRow[]>();
	for (const r of stream) byId.set(String(r.id), [...(byId.get(String(r.id)) ?? []), r]);
	for (const [id, a] of acked) {
		const r = byId.get(id)?.[0];
		if (!r || Number(r.rev) !== a.rev || Number(r.pos) !== a.pos) lostAcked++;
	}
	const twice = [...byId.values()].filter((rs) => rs.length > 1).length;
	const tailRevs = t.got.map((r) => r.rev);
	const tailInOrder = tailRevs.every((r, i) => r === i + 1);
	const tailMatches =
		t.got.length === stream.length &&
		t.got.every((r, i) => r.pos === Number(stream[i]?.pos) && r.id === stream[i]?.id);
	await stopGroup(d.c.pgid);
	rmSync(persist, {recursive: true, force: true});

	const law7: LawResult = {
		law: `7. SIGKILL the child Miniflare mid-write, restart, ${KILLS} times`,
		pass:
			lostAcked === 0 &&
			rounds.every((r) => r.posGaps === 0 && r.revGaps === 0 && r.alarmFiredAlone === true),
		numbers: `${rounds.length} kills; ${acked.size} acknowledged, lost ${lostAcked}; pos gaps ${gaps(rows).posGaps}; rev gaps ${gaps(rows).revGaps}; alarm fired alone ${rounds.filter((r) => r.alarmFiredAlone).length}/${rounds.length}; restart ${rounds.map((r) => r.restartMs).join(", ")} ms`,
	};
	const answers: Record<string, number> = {};
	for (const r of resent) answers[r.answer] = (answers[r.answer] ?? 0) + 1;
	const law11c: LawResult = {
		law: "11c. a send whose answer a kill swallowed, sent again with its id after the restart, is in the stream once",
		pass: resent.length > 0 && twice === 0 && resent.every((r) => r.answer !== "fenced"),
		numbers: `${resent.length} sent again: ${JSON.stringify(answers)} (dup: the first send had landed); ids twice in the stream ${twice}`,
	};
	const law13: LawResult = {
		law: `13. a live tail of one stream across ${KILLS} SIGKILLs of Miniflare never skips or repeats`,
		pass: tailInOrder && tailMatches && t.got.length > 0,
		numbers: `${stream.length} events in the stream; the tail handed on ${t.got.length}, revs 1..${tailRevs.at(-1)} each once in order ${tailInOrder}, the same events as the stream ${tailMatches}; at each kill it had ${tailSeenAtKill.join(", ")}; reconnects ${t.meter.connects}, reads ${t.meter.reads}, wake-ups ${t.meter.wakes}`,
	};
	printLaws("Laws 7, 11c and 13: SIGKILL and restart", [law7, law11c, law13]);
	results.kill = {laws: [law7, law11c, law13], rounds, tail: t.meter};
	save();
}

// ---------------------------------------------------------------- law 8: two hosts over HTTP

type Raced = {who: string; won: string[]; counts: Record<string, number>};

/** Two of 93's racer processes on the same 20 tickets, 10 claims each per ticket, at one instant. */
async function race(url: string) {
	const streams = Array.from({length: 20}, (_, i) => `l8-${Date.now().toString(36)}-${i}`);
	const startAt = Date.now() + 2000;
	const run = (who: string) =>
		new Promise<Raced>((resolve, reject) => {
			let out = "";
			const p = spawn(process.execPath, ["--no-warnings", RACER], {
				env: {
					...process.env,
					BASE: url,
					LEDGER: LAW_LEDGER,
					STREAMS: streams.join(","),
					PER: "10",
					START_AT: String(startAt),
					WHO: who,
					INFLIGHT: "32",
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
	for (const s of streams) {
		const wins = [...a.won, ...b.won].filter((x) => x === s).length;
		const claimed = (await c.readStream(s)).filter((e) => e.kind === "claimed").length;
		if (wins === 1 && claimed === 1) one++;
	}
	return {tickets: streams.length, one, a: a.counts, b: b.counts};
}

async function hosts() {
	const persist = tempDir("hosts");
	const d = await startDaemon(persist, await freePort());
	const r = await race(d.url);
	const law: LawResult = {
		law: "8. two Node processes race claims on one Miniflare over HTTP (32 in flight each)",
		pass: r.one === r.tickets,
		numbers: `${r.tickets} tickets x 10 claims from each: exactly one winner on ${r.one}; answers A ${JSON.stringify(r.a)}, B ${JSON.stringify(r.b)}`,
	};
	printLaws("Law 8, two hosts", [law]);
	results.hosts = {laws: [law]};
	await stopGroup(d.c.pgid);
	rmSync(persist, {recursive: true, force: true});
	save();
}

// ---------------------------------------------------------------- law 9: node:sqlite

async function nodeSqlite() {
	const dir = tempDir("node");
	const pool = nodePool(join(dir, "ledger.sqlite"), 8, GRACE_MS);
	const c = pool.client;
	const out: LawResult[] = [
		await law1Claims(c),
		...(await law2Appends(c)),
		await law3Fencing(c),
		await law5Stop(c),
		await law6View(c),
		await law11AppendAny(c),
		await law11RepeatedId(c),
		await law12PrefixFence(c),
		await law14Reads(c),
	];
	await pool.close();
	printLaws("Law 9, the same SQL on node:sqlite (8 threads, one file)", out);
	results.node = {laws: out};
	rmSync(dir, {recursive: true, force: true});
	save();
}

// ---------------------------------------------------------------- law 10: a plain file

async function file() {
	const persist = tempDir("file");
	const mf = new Miniflare(ledgerOptions({persist, graceMs: GRACE_MS, direct: 0}));
	await mf.ready;
	const c = clientFor((await mf.unsafeGetDirectURL()).origin);
	for (let i = 0; i < 100; i++)
		await c.append("f", "any", {kind: "note", writer: "w", id: `m${i}`});
	await c.append("f", "any", {kind: "note", writer: "w", id: "m3"});
	await mf.dispose();
	const folder = readdirSync(persist).find((f) => f.endsWith("Ledger")) ?? "";
	const db = readdirSync(join(persist, folder)).find(
		(f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
	);
	const raw = new DatabaseSync(join(persist, folder, String(db)), {readOnly: true});
	const n = Number(raw.prepare("SELECT count(*) AS n FROM events").get()?.n);
	const ids = Number(raw.prepare("SELECT count(DISTINCT id) AS n FROM events").get()?.n);
	const migrations = Number(raw.prepare("SELECT max(id) AS n FROM migrations").get()?.n);
	raw.close();
	rmSync(persist, {recursive: true, force: true});
	const law: LawResult = {
		law: "10. after stopping Miniflare, the .sqlite is a plain file (the id column too)",
		pass: n === 100 && ids === 100 && migrations === 3,
		numbers: `101 appends through the DO (one a repeated id): ${n} events, ${ids} distinct ids, migration ${migrations}, read by node:sqlite read-only`,
	};
	printLaws("Law 10", [law]);
	results.file = {laws: [law]};
	save();
}

// ---------------------------------------------------------------- 94's counter test, again

const call = async <T>(url: string, method: string, args: unknown[]): Promise<T> => {
	for (let i = 0; ; i++) {
		// biome-ignore lint/plugin: the harness's own plain fetch, as in 94, retried while workerd restarts.
		try {
			const res = await fetch(`${url}/${LEDGER}/${method}`, {
				method: "POST",
				body: JSON.stringify(args),
			});
			if (res.status === 200) return (await res.json()) as T;
			throw new Error(`${method}: ${res.status}`);
		} catch (e) {
			if (i >= 50) throw e;
			await sleep(100);
		}
	}
};
type Row = LedgerRow;
type Lease = {holder: string; expires_at: number; fence: number};
const readAll = async (url: string): Promise<Row[]> => {
	const all: Row[] = [];
	for (;;) {
		const page = await call<Row[]>(url, "read", [all.at(-1)?.pos ?? 0, 5000]);
		all.push(...page);
		if (page.length < 5000) return all;
	}
};
const liveLease = async (url: string): Promise<Lease | null> => {
	const l = await call<Lease | null>(url, "lease", [REGISTRY]);
	return l !== null && l.expires_at > Date.now() ? l : null;
};

type Fault = {
	kind: "kill" | "zombie" | "alone";
	holder: string;
	fence: number;
	at: number;
	leaseEndsAt: number;
	contAt?: number;
};

const parse = <T>(s: string): T => JSON.parse(s) as T;
type StateData = {fence: number; state: Count};

/** One run: 94's, with the faults, the cap and the attach as they were; only the streams moved. */
async function runOnce(preset: keyof typeof PRESETS, index: number) {
	const {n, kills, rate} = PRESETS[preset];
	const dir = tempDir("run");
	const port = await freePort();
	let daemon = await startDaemon(dir, port);
	const env = {
		LEDGER_URL: daemon.url,
		LEDGER_NAME: LEDGER,
		NAME,
		TTL_MS: String(TTL_MS),
		RENEW_MS: String(RENEW_MS),
	};
	const log = (s: string) => console.log(`[${preset} ${index}] ${s}`);

	const capRestarts: {at: number; workerdMb: number; ms: number}[] = [];
	let peakWorkerdMb = 0;
	let watching = true;
	const capWatch = (async () => {
		while (watching) {
			await sleep(1000);
			if (!watching) break;
			const {workerdMb} = rssOf(daemon.c.pgid);
			peakWorkerdMb = Math.max(peakWorkerdMb, workerdMb);
			if (workerdMb > CAP_MB) {
				const t0 = Date.now();
				await stopGroup(daemon.c.pgid);
				daemon = await startDaemon(dir, port);
				capRestarts.push({at: t0, workerdMb, ms: Date.now() - t0});
				log(`workerd at ${workerdMb} MB: restarted in ${Date.now() - t0} ms`);
			}
		}
	})();

	const hosts = new Map<string, Child>();
	const dead = new Map<string, number>();
	let gen = 0;
	const startHost = (base: string) => {
		gen++;
		const name = `${base}.${gen}`;
		hosts.set(name, child(HOST, {...env, HOST: name}));
		return name;
	};
	for (const base of ["host-a", "host-b", "host-c"]) startHost(base);
	await until(
		"an owner",
		() => [...hosts.values()].some((h) => h.lines.some((l) => l.ev === "program")),
		20_000,
	);

	const attachments: Record<string, unknown>[] = [];
	const attach = async (when: string) => {
		const a = child(ATTACH, env);
		await a.exited;
		const line = a.lines[0] ?? {error: a.err.join("")};
		attachments.push({when, ...line});
		log(`attach (${when}): ${String(line.line ?? line.error)}`);
	};
	await attach("before the first send");

	const runStart = Date.now();
	const senders = ["s1", "s2"].map((s, i) =>
		child(SENDER, {
			...env,
			SENDER: s,
			COUNT: String(n / 2),
			RATE: String(rate),
			DUP_RATE,
			SEED: String(index * 10 + i + 1),
		}),
	);

	const faults: Fault[] = [];
	const plan = [
		...Array.from({length: kills}, () => "kill" as const),
		"zombie" as const,
		"alone" as const,
	];
	for (const [i, kind] of plan.entries()) {
		const due = runStart + FIRST_FAULT_MS + i * FAULT_EVERY_MS;
		await sleep(Math.max(0, due - Date.now()));
		let lease: Lease | null = null;
		for (let tries = 0; tries < 200; tries++) {
			lease = await liveLease(daemon.url);
			const owner = lease === null ? undefined : hosts.get(lease.holder);
			const since = owner?.lines.findLast((l) => l.ev === "program" && l.phase === "started")?.at;
			if (lease !== null && typeof since === "number" && Date.now() - since > 300) break;
			lease = null;
			await sleep(25);
		}
		if (lease === null) throw new Error(`no steady owner for fault ${i + 1}`);
		const owner = hosts.get(lease.holder);
		if (owner === undefined)
			throw new Error(`the lease is held by ${lease.holder}, not a host here`);
		const at = Date.now();
		if (kind === "kill") {
			await killGroup(owner.pgid);
			dead.set(lease.holder, at);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
			});
			log(
				`SIGKILL ${lease.holder} (fence ${lease.fence}), lease ends in ${lease.expires_at - at} ms`,
			);
			await sleep(RESTART_MS);
			startHost(lease.holder.split(".")[0] ?? "host-x");
			if (i === 0) {
				await sleep(TTL_MS + 500);
				await attach("after the first kill");
			}
		} else if (kind === "alone") {
			const others = [...hosts.entries()].filter(([h]) => h !== lease.holder && !dead.has(h));
			for (const [, h] of others) signal(h.pgid, "SIGSTOP");
			signal(owner.pgid, "SIGSTOP");
			await sleep(Math.max(0, lease.expires_at - Date.now()) + 300);
			const contAt = Date.now();
			signal(owner.pgid, "SIGCONT");
			log(`SIGSTOP ${lease.holder} (fence ${lease.fence}) and every other host; woke it alone`);
			await sleep(400);
			for (const [, h] of others) signal(h.pgid, "SIGCONT");
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
				contAt,
			});
		} else {
			signal(owner.pgid, "SIGSTOP");
			log(`SIGSTOP ${lease.holder} (fence ${lease.fence}) for ${STOP_MS} ms`);
			await sleep(STOP_MS);
			await attach("while the old owner sleeps");
			const contAt = Date.now();
			signal(owner.pgid, "SIGCONT");
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
				contAt,
			});
			log(`SIGCONT ${lease.holder}`);
		}
	}

	const sent = await Promise.all(
		senders.map(async (s) => ({code: await s.exited, out: s.lines[0], err: s.err.join("")})),
	);
	for (const s of sent)
		if (s.code !== 0 || s.out === undefined) throw new Error(`a sender failed: ${s.err}`);
	const sendsDoneAt = Date.now();
	const lastWake = Math.max(...faults.map((f) => f.contAt ?? f.at));

	// Drain: wait until the last saved count covers every id in the inbox.
	let settled = false;
	for (let i = 0; i < 600 && !settled; i++) {
		const inboxEnd = await call<Row[]>(daemon.url, "readLast", [INBOX, 1]);
		const last = await call<Row[]>(daemon.url, "readLast", [STATE, 1]);
		const end = inboxEnd.at(-1)?.rev ?? 0;
		const st = last.at(-1);
		settled = st !== undefined && parse<StateData>(st.data).state.cursor === end;
		if (!settled) await sleep(100);
	}
	const drainedAt = Date.now();
	await attach("at the end");
	// One more second, so every host prints what its tails read after the drain.
	await sleep(1200);

	const live = [...hosts.entries()].filter(([name]) => !dead.has(name));
	const rss = {
		ledger: rssOf(daemon.c.pgid),
		peakWorkerdMb,
		hosts: Object.fromEntries(live.map(([name, h]) => [name, rssOf(h.pgid).nodeMb])),
	};
	const aliveAtEnd = new Set(live.flatMap(([name, h]) => (group(h.pgid).length > 0 ? [name] : [])));
	watching = false;
	await capWatch;
	const stopAt = Date.now();
	for (const [, h] of live) await stopGroup(h.pgid);
	const rows = await readAll(daemon.url);
	await stopGroup(daemon.c.pgid);
	rmSync(dir, {recursive: true, force: true});

	if (KEEP_LOGS !== undefined) mkdirSync(KEEP_LOGS, {recursive: true});
	if (KEEP_LOGS !== undefined)
		for (const [name, h] of hosts)
			writeFileSync(
				join(KEEP_LOGS, `${preset}-${index}-${name}.jsonl`),
				h.lines.map((l) => JSON.stringify(l)).join("\n"),
			);
	const check = judge({rows, n, hosts, dead, faults, stopAt, aliveAtEnd, drainedAt, runStart});
	const senderOut = sent.map((s) => s.out ?? {});
	const attempts = senderOut.flatMap((o) =>
		Array.isArray(o.attempts) ? o.attempts.map(Number) : [],
	);
	const sends = senderOut.flatMap((o) => (Array.isArray(o.sends) ? o.sends.map(Number) : []));
	return {
		preset,
		n,
		kills,
		ttlMs: TTL_MS,
		renewMs: RENEW_MS,
		stopMs: STOP_MS,
		sendRatePerSender: rate,
		...check,
		sendLatency: {
			appendP50Ms: r1(pct(attempts, 50)),
			appendP99Ms: r1(pct(attempts, 99)),
			sendP50Ms: r1(pct(sends, 50)),
			sendP99Ms: r1(pct(sends, 99)),
			appends: attempts.length,
			stale: senderOut.reduce((a, o) => a + Number(o.stale ?? 0), 0),
			dupAnswers: senderOut.reduce((a, o) => a + Number(o.dups ?? 0), 0),
			errors: senderOut.reduce((a, o) => a + Number(o.errors ?? 0), 0),
			repeatsInjected: senderOut.reduce((a, o) => a + Number(o.repeats ?? 0), 0),
		},
		sendMs: sendsDoneAt - runStart,
		faultsDuringSends: lastWake < sendsDoneAt - 500,
		drainMs: drainedAt - sendsDoneAt,
		capRestarts,
		rss,
		attach: attachments,
		hostsStarted: [...hosts.keys()],
		hostErrors: Object.fromEntries(
			[...hosts.entries()].flatMap(([name, h]) =>
				h.err.length > 0 ? [[name, firstLines(h.err.join(""))]] : [],
			),
		),
	};
}

/** A row's size as JSON, without the new `id` key: what the same row weighed in 94. */
const bytes94 = (r: Row) => {
	const {id: _, ...rest} = r;
	return JSON.stringify(rest).length + 1;
};
const avg = (xs: readonly number[]) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

function judge(o: {
	rows: Row[];
	n: number;
	hosts: Map<string, Child>;
	dead: Map<string, number>;
	faults: Fault[];
	stopAt: number;
	aliveAtEnd: Set<string>;
	drainedAt: number;
	runStart: number;
}) {
	const registry = o.rows.filter((r) => r.stream === REGISTRY);
	const states = o.rows.filter((r) => r.stream === STATE);
	const inbox = o.rows.filter((r) => r.stream === INBOX).sort((a, b) => a.rev - b.rev);

	// The mailbox: the ledger keeps one event per id, so every inbox event is a distinct id.
	const firstOf = new Map<string, number>();
	for (const r of inbox) {
		const id = parse<{id: string}>(r.data).id;
		if (!firstOf.has(id)) firstOf.set(id, r.rev);
	}
	const expected = new Set(
		["s1", "s2"].flatMap((s) => Array.from({length: o.n / 2}, (_, i) => `${s}-${i + 1}`)),
	);
	const missing = [...expected].filter((id) => !firstOf.has(id));
	const extra = [...firstOf.keys()].filter((id) => !expected.has(id));

	// Replay: the real counter's update over the inbox, from zero.
	let replayed: Count = ZERO;
	for (const [id, rev] of [...firstOf.entries()].sort((a, b) => a[1] - b[1])) {
		const msg: CounterMsg = {type: "increment", id, rev};
		[replayed] = applyCell<Count, CounterMsg, never>(counter, replayed, msg);
	}

	// The chain of saved states, in log order with the claims: each under the latest claim's
	// fence, the count +1 or +0.
	let fence = 0;
	let prev = 0;
	const applied = new Map<string, number>();
	const breaks: string[] = [];
	const incAt: {at: number; fence: number}[] = [];
	for (const r of [...registry, ...states].sort((a, b) => a.pos - b.pos)) {
		if (r.kind === "claimed") fence = r.pos;
		if (r.kind !== "state") continue;
		const d = parse<StateData>(r.data);
		if (d.fence !== fence)
			breaks.push(`pos ${r.pos}: saved under fence ${d.fence} after claim ${fence}`);
		if (d.state.count === prev + 1) {
			const id = d.state.last ?? "";
			applied.set(id, (applied.get(id) ?? 0) + 1);
			incAt.push({at: r.at, fence: d.fence});
		} else if (d.state.count !== prev)
			breaks.push(`pos ${r.pos}: count ${prev} -> ${d.state.count}`);
		prev = d.state.count;
	}
	const stateRevGaps = states.filter((r, i) => r.rev !== i + 1).length;
	const twice = [...applied.entries()].filter(([, k]) => k > 1).map(([id]) => id);
	const notApplied = [...firstOf.keys()].filter((id) => !applied.has(id));
	const lastSaved = states.at(-1);
	const final = lastSaved === undefined ? ZERO : parse<StateData>(lastSaved.data).state;

	type Note = Record<string, unknown> & {host: string; at: number};
	const notes = new Map<string, Note[]>();
	for (const [name, h] of o.hosts)
		notes.set(
			name,
			h.lines.map((l) => ({...l, host: name, at: Number(l.at)})),
		);
	const beliefs: {host: string; from: number; to: number}[] = [];
	for (const [name, ls] of notes) {
		let from: number | null = null;
		for (const l of ls) {
			if (l.ev !== "phase") continue;
			if (l.to === "owning") from = l.at;
			if (l.from === "owning" && from !== null) {
				beliefs.push({host: name, from, to: l.at});
				from = null;
			}
		}
		if (from !== null) beliefs.push({host: name, from, to: o.dead.get(name) ?? o.stopAt});
	}
	const accepted = states;
	const overlaps: string[] = [];
	let believedTogetherMs = 0;
	for (const [i, a] of beliefs.entries())
		for (const b of beliefs.slice(i + 1)) {
			if (a.host === b.host) continue;
			const lo = Math.max(a.from, b.from);
			const hi = Math.min(a.to, b.to);
			if (lo >= hi) continue;
			believedTogetherMs += hi - lo;
			const by = (h: string) =>
				accepted.filter((r) => r.writer === h && r.at >= lo && r.at <= hi).length;
			if (by(a.host) > 0 && by(b.host) > 0)
				overlaps.push(
					`${a.host} and ${b.host} both believed they owned it from ${lo} to ${hi}, and both had writes accepted`,
				);
		}

	const zombies = o.faults
		.filter((f) => f.kind !== "kill")
		.map((f) => {
			const ls = notes.get(f.holder) ?? [];
			const cont = f.contAt ?? f.at;
			const sentAfterFreeze = ls.filter(
				(l) => l.ev === "write" && l.fence === f.fence && Number(l.sentAt) >= f.at,
			);
			// A write already in flight when the freeze came can land while the lease still holds,
			// and its answer reaches the host only after the wake. The ledger's own clock tells the
			// two apart: it is late only if its row is missing or was written after the lease ended.
			const landedInLease = (l: Note) =>
				l.ok === true &&
				accepted.some(
					(r) => r.writer === f.holder && Number(r.rev) === Number(l.rev) && r.at <= f.leaseEndsAt,
				);
			const inFlight = sentAfterFreeze.filter(landedInLease);
			const late = sentAfterFreeze.filter((l) => !landedInLease(l));
			const noticed = ls.find(
				(l) => l.ev === "phase" && l.from === "owning" && l.fence === f.fence && l.at >= cont,
			);
			const stopped = ls.find(
				(l) =>
					l.ev === "program" &&
					l.fence === f.fence &&
					(l.phase === "stopped" || l.phase === "ended") &&
					l.at >= cont,
			);
			const acceptedAfter = accepted.filter(
				(r) => r.writer === f.holder && r.at >= cont && parse<StateData>(r.data).fence === f.fence,
			).length;
			return {
				kind: f.kind,
				holder: f.holder,
				fence: f.fence,
				sleptMs: cont - f.at,
				inFlightLandedInLease: inFlight.length,
				lateWrites: late.length,
				lateAccepted: late.filter((l) => l.ok === true).length,
				lateRefused: late.filter((l) => l.ok === false).map((l) => String(l.why)),
				ledgerAcceptedAfterWake: acceptedAfter,
				noticedBy: noticed === undefined ? null : String(noticed.by),
				noticedMs: noticed === undefined ? null : noticed.at - cont,
				programGoneMs: stopped === undefined ? null : stopped.at - cont,
				teaErrors: ls
					.filter((l) => l.ev === "tea_error")
					.map((l) => `${String(l.phase)}: ${String(l.error).slice(0, 120)}`),
				hostAliveAtEnd: o.aliveAtEnd.has(f.holder),
			};
		});

	const takeovers = o.faults.map((f) => {
		const claim = registry.find((r) => r.kind === "claimed" && r.at >= f.at && r.pos > f.fence);
		const resumed =
			claim === undefined
				? undefined
				: accepted.find((r) => parse<StateData>(r.data).fence === claim.pos);
		const startedLine =
			claim === undefined
				? undefined
				: (notes.get(claim.writer) ?? []).find(
						(l) => l.ev === "program" && l.phase === "started" && l.fence === claim.pos,
					);
		const backlog = Number(startedLine?.backlog ?? 0);
		const after = incAt.filter((x) => claim !== undefined && x.fence === claim.pos);
		const caughtUp = backlog >= 20 ? after[backlog - 1] : undefined;
		return {
			kind: f.kind,
			from: f.holder,
			to: claim?.writer ?? null,
			leaseLeftMs: f.leaseEndsAt - f.at,
			claimMs: claim === undefined ? null : claim.at - f.at,
			claimAfterLeaseEndMs: claim === undefined ? null : claim.at - f.leaseEndsAt,
			resumeMs: resumed === undefined ? null : resumed.at - f.at,
			replayMs: startedLine === undefined ? null : Number(startedLine.replayMs),
			backlog,
			catchUpPerS:
				caughtUp === undefined || resumed === undefined
					? null
					: Math.round(backlog / Math.max(0.001, (caughtUp.at - resumed.at) / 1000)),
		};
	});

	// What each host read to follow its streams: the last `reads` line it printed.
	type Reads = {
		registry: Meter;
		inbox: Meter;
		replay: {reads: number; events: number; bytes: number};
	};
	const readsOf = (name: string) =>
		(notes.get(name) ?? []).findLast((l) => l.ev === "reads") as (Note & Reads) | undefined;
	const lived = [...o.hosts.keys()].filter((h) => o.aliveAtEnd.has(h));
	const watchers = lived.flatMap((h) => {
		const r = readsOf(h);
		const up = (notes.get(h) ?? []).find((l) => l.ev === "up")?.at ?? o.runStart;
		return r === undefined
			? []
			: [
					{
						host: h,
						seconds: r1((r.at - up) / 1000),
						registryEvents: r.registry.events,
						registryBytes: r.registry.bytes,
						registryReads: r.registry.reads,
						registryWakes: r.registry.wakes,
						inboxEvents: r.inbox.events,
						inboxBytes: r.inbox.bytes,
						inboxReads: r.inbox.reads,
						replayBytes: r.replay.bytes,
					},
				];
	});
	const writes = [...notes.values()].flat().filter((l) => l.ev === "write");
	const span = incAt.length < 2 ? 0 : ((incAt.at(-1)?.at ?? 0) - (incAt[0]?.at ?? 0)) / 1000;
	return {
		finalCount: final.count,
		replayedCount: replayed.count,
		replayMatchesLive:
			replayed.count === final.count &&
			replayed.cursor === final.cursor &&
			replayed.last === final.last,
		inboxEvents: inbox.length,
		distinctIds: firstOf.size,
		repeatsInInbox: inbox.length - firstOf.size,
		missingIds: missing.length,
		extraIds: extra.length,
		appliedOnce: applied.size,
		appliedTwice: twice.length,
		notApplied: notApplied.length,
		registryEvents: registry.length,
		registryKinds: Object.fromEntries(
			[...new Set(registry.map((r) => r.kind))].map((k) => [
				k,
				registry.filter((r) => r.kind === k).length,
			]),
		),
		stateEvents: states.length,
		stateRevGaps,
		chainBreaks: breaks.slice(0, 10),
		claims: registry.filter((r) => r.kind === "claimed").length,
		leaseExpiredEvents: registry.filter((r) => r.kind === "lease_expired").length,
		logEvents: o.rows.length,
		rowBytes: {
			inbox: r1(avg(inbox.map(bytes94))),
			state: r1(avg(states.map(bytes94))),
			registry: r1(avg(registry.map(bytes94))),
		},
		writesTried: writes.length,
		writesRefused: writes.filter((l) => l.ok === false).map((l) => `${l.host}: ${String(l.why)}`),
		savesAnsweredDup: writes.filter((l) => l.why === "answer lost, landed").length,
		overlaps,
		believedTogetherMs,
		zombies,
		takeovers,
		watchers,
		countedPerS: span === 0 ? 0 : Math.round(incAt.length / span),
		pass: {
			countExact: final.count === o.n && missing.length === 0 && extra.length === 0,
			everyIdOnce:
				twice.length === 0 &&
				notApplied.length === 0 &&
				applied.size === o.n &&
				breaks.length === 0 &&
				inbox.length === firstOf.size,
			zombieRefused: zombies.every(
				(z) =>
					z.lateAccepted === 0 &&
					z.ledgerAcceptedAfterWake === 0 &&
					z.noticedBy !== null &&
					z.programGoneMs !== null &&
					z.hostAliveAtEnd,
			),
			aloneRefusedByFence: zombies
				.filter((z) => z.kind === "alone")
				.every((z) => z.lateRefused.length > 0 && z.lateRefused.every((w) => w === "fenced")),
			noHostCrashed: [...o.hosts.keys()].every((h) => o.dead.has(h) || o.aliveAtEnd.has(h)),
			neverTwoWritingOwners: overlaps.length === 0,
			replayMatches: replayed.count === final.count && replayed.cursor === final.cursor,
			progressOffRegistry: states.length > 0 && registry.every((r) => r.kind !== "state"),
		},
	};
}

/** The before/after table: 94's saved runs against these, by preset. */
function beforeAfter() {
	const before = existsSync(RESULTS_94)
		? (JSON.parse(readFileSync(RESULTS_94, "utf8")).runs as Record<string, any>[])
		: [];
	const after = (results[SAVE_AS] ?? []) as ReturnType<typeof judge>[] & Record<string, any>[];
	const side = (runs: Record<string, any>[], preset: string, was: boolean) => {
		const rs = runs.filter((r) => r.preset === preset);
		if (rs.length === 0) return null;
		const range = (xs: number[]) => {
			const f = xs.filter((x) => Number.isFinite(x));
			return f.length === 0 ? null : [Math.min(...f), Math.max(...f)];
		};
		const takeovers = rs.flatMap((r) => r.takeovers.filter((t: any) => t.kind !== "alone"));
		const zombies = rs.flatMap((r) => r.zombies);
		// A watching host in 94 read every event of the log to follow the registry stream; in 96 it
		// reads that stream alone. 94 kept no byte counts: its bytes are 96's row sizes (the new
		// `id` key taken out) times 94's event counts, an estimate.
		const watchEvents = rs.map((r) =>
			was
				? r.inboxEvents + r.stateEvents + r.claims + r.leaseExpiredEvents
				: Math.max(...r.watchers.map((w: any) => w.registryEvents)),
		);
		const sizes = after.find((a) => a.preset === preset)?.rowBytes;
		const watchBytes = rs.map((r) =>
			was
				? sizes === undefined
					? Number.NaN
					: Math.round(
							r.inboxEvents * sizes.inbox +
								r.stateEvents * sizes.state +
								(r.claims + r.leaseExpiredEvents) * sizes.registry,
						)
				: Math.max(...r.watchers.map((w: any) => w.registryBytes)),
		);
		const watchReadsPerS = was
			? []
			: rs.flatMap((r) => r.watchers.map((w: any) => w.registryReads / Math.max(1, w.seconds)));
		return {
			runs: rs.length,
			staleShareOfSendAppends: range(
				rs.map((r) => r1((100 * r.sendLatency.stale) / r.sendLatency.appends)),
			),
			registryEventsPerMessage: range(
				rs.map(
					(r) =>
						Math.round(
							(1000 * (was ? r.claims + r.stateEvents + r.leaseExpiredEvents : r.registryEvents)) /
								r.n,
						) / 1000,
				),
			),
			watchEventsPerMessage: range(
				rs.map((r, i) => Math.round((1000 * (watchEvents[i] ?? 0)) / r.n) / 1000),
			),
			watchKbPerRun: range(watchBytes.map((b) => r1(b / 1024))),
			watchReadsPerS: was ? null : range(watchReadsPerS.map(r1)),
			repeatsInInbox: range(rs.map((r) => r.repeatsInInbox)),
			sendAppendP50Ms: range(rs.map((r) => r.sendLatency.appendP50Ms)),
			sendAppendP99Ms: range(rs.map((r) => r.sendLatency.appendP99Ms)),
			sendP50Ms: range(rs.map((r) => r.sendLatency.sendP50Ms)),
			sendP99Ms: range(rs.map((r) => r.sendLatency.sendP99Ms)),
			claimAfterLeaseEndMs: range(takeovers.map((t: any) => t.claimAfterLeaseEndMs)),
			takeoverMs: range(takeovers.map((t: any) => t.claimMs)),
			resumeMs: range(takeovers.map((t: any) => t.resumeMs)),
			replayMs: range(takeovers.map((t: any) => t.replayMs)),
			catchUpPerS: range(takeovers.map((t: any) => t.catchUpPerS ?? Number.NaN)),
			zombieRefusals: zombies.map((z: any) => `${z.kind}: ${z.lateRefused.join(",")}`),
			zombieNoticedMs: range(zombies.map((z: any) => z.noticedMs)),
		};
	};
	const out: Record<string, unknown> = {};
	for (const preset of ["small", "large"])
		out[preset] = {before: side(before, preset, true), after: side(after, preset, false)};
	console.log(JSON.stringify(out, null, 1));
	return out;
}

// ---------------------------------------------------------------- main

const sections: Record<string, () => Promise<void>> = {
	laws,
	kill,
	hosts,
	node: nodeSqlite,
	file,
	machine: async () => {
		const host = checkHost(Number(process.env.HOST_DEPTH ?? "10"));
		const count = checkCounter(6);
		for (const r of [host, count]) {
			console.log(`\n## laws: ${r.machine} (${r.states} states, complete: ${r.complete})`);
			for (const law of r.laws)
				console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
			for (const p of r.planted)
				console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
		}
		results.machine = {host, counter: count};
		save();
	},
	runs: async () => {
		const runs: unknown[] = [];
		for (const [i, preset] of RUNS.entries()) {
			if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
			const r = await runOnce(preset, i + 1);
			console.log(JSON.stringify({preset: r.preset, pass: r.pass, final: r.finalCount}, null, 1));
			runs.push(r);
			results[SAVE_AS] = runs;
			save();
		}
		results.compare = beforeAfter();
		save();
	},
};
for (const name of ["laws", "kill", "hosts", "node", "file", "machine", "runs"]) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
