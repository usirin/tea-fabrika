// Experiment 94: the first tea-host test. Three hosts (separate Node processes) share one local
// ledger (experiment 93's Durable Object in Miniflare, on workerd's direct socket, in its own
// process group). A `counter` tea program, registered as `counter:1`, runs on exactly one host
// at a time: the one holding the lease on `registry/counter:1`. Two senders send increments as
// inbox appends, each with a message id. The owner is SIGKILLed mid-stream (its whole process
// group), then SIGSTOPped past its lease and woken after another host took over (a zombie),
// then SIGSTOPped once more with every other host and woken alone, before anyone could claim
// (only the fence can refuse that one). Does the count end exactly right, every id once, with
// every late write of a zombie refused?
//
// ONLY=laws|runs (comma list; default both). RUNS: a comma list of `small` (1,000 increments,
// 2 kills, 25 sends a second per sender) and `large` (10,000, 3 kills, 150 a second), each with
// both zombies; default `small,small,small,large`. TTL_MS (1000), RENEW_MS (250), STOP_MS (how
// long the zombie sleeps, 2500), RESTART_MS (a killed host's replacement starts this long
// after, 300), CAP_MB (workerd's memory cap, 500), DUP_RATE (sends whose answer a sender
// pretends to lose, 0.02), HOST_DEPTH (the host machine's law depth, 10), KEEP_LOGS (a folder
// for every host's event lines), SAVE_AS (the results key, `runs`). No key, no model, no network beyond 127.0.0.1. Results:
// results/94-tea-host-counter.json.
//
// Node at the edge, as experiment 93's harness: this script starts processes in their own
// process groups and signals whole groups (SIGKILL, SIGSTOP, SIGCONT), and reads their memory
// with ps. Everything it starts runs on Effect (./94-tea-host/).
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {applyCell} from "@demlik/tea";
import {type Count, type CounterMsg, counter, ZERO} from "./94-tea-host/counter.ts";
import {checkCounter, checkHost} from "./94-tea-host/laws.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/94-tea-host-counter.json");
const DAEMON = here("94-tea-host/daemon.ts");
const HOST = here("94-tea-host/host.ts");
const SENDER = here("94-tea-host/sender.ts");
const ATTACH = here("94-tea-host/attach.ts");
const LEDGER = "tea-host";
const NAME = "counter:1";
const REGISTRY = `registry/${NAME}`;
const INBOX = `${NAME}/inbox`;

