// Experiment 95: tea-host's second test. An agent on one host asks an agent on a second host,
// run in a Docker container, through the one shared ledger.
//
//   ledger    experiment 93's Durable Object (95's copy, with `fenceOn`) in Miniflare on the
//             Mac, on workerd's direct socket, in its own process group
//   host A    a Mac process running `asker`, registered as asker:1 by the registry lease
//   host B    a container running `answerer`, registered as answerer:1; it reaches the ledger
//             at host.docker.internal. The repo is mounted read-only; node_modules for Linux
//             come from a named volume.
//
// A question is a call (OTP's gen_server:call): one append to answerer:1/inbox with a message
// id, a correlation id and the reply-to address asker:1/inbox, and a timeout. A late call is
// sent again under the same message id; the answerer answers each id once and replies to a
// repeat with the answer on record. Faults while calls are in flight: the answerer's container
// is killed twice (docker kill) and started again; a second container stands by and takes
// answerer:1 over while the first is frozen (docker pause), and the first is woken after; the
// Mac's host A is killed once (SIGKILL) and started again.
//
// ONLY=laws|latency|runs (comma list; default all). RUNS: comma list of `small` (200 questions)
// and `large` (2,000), default `small,small,small,large`. LATENCY: questions in the no-fault
// latency runs (200). WINDOW (8), TIMEOUT_MS (1500), TTL_MS (1000), RENEW_MS (250), STOP_MS
// (how long the owner is frozen at the takeover, 2500), RESTART_MS (300), KEEP_LOGS (a folder
// for every host's lines), KEEP_IMAGE=1 (leave the image and the volume), SAVE_AS (`runs`).
//
// REAL=1: one run with Claude Code in the container instead of the stub, one fixed question,
// no faults. It needs CLAUDE_CODE_OAUTH_TOKEN set in this shell: the container gets it by name
// (`docker run -e CLAUDE_CODE_OAUTH_TOKEN`), so its value is never on a command line, in a
// file, in the image or in a log here. MODEL (haiku). Results under `real`.
//
// Node at the edge, as 94's harness: process groups, signals, `ps`, and the `docker` command.
// Everything the harness starts runs on Effect (./95-agents-across-hosts/).
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {checkHost} from "./94-tea-host/laws.ts";
import {checkAnswerer, checkCalls} from "./95-agents-across-hosts/laws.ts";
import {questionOf, stubAnswer} from "./95-agents-across-hosts/question.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const REPO = here("..");
const DIR = here("95-agents-across-hosts/");
const RESULTS = here("results/95-agents-across-hosts.json");
const DAEMON = here("95-agents-across-hosts/daemon.ts");
const HOST = here("95-agents-across-hosts/host.ts");
const IN_CONTAINER_HOST = "experiments/95-agents-across-hosts/host.ts";
const IMAGE = "exp95-host:local";
const VOLUME = "exp95-node-modules";
const LABEL = "exp95";
const LEDGER = "tea-host";
const ASKER = "asker:1";
const ANSWERER = "answerer:1";
const S = {
	askerRegistry: `registry/${ASKER}`,
	askerInbox: `${ASKER}/inbox`,
	answererRegistry: `registry/${ANSWERER}`,
	answererInbox: `${ANSWERER}/inbox`,
};

const REAL = process.env.REAL === "1";
const only = new Set((process.env.ONLY ?? "laws,latency,runs").split(","));
const RUNS = (process.env.RUNS ?? "small,small,small,large").split(",");
const LATENCY_N = Number(process.env.LATENCY ?? "200");
const WINDOW = Number(process.env.WINDOW ?? "8");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? "1500");
const TTL_MS = Number(process.env.TTL_MS ?? "1000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "250");
const STOP_MS = Number(process.env.STOP_MS ?? "2500");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const KEEP_LOGS = process.env.KEEP_LOGS;
const KEEP_IMAGE = process.env.KEEP_IMAGE === "1";
const SAVE_AS = process.env.SAVE_AS ?? "runs";
const GRACE_MS = 1000;
const FIRST_FAULT_MS = 1500;
const FAULT_EVERY_MS = 3500;

/** small: 200 questions; large: 2,000. The stub thinks long enough that every fault lands mid-run. */
const PRESETS = {
	small: {n: 200, stubMs: 80},
	large: {n: 2000, stubMs: 6},
} as const;
type Fault = "kill_b" | "takeover" | "kill_a";
const PLAN: readonly Fault[] = ["kill_b", "kill_b", "takeover", "kill_a"];

const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: readonly number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0
		? null
		: (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? null);
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const stats = (xs: readonly number[]) => ({
	n: xs.length,
	p50: pct(xs, 50),
	p99: pct(xs, 99),
	max: xs.length === 0 ? null : Math.max(...xs),
});
/** A child's stderr, short and with no file paths: the results file is public. */
const firstLines = (text: string) =>
	text
		.split("\n")
		.filter((l) => !/^\s+at /.test(l))
		.join("\n")
		.replace(/(file:\/\/)?\/[^\s:)]+/g, "<path>")
		.slice(0, 600);

