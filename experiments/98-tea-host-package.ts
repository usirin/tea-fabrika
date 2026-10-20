// Experiment 98: the tea-host package. Experiments 93 to 97 proved the pieces of a tea host on one
// ledger, each in its own folder with its own copy. This lifts them into `packages/tea-host` and
// runs 94's and 95's tests again against the package's exports only. New: deny by default (a name
// must be registered before anything is written under it), the lease clock (a host stops its
// program at its own lease's end), and the error sink the host always gives.
//
// ONLY: a comma list of laws|plants|kill|hosts|node|file|machine|counter|agents (default all).
//   laws     the package's law suite (`runLaws`) on the Durable Object, Miniflare in this process;
//            law 15 (the doorbell's notices) and the tail's wake-up latency
//   plants   each planted mistake in the ledger's rules: which laws it breaks
//   kill     laws 7, 11c, 13 and the guard across KILLS SIGKILLs of the local ledger
//            (`LocalLedger.crash`), then the suite on the restarted child
//   hosts    law 8: two Node processes race claims over HTTP
//   node     law 9: the suite on node:sqlite, 8 threads, one file
//   file     law 10: after stopping, the Durable Object's .sqlite is a plain file
//   machine  the host and call machines' laws (wip/src/laws/tea-host.ts), and 94's counter and
//            95's answerer machines' (unchanged)
//   counter  94's counter test on the package: RUNS (small,small,small,large)
//   agents   95's agents test across a Docker container, stub agents: AGENT_RUNS (same)
// KILLS (5). Results: results/98-tea-host-package.json.
//
// Node at the edge, as 93 to 97: processes in their own groups, signals, `ps` and `docker`
// (./98-tea-host-package/harness.ts). The ledger, the hosts and everything they write go through
// `@tea-fabrika/tea-host`.
import {existsSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
// biome-ignore lint/plugin: law 10 reads the Durable Object's own file; nothing here fakes D1.
import {DatabaseSync} from "node:sqlite";
import {type Appended, Ledger, type Row, streams} from "@tea-fabrika/tea-host";
import {layerHttp} from "@tea-fabrika/tea-host/http";
import {
	fresh,
	type LawResult,
	layerPlanted,
	PLANTED,
	type Planted,
	runLaws,
	say,
} from "@tea-fabrika/tea-host/laws";
import {layerSqlite} from "@tea-fabrika/tea-host/sqlite";
import {meter, tail} from "@tea-fabrika/tea-host/tail";
import {ledgerOptions} from "@tea-fabrika/tea-host/worker-options";
import {Effect, Fiber, Stream} from "effect";
import {Miniflare} from "miniflare";
import {checkCalls, checkHost} from "../wip/src/laws/tea-host.ts";
import {checkCounter} from "./94-tea-host/laws.ts";
import {checkAnswerer} from "./95-agents-across-hosts/laws.ts";
import * as agents from "./98-tea-host-package/agents-run.ts";
import * as counter from "./98-tea-host-package/counter-run.ts";
import {
	GRACE_MS,
	group,
	here,
	node,
	pct,
	r1,
	results,
	save,
	sleep,
	tempDir,
	until,
} from "./98-tea-host-package/harness.ts";
import {connect, openLocal} from "./98-tea-host-package/ledger.ts";

const RACER = here("98-tea-host-package/racer.ts");
const LAW_LEDGER = "acme-app";
const ALL = "laws,plants,kill,hosts,node,file,machine,counter,agents";
const only = new Set((process.env.ONLY ?? ALL).split(","));
const KILLS = Number(process.env.KILLS ?? "5");
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");
const AGENT_RUNS = (process.env.AGENT_RUNS ?? "small,small,small,large").split(",");

const printLaws = (title: string, laws: readonly LawResult[]) => {
	console.log(`\n## ${title}`);
	for (const l of laws) console.log(`${l.pass ? "PASS" : "FAIL"}  ${l.law}\n      ${l.numbers}`);
};
type Service = Ledger["Service"];
type Run = <A, E>(e: Effect.Effect<A, E, Ledger>) => Promise<A>;
const withLedger = <A, E>(f: (l: Service) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		return yield* f(yield* Ledger);
	});