const only = new Set((process.env.ONLY ?? "laws,runs").split(","));
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");
const TTL_MS = Number(process.env.TTL_MS ?? "1000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "250");
const STOP_MS = Number(process.env.STOP_MS ?? "2500");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const CAP_MB = Number(process.env.CAP_MB ?? "500");
const DUP_RATE = process.env.DUP_RATE ?? "0.02";
/** A folder to keep every host's event lines in, one file a host a run; none by default. */
const KEEP_LOGS = process.env.KEEP_LOGS;
/** Where in the results file these runs go: `runs`, or another key for a side run (CAP_MB=100). */
const SAVE_AS = process.env.SAVE_AS ?? "runs";
const GRACE_MS = 1000;

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
/** A child's stderr, kept short and with no file paths: the results file is public. */
const firstLines = (text: string) =>
	text
		.split("\n")
		.filter((l) => !/^\s+at /.test(l))
		.join("\n")
		.replace(/(file:\/\/)?\/[^\s:)]+/g, "<path>")
		.slice(0, 600);

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
	try {
		process.kill(-pgid, sig);
	} catch {
		// the group is already gone
	}
};
const killGroup = async (pgid: number) => {
	signal(pgid, "SIGKILL");
	for (let i = 0; i < 100 && group(pgid).length > 0; i++) await sleep(20);
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

// ---------------------------------------------------------------- the ledger daemon

type Daemon = {c: Child; url: string};
const startDaemon = async (persist: string, port: number): Promise<Daemon> => {
	const c = child(DAEMON, {PERSIST: persist, PORT: String(port), GRACE_MS: String(GRACE_MS)});
	await until("the ledger", () => c.lines.length > 0, 30_000);
	return {c, url: String(c.lines[0]?.ready)};
};

type Row = {
	pos: number;
	stream: string;
	rev: number;
	writer: string;
	kind: string;
	at: number;
	data: string;
};
type Lease = {holder: string; expires_at: number; fence: number};
const call = async <T>(url: string, method: string, args: unknown[]): Promise<T> => {
	for (let i = 0; ; i++) {
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

// ---------------------------------------------------------------- one run

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

async function runOnce(preset: keyof typeof PRESETS, index: number) {
	const {n, kills, rate} = PRESETS[preset];
	const dir = mkdtempSync(join(tmpdir(), "exp94-"));
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

	// The memory cap: workerd is restarted when it passes CAP_MB (the decided daemon rule).
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

	// Three hosts. A killed one is replaced by a fresh process under a new name.
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

	// The faults, spread over the expected send time: the kills, then the zombie.
	const faults: Fault[] = [];
	// "alone": a zombie that wakes while every other host is still frozen, so nobody has claimed
	// since its lease ran out. Only the fence can refuse it then: the rev it names is still the end.
	const plan = [
		...Array.from({length: kills}, () => "kill" as const),
		"zombie" as const,
		"alone" as const,
	];
	for (const [i, kind] of plan.entries()) {
		// A fault every 3.5 s, each one over before the next: a frozen zombie must not be frozen
		// again by the next fault. The rates keep the senders going past the last one.
		const due = runStart + FIRST_FAULT_MS + i * FAULT_EVERY_MS;
		await sleep(Math.max(0, due - Date.now()));
		// Fault the owner only once its program has run for a moment: a fault mid-takeover is
		// another test.
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
			// Wake it past its lease's end, inside the ledger's grace before `lease_expired`.
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

	// Drain: wait until the last saved count covers every distinct id in the inbox.
	let settled = false;
	for (let i = 0; i < 600 && !settled; i++) {
		const inbox = await call<Row[]>(daemon.url, "readStream", [INBOX]);
		const ids = new Set(inbox.map((r) => parse<{id: string}>(r.data).id));
		const reg = await call<Row[]>(daemon.url, "readStream", [REGISTRY]);
		const last = reg.findLast((r) => r.kind === "state");
		settled = last !== undefined && parse<StateData>(last.data).state.count === ids.size;
		if (!settled) await sleep(100);
	}
	const drainedAt = Date.now();
	await attach("at the end");

	// Memory at the end, before anything is stopped.
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

	if (KEEP_LOGS !== undefined)
		for (const [name, h] of hosts)
			writeFileSync(
				join(KEEP_LOGS, `${preset}-${index}-${name}.jsonl`),
				h.lines.map((l) => JSON.stringify(l)).join("\n"),
			);
	const check = judge({
		rows,
		n,
		hosts,
		dead,
		faults,
		stopAt,
		aliveAtEnd,
		senders: sent.map((s) => s.out ?? {}),
	});
	const senderOut = sent.map((s) => s.out ?? {});
	const attempts = senderOut.flatMap((o) =>
		Array.isArray(o.attempts) ? o.attempts.map(Number) : [],
	);
	const sends = senderOut.flatMap((o) => (Array.isArray(o.sends) ? o.sends.map(Number) : []));
	const result = {
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
			errors: senderOut.reduce((a, o) => a + Number(o.errors ?? 0), 0),
			repeatsInjected: senderOut.reduce((a, o) => a + Number(o.repeats ?? 0), 0),
		},
		sendMs: sendsDoneAt - runStart,
		/** Every fault, the last wake included, came while the senders were still sending. */
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
	return result;
}

// ---------------------------------------------------------------- the checks

function judge(o: {
	rows: Row[];
	n: number;
	hosts: Map<string, Child>;
	dead: Map<string, number>;
	faults: Fault[];
	stopAt: number;
	aliveAtEnd: Set<string>;
	senders: Record<string, unknown>[];
}) {
	const registry = o.rows.filter((r) => r.stream === REGISTRY).sort((a, b) => a.rev - b.rev);
	const inbox = o.rows.filter((r) => r.stream === INBOX).sort((a, b) => a.rev - b.rev);

	// The mailbox, folded from scratch: the first send of each id counts.
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

	// Replay: the real counter's update over the folded mailbox, from zero.
	let replayed: Count = ZERO;
	for (const [id, rev] of [...firstOf.entries()].sort((a, b) => a[1] - b[1])) {
		const msg: CounterMsg = {type: "increment", id, rev};
		[replayed] = applyCell<Count, CounterMsg, never>(counter, replayed, msg);
	}

	// The chain of saved states: each under the fence of the latest claim, the count +1 or +0.
	let fence = 0;
	let prev = 0;
	const applied = new Map<string, number>();
	const breaks: string[] = [];
	let states = 0;
	const incAt: {at: number; fence: number}[] = [];
	for (const r of registry) {
		if (r.kind === "claimed") fence = r.pos;
		if (r.kind !== "state") continue;
		states++;
		const d = parse<StateData>(r.data);
		if (d.fence !== fence)
			breaks.push(`rev ${r.rev}: saved under fence ${d.fence} after claim ${fence}`);
		if (d.state.count === prev + 1) {
			const id = d.state.last ?? "";
			applied.set(id, (applied.get(id) ?? 0) + 1);
			incAt.push({at: r.at, fence: d.fence});
		} else if (d.state.count !== prev)
			breaks.push(`rev ${r.rev}: count ${prev} -> ${d.state.count}`);
		prev = d.state.count;
	}
	const twice = [...applied.entries()].filter(([, k]) => k > 1).map(([id]) => id);
	const notApplied = [...firstOf.keys()].filter((id) => !applied.has(id));
	const lastState = registry.findLast((r) => r.kind === "state");
	const final = lastState === undefined ? ZERO : parse<StateData>(lastState.data).state;

	// What the hosts said: when each believed it owned, and every write it tried.
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
	const accepted = registry.filter((r) => r.kind === "state");
	const overlaps: string[] = [];
	for (const [i, a] of beliefs.entries())
		for (const b of beliefs.slice(i + 1)) {
			if (a.host === b.host) continue;
			const lo = Math.max(a.from, b.from);
			const hi = Math.min(a.to, b.to);
			if (lo >= hi) continue;
			const by = (h: string) =>
				accepted.filter((r) => r.writer === h && r.at >= lo && r.at <= hi).length;
			if (by(a.host) > 0 && by(b.host) > 0)
				overlaps.push(
					`${a.host} and ${b.host} both believed they owned it from ${lo} to ${hi}, and both had writes accepted`,
				);
		}
	const believedTogetherMs = beliefs.reduce(
		(sum, a, i) =>
			sum +
			beliefs
				.slice(i + 1)
				.reduce(
					(s, b) =>
						s +
						(a.host === b.host ? 0 : Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from))),
					0,
				),
		0,
	);

	// The zombie: every write it tried after waking, and when it noticed.
	const zombies = o.faults
		.filter((f) => f.kind !== "kill")
		.map((f) => {
			const ls = notes.get(f.holder) ?? [];
			const cont = f.contAt ?? f.at;
			const late = ls.filter(
				(l) => l.ev === "write" && l.fence === f.fence && Number(l.sentAt) >= f.at,
			);
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
			// Under its old fence: a host that lost may claim again and write under a new one.
			const acceptedAfter = accepted.filter(
				(r) => r.writer === f.holder && r.at >= cont && parse<StateData>(r.data).fence === f.fence,
			).length;
			const claimedAgain = ls.find((l) => l.ev === "claimed" && l.at >= cont);
			const paused = ls.find((l) => l.ev === "paused" && l.at >= cont);
			return {
				kind: f.kind,
				holder: f.holder,
				fence: f.fence,
				sleptMs: cont - f.at,
				lateWrites: late.length,
				lateAccepted: late.filter((l) => l.ok === true).length,
				lateRefused: late.filter((l) => l.ok === false).map((l) => String(l.why)),
				ledgerAcceptedAfterWake: acceptedAfter,
				noticedBy: noticed === undefined ? null : String(noticed.by),
				noticedMs: noticed === undefined ? null : noticed.at - cont,
				programGoneMs: stopped === undefined ? null : stopped.at - cont,
				programGoneHow:
					stopped === undefined
						? null
						: String(stopped.phase === "ended" ? `ended ${String(stopped.how)}` : "stopped"),
				teaErrors: ls
					.filter((l) => l.ev === "tea_error")
					.map((l) => `${String(l.phase)}: ${String(l.error).slice(0, 120)}`),
				/** What its own pause detector said once it woke: how long it was frozen. */
				pauseSeenMs: paused === undefined ? null : Number(paused.ms),
				hostAliveAtEnd: o.aliveAtEnd.has(f.holder),
				claimedAgainLater: claimedAgain !== undefined,
			};
		});

	// Takeover after each fault: the next claim, and the first state saved under it.
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

	const span = incAt.length < 2 ? 0 : ((incAt.at(-1)?.at ?? 0) - (incAt[0]?.at ?? 0)) / 1000;
	const writes = [...notes.values()].flat().filter((l) => l.ev === "write");
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
		stateEvents: states,
		chainBreaks: breaks.slice(0, 10),
		claims: registry.filter((r) => r.kind === "claimed").length,
		leaseExpiredEvents: registry.filter((r) => r.kind === "lease_expired").length,
		writesTried: writes.length,
		writesRefused: writes.filter((l) => l.ok === false).map((l) => `${l.host}: ${String(l.why)}`),
		overlaps,
		believedTogetherMs,
		zombies,
		takeovers,
		countedPerS: span === 0 ? 0 : Math.round(incAt.length / span),
		pass: {
			countExact: final.count === o.n && missing.length === 0 && extra.length === 0,
			everyIdOnce:
				twice.length === 0 &&
				notApplied.length === 0 &&
				applied.size === o.n &&
				breaks.length === 0,
			zombieRefused: zombies.every(
				(z) =>
					z.lateAccepted === 0 &&
					z.ledgerAcceptedAfterWake === 0 &&
					z.noticedBy !== null &&
					z.programGoneMs !== null &&
					z.hostAliveAtEnd,
			),
			noHostCrashed: [...o.hosts.keys()].every((h) => o.dead.has(h) || o.aliveAtEnd.has(h)),
			neverTwoWritingOwners: overlaps.length === 0,
			replayMatches: replayed.count === final.count && replayed.cursor === final.cursor,
		},
	};
}

// ---------------------------------------------------------------- main

if (only.has("laws")) {
	const host = checkHost(Number(process.env.HOST_DEPTH ?? "10"));
	const count = checkCounter(6);
	for (const r of [host, count]) {
		console.log(
			`\n## laws: ${r.machine} (${r.states} states, ${r.ms} ms, complete: ${r.complete})`,
		);
		for (const law of r.laws)
			console.log(`${r.broken[law] === undefined ? "HOLDS" : "BROKEN"}  ${law}`);
		for (const p of r.planted)
			console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"\n${p.path ?? ""}`);
		if (r.unsent.length > 0) console.log(`never sent: ${r.unsent.join(", ")}`);
	}
	results.laws = {host, counter: count};
	save();
}

if (only.has("runs")) {
	const runs: unknown[] = [];
	for (const [i, preset] of RUNS.entries()) {
		if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
		const r = await runOnce(preset, i + 1);
		console.log(
			JSON.stringify(
				{
					preset: r.preset,
					pass: r.pass,
					finalCount: r.finalCount,
					takeovers: r.takeovers,
					zombies: r.zombies,
				},
				null,
				1,
			),
		);
		runs.push(r);
		results[SAVE_AS] = runs;
		save();
	}
}
