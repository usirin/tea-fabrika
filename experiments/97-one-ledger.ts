// Experiment 97: one ledger. Experiments 95 and 96 each grew their own copy of experiment 93's
// ledger: 95 added `fenceOn` (a reply into another program's inbox, fenced on the replier's own
// lease), 96 a prefix lease, append "any" with a message id, and a live tail. This merges the two
// into one ledger (./97-one-ledger/), closes the rule both left open (an unfenced write under a
// claimed name lands), and runs both tests again on it: 94's counter and 95's agents across hosts.
//
// ONLY: a comma list of laws|plants|kill|hosts|node|file|machine|counter|latency|agents (default
// all).
//   laws     93's laws 1-6, 96's laws 11, 12, 14, 15 and the new laws 16-18, Miniflare in this
//            process; the tail's wake-up latency
//   plants   each planted mistake in the ledger's rules (sql.ts PLANTED), on node:sqlite: the
//            laws must fail on every one
//   kill     law 7, 11c and 13 (96's): SIGKILL the child Miniflare mid-write KILLS times; then the
//            guard after the restarts, and the new laws on the restarted child
//   hosts    law 8: two Node processes race claims over HTTP (93's racer, unchanged)
//   node     law 9: the laws, old and new, on node:sqlite, 8 threads, one file
//   file     law 10: after stopping, the .sqlite is a plain file, the `acl` table included
//   machine  the host, counter, call and answer machines' laws (94's and 95's; unchanged)
//   counter  94's counter test (96's run): RUNS (small,small,small,large)
//   latency  95's no-fault round trips: the answerer in a container, then on the Mac
//   agents   95's agents-across-hosts test, stub agents: AGENT_RUNS (small,small,small,large)
// KILLS (5); the counter's and the agents' own switches are in ./97-one-ledger/counter-run.ts and
// ./97-one-ledger/agents-run.ts. Results: results/97-one-ledger.json.
//
// Node at the edge, as 93 to 96: processes in their own groups, signals, `ps` and `docker`
// (./97-one-ledger/harness.ts). Everything the harness starts that is not Miniflare runs on Effect.
import {spawn} from "node:child_process";
import {existsSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
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
import {checkCounter, checkHost} from "./94-tea-host/laws.ts";
import {checkAnswerer, checkCalls} from "./95-agents-across-hosts/laws.ts";
import {
	fresh,
	law11AppendAny,
	law11RepeatedId,
	law12PrefixFence,
	law14Reads,
} from "./96-ledger-mailbox/laws.ts";
import * as agents from "./97-one-ledger/agents-run.ts";
import {fetchPost, httpClient, type LedgerClient} from "./97-one-ledger/client.ts";
import * as counter from "./97-one-ledger/counter-run.ts";
import {
	freePort,
	GRACE_MS,
	here,
	killGroup,
	pct,
	r1,
	results,
	save,
	sleep,
	startDaemon,
	stopGroup,
	tempDir,
	until,
} from "./97-one-ledger/harness.ts";
import {
	law16Guard,
	law17Inbox,
	law18Reply,
	newLaws,
	type OldClient,
	oldClient,
} from "./97-one-ledger/laws.ts";
import {nodePool, plantedClient} from "./97-one-ledger/node-ledger.ts";
import {Ledger, type Row as LedgerRow, ledgerLayer} from "./97-one-ledger/service.ts";
import {PLANTED, type Planted, type Row as SqlRow} from "./97-one-ledger/sql.ts";
import {meter, tail} from "./97-one-ledger/tail.ts";
import {ledgerOptions} from "./97-one-ledger/worker.ts";

const RACER = here("93-ledger/racer.ts");
const LAW_LEDGER = "acme-app";
const ALL = "laws,plants,kill,hosts,node,file,machine,counter,latency,agents";
const only = new Set((process.env.ONLY ?? ALL).split(","));
const KILLS = Number(process.env.KILLS ?? "5");
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");
const AGENT_RUNS = (process.env.AGENT_RUNS ?? "small,small,small,large").split(",");

const printLaws = (title: string, laws: readonly LawResult[]) => {
	console.log(`\n## ${title}`);
	for (const l of laws) console.log(`${l.pass ? "PASS" : "FAIL"}  ${l.law}\n      ${l.numbers}`);
};
const clientFor = (url: string, ledger = LAW_LEDGER): LedgerClient =>
	httpClient(fetchPost(url), ledger);

/** An old law that met `denied` stops with an error (see `oldClient`): it counts as failed. */
const failedBy =
	(law: string) =>
	(e: unknown): LawResult[] => [
		{law, pass: false, numbers: `stopped: ${e instanceof Error ? e.message : String(e)}`},
	];
const one = (law: string, run: () => Promise<LawResult>): Promise<LawResult[]> =>
	run().then((l) => [l], failedBy(law));
const many = (law: string, run: () => Promise<LawResult[]>): Promise<LawResult[]> =>
	run().catch(failedBy(law));

/** 93's laws 1-6 on this ledger, unchanged: law 4 needs the Durable Object's alarm. */
const laws93 = async (c: OldClient, alarm: boolean): Promise<LawResult[]> => [
	...(await one("1", () => law1Claims(c))),
	...(await many("2", () => law2Appends(c))),
	...(await one("3", () => law3Fencing(c))),
	...(alarm ? await many("4", () => law4Expiry(c, GRACE_MS)) : []),
	...(await one("5", () => law5Stop(c))),
	...(await one("6", () => law6View(c))),
];
/** 96's laws on this ledger, unchanged, so each runs as 96 wrote it. */
const laws96 = async (c: OldClient): Promise<LawResult[]> => [
	...(await one("11a", () => law11AppendAny(c))),
	...(await one("11b", () => law11RepeatedId(c))),
	...(await one("12", () => law12PrefixFence(c))),
	...(await one("14", () => law14Reads(c))),
];

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

/** 15 (96's, in its harness). Wake-ups reach exactly the watchers of the stream written, or of a prefix it sits under. */
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
	const old = await laws93(oldClient(c), true);
	printLaws("93's laws 1-6 on the one ledger, Miniflare in this process", old);
	const of96 = [...(await laws96(oldClient(c))), await law15Wakes(url, c)];
	printLaws("96's laws 11, 12, 14, 15 on the one ledger", of96);
	const neu = await newLaws(c);
	printLaws("New laws 16-18, Miniflare in this process", neu);
	const latency = await tailLatency(url, c);
	console.log(`tail latency: ${JSON.stringify(latency)}`);
	await mf.dispose();
	rmSync(dir, {recursive: true, force: true});
	results.laws = {of93: old, of96, new: neu, tailLatency: latency};
	save();
}