/** Run one thing against the ledger. A refusal rejects the promise. */
const on =
	(run: Run) =>
	<A, E>(f: (l: Service) => Effect.Effect<A, E>) =>
		run(withLedger(f));
/** One call's answer as a word: `ok`, `dup`, or the refusal's (`denied`, `fenced`, `unknown`, ...). */
const wordOf =
	(run: Run) =>
	<A, E extends {readonly _tag: string}>(f: (l: Service) => Effect.Effect<A, E>) =>
		run(withLedger((l) => say(f(l)))).then((s) => s.word);
const suiteOn = (run: Run, alarm = true) => run(runLaws({alarm, graceMs: GRACE_MS}));

/** A live tail in this process over its own small pool, collecting what it hands on. */
const runTail = (url: string, ledger: string, stream: string) => {
	const got: Row[] = [];
	const m = meter();
	const fiber = Effect.runFork(
		withLedger((l) =>
			Stream.runForEach(tail(l, {stream, fromRev: 0, meter: m}), (r) =>
				Effect.sync(() => {
					got.push(r);
				}),
			),
		).pipe(Effect.provide(layerHttp({url, ledger, maxSockets: 2}))),
	);
	return {got, meter: m, stop: () => Effect.runPromise(Fiber.interrupt(fiber))};
};

// ---------------------------------------------------------------- laws in this process

/**
 * 15 (96's). The Durable Object's doorbell: a write wakes the watchers of its stream and of the
 * prefixes it sits under, once each, and no others. Under deny by default the writes are sends
 * into registered names' inboxes, and a claim.
 */
async function law15Wakes(url: string, run: Run): Promise<LawResult> {
	const p = fresh("l15");
	const w = wordOf(run);
	for (const n of [`${p}/a`, `${p}/b`, `${p}x`]) await w((l) => l.register(n, "r"));
	const ws = (q: string) =>
		new Promise<{notes: string[]; sock: WebSocket}>((resolve, reject) => {
			const sock = new WebSocket(`${url.replace(/^http/, "ws")}/${LAW_LEDGER}/tail?${q}`);
			const notes: string[] = [];
			sock.onmessage = (e) => notes.push(String(e.data));
			sock.onopen = () => resolve({notes, sock});
			sock.onerror = () => reject(new Error(`no socket for ${q}`));
		});
	const aIn = streams(`${p}/a`).inbox;
	const a = await ws(`stream=${encodeURIComponent(aIn)}`);
	const pre = await ws(`prefix=${encodeURIComponent(p)}`);
	const both = await ws(`stream=${encodeURIComponent(aIn)}&prefix=${encodeURIComponent(aIn)}`);
	const other = await ws(`stream=${encodeURIComponent(streams(`${p}x`).inbox)}`);
	const tooMany = await new Promise<string>((resolve) => {
		const q = Array.from({length: 11}, (_, i) => `stream=s${i}`).join("&");
		const sock = new WebSocket(`${url.replace(/^http/, "ws")}/${LAW_LEDGER}/tail?${q}`);
		sock.onopen = () => {
			sock.close();
			resolve("opened");
		};
		sock.onerror = () => resolve("refused");
	});
	const note = {kind: "note", writer: "w"};
	const answers = [
		await w((l) => l.send(aIn, "m0", note)),
		await w((l) => l.send(streams(`${p}/b`).inbox, "m0", note)),
		await w((l) => l.send(streams(`${p}x`).inbox, "m0", note)),
		await w((l) => l.send(aIn, "m1", note)),
		await w((l) => l.send(aIn, "m1", note)),
		await w((l) => l.claim(`${p}/a`, "h", 1, 60_000)),
	];
	await sleep(200);
	const counts = [a, pre, both, other].map((s) => s.notes.length);
	const first = JSON.parse(a.notes[0] ?? "{}");
	for (const s of [a, pre, both, other]) s.sock.close();
	return {
		law: "15. a write wakes the watchers of its stream and of its prefixes, once each, and no others",
		pass:
			counts.join(",") === "2,4,2,1" &&
			answers.join(",") === "ok,ok,ok,ok,dup,ok" &&
			first.stream === aIn &&
			first.rev === 1 &&
			first.data === undefined &&
			tooMany === "refused",
		numbers: `answers ${answers.join(",")}; notices: ${aIn} ${counts[0]} (2 sends, a repeated id that wrote nothing); prefix ${p} ${counts[1]} (and ${p}/b's send and the claim); stream and prefix on one socket ${counts[2]}; ${p}x ${counts[3]}; a notice: ${a.notes[0]}; 11 tags: ${tooMany}`,
	};
}