// ---------------------------------------------------------------- processes and containers

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
const rssMbOf = (pgid: number, pick: (p: Proc) => boolean = () => true) =>
	r1(
		group(pgid)
			.filter(pick)
			.reduce((a, p) => a + p.rssKb, 0) / 1024,
	);
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

const docker = (args: readonly string[]) =>
	execFileSync("docker", args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
const dockerQuiet = (args: readonly string[]) => {
	try {
		return docker(args);
	} catch {
		return "";
	}
};
/** Every container this harness made carries the label; nothing else is ever removed. */
const removeContainers = () => {
	const ids = dockerQuiet(["ps", "-aq", "--filter", `label=${LABEL}`])
		.split("\n")
		.filter(Boolean);
	if (ids.length > 0) dockerQuiet(["rm", "-f", ...ids]);
	return ids.length;
};
process.on("exit", () => {
	for (const pgid of started) signal(pgid, "SIGKILL");
	removeContainers();
});

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port"))));
		});
	});

/** A child in its own process group; every JSON line it prints is kept, with the time it came. */
type Child = {
	proc: ChildProcess;
	pgid: number;
	lines: Record<string, unknown>[];
	err: string[];
	exited: Promise<number | null>;
	spawnedAt: number;
};
const spawnChild = (command: string, args: readonly string[], env: Record<string, string>) => {
	const proc = spawn(command, args, {
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
		for (const p of parts)
			if (p.startsWith("{")) lines.push({...JSON.parse(p), seenAt: Date.now()});
	});
	proc.stderr?.on("data", (d: Buffer) => err.push(d.toString()));
	const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
	return {proc, pgid, lines, err, exited, spawnedAt: Date.now()} satisfies Child;
};
const node = (script: string, env: Record<string, string>) =>
	spawnChild(process.execPath, ["--no-warnings", script], env);
const until = async (what: string, ok: () => boolean, ms: number) => {
	const t0 = Date.now();
	while (!ok()) {
		if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
		await sleep(10);
	}
};

// ---------------------------------------------------------------- the image and the volume

const prepare = () => {
	const t0 = Date.now();
	docker(["build", "-q", "-t", IMAGE, "-f", join(DIR, "Dockerfile"), DIR]);
	const built = Date.now();
	docker([
		"run",
		"--rm",
		"--user",
		"root",
		"--label",
		LABEL,
		"-v",
		`${REPO}:/repo:ro`,
		"-v",
		`${VOLUME}:/ws/node_modules`,
		"--entrypoint",
		"sh",
		IMAGE,
		"/repo/experiments/95-agents-across-hosts/install.sh",
	]);
	return {buildMs: built - t0, installMs: Date.now() - built};
};
const unprepare = () => {
	if (KEEP_IMAGE) return {removed: false};
	removeContainers();
	dockerQuiet(["volume", "rm", VOLUME]);
	dockerQuiet(["image", "rm", IMAGE]);
	return {removed: true};
};

// ---------------------------------------------------------------- the ledger