// ---------------------------------------------------------------- planted mistakes

/** Which laws each planted mistake must break; every one is run, and the ones it breaks recorded. */
async function plants() {
	const out: {planted: Planted; failed: string[]; caught: boolean; numbers: string[]}[] = [];
	for (const planted of Object.keys(PLANTED) as Planted[]) {
		const dir = tempDir("plant");
		const {client: c, close} = plantedClient(join(dir, "ledger.sqlite"), planted, GRACE_MS);
		const ran = [
			...(await laws96(oldClient(c))).filter((l) => l.law.startsWith("12")),
			await law16Guard(c),
			await law17Inbox(c),
			await law18Reply(c),
		];
		close();
		rmSync(dir, {recursive: true, force: true});
		const failed = ran.filter((l) => !l.pass);
		out.push({
			planted,
			failed: failed.map((l) => l.law.split(".")[0] ?? l.law),
			caught: failed.length > 0,
			numbers: failed.map((l) => `${l.law.split(".")[0]}: ${l.numbers}`),
		});
		console.log(
			`${failed.length > 0 ? "caught" : "MISSED"}  planted "${planted}": fails ${failed.map((l) => l.law.split(".")[0]).join(", ") || "nothing"}`,
		);
	}
	results.plants = out;
	save();
}

// ---------------------------------------------------------------- laws 7, 11c, 13: SIGKILL

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

const word = (r: {ok: boolean; why?: string; dup?: boolean}) =>
	r.ok ? (r.dup ? "dup" : "ok") : String(r.why);