/** How long from a send to the tail handing it on, sends spaced so the tail is idle. */
async function tailLatency(url: string, run: Run, n = 200) {
	const s = fresh("lat");
	await on(run)((l) => l.register(s, "r"));
	const inbox = streams(s).inbox;
	const t = runTail(url, LAW_LEDGER, inbox);
	await sleep(300);
	const ms: number[] = [];
	for (let i = 0; i < n; i++) {
		const t0 = performance.now();
		await on(run)((l) => l.send(inbox, `m${i}`, {kind: "note", writer: "w"}));
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
		rings: t.meter.rings,
	};
}

async function laws() {
	const dir = tempDir("laws");
	const mf = new Miniflare(ledgerOptions({persist: dir, graceMs: GRACE_MS, direct: 0}));
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	const c = connect(url, LAW_LEDGER);
	const suite = await suiteOn(c.run);
	printLaws("The package's law suite on the Durable Object, Miniflare in this process", suite);
	const wakes = await law15Wakes(url, c.run);
	printLaws("Law 15, the doorbell", [wakes]);
	const latency = await tailLatency(url, c.run);
	console.log(`tail latency: ${JSON.stringify(latency)}`);
	await c.close();
	await mf.dispose();
	rmSync(dir, {recursive: true, force: true});
	results.laws = {suite, law15: wakes, tailLatency: latency};
	save();
}

// ---------------------------------------------------------------- planted mistakes