type Daemon = {c: Child; url: string; port: number};
const startDaemon = async (persist: string): Promise<Daemon> => {
	const port = await freePort();
	const c = node(DAEMON, {PERSIST: persist, PORT: String(port), GRACE_MS: String(GRACE_MS)});
	await until("the ledger", () => c.lines.length > 0, 30_000);
	return {c, url: String(c.lines[0]?.ready), port};
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
const liveLease = async (url: string, stream: string): Promise<Lease | null> => {
	const l = await call<Lease | null>(url, "lease", [stream]);
	return l !== null && l.expires_at > Date.now() ? l : null;
};
const parse = <T>(s: string): T => JSON.parse(s) as T;

// ---------------------------------------------------------------- hosts

/** One host: a container (host B) or a Mac process (host A, or B in the local latency run). */
type Box = {
	base: string;
	where: "container" | "mac";
	container: string | null;
	starts: Child[];
	kills: number[];
};
const hostEnv = (ledgerUrl: string, base: string, extra: Record<string, string>) => ({
	LEDGER_URL: ledgerUrl,
	LEDGER_NAME: LEDGER,
	HOST: base,
	TTL_MS: String(TTL_MS),
	RENEW_MS: String(RENEW_MS),
	...extra,
});

const runContainer = (
	name: string,
	env: Record<string, string>,
	withToken = false,
	rm = false,
): Child => {
	const flags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
	return spawnChild(
		"docker",
		[
			"run",
			"--name",
			name,
			"--init",
			"--label",
			LABEL,
			...(rm ? ["--rm"] : []),
			"--add-host",
			"host.docker.internal:host-gateway",
			"-v",
			`${REPO}:/repo:ro`,
			"-v",
			`${VOLUME}:/repo/node_modules:ro`,
			...flags,
			// The name only: docker reads the value from this process's environment.
			...(withToken ? ["-e", "CLAUDE_CODE_OAUTH_TOKEN"] : []),
			IMAGE,
			IN_CONTAINER_HOST,
		],
		{},
	);
};

/** RSS of the Node processes in a container, and what `docker stats` says the container uses. */
const containerMemory = (name: string) => {
	const vm = dockerQuiet([
		"exec",
		name,
		"sh",
		"-c",
		"for p in /proc/[0-9]*; do awk '/^Name:/{n=$2} /^VmRSS:/{print n, $2}' $p/status 2>/dev/null; done",
	]);
	// Node names its main thread `node-MainThread`; tini (`--init`) and the shell are left out.
	const nodeKb = vm
		.split("\n")
		.filter((l) => l.startsWith("node"))
		.reduce((a, l) => a + Number(l.split(" ")[1] ?? 0), 0);
	const stat = dockerQuiet(["stats", "--no-stream", "--format", "{{.MemUsage}}", name]);
	return {nodeRssMb: r1(nodeKb / 1024), dockerStats: stat.split(" / ")[0] ?? stat};
};

// ---------------------------------------------------------------- one run

type Preset = keyof typeof PRESETS | "latency" | "latency-mac" | "real";
type Done = {at: number; how: string};

async function runOnce(preset: Preset, index: number) {
	const real = preset === "real";
	const faulted = preset === "small" || preset === "large";
	const n = faulted ? PRESETS[preset].n : real ? 1 : LATENCY_N;
	const stubMs = faulted ? PRESETS[preset].stubMs : 0;
	const window = faulted ? WINDOW : 1;
	const timeoutMs = real ? 120_000 : TIMEOUT_MS;
	const dir = mkdtempSync(join(tmpdir(), "exp95-"));
	const daemon = await startDaemon(dir);
	const macUrl = daemon.url;
	const boxUrl = `http://host.docker.internal:${daemon.port}`;
	const log = (s: string) => console.log(`[${preset} ${index}] ${s}`);
	const tag = `exp95-r${index}`;

	const boxes = new Map<string, Box>();
	const bEnv = {
		PROGRAM: "answerer",
		AGENT: real ? "claude" : "stub",
		STUB_MS: String(stubMs),
		...(real ? {MODEL: process.env.MODEL ?? "haiku"} : {}),
	};
	const startB = (base: string): Box => {
		if (preset === "latency-mac") {
			const box: Box = {base, where: "mac", container: null, starts: [], kills: []};
			box.starts.push(node(HOST, hostEnv(macUrl, base, bEnv)));
			boxes.set(base, box);
			return box;
		}
		const name = `${tag}-${base}`;
		const box: Box = {base, where: "container", container: name, starts: [], kills: []};
		box.starts.push(runContainer(name, hostEnv(boxUrl, base, bEnv), real, real));
		boxes.set(base, box);
		return box;
	};
	const restartB = (box: Box) => {
		if (box.container === null) throw new Error("only a container is restarted here");
		box.starts.push(spawnChild("docker", ["start", "-a", box.container], {}));
	};
	const aEnv = {
		PROGRAM: "asker",
		TOTAL: String(n),
		WINDOW: String(window),
		TIMEOUT_MS: String(timeoutMs),
		REAL: real ? "1" : "0",
	};
	const startA = (box: Box) => box.starts.push(node(HOST, hostEnv(macUrl, "a", aEnv)));
	const a: Box = {base: "a", where: "mac", container: null, starts: [], kills: []};
	boxes.set("a", a);
	const lineOf = (box: Box, ev: string, after = 0) =>
		box.starts.flatMap((c) => c.lines).find((l) => l.ev === ev && Number(l.at) >= after);
	const holderBox = (holder: string) => boxes.get(holder.split("@")[0] ?? "");

	// Host B first: its cold start is from `docker run` to owning answerer:1.
	const b1 = startB("b1");
	const bRunAt = b1.starts[0]?.spawnedAt ?? Date.now();
	await until(
		"b1 to own answerer:1",
		() => lineOf(b1, "program") !== undefined,
		real ? 120_000 : 60_000,
	);
	const b1Up = lineOf(b1, "up");
	const b1Claim = lineOf(b1, "claimed");
	const coldStart = {
		upMs: Number(b1Up?.seenAt) - bRunAt,
		owningMs: Number(b1Claim?.at) - bRunAt,
	};
	log(`b1 up ${coldStart.upMs} ms, owning answerer:1 ${coldStart.owningMs} ms after docker run`);
	startA(a);
	const runStart = Date.now();

	const lastAsker = async () => {
		const reg = await call<Row[]>(daemon.url, "readStream", [S.askerRegistry]);
		const last = reg.findLast((r) => r.kind === "state");
		return last === undefined
			? null
			: parse<{state: {answered: number; pending: unknown[]}}>(last.data).state;
	};

	// ------------------------------------------------ faults
	type FaultNote = {
		kind: Fault;
		holder: string;
		fence: number;
		at: number;
		leaseEndsAt: number;
		restartAt?: number;
		contAt?: number;
		standby?: {upMs: number};
		pendingAtFault?: number;
	};
	const faults: FaultNote[] = [];
	const steadyOwner = async (stream: string) => {
		for (let tries = 0; tries < 400; tries++) {
			const lease = await liveLease(daemon.url, stream);
			const box = lease === null ? undefined : holderBox(lease.holder);
			const since = box?.starts
				.flatMap((c) => c.lines)
				.findLast(
					(l) => l.ev === "program" && l.phase === "started" && l.host === lease?.holder,
				)?.at;
			if (
				lease !== null &&
				box !== undefined &&
				typeof since === "number" &&
				Date.now() - since > 300
			)
				return {lease, box};
			await sleep(25);
		}
		throw new Error(`no steady owner of ${stream}`);
	};
	// The lease's end, read once the fault has landed: a renew can land between the read that
	// picked the owner and the fault, and would move the end by one renew period.
	const endOf = async (stream: string, fence: number) => {
		const l = await call<Lease | null>(daemon.url, "lease", [stream]);
		return l !== null && l.fence === fence ? l.expires_at : Number.NaN;
	};
	for (const [i, kind] of (faulted ? PLAN : []).entries()) {
		const due = runStart + FIRST_FAULT_MS + i * FAULT_EVERY_MS;
		await sleep(Math.max(0, due - Date.now()));
		if (kind === "kill_b") {
			const {lease, box} = await steadyOwner(S.answererRegistry);
			const at = Date.now();
			docker(["kill", box.container ?? ""]);
			box.kills.push(at);
			const leaseEndsAt = await endOf(S.answererRegistry, lease.fence);
			log(
				`docker kill ${box.base} (${lease.holder}, fence ${lease.fence}), lease ends in ${leaseEndsAt - at} ms`,
			);
			await sleep(RESTART_MS);
			const restartAt = Date.now();
			restartB(box);
			faults.push({kind, holder: lease.holder, fence: lease.fence, at, leaseEndsAt, restartAt});
		} else if (kind === "takeover") {
			// A second container stands by, then the owner freezes: only one of them may answer.
			const b2 = startB("b2");
			const b2At = b2.starts[0]?.spawnedAt ?? Date.now();
			await until("b2 up", () => lineOf(b2, "up") !== undefined, 60_000);
			const upMs = Number(lineOf(b2, "up")?.seenAt) - b2At;
			const {lease, box} = await steadyOwner(S.answererRegistry);
			const at = Date.now();
			docker(["pause", box.container ?? ""]);
			const leaseEndsAt = await endOf(S.answererRegistry, lease.fence);
			log(
				`b2 up in ${upMs} ms; docker pause ${box.base} (${lease.holder}, fence ${lease.fence}) for ${STOP_MS} ms`,
			);
			await sleep(STOP_MS);
			const contAt = Date.now();
			docker(["unpause", box.container ?? ""]);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt,
				contAt,
				standby: {upMs},
			});
		} else {
			const {lease} = await steadyOwner(S.askerRegistry);
			const pending = (await lastAsker())?.pending.length ?? 0;
			const child = a.starts.at(-1);
			const at = Date.now();
			if (child !== undefined) await killGroup(child.pgid);
			a.kills.push(at);
			const leaseEndsAt = await endOf(S.askerRegistry, lease.fence);
			log(`SIGKILL host A (${lease.holder}, fence ${lease.fence}) with ${pending} calls pending`);
			await sleep(RESTART_MS);
			const restartAt = Date.now();
			startA(a);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt,
				restartAt,
				pendingAtFault: pending,
			});
		}
	}
	const lastFaultAt = Math.max(0, ...faults.map((f) => f.contAt ?? f.restartAt ?? f.at));

	// ------------------------------------------------ drain
	let done: Done | null = null;
	const limit = real ? 300_000 : faulted ? 240_000 : 120_000;
	for (const t0 = Date.now(); Date.now() - t0 < limit;) {
		const s = await lastAsker();
		if (s !== null && s.answered === n && s.pending.length === 0) {
			done = {at: Date.now(), how: "all answered"};
			break;
		}
		await sleep(100);
	}
	if (done === null) done = {at: Date.now(), how: "gave up waiting"};
	log(`${done.how} ${done.at - runStart} ms after the first question`);
	await sleep(faulted ? 1500 : 300); // late duplicate replies land, so the checks see them

	// ------------------------------------------------ memory, then stop everything
	const memory: Record<string, unknown> = {
		ledgerWorkerdMb: rssMbOf(daemon.c.pgid, (p) => p.comm.includes("workerd")),
		ledgerNodeMb: rssMbOf(daemon.c.pgid, (p) => !p.comm.includes("workerd")),
		hostAMb: rssMbOf(a.starts.at(-1)?.pgid ?? -1),
	};
	for (const box of boxes.values())
		if (box.container !== null) memory[box.base] = containerMemory(box.container);
		else if (box.base !== "a")
			memory[box.base] = {nodeRssMb: rssMbOf(box.starts.at(-1)?.pgid ?? -1)};
	const stopAt = Date.now();
	for (const box of boxes.values()) {
		if (box.container !== null) dockerQuiet(["rm", "-f", box.container]);
		for (const c of box.starts) await stopGroup(c.pgid);
	}
	const rows = await readAll(daemon.url);
	await stopGroup(daemon.c.pgid);
	rmSync(dir, {recursive: true, force: true});

	if (KEEP_LOGS !== undefined)
		for (const box of boxes.values())
			writeFileSync(
				join(KEEP_LOGS, `${preset}-${index}-${box.base}.jsonl`),
				box.starts.flatMap((c) => c.lines.map((l) => JSON.stringify(l))).join("\n"),
			);

	const check = judge({rows, n, boxes, faults, stopAt, real});
	return {
		preset,
		n,
		window,
		timeoutMs,
		stubMs,
		ttlMs: TTL_MS,
		answerer: preset === "latency-mac" ? "mac process" : "container",
		coldStart,
		finishedMs: done.at - runStart,
		finished: done.how,
		/** The last fault came while calls were still open. */
		faultsDuringCalls: faults.length === 0 ? null : lastFaultAt < done.at - 500,
		faults,
		...check,
		memory,
		hostErrors: Object.fromEntries(
			[...boxes.values()].flatMap((b) => {
				const err = b.starts.map((c) => c.err.join("")).join("");
				return err.trim() === "" ? [] : [[b.base, firstLines(err)]];
			}),
		),
	};
}

