// What experiment 97's harness parts share: processes in their own groups, Docker by label, the
// ledger daemon, the results file and small number helpers. Merged from 95's and 96's harnesses
// (../95-agents-across-hosts.ts, ../96-ledger-mailbox.ts), which each had their own copy.
//
// Node at the edge, as in 93 to 96: the harness starts processes in their own process groups and
// signals whole groups (SIGKILL, SIGSTOP, SIGCONT), reads their memory with ps, and runs `docker`.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

export const here = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
export const RESULTS = here("results/97-one-ledger.json");
export const DAEMON = here("97-one-ledger/daemon.ts");
export const GRACE_MS = 1000;
/** The ledger the hosts use (the laws use their own, `acme-app`). */
export const LEDGER = "tea-host";

export const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
export const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const pct = (xs: readonly number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0
		? Number.NaN
		: (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN);
};
export const r1 = (x: number) => Math.round(x * 10) / 10;
const orNull = (x: number) => (Number.isFinite(x) ? x : null);
export const stats = (xs: readonly number[]) => ({
	n: xs.length,
	p50: orNull(pct(xs, 50)),
	p99: orNull(pct(xs, 99)),
	max: xs.length === 0 ? null : Math.max(...xs),
});
export const tempDir = (tag: string) => mkdtempSync(join(tmpdir(), `exp97-${tag}-`));
export const parse = <T>(s: string): T => JSON.parse(s) as T;
/** A child's stderr, kept short and with no file paths: the results file is public. */
export const firstLines = (text: string) =>
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
export const group = (pgid: number) => ps().filter((p) => p.pgid === pgid);
const mbOf = (ps: Proc[]) => r1(ps.reduce((a, p) => a + p.rssKb, 0) / 1024);
export const rssOf = (pgid: number) => {
	const g = group(pgid);
	return {
		workerdMb: mbOf(g.filter((p) => p.comm.includes("workerd"))),
		nodeMb: mbOf(g.filter((p) => !p.comm.includes("workerd"))),
	};
};
export const signal = (pgid: number, sig: NodeJS.Signals) => {
	try {
		process.kill(-pgid, sig);
	} catch {
		// the group is already gone
	}
};
export const killGroup = async (pgid: number) => {
	signal(pgid, "SIGKILL");
	for (let i = 0; i < 100 && group(pgid).length > 0; i++) await sleep(20);
	return group(pgid).length;
};
export const stopGroup = async (pgid: number) => {
	signal(pgid, "SIGCONT");
	signal(pgid, "SIGTERM");
	for (let i = 0; i < 150 && group(pgid).length > 0; i++) await sleep(20);
	if (group(pgid).length > 0) await killGroup(pgid);
};
/** Every group this harness started: killed on exit, whatever happened. */
export const started = new Set<number>();

export const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port"))));
		});
	});

/** A child in its own process group; every JSON line it prints is kept, with the time it came. */
export type Child = {
	proc: ChildProcess;
	pgid: number;
	lines: Record<string, unknown>[];
	err: string[];
	exited: Promise<number | null>;
	spawnedAt: number;
};
export const spawnChild = (
	command: string,
	args: readonly string[],
	env: Record<string, string>,
): Child => {
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
	return {proc, pgid, lines, err, exited, spawnedAt: Date.now()};
};
export const node = (script: string, env: Record<string, string>) =>
	spawnChild(process.execPath, ["--no-warnings", script], env);
export const until = async (what: string, ok: () => boolean, ms: number) => {
	const t0 = Date.now();
	while (!ok()) {
		if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
		await sleep(10);
	}
};

// ---------------------------------------------------------------- the ledger daemon

export type Daemon = {c: Child; url: string; port: number; ms: number};
export const startDaemon = async (persist: string, port?: number): Promise<Daemon> => {
	const p = port ?? (await freePort());
	const t0 = performance.now();
	const c = node(DAEMON, {PERSIST: persist, PORT: String(p), GRACE_MS: String(GRACE_MS)});
	await until("the ledger", () => c.lines.length > 0 || c.err.join("").includes("Error"), 30_000);
	if (c.lines.length === 0) throw new Error(`the ledger did not start: ${c.err.join("")}`);
	return {c, url: String(c.lines[0]?.ready), port: p, ms: performance.now() - t0};
};

/** One ledger call over plain fetch, retried while workerd restarts (94's harness call). */
export const call = async <T>(url: string, method: string, args: unknown[]): Promise<T> => {
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
export type Row = {
	pos: number;
	stream: string;
	rev: number;
	writer: string;
	kind: string;
	at: number;
	data: string;
	id: string | null;
};
export type Lease = {holder: string; expires_at: number; fence: number};
export const readAll = async (url: string): Promise<Row[]> => {
	const all: Row[] = [];
	for (;;) {
		const page = await call<Row[]>(url, "read", [all.at(-1)?.pos ?? 0, 5000]);
		all.push(...page);
		if (page.length < 5000) return all;
	}
};
export const liveLease = async (url: string, stream: string): Promise<Lease | null> => {
	const l = await call<Lease | null>(url, "lease", [stream]);
	return l !== null && l.expires_at > Date.now() ? l : null;
};

// ---------------------------------------------------------------- docker

/** Every container, image and volume this harness makes carries one of these names. */
export const DOCKER = {
	label: "exp97",
	image: "exp97-host:local",
	volume: "exp97-node-modules",
} as const;
export const docker = (args: readonly string[]) =>
	execFileSync("docker", args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
export const dockerQuiet = (args: readonly string[]) => {
	try {
		return docker(args);
	} catch {
		return "";
	}
};
/** Every container this harness made carries the label; nothing else is ever removed. */
export const removeContainers = () => {
	const ids = dockerQuiet(["ps", "-aq", "--filter", `label=${DOCKER.label}`])
		.split("\n")
		.filter(Boolean);
	if (ids.length > 0) dockerQuiet(["rm", "-f", ...ids]);
	return ids.length;
};
let dockerUsed = false;
export const usedDocker = () => {
	dockerUsed = true;
};

process.on("exit", () => {
	for (const pgid of started) signal(pgid, "SIGKILL");
	if (dockerUsed) removeContainers();
});