async function plants() {
	const dir = tempDir("plant");
	const names = Object.keys(PLANTED).filter((k): k is Planted => k in PLANTED);
	const out = await Effect.runPromise(
		Effect.forEach(
			names,
			(planted, i) =>
				runLaws({alarm: true, graceMs: GRACE_MS}).pipe(
					Effect.provide(layerPlanted(join(dir, `planted-${i}.sqlite`), planted, GRACE_MS)),
					Effect.scoped,
					Effect.map((rs) => {
						const failed = rs.filter((l) => !l.pass);
						return {
							planted,
							failed: failed.map((l) => l.law.split(".")[0] ?? l.law),
							caught: failed.length > 0,
							numbers: failed.map((l) => `${l.law.split(".")[0]}: ${l.numbers}`),
						};
					}),
				),
			{concurrency: "unbounded"},
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

// ---------------------------------------------------------------- laws 7, 11c, 13: SIGKILL

/** pos gapless from 1; rev gapless from 1 per stream. */
const gaps = (rows: readonly Row[]) => {
	let posGaps = 0;
	rows.forEach((r, i) => {
		if (r.pos !== i + 1) posGaps++;
	});
	const byStream = new Map<string, number[]>();
	for (const r of rows) byStream.set(r.stream, [...(byStream.get(r.stream) ?? []), r.rev]);
	let revGaps = 0;
	for (const revs of byStream.values()) {
		revs.sort((x, y) => x - y);
		revs.forEach((v, i) => {
			if (v !== i + 1) revGaps++;
		});
	}
	return {posGaps, revGaps};
};

/**
 * 96's laws 7, 11c and 13, as 97 ran them, now through `LocalLedger.crash` (SIGKILL the child's
 * whole group, start it again on the same port). Then the guard across the same kills: a name
 * registered and claimed before the first kill is still guarded after the last restart, and a name
 * nobody registered is still `unknown`. Then the whole suite on the restarted child.
 */
async function kill() {
	const persist = tempDir("kill");
	const led = await openLocal(persist, {ledger: LAW_LEDGER});
	const run: Run = led.run;
	const w = wordOf(run);
	const MAIL = "l13";
	await on(run)((l) => l.register(MAIL, "r"));
	const INBOX = streams(MAIL).inbox;
	const t = runTail(led.url, LAW_LEDGER, INBOX);
	const rounds: Record<string, unknown>[] = [];
	const acked = new Map<string, {rev: number; pos: number}>();
	const resent: {id: string; answer: string}[] = [];
	const tailSeenAtKill: number[] = [];

	// The guard's name, registered and claimed before the kills, with a lease that ends among them.
	const G = "l16k-counter";
	await on(run)((l) => l.register(G, "r"));
	const gClaim = await on(run)((l) => l.claim(G, "g1", 1, 1500));
	const gSaved = await w((l) =>
		l.append(`${G}/state`, 0, {kind: "state", writer: "g1"}, gClaim.fence),
	);

	for (let k = 0; k < KILLS; k++) {
		const leaseName = `l7-lease-${k}`;
		await on(run)((l) => l.register(leaseName, "r"));
		const claimed = await w((l) => l.claim(leaseName, "h", 1, 4000));
		let stop = false;
		const lost: string[] = [];
		const writers = Array.from({length: 8}, async (_, wr) => {
			for (let i = 1; !stop; i++) {
				const id = `${k}.${wr}.${i}`;
				const r = await run(
					withLedger((l) => l.send(INBOX, id, {kind: "inc", writer: `w${wr}`})).pipe(Effect.result),
				);
				if (r._tag === "Failure") {
					lost.push(id);
					return;
				}
				const a: Appended = r.success;
				acked.set(id, {rev: a.rev, pos: a.pos});
			}
		});
		await sleep(800 + Math.random() * 700);
		const oldPid = await led.pid();
		const killedAt = Date.now();
		const {restartMs} = await led.crash();
		stop = true;
		await Promise.all(writers);
		const left = group(oldPid).length;
		tailSeenAtKill.push(t.got.length);
		for (const id of lost) {
			const answer = await w((l) => l.send(INBOX, id, {kind: "inc", writer: "resend"}));
			resent.push({id, answer});
		}
		// Touch nothing more until the lease and its grace are past, so the alarm fires alone.
		await sleep(Math.max(0, killedAt + 4000 + GRACE_MS + 2500 - Date.now()));
		const firstTouch = Date.now();
		const rows = await led.readAll();
		const expired = rows.find((r) => r.stream === leaseName && r.kind === "lease_expired");
		rounds.push({
			round: k,
			claimed,
			processesLeftAfterKill: left,
			restartMs,
			events: rows.length,
			inFlightAtKill: lost.length,
			...gaps(rows),
			alarmFiredAlone: expired ? expired.at < firstTouch : false,
		});
		console.log(`kill ${k}: ${JSON.stringify(rounds.at(-1))}`);
	}
	// The resent ids are in `acked` only through the stream: read their place from it.
	const stream = await on(run)((l) => l.readStream(INBOX));
	await until("the tail to catch up", () => t.got.length >= stream.length, 15_000).catch(() => {});
	await t.stop();
	const rows = await led.readAll();
	let lostAcked = 0;
	const byId = new Map<string, Row[]>();
	for (const r of stream) byId.set(String(r.id), [...(byId.get(String(r.id)) ?? []), r]);
	for (const [id, a] of acked) {
		const r = byId.get(id)?.[0];
		if (!r || r.rev !== a.rev || r.pos !== a.pos) lostAcked++;
	}
	const twice = [...byId.values()].filter((rs) => rs.length > 1).length;
	const tailRevs = t.got.map((r) => r.rev);
	const tailInOrder = tailRevs.every((r, i) => r === i + 1);
	const tailMatches =
		t.got.length === stream.length &&
		t.got.every((r, i) => r.pos === stream[i]?.pos && r.id === stream[i]?.id);

	// The guard, after every kill: the name's lease ran out long ago, and nobody claimed it again.
	const other = "l16k-asker";
	await on(run)((l) => l.register(other, "r"));
	const guard = {
		claimed: "ok",
		savedUnderFence: gSaved,
		unfencedState: await w((l) => l.append(`${G}/state`, 1, {kind: "state", writer: "x"})),
		unfencedName: await w((l) => l.append(G, "any", {kind: "note", writer: "x"})),
		inbox: await w((l) => l.send(streams(G).inbox, "k1", {kind: "m", writer: "s"})),
		oldFenceReply: await w((l) =>
			l.send(streams(other).inbox, "r1", {kind: "reply", writer: "g1"}, gClaim.fence),
		),
		claimInside: await w((l) => l.claim(`${G}/state`, "x", 0, 30_000)),
		otherClaimed: await w((l) => l.claim(other, "a1", 1, 30_000)),
		unregisteredSend: await w((l) =>
			l.send(streams("l16k-nobody").inbox, "n1", {kind: "m", writer: "s"}),
		),
		unregisteredClaim: await w((l) => l.claim("l16k-nobody", "x", 0, 30_000)),
	};
	const afterKills = await suiteOn(run);
	const restarts = await led.restarts();
	const lastPid = await led.pid();
	await led.close();
	const leftAfterClose = group(lastPid).length;
	rmSync(persist, {recursive: true, force: true});

	const law7: LawResult = {
		law: `7. SIGKILL the local ledger's child mid-write, restart, ${KILLS} times`,
		pass:
			lostAcked === 0 &&
			rounds.every(
				(r) =>
					r.posGaps === 0 &&
					r.revGaps === 0 &&
					r.alarmFiredAlone === true &&
					r.processesLeftAfterKill === 0,
			),
		numbers: `${rounds.length} kills (${restarts} restarts); ${acked.size} acknowledged, lost ${lostAcked}; pos gaps ${gaps(rows).posGaps}; rev gaps ${gaps(rows).revGaps}; alarm fired alone ${rounds.filter((r) => r.alarmFiredAlone).length}/${rounds.length}; processes left after each kill ${rounds.map((r) => r.processesLeftAfterKill).join(", ")}; restart ${rounds.map((r) => r.restartMs).join(", ")} ms; processes left after close ${leftAfterClose}`,
	};
	const answers: Record<string, number> = {};
	for (const r of resent) answers[r.answer] = (answers[r.answer] ?? 0) + 1;
	const law11c: LawResult = {
		law: "11c. a send whose answer a kill swallowed, sent again with its id after the restart, is in the stream once",
		pass:
			resent.length > 0 &&
			twice === 0 &&
			resent.every((r) => r.answer === "ok" || r.answer === "dup"),
		numbers: `${resent.length} sent again: ${JSON.stringify(answers)} (dup: the first send had landed); ids twice in the stream ${twice}`,
	};
	const law13: LawResult = {
		law: `13. a live tail of one inbox across ${KILLS} SIGKILLs of the ledger never skips or repeats`,
		pass: tailInOrder && tailMatches && t.got.length > 0,
		numbers: `${stream.length} events in the stream; the tail handed on ${t.got.length}, revs 1..${tailRevs.at(-1)} each once in order ${tailInOrder}, the same events as the stream ${tailMatches}; at each kill it had ${tailSeenAtKill.join(", ")}; reads ${t.meter.reads}, rings ${t.meter.rings}`,
	};
	const law16k: LawResult = {
		law: `16k. a name claimed before ${KILLS} SIGKILLs is still guarded after them, and a name nobody registered is still unknown`,
		pass:
			guard.savedUnderFence === "ok" &&
			guard.unfencedState === "denied" &&
			guard.unfencedName === "denied" &&
			guard.inbox === "ok" &&
			guard.oldFenceReply === "fenced" &&
			guard.claimInside === "denied" &&
			guard.otherClaimed === "ok" &&
			guard.unregisteredSend === "unknown" &&
			guard.unregisteredClaim === "unknown",
		numbers: Object.entries(guard)
			.map(([k, v]) => `${k} ${v}`)
			.join("; "),
	};
	printLaws("Laws 7, 11c, 13 and the guard: SIGKILL and restart", [law7, law11c, law13, law16k]);
	printLaws("The suite on the restarted child", afterKills);
	results.kill = {laws: [law7, law11c, law13, law16k], afterKills, rounds, tail: t.meter};
	save();
}

// ---------------------------------------------------------------- law 8: two hosts over HTTP

type Raced = {who: string; won: string[]; counts: Record<string, number>};

async function hosts() {
	const persist = tempDir("hosts");
	const led = await openLocal(persist, {ledger: LAW_LEDGER});
	const names = Array.from({length: 20}, (_, i) => `l8-${Date.now().toString(36)}-${i}`);
	for (const n of names) await on(led.run)((l) => l.register(n, "r"));
	const startAt = Date.now() + 2000;
	const racers = ["hostA", "hostB"].map((who) =>
		node(RACER, {
			BASE: led.url,
			LEDGER: LAW_LEDGER,
			STREAMS: names.join(","),
			PER: "10",
			START_AT: String(startAt),
			WHO: who,
			INFLIGHT: "32",
		}),
	);
	await Promise.all(racers.map((r) => r.exited));
	const [a, b] = racers.map((r) => r.lines[0] as Raced | undefined);
	let one = 0;
	for (const s of names) {
		const wins = [...(a?.won ?? []), ...(b?.won ?? [])].filter((x) => x === s).length;
		const claimed = (await on(led.run)((l) => l.readStream(s))).filter(
			(e) => e.kind === "claimed",
		).length;
		if (wins === 1 && claimed === 1) one++;
	}
	await led.close();
	rmSync(persist, {recursive: true, force: true});
	const law: LawResult = {
		law: "8. two Node processes race claims on the local ledger over HTTP (32 in flight each)",
		pass: one === names.length && a !== undefined && b !== undefined,
		numbers: `${names.length} names x 10 claims from each: exactly one winner on ${one}; answers A ${JSON.stringify(a?.counts)}, B ${JSON.stringify(b?.counts)}`,
	};
	printLaws("Law 8, two hosts", [law]);
	results.hosts = {laws: [law]};
	save();
}

// ---------------------------------------------------------------- law 9: node:sqlite

async function nodeSqlite() {
	const dir = tempDir("node");
	const out = await Effect.runPromise(
		runLaws({alarm: true, graceMs: GRACE_MS}).pipe(
			Effect.provide(
				layerSqlite({path: join(dir, "ledger.sqlite"), threads: 8, graceMs: GRACE_MS}),
			),
			Effect.scoped,
		),
	);
	printLaws("Law 9, the suite on node:sqlite (8 threads, one file)", out);
	results.node = {laws: out};
	rmSync(dir, {recursive: true, force: true});
	save();
}

// ---------------------------------------------------------------- law 10: a plain file

async function file() {
	const persist = tempDir("file");
	const mf = new Miniflare(ledgerOptions({persist, graceMs: GRACE_MS, direct: 0}));
	await mf.ready;
	const c = connect((await mf.unsafeGetDirectURL()).origin, LAW_LEDGER);
	const run = on(c.run);
	await run((l) => l.register("f", "r"));
	const inbox = streams("f").inbox;
	for (let i = 0; i < 100; i++)
		await run((l) => l.send(inbox, `m${i}`, {kind: "note", writer: "w"}));
	await run((l) => l.send(inbox, "m3", {kind: "note", writer: "w"}));
	await run((l) => l.register("g", "r"));
	const claimed = await wordOf(c.run)((l) => l.claim("g", "h", 1, 60_000));
	await c.close();
	await mf.dispose();
	const folder = readdirSync(persist).find((f) => f.endsWith("Ledger")) ?? "";
	const db = readdirSync(join(persist, folder)).find(
		(f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
	);
	const raw = new DatabaseSync(join(persist, folder, String(db)), {readOnly: true});
	const n = Number(
		raw.prepare("SELECT count(*) AS n FROM events WHERE stream = 'f/inbox'").get()?.n,
	);
	const ids = Number(
		raw.prepare("SELECT count(DISTINCT id) AS n FROM events WHERE stream = 'f/inbox'").get()?.n,
	);
	const migrations = Number(raw.prepare("SELECT max(id) AS n FROM migrations").get()?.n);
	const names = raw
		.prepare("SELECT name FROM names ORDER BY name")
		.all()
		.map((r) => String(r.name));
	raw.close();
	rmSync(persist, {recursive: true, force: true});
	const law: LawResult = {
		law: "10. after stopping Miniflare, the .sqlite is a plain file (the names table too)",
		pass:
			n === 100 && ids === 100 && migrations === 2 && claimed === "ok" && names.join(",") === "f,g",
		numbers: `101 sends through the DO (one a repeated id): ${n} events, ${ids} distinct ids; one claim (${claimed}); migration ${migrations}; names ${JSON.stringify(names)}; read by node:sqlite read-only`,
	};
	printLaws("Law 10", [law]);
	results.file = {laws: [law]};
	save();
}

// ---------------------------------------------------------------- the tests, again

const saved = (path: string, key: string): Record<string, unknown>[] =>
	existsSync(here(path))
		? ((JSON.parse(readFileSync(here(path), "utf8"))[key] ?? []) as Record<string, unknown>[])
		: [];

async function counterRuns() {
	const runs: counter.CounterRun[] = [];
	for (const [i, preset] of RUNS.entries()) {
		if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
		const r = await counter.runOnce(preset, i + 1);
		console.log(JSON.stringify({preset: r.preset, pass: r.pass, final: r.finalCount}, null, 1));
		runs.push(r);
		results.counter = runs;
		save();
	}
	results.counterCompare = counter.compare(
		saved("results/94-tea-host-counter.json", "runs"),
		saved("results/96-ledger-mailbox.json", "runs"),
		saved("results/97-one-ledger.json", "counter"),
		runs,
	);
	console.log(JSON.stringify(results.counterCompare, null, 1));
	save();
}

const show = (r: agents.AgentsRun) =>
	JSON.stringify(
		{
			preset: r.preset,
			finishedMs: r.finishedMs,
			pass: r.pass,
			answered: r.answered,
			faultsDuringCalls: r.faultsDuringCalls,
			refusals: r.refusals,
			zombies: r.zombies,
			latency: r.latency,
			hostErrors: r.hostErrors,
		},
		null,
		1,
	);

async function agentRuns() {
	const prep = agents.prepare();
	console.log(
		`image built in ${prep.buildMs} ms; Linux node_modules installed in ${prep.installMs} ms`,
	);
	try {
		const runs: agents.AgentsRun[] = [];
		for (const [i, preset] of AGENT_RUNS.entries()) {
			if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
			const r = await agents.runOnce(preset, i + 1);
			console.log(show(r));
			runs.push(r);
			results.agents = runs;
			save();
		}
		results.agentsCompare = agents.compareAgents(
			saved("results/95-agents-across-hosts.json", "runs"),
			saved("results/97-one-ledger.json", "agents"),
			runs,
		);
		console.log(JSON.stringify(results.agentsCompare, null, 1));
		results.agentsPrepare = prep;
		save();
	} finally {
		const un = agents.unprepare();
		console.log(
			`removed ${un.containers} containers; image and volume ${un.removed ? "removed" : "kept (KEEP_IMAGE=1)"}`,
		);
	}
}

// ---------------------------------------------------------------- main

const sections: Record<string, () => Promise<void>> = {
	laws,
	plants,
	kill,
	hosts,
	node: nodeSqlite,
	file,
	machine: async () => {
		const host = checkHost(Number(process.env.HOST_DEPTH ?? "9"));
		const calls = checkCalls(Number(process.env.CALL_DEPTH ?? "7"));
		const count = checkCounter(6);
		const answerer = checkAnswerer(6);
		for (const r of [host, calls, count, answerer]) {
			console.log(`\n## laws: ${r.machine} (${r.states} states, complete: ${r.complete})`);
			for (const law of r.laws)
				console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
			for (const p of r.planted)
				console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
		}
		results.machine = {host, calls, counter: count, answerer};
		save();
	},
	counter: counterRuns,
	agents: agentRuns,
};
for (const name of ALL.split(",")) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