// ---------------------------------------------------------------- the checks

type Line = Record<string, unknown> & {host: string; at: number};

function judge(o: {
	rows: Row[];
	n: number;
	boxes: Map<string, Box>;
	faults: readonly {
		kind: Fault;
		holder: string;
		fence: number;
		at: number;
		leaseEndsAt: number;
		contAt?: number;
	}[];
	stopAt: number;
	real: boolean;
}) {
	const of = (stream: string) =>
		o.rows.filter((r) => r.stream === stream).sort((x, y) => x.rev - y.rev);
	const askerReg = of(S.askerRegistry);
	const answererReg = of(S.answererRegistry);
	const questions = of(S.answererInbox);
	const replies = of(S.askerInbox);
	const lines: Line[] = [...o.boxes.values()].flatMap((b) =>
		b.starts.flatMap((c) => c.lines.map((l) => ({...l, host: String(l.host), at: Number(l.at)}))),
	);
	const byHost = (h: string) => lines.filter((l) => l.host === h);

	// The asker's chain of saved states: each under the latest claim's fence; answered +1 or +0.
	type AskerSaved = {
		fence: number;
		state: {
			answered: number;
			wrong: number;
			extra: number;
			pending: unknown[];
			last: {i: number; answer: string; right: boolean} | null;
		};
	};
	const chain = <T extends {fence: number}>(
		reg: Row[],
		count: (d: T) => number,
		key: (d: T) => string | null,
	) => {
		let fence = 0;
		let prev = 0;
		const once = new Map<string, number>();
		const breaks: string[] = [];
		const steps: {at: number; fence: number; key: string}[] = [];
		for (const r of reg) {
			if (r.kind === "claimed") fence = r.pos;
			if (r.kind !== "state") continue;
			const d = parse<T>(r.data);
			if (d.fence !== fence)
				breaks.push(`rev ${r.rev}: saved under fence ${d.fence} after claim ${fence}`);
			const c = count(d);
			if (c === prev + 1) {
				const k = key(d) ?? "?";
				once.set(k, (once.get(k) ?? 0) + 1);
				steps.push({at: r.at, fence: d.fence, key: k});
			} else if (c !== prev) breaks.push(`rev ${r.rev}: count ${prev} -> ${c}`);
			prev = c;
		}
		return {once, breaks, steps, final: prev};
	};
	const asked = chain<AskerSaved>(
		askerReg,
		(d) => d.state.answered,
		(d) => (d.state.last === null ? null : String(d.state.last.i)),
	);
	const askerStates = askerReg
		.filter((r) => r.kind === "state")
		.map((r) => parse<AskerSaved>(r.data).state);
	const askerFinal = askerStates.at(-1);
	const wrongAnswers = askerStates
		.filter((s, i) => s.answered > (askerStates[i - 1]?.answered ?? 0) && s.last?.right === false)
		.map((s) => s.last);
	// Each answer the asker took, against the question's own expected answer (not the machine's word).
	const rightByHarness = askerStates.filter((s, i) => {
		if (s.answered === (askerStates[i - 1]?.answered ?? 0) || s.last === null) return false;
		const q = questionOf(s.last.i, o.real);
		return Number(/-?\d+/.exec(s.last.answer)?.[0]) === q.expected;
	}).length;
	const askedTwice = [...asked.once.entries()].filter(([, k]) => k > 1).map(([i]) => i);
	const notAnswered = Array.from({length: o.n}, (_, i) => String(i + 1)).filter(
		(i) => !asked.once.has(i),
	);

	// The answerer's chain: an answer produced is a +1 step naming its message id. Each id once.
	type AnswererSaved = {
		fence: number;
		state: {answered: number; repeats: number; last: {id: string; answer: string} | null};
	};
	const produced = chain<AnswererSaved>(
		answererReg,
		(d) => d.state.answered,
		(d) => d.state.last?.id ?? null,
	);
	const producedTwice = [...produced.once.entries()].filter(([, k]) => k > 1).map(([id]) => id);
	const answererStates = answererReg
		.filter((r) => r.kind === "state")
		.map((r) => parse<AnswererSaved>(r.data).state);
	const producedWrong = answererStates.filter((s, i) => {
		if (s.answered === (answererStates[i - 1]?.answered ?? 0) || s.last === null) return false;
		const q = questions.find((r) => parse<{id: string}>(r.data).id === s.last?.id);
		return (
			!o.real && q !== undefined && s.last.answer !== stubAnswer(parse<{text: string}>(q.data).text)
		);
	}).length;
	// The agent asked: one `think` line per agent run. A run cut off by a kill leaves none.
	const thinks = lines.filter((l) => l.ev === "think");
	const thinkCount = new Map<string, number>();
	for (const t of thinks) thinkCount.set(String(t.id), (thinkCount.get(String(t.id)) ?? 0) + 1);
	const thoughtTwice = [...thinkCount.entries()].filter(([, k]) => k > 1).map(([id]) => id);

	// Who may write: the fence of each claim of answerer:1, its holder, and when the next claim came.
	const claimsOf = (reg: Row[]) => {
		const cs = reg
			.filter((r) => r.kind === "claimed")
			.map((r) => ({fence: r.pos, holder: r.writer, at: r.at}));
		return cs.map((c, i) => ({...c, until: cs[i + 1]?.at ?? Number.POSITIVE_INFINITY}));
	};
	const bClaims = claimsOf(answererReg);
	const aClaims = claimsOf(askerReg);
	const fromHolder = (claims: ReturnType<typeof claimsOf>, r: Row) => {
		const d = parse<{fence?: number}>(r.data);
		const c = claims.find((x) => x.fence === d.fence);
		return c !== undefined && c.holder === r.writer && r.at >= c.at && r.at < c.until;
	};
	const repliesNotFromHolder = replies.filter((r) => !fromHolder(bClaims, r));
	const questionsNotFromHolder = questions.filter((r) => !fromHolder(aClaims, r));
	const replyCount = new Map<string, number>();
	for (const r of replies) {
		const id = parse<{id: string}>(r.data).id;
		replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
	}
	const sendCount = new Map<string, number>();
	for (const r of questions) {
		const id = parse<{id: string}>(r.data).id;
		sendCount.set(id, (sendCount.get(id) ?? 0) + 1);
	}

	// The frozen owner, woken after the takeover: nothing it wrote after waking may be accepted.
	const zombies = o.faults
		.filter((f) => f.kind === "takeover")
		.map((f) => {
			const cont = f.contAt ?? f.at;
			const ls = byHost(f.holder);
			const accepted = o.rows.filter((r) => r.writer === f.holder && r.at >= cont).length;
			const refusedWrites = ls
				.filter((l) => l.ev === "write" && l.ok === false && l.at >= cont)
				.map((l) => String(l.why));
			const refusedReplies = ls
				.filter((l) => l.ev === "reply" && l.how !== "sent" && l.at >= cont)
				.map((l) => String(l.how));
			const noticed = ls.find((l) => l.ev === "phase" && l.from === "owning" && l.at >= cont);
			const stopped = ls.find(
				(l) => l.ev === "program" && (l.phase === "stopped" || l.phase === "ended") && l.at >= cont,
			);
			const thoughtAfter = ls.filter((l) => l.ev === "think" && l.at >= cont).length;
			const newOwner = bClaims.find((c) => c.at >= f.at && c.fence > f.fence);
			return {
				holder: f.holder,
				fence: f.fence,
				frozenMs: cont - f.at,
				takenBy: newOwner?.holder ?? null,
				acceptedAfterWake: accepted,
				refusedWrites,
				refusedReplies,
				agentRunsFinishedAfterWake: thoughtAfter,
				noticedBy: noticed === undefined ? null : String(noticed.by),
				noticedMs: noticed === undefined ? null : noticed.at - cont,
				programGoneMs: stopped === undefined ? null : stopped.at - cont,
				stillUpAtEnd:
					ls.some((l) => l.at >= cont) &&
					ls.every((l) => l.ev !== "tea_error" || l.phase !== "fatal"),
			};
		});

	// Two hosts that both believed they owned answerer:1, and both had a write accepted meanwhile.
	const beliefs: {host: string; from: number; to: number}[] = [];
	for (const box of o.boxes.values()) {
		if (box.base === "a") continue;
		const hs = [...new Set(box.starts.flatMap((c) => c.lines.map((l) => String(l.host))))];
		for (const h of hs) {
			let from: number | null = null;
			for (const l of byHost(h)) {
				if (l.ev !== "phase") continue;
				if (l.to === "owning") from = l.at;
				if (l.from === "owning" && from !== null) {
					beliefs.push({host: h, from, to: l.at});
					from = null;
				}
			}
			const lastSeen = Math.max(...byHost(h).map((l) => l.at));
			if (from !== null)
				beliefs.push({
					host: h,
					from,
					to: Math.min(o.stopAt, box.kills.find((k) => k >= (from ?? 0)) ?? lastSeen + 1),
				});
		}
	}
	const bWrites = o.rows.filter(
		(r) => r.stream === S.answererRegistry || r.stream === S.askerInbox,
	);
	const overlaps: string[] = [];
	let believedTogetherMs = 0;
	for (const [i, x] of beliefs.entries())
		for (const y of beliefs.slice(i + 1)) {
			if (x.host === y.host) continue;
			const lo = Math.max(x.from, y.from);
			const hi = Math.min(x.to, y.to);
			if (lo >= hi) continue;
			believedTogetherMs += hi - lo;
			const by = (h: string) =>
				bWrites.filter((r) => r.writer === h && r.kind !== "claimed" && r.at >= lo && r.at <= hi)
					.length;
			if (by(x.host) > 0 && by(y.host) > 0)
				overlaps.push(`${x.host} and ${y.host} from ${lo} to ${hi}`);
		}

	// Takeovers: after each fault, the next claim and the first answer under it.
	const takeovers = o.faults.map((f) => {
		const reg = f.kind === "kill_a" ? askerReg : answererReg;
		const claim = reg.find((r) => r.kind === "claimed" && r.at >= f.at && r.pos > f.fence);
		const resumed =
			claim === undefined
				? undefined
				: reg.find(
						(r) =>
							r.kind === "state" &&
							r.pos > claim.pos &&
							parse<{fence: number}>(r.data).fence === claim.pos,
					);
		const startedLine =
			claim === undefined
				? undefined
				: lines.find(
						(l) =>
							l.host === claim.writer &&
							l.ev === "program" &&
							l.phase === "started" &&
							l.fence === claim.pos,
					);
		return {
			kind: f.kind,
			from: f.holder,
			to: claim?.writer ?? null,
			leaseLeftMs: f.leaseEndsAt - f.at,
			claimMs: claim === undefined ? null : claim.at - f.at,
			claimAfterLeaseEndMs: claim === undefined ? null : claim.at - f.leaseEndsAt,
			firstSaveMs: resumed === undefined ? null : resumed.at - f.at,
			replayMs: startedLine === undefined ? null : Number(startedLine.replayMs),
			backlog: startedLine === undefined ? null : Number(startedLine.backlog),
			pendingAtStart: startedLine === undefined ? null : Number(startedLine.pending ?? Number.NaN),
		};
	});
	const restarts = o.faults
		.filter((f) => f.kind === "kill_b")
		.map((f) => {
			const box = holderBox(o.boxes, f.holder);
			const next = box?.starts.find((c) => c.spawnedAt >= f.at);
			const up = next?.lines.find((l) => l.ev === "up");
			return {
				upAfterDockerStartMs:
					up === undefined || next === undefined ? null : Number(up.seenAt) - next.spawnedAt,
			};
		});

	// Round trips, from host A's own lines: a call's sends and the first reply it heard.
	const sends = lines.filter((l) => l.ev === "send" && String(l.host).startsWith("a@"));
	const heard = lines.filter((l) => l.ev === "heard");
	const firstHeard = new Map<string, number>();
	for (const h of heard) if (!firstHeard.has(String(h.id))) firstHeard.set(String(h.id), h.at);
	const oneSend: number[] = [];
	const whole: number[] = [];
	for (const [id, at] of firstHeard) {
		const i = Number(id.slice(2));
		const mine = sends.filter((s) => s.i === i && Number(s.began) <= at);
		const first = mine.reduce((m, s) => Math.min(m, Number(s.began)), Number.POSITIVE_INFINITY);
		if (Number.isFinite(first)) whole.push(at - first);
		if (mine.length === 1 && sends.filter((s) => s.i === i).length === 1)
			oneSend.push(at - Number(mine[0]?.began));
	}
	const sendMs = sends.filter((s) => s.how === "sent").map((s) => Number(s.at) - Number(s.began));
	const writeMs = (prefix: string) =>
		lines
			.filter((l) => l.ev === "write" && l.ok === true && String(l.host).startsWith(prefix))
			.map((l) => l.at - Number(l.sentAt));

	const usd = thinks.reduce((a, t) => a + Number(t.usd ?? 0), 0);
	return {
		answered: askerFinal?.answered ?? 0,
		answeredRightByHarness: rightByHarness,
		wrongAnswers: wrongAnswers.length,
		askerExtraReplies: askerFinal?.extra ?? 0,
		answeredTwice: askedTwice.length,
		notAnswered: notAnswered.length,
		askerChainBreaks: asked.breaks.slice(0, 10),
		answersProduced: produced.final,
		answersProducedTwice: producedTwice.length,
		answersProducedWrong: producedWrong,
		answererRepeats: answererStates.at(-1)?.repeats ?? 0,
		answererChainBreaks: produced.breaks.slice(0, 10),
		agentRuns: thinks.length,
		agentRunsForAnIdTwice: thoughtTwice,
		sends: {
			questionsInInbox: questions.length,
			distinctIds: sendCount.size,
			retriedIds: [...sendCount.values()].filter((k) => k > 1).length,
		},
		replies: {
			inInbox: replies.length,
			idsRepliedMoreThanOnce: [...replyCount.values()].filter((k) => k > 1).length,
			notFromLeaseHolder: repliesNotFromHolder.length,
		},
		questionsNotFromLeaseHolder: questionsNotFromHolder.length,
		claims: {answerer: bClaims.map((c) => c.holder), asker: aClaims.map((c) => c.holder)},
		leaseExpiredEvents: o.rows.filter((r) => r.kind === "lease_expired").length,
		zombies,
		overlaps,
		believedTogetherMs,
		takeovers,
		restarts,
		latency: {
			roundTripOneSendMs: stats(oneSend),
			callIncludingRetriesMs: stats(whole),
			sendAppendMs: stats(sendMs),
			askerSaveMs: stats(writeMs("a@")),
			answererSaveMs: stats(writeMs("b")),
		},
		agentUsd: Math.round(usd * 10000) / 10000,
		pass: {
			everyQuestionOneRightAnswer:
				(askerFinal?.answered ?? 0) === o.n &&
				askedTwice.length === 0 &&
				notAnswered.length === 0 &&
				rightByHarness === o.n &&
				asked.breaks.length === 0,
			noAnswerProducedTwice:
				producedTwice.length === 0 && produced.breaks.length === 0 && producedWrong === 0,
			repliesOnlyFromLeaseHolder: repliesNotFromHolder.length === 0 && overlaps.length === 0,
			zombieWroteNothing: zombies.every((z) => z.acceptedAfterWake === 0 && z.noticedBy !== null),
		},
	};
}
const holderBox = (boxes: Map<string, Box>, holder: string) =>
	boxes.get(holder.split("@")[0] ?? "");