/**
 * 96's laws 7, 11c and 13, as 96 ran them, and then the guard across the same kills: a name
 * claimed before the first kill stays claimed after the last restart. Its state stream still
 * refuses an unfenced write, its inbox still takes one, and its old fence, now a lost lease, can
 * no longer reply into another inbox. Then the new laws on the restarted child.
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

	// The guard's name, claimed before the kills, with a short lease that runs out among them.
	const G = "l16k-counter";
	const gClaim = await c.claim(G, "g1", 0, 1500);
	const gSaved = gClaim.ok
		? await c.append(`${G}/state`, 0, {kind: "state", writer: "g1"}, gClaim.fence)
		: gClaim;

	for (let k = 0; k < KILLS; k++) {
		const leaseStream = `l7-lease-${k}`;
		const cl = await c.claim(leaseStream, "h", 0, 4000);
		let stop = false;
		const lost: string[] = [];
		const writers = Array.from({length: 8}, async (_, w) => {
			for (let i = 1; !stop; i++) {
				const id = `${k}.${w}.${i}`;
				// oxlint-disable-next-line fabrika/no-raw-try-catch -- law 7 as in 93, on the Promise client; a kill ends a writer.
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
		for (const id of lost) {
			const r = await c.append(STREAM, "any", {kind: "inc", writer: "resend", id});
			resent.push({id, answer: word(r)});
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

	// The guard, after every kill: the name's lease ran out long ago, and nobody has claimed it.
	const other = await c.claim("l16k-asker", "a1", 0, 30_000);
	const guard = {
		claimed: word(gClaim),
		savedUnderFence: word(gSaved),
		unfencedState: word(await c.append(`${G}/state`, 1, {kind: "state", writer: "x"})),
		unfencedName: word(await c.append(G, "any", {kind: "note", writer: "x"})),
		inbox: word(await c.append(`${G}/inbox`, "any", {kind: "m", writer: "s", id: "k1"})),
		oldFenceReply: gClaim.ok
			? word(
					await c.append(
						"l16k-asker/inbox",
						"any",
						{kind: "reply", writer: "g1", id: "r1"},
						gClaim.fence,
					),
				)
			: "no claim",
		claimInside: word(await c.claim(`${G}/state`, "x", 1, 30_000)),
		otherClaimed: word(other),
	};
	const afterKills = await newLaws(c);
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
	const law16k: LawResult = {
		law: `16k. a name claimed before ${KILLS} SIGKILLs is still guarded after them: its state denied, its inbox open, its old fence fenced`,
		pass:
			guard.claimed === "ok" &&
			guard.savedUnderFence === "ok" &&
			guard.unfencedState === "denied" &&
			guard.unfencedName === "denied" &&
			guard.inbox === "ok" &&
			guard.oldFenceReply === "fenced" &&
			guard.claimInside === "denied" &&
			guard.otherClaimed === "ok",
		numbers: Object.entries(guard)
			.map(([k, v]) => `${k} ${v}`)
			.join("; "),
	};
	printLaws("Laws 7, 11c, 13 and the guard: SIGKILL and restart", [law7, law11c, law13, law16k]);
	printLaws("New laws 16-18 on the restarted child Miniflare", afterKills);
	results.kill = {laws: [law7, law11c, law13, law16k], afterKills, rounds, tail: t.meter};
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
	const d = await startDaemon(persist);
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
		...(await laws93(oldClient(c), false)),
		...(await laws96(oldClient(c))),
		...(await newLaws(c)),
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
	const claimed = await c.claim("g", "h", 0, 60_000);
	await mf.dispose();
	const folder = readdirSync(persist).find((f) => f.endsWith("Ledger")) ?? "";
	const db = readdirSync(join(persist, folder)).find(
		(f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
	);
	const raw = new DatabaseSync(join(persist, folder, String(db)), {readOnly: true});
	const n = Number(raw.prepare("SELECT count(*) AS n FROM events WHERE stream = 'f'").get()?.n);
	const ids = Number(raw.prepare("SELECT count(DISTINCT id) AS n FROM events").get()?.n);
	const migrations = Number(raw.prepare("SELECT max(id) AS n FROM migrations").get()?.n);
	const acl = raw
		.prepare("SELECT prefix FROM acl")
		.all()
		.map((r) => String(r.prefix));
	raw.close();
	rmSync(persist, {recursive: true, force: true});
	const law: LawResult = {
		law: "10. after stopping Miniflare, the .sqlite is a plain file (the acl table too)",
		pass: n === 100 && ids === 100 && migrations === 4 && claimed.ok && acl.join(",") === "g",
		numbers: `101 appends through the DO (one a repeated id): ${n} events, ${ids} distinct ids; one claim; migration ${migrations}; acl rows ${JSON.stringify(acl)}; read by node:sqlite read-only`,
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
			takeovers: r.takeovers,
			zombies: r.zombies,
			latency: r.latency,
			hostErrors: r.hostErrors,
		},
		null,
		1,
	);

async function dockerRuns() {
	const prep = agents.prepare();
	console.log(
		`image built in ${prep.buildMs} ms; Linux node_modules installed in ${prep.installMs} ms`,
	);
	try {
		if (only.has("latency")) {
			const container = await agents.runOnce("latency", 1);
			const mac = await agents.runOnce("latency-mac", 2);
			console.log(show(container));
			console.log(show(mac));
			results.latency = {container, mac, prepare: prep};
			save();
		}
		if (only.has("agents")) {
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
				runs,
			);
			console.log(JSON.stringify(results.agentsCompare, null, 1));
			save();
		}
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
		const host = checkHost(Number(process.env.HOST_DEPTH ?? "10"));
		const count = checkCounter(6);
		const calls = checkCalls(Number(process.env.CALL_DEPTH ?? "8"));
		const answerer = checkAnswerer(Number(process.env.ANSWER_DEPTH ?? "6"));
		for (const r of [host, count, calls, answerer]) {
			console.log(`\n## laws: ${r.machine} (${r.states} states, complete: ${r.complete})`);
			for (const law of r.laws)
				console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
			for (const p of r.planted)
				console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
		}
		results.machine = {host, counter: count, calls, answerer};
		save();
	},
	counter: counterRuns,
};
for (const name of ["laws", "plants", "kill", "hosts", "node", "file", "machine", "counter"]) {
	if (!only.has(name)) continue;
	await sections[name]?.();
}
if (only.has("latency") || only.has("agents")) await dockerRuns();