// ---------------------------------------------------------------- main

const show = (r: Awaited<ReturnType<typeof runOnce>>) =>
	JSON.stringify(
		{
			preset: r.preset,
			finishedMs: r.finishedMs,
			pass: r.pass,
			answered: r.answered,
			faultsDuringCalls: r.faultsDuringCalls,
			takeovers: r.takeovers,
			zombies: r.zombies,
			latency: r.latency,
			memory: r.memory,
			hostErrors: r.hostErrors,
		},
		null,
		1,
	);

if (only.has("laws") && !REAL) {
	const host = checkHost(Number(process.env.HOST_DEPTH ?? "10"));
	const calls = checkCalls(Number(process.env.CALL_DEPTH ?? "8"));
	const answerer = checkAnswerer(Number(process.env.ANSWER_DEPTH ?? "6"));
	for (const r of [calls, answerer, host]) {
		console.log(
			`\n## laws: ${r.machine} (${r.states} states, ${r.ms} ms, complete: ${r.complete})`,
		);
		for (const l of r.laws) console.log(`${r.broken[l] === undefined ? "HOLDS" : "BROKEN"}  ${l}`);
		for (const p of r.planted)
			console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
		if (r.unsent.length > 0) console.log(`never sent: ${r.unsent.join(", ")}`);
	}
	results.laws = {calls, answerer, host};
	save();
}

// Only whether it is set is read here; the value stays in this process's environment.
const tokenSet = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") !== "";
if (REAL && !tokenSet)
	console.log("REAL=1 needs CLAUDE_CODE_OAUTH_TOKEN set in this shell; real mode skipped.");
const needsDocker = REAL ? tokenSet : only.has("latency") || only.has("runs");
if (needsDocker) {
	const before = removeContainers();
	if (before > 0)
		console.log(`removed ${before} containers left by an earlier run of this harness`);
	const prep = prepare();
	console.log(
		`image built in ${prep.buildMs} ms; Linux node_modules installed in ${prep.installMs} ms`,
	);
	try {
		if (REAL) {
			const r = await runOnce("real", 1);
			console.log(show(r));
			results.real = {...r, prepare: prep, at: new Date().toISOString().slice(0, 10)};
			save();
		} else {
			if (only.has("latency")) {
				const container = await runOnce("latency", 1);
				const mac = await runOnce("latency-mac", 2);
				console.log(show(container));
				console.log(show(mac));
				results.latency = {container, mac, prepare: prep};
				save();
			}
			if (only.has("runs")) {
				const runs: unknown[] = [];
				for (const [i, preset] of RUNS.entries()) {
					if (preset !== "small" && preset !== "large") throw new Error(`no run called ${preset}`);
					const r = await runOnce(preset, i + 1);
					console.log(show(r));
					runs.push(r);
					results[SAVE_AS] = runs;
					save();
				}
			}
		}
	} finally {
		const left = removeContainers();
		const un = unprepare();
		console.log(
			`removed ${left} containers; image and volume ${un.removed ? "removed" : "kept (KEEP_IMAGE=1)"}`,
		);
	}
}
