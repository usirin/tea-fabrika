// Experiment 171: can the app host run the ledger as the local stage of the same Alchemy stack the
// cloud deploys, instead of our own Miniflare twin? See 171-alchemy-local-twin.md.
//
//   env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u TYPESAFE_API_KEY ... \
//     nice -n 15 node experiments/171-alchemy-local-twin.ts [part ...]
//
// Parts: bytes, tree, supervise, timing, tests (default: all, in that order). Each starts its own
// children in a fresh temp folder, stops them, checks none is left, and saves its answer to
// experiments/results/171-alchemy-local-twin.json with every path scrubbed. No deploy, no
// Cloudflare credential, no key: the run refuses to start with one in the environment.
//
// The children: `171-alchemy-local-twin/twin.ts` (Alchemy's local stage, from code), today's
// twin (`packages/fabrika/src/host/daemon.ts`, Miniflare), `parent.ts` (a stand-in app host),
// `client.ts` (fabrika's HTTP client through the local door), `bytes.ts` and `inproc.ts`.
// Node at the edge, all of it: this is a harness of processes, ps and lsof.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "171-alchemy-local-twin");
const repo = dirname(here);
const resultsFile = join(here, "results", "171-alchemy-local-twin.json");
const requireHere = createRequire(join(dir, "package.json"));
const ELECTRON: string = requireHere("electron");

const FORBIDDEN = [
	"CLOUDFLARE_API_TOKEN",
	"CLOUDFLARE_ACCOUNT_ID",
	"CF_API_TOKEN",
	"CF_ACCOUNT_ID",
	"TYPESAFE_API_KEY",
	"OPENAI_API_KEY",
	"CODEX_API_KEY",
	"LEDGER_GITHUB_TOKEN",
];
const present = FORBIDDEN.filter((k) => process.env[k] !== undefined);
if (present.length > 0) throw new Error(`unset these first: ${present.join(", ")}`);

const work = mkdtempSync(join(tmpdir(), "tf171-"));
const scrub = (s: string) =>
	s
		.split(`/private${work}`)
		.join("<tmp>")
		.split(work)
		.join("<tmp>")
		.split(repo)
		.join("<repo>")
		.split(process.env.HOME ?? "~nohome~")
		.join("~");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

// ---------------------------------------------------------------- processes, from outside

type Proc = {pid: number; ppid: number; pgid: number; rssMb: number; stat: string; name: string};
const ps = (): Proc[] =>
	execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,rss=,stat=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({
			pid: Number(m[1]),
			ppid: Number(m[2]),
			pgid: Number(m[3]),
			rssMb: Math.round(Number(m[4]) / 102.4) / 10,
			stat: m[5] ?? "",
			name: nameOf(m[6] ?? ""),
		}));
/** A short name: workerd, esbuild, node, Electron, or `<defunct>`. */
const nameOf = (comm: string) => {
	const c = comm.trim();
	if (c.includes("defunct")) return "<defunct>";
	const base = c.slice(c.lastIndexOf("/") + 1);
	return base;
};
/** Every process under `root`, by parent, and every process in a group one of them leads. */
const treeOf = (root: number): Proc[] => {
	const all = ps();
	const out = new Map<number, Proc>();
	const walk = (pid: number) => {
		for (const p of all)
			if (p.ppid === pid && !out.has(p.pid)) {
				out.set(p.pid, p);
				walk(p.pid);
			}
	};
	const self = all.find((p) => p.pid === root);
	if (self) out.set(root, self);
	walk(root);
	const groups = new Set([...out.values()].map((p) => p.pgid));
	for (const p of all) if (groups.has(p.pgid) && p.pgid !== process.pid) out.set(p.pid, p);
	return [...out.values()];
};
/** What a tree looks like, with pids as roles: [{name, depth, ownGroup, rssMb}]. */
const shapeOf = (root: number) => {
	const t = treeOf(root);
	const depth = (p: Proc): number => {
		let d = 0;
		let at = p;
		for (;;) {
			if (at.pid === root) return d;
			const up = t.find((q) => q.pid === at.ppid);
			if (up === undefined) return -1;
			d++;
			at = up;
		}
	};
	const rootGroup = t.find((p) => p.pid === root)?.pgid;
	return t
		.map((p) => ({
			name: p.name,
			depth: depth(p),
			group: p.pgid === rootGroup ? "root's" : p.pgid === p.pid ? "leads its own" : "another",
			rssMb: p.rssMb,
			stat: p.stat,
		}))
		.sort((a, b) => a.depth - b.depth);
};
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
/** Remote ends of every socket the given processes hold, by lsof. */
const remotes = (pids: number[]) => {
	if (pids.length === 0) return [];
	try {
		const out = execFileSync("lsof", ["-nP", "-a", "-i", "-p", pids.join(",")], {encoding: "utf8"});
		return [
			...new Set(
				out
					.split("\n")
					.filter((l) => l.includes("->"))
					.map((l) => (l.split("->")[1] ?? "").split(" ")[0]?.replace(/:\d+$/, ":<port>") ?? ""),
			),
		];
	} catch {
		return [];
	}
};

/** Every process this run started, so the end can show each one is gone. */
const started = new Set<number>();
const groupsStarted = new Set<number>();

type Ready = {ready: string; ms: number; importMs: number; pid: number; net: string[]};
type Started = {child: ChildProcess; lines: unknown[]; err: string[]; ready: Promise<Ready>};
/** A child's ready line (its own JSON), read field by field. */
const readyOf = (j: Record<string, unknown>, key: string): Ready => ({
	ready: String(j[key]),
	ms: Number(j.ms),
	importMs: Number(j.importMs),
	pid: Number(j.pid),
	net: Array.isArray(j.net) ? j.net.map(String) : [],
});

const childEnv = (extra: Record<string, string>) => {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env))
		if (v !== undefined && !FORBIDDEN.includes(k)) env[k] = v;
	return {...env, ...extra};
};

/** Start a child that prints JSON lines; `ready` is the first line that has `key`. */
const start = (
	cmd: string,
	args: string[],
	env: Record<string, string>,
	key: string,
	o: {detached?: boolean; cwd?: string} = {},
): Started => {
	const child = spawn("nice", ["-n", "15", cmd, ...args], {
		env: childEnv(env),
		cwd: o.cwd ?? dir,
		stdio: ["ignore", "pipe", "pipe"],
		detached: o.detached ?? true,
	});
	if (child.pid !== undefined) {
		started.add(child.pid);
		if (o.detached ?? true) groupsStarted.add(child.pid);
	}
	const lines: unknown[] = [];
	const err: string[] = [];
	let resolve: (r: Ready) => void = () => undefined;
	let reject: (e: Error) => void = () => undefined;
	const ready = new Promise<Ready>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	let buf = "";
	child.stdout?.on("data", (b: Buffer) => {
		buf += b.toString();
		for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
			const line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			try {
				const j = JSON.parse(line) as Record<string, unknown>;
				lines.push(j);
				if (key in j) resolve(readyOf(j, key));
			} catch {
				/* a log line */
			}
		}
	});
	child.stderr?.on("data", (b: Buffer) => err.push(b.toString()));
	child.on("exit", (code) =>
		reject(new Error(`exited ${code} before ready: ${scrub(err.join("").slice(-1500))}`)),
	);
	const timer = setTimeout(
		() => reject(new Error(`no ready in 60 s: ${scrub(err.join("").slice(-1500))}`)),
		60_000,
	);
	ready.finally(() => clearTimeout(timer)).catch(() => undefined);
	return {child, lines, err, ready};
};

/** Stop a group the way local.ts does: SIGTERM to the group, SIGKILL after 3 s. */
const stopGroup = async (pgid: number) => {
	try {
		process.kill(-pgid, "SIGTERM");
	} catch {
		return;
	}
	for (let i = 0; i < 30; i++) {
		if (ps().every((p) => p.pgid !== pgid)) return;
		await sleep(100);
	}
	try {
		process.kill(-pgid, "SIGKILL");
	} catch {
		/* gone */
	}
};

const secret = `fabrika_l_${randomBytes(16).toString("hex")}`;
let nextPort = 18700 + Math.floor(Math.random() * 200);
const portOf = () => nextPort++;

type TwinRun = {
	runtime: "node" | "electron";
	from: "source" | "bundle";
	home: string;
	port: number;
	extra?: Record<string, string>;
	parent?: boolean;
};
const exec = (r: {runtime: "node" | "electron"}) =>
	r.runtime === "node" ? process.execPath : ELECTRON;
const runtimeEnv = (r: {runtime: "node" | "electron"}): Record<string, string> =>
	r.runtime === "electron" ? {ELECTRON_RUN_AS_NODE: "1"} : {};
const twinScript = (from: "source" | "bundle") =>
	from === "source" ? join(dir, "twin.ts") : join(dir, "dist", "twin.mjs");

const startTwin = (r: TwinRun) =>
	start(
		exec(r),
		["--no-warnings", twinScript(r.from)],
		{
			...runtimeEnv(r),
			TWIN_HOME: r.home,
			TWIN_PORT: String(r.port),
			TWIN_SECRET: secret,
			...(r.from === "bundle" ? {TWIN_MAIN: join(work, "worker", "durable-object.js")} : {}),
			...r.extra,
		},
		"ready",
	);

/** Today's twin: packages/fabrika's daemon.ts (Miniflare), as local.ts starts it. */
const startToday = (r: {
	runtime: "node" | "electron";
	from: "source" | "bundle";
	home: string;
	port: number;
}) =>
	start(
		exec(r),
		[
			"--no-warnings",
			r.from === "source"
				? join(repo, "packages", "fabrika", "src", "host", "daemon.ts")
				: join(dir, "dist", "daemon.mjs"),
		],
		{
			...runtimeEnv(r),
			PERSIST: join(r.home, "do"),
			PORT: String(r.port),
			GRACE_MS: "1000",
			DOOR_PERSON: "owner",
			DOOR_SECRET: secret,
		},
		"ready",
	);

const client = (url: string, ...args: string[]) =>
	JSON.parse(
		execFileSync(process.execPath, ["--no-warnings", join(dir, "client.ts"), ...args], {
			env: childEnv({CLIENT_URL: url, TWIN_SECRET: secret}),
			encoding: "utf8",
			cwd: dir,
		}),
	) as Record<string, unknown>;

/** The folder's files, as relative names (no contents), scrubbed. */
const listing = (root: string, depth = 6): string[] => {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (d: string, n: number) => {
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			const s = statSync(p);
			out.push(`${relative(root, p)}${s.isDirectory() ? "/" : ` (${s.size} B)`}`);
			if (s.isDirectory() && n > 0) walk(p, n - 1);
		}
	};
	walk(root, depth);
	return out.sort();
};

const save = (part: string, entry: unknown) => {
	const all: Record<string, unknown> = existsSync(resultsFile)
		? JSON.parse(readFileSync(resultsFile, "utf8"))
		: {};
	all[part] = JSON.parse(scrub(JSON.stringify(entry)));
	writeFileSync(resultsFile, `${JSON.stringify(all, null, "\t")}\n`);
	console.log(`saved ${part}`);
};

const newHome = (name: string) => {
	const h = join(work, name);
	mkdirSync(h, {recursive: true});
	return h;
};

/** The SHA-256 of the module workerd was handed, from Alchemy's own config dump. */
const dumpedModules = (dumpDir: string) => {
	if (!existsSync(dumpDir)) return [];
	const found: {name: string; bytes: number; sha256: string}[] = [];
	const visit = (v: unknown) => {
		if (Array.isArray(v)) v.forEach(visit);
		else if (v !== null && typeof v === "object") {
			const o = v as Record<string, unknown>;
			const text = o.esModule ?? o.commonJsModule;
			if (
				typeof o.name === "string" &&
				typeof text === "string" &&
				o.name.startsWith("durable-object")
			)
				found.push({
					name: o.name,
					bytes: Buffer.byteLength(text),
					sha256:
						execFileSync("shasum", ["-a", "256"], {input: text, encoding: "utf8"}).split(" ")[0] ??
						"",
				});
			for (const x of Object.values(o)) visit(x);
		}
	};
	for (const f of readdirSync(dumpDir)) visit(JSON.parse(readFileSync(join(dumpDir, f), "utf8")));
	return found;
};

// ---------------------------------------------------------------- the parts

const parts: Record<string, () => Promise<void>> = {};

// Question 5: the same bytes as a deploy? Alchemy's bundler, called its two ways (bytes.ts).
parts.bytes = async () => {
	mkdirSync(join(work, "worker"), {recursive: true});
	const out = execFileSync(process.execPath, ["--no-warnings", join(dir, "bytes.ts")], {
		env: childEnv({BYTES_OUT: join(work, "worker")}),
		encoding: "utf8",
		cwd: dir,
	});
	save("bytes", JSON.parse(out.trim().split("\n").at(-1) ?? "{}"));
};

const ensureWorker = () => {
	if (!existsSync(join(work, "worker", "durable-object.js"))) return parts.bytes?.();
	return Promise.resolve();
};

// Questions 1 and 2: it answers, on what, made of which processes, talking to whom.
parts.tree = async () => {
	await ensureWorker();
	const result: Record<string, unknown> = {};
	for (const main of ["source", "prebuilt"] as const) {
		const home = newHome(`tree-${main}`);
		const port = portOf();
		const t = startTwin({
			runtime: "node",
			from: "source",
			home,
			port,
			extra: {
				WORKERD_DUMP_CONFIG: join(home, "dump"),
				...(main === "prebuilt" ? {TWIN_MAIN: join(work, "worker", "durable-object.js")} : {}),
			},
		});
		const ready = await t.ready;
		await sleep(1500);
		const shape = shapeOf(t.child.pid ?? 0);
		const tree = treeOf(t.child.pid ?? 0);
		const wrote = client(ready.ready, "write", "5");
		const read = client(ready.ready, "read");
		// An unknown path, with no credential: the door's refusal.
		const refused = await fetch(`${ready.ready}/exp171/readLast`, {method: "POST", body: "[]"});
		process.kill(ready.pid, "SIGUSR2");
		await sleep(300);
		const net = (t.lines.at(-1) as {net?: string[]})?.net ?? [];
		const sockets = remotes(tree.map((p) => p.pid));
		const modules = dumpedModules(join(home, "dump"));
		const files = listing(join(home, ".alchemy"));
		await stopGroup(t.child.pid ?? 0);
		await sleep(500);
		result[main] = {
			url: ready.ready.replace(String(port), "<port>"),
			samePort: ready.ready.endsWith(`:${port}`),
			readyMs: ready.ms,
			importMs: ready.importMs,
			shape,
			wrote,
			read,
			noCredential: refused.status,
			net,
			childSockets: sockets,
			workerdGot: modules,
			alchemyFolder: files.filter((f) => !f.startsWith("log/")),
			left: tree.filter((p) => alive(p.pid)).map((p) => p.name),
		};
		console.log(main, JSON.stringify(result[main]).slice(0, 400));
	}
	// packages/ledger-server's stack as it is: the shared door, no local person.
	{
		const home = newHome("tree-server");
		const t = startTwin({
			runtime: "node",
			from: "source",
			home,
			port: 0,
			extra: {TWIN_STACK: "server", WORKERD_DUMP_CONFIG: join(home, "dump")},
		});
		const ready = await t.ready;
		const tree = treeOf(t.child.pid ?? 0);
		const res = await fetch(`${ready.ready}/acme/who`, {method: "POST", body: "[]"});
		// The Worker's own bindings: the service in workerd's config that holds `LEDGER`.
		const bindings: string[] = [];
		const dump = join(home, "dump");
		for (const f of existsSync(dump) ? readdirSync(dump) : []) {
			const j = JSON.parse(readFileSync(join(dump, f), "utf8")) as {
				services?: {worker?: {bindings?: {name: string}[]}}[];
			};
			for (const s of j.services ?? []) {
				const names = (s.worker?.bindings ?? []).map((b) => b.name);
				if (names.includes("LEDGER")) bindings.push(...names);
			}
		}
		process.kill(ready.pid, "SIGUSR2");
		await sleep(300);
		const net = (t.lines.at(-1) as {net?: string[]})?.net ?? [];
		const sockets = remotes(tree.map((p) => p.pid));
		await stopGroup(t.child.pid ?? 0);
		result.server = {
			readyMs: ready.ms,
			defaultPort: new URL(ready.ready).port,
			noCredentialStatus: res.status,
			bindings: [...new Set(bindings)].sort(),
			net,
			childSockets: sockets,
		};
		console.log("server", JSON.stringify(result.server).slice(0, 400));
	}
	save("tree", result);
};

/** Wait until every pid is gone, or `ms` passes. Answers the names still alive. */
const goneWithin = async (procs: Proc[], ms: number) => {
	const t = now();
	while (now() - t < ms) {
		if (procs.every((p) => !alive(p.pid))) break;
		await sleep(100);
	}
	return {ms: Math.round(now() - t), left: procs.filter((p) => alive(p.pid)).map((p) => p.name)};
};
const workerdMb = (root: number) =>
	treeOf(root)
		.filter((p) => p.name === "workerd")
		.reduce((a, p) => a + p.rssMb, 0);

// Question 3: can our code supervise it? Question 6: does the data survive?
parts.supervise = async () => {
	await ensureWorker();
	const r: Record<string, unknown> = {};
	const home = newHome("supervise");
	const port = portOf();
	const run: TwinRun = {runtime: "node", from: "source", home, port};
	let t = startTwin(run);
	let ready = await t.ready;
	const url = ready.ready;
	client(url, "write", "10");
	const before = client(url, "read");
	r.first = {readyMs: ready.ms, workerdMb: workerdMb(t.child.pid ?? 0), facts: before};

	// A graceful restart: SIGTERM to the group, then start again on the same home and port.
	{
		const procs = treeOf(t.child.pid ?? 0);
		const t0 = now();
		await stopGroup(t.child.pid ?? 0);
		const stopped = await goneWithin(procs, 5000);
		t = startTwin(run);
		ready = await t.ready;
		r.stopStart = {
			stopMs: stopped.ms,
			left: stopped.left,
			restartMs: Math.round(now() - t0),
			sameUrl: ready.ready === url,
			facts: client(url, "read"),
		};
	}
	// A crash of the twin's Node alone (SIGKILL): is workerd left serving?
	{
		const procs = treeOf(t.child.pid ?? 0);
		client(url, "write", "5");
		const facts = client(url, "read");
		process.kill(ready.pid, "SIGKILL");
		const after = await goneWithin(procs, 3000);
		const answers = await fetch(`${url}/exp171/readLast`, {method: "POST", body: "[]"}).then(
			(x) => x.status,
			() => 0,
		);
		const orphan = procs
			.filter((p) => alive(p.pid))
			.map((p) => ({
				name: p.name,
				ppid: ps().find((q) => q.pid === p.pid)?.ppid === 1 ? "launchd (1)" : "other",
			}));
		// What local.ts does on a crash: SIGKILL the whole group.
		try {
			process.kill(-(t.child.pid ?? 0), "SIGKILL");
		} catch {
			/* gone */
		}
		const afterGroupKill = await goneWithin(procs, 3000);
		const t0 = now();
		t = startTwin(run);
		ready = await t.ready;
		r.crash = {
			leftAfterNodeKilled: after.left,
			orphans: orphan,
			stillAnswering: answers,
			leftAfterGroupKill: afterGroupKill.left,
			restartMs: Math.round(now() - t0),
			sameUrl: ready.ready === url,
			factsBefore: facts,
			factsAfter: client(url, "read"),
		};
	}
	// workerd alone dies, its Node lives: does Alchemy start it again behind the same URL? Then the
	// memory cap needs no restart of Node: past the cap, end workerd and let Alchemy bring it back.
	/** Until the door itself answers (401 with no credential); what else came back meanwhile. */
	const untilAnswer = async (ms: number) => {
		const t0 = now();
		const seen = new Set<number>();
		while (now() - t0 < ms) {
			const s = await fetch(`${url}/exp171/readLast`, {
				method: "POST",
				body: "[]",
				signal: AbortSignal.timeout(500),
			}).then(
				(x) => x.status,
				() => 0,
			);
			seen.add(s);
			if (s === 401) return {status: s, ms: Math.round(now() - t0), meanwhile: [...seen]};
			await sleep(20);
		}
		return {status: 0, ms: null, meanwhile: [...seen]};
	};
	await untilAnswer(5000);
	for (const signal of ["SIGKILL", "SIGTERM"] as const) {
		const w = treeOf(t.child.pid ?? 0).find((p) => p.name === "workerd");
		const mb = w?.rssMb ?? 0;
		if (w !== undefined) process.kill(w.pid, signal);
		await sleep(50);
		const back = await untilAnswer(10_000);
		await sleep(300);
		r[`workerd_${signal}`] = {
			workerdMbBefore: mb,
			nodeAlive: alive(ready.pid),
			newWorkerd: treeOf(t.child.pid ?? 0).some((p) => p.name === "workerd" && p.pid !== w?.pid),
			answersAgainMs: back.ms,
			meanwhile: back.meanwhile,
			workerdMbAfter: workerdMb(t.child.pid ?? 0),
			oldGone: w === undefined ? null : !alive(w.pid),
			facts: client(url, "read"),
		};
	}
	// The other way, as today's local.ts does it: restart the whole group past the cap.
	{
		const cap = 1;
		const mb = workerdMb(t.child.pid ?? 0);
		const t0 = now();
		if (mb > cap) {
			await stopGroup(t.child.pid ?? 0);
			t = startTwin(run);
			ready = await t.ready;
		}
		const back = await untilAnswer(5000);
		r.capGroupRestart = {
			capMb: cap,
			workerdMb: mb,
			restarted: mb > cap,
			restartMs: Math.round(now() - t0),
			firstAnswerAfterReadyMs: back.ms,
			sameUrl: ready.ready === url,
			facts: client(url, "read"),
		};
	}
	r.alchemyFolder = listing(join(home, ".alchemy")).filter(
		(f) => !f.startsWith("log/") && !f.startsWith("local/cache"),
	);
	await stopGroup(t.child.pid ?? 0);

	// The parent dies (SIGKILL), as an app host can. Without and with our one-line guard.
	for (const guard of ["off", "on"] as const) {
		const h = newHome(`parent-${guard}`);
		const p = start(
			process.execPath,
			["--no-warnings", join(dir, "parent.ts")],
			{
				PARENT_RUN: `${process.execPath} --no-warnings ${join(dir, "twin.ts")}`,
				PARENT_GROUP: "1",
				TWIN_HOME: h,
				TWIN_PORT: String(portOf()),
				TWIN_SECRET: secret,
				TWIN_MAIN: join(work, "worker", "durable-object.js"),
				TWIN_GUARD: guard === "on" ? "1" : "0",
			},
			"ready",
		);
		const rd = await p.ready;
		groupsStarted.add(rd.pid);
		started.add(rd.pid);
		await sleep(500);
		const procs = treeOf(rd.pid);
		process.kill(p.child.pid ?? 0, "SIGKILL");
		const after = await goneWithin(procs, 3000);
		const answers = await fetch(`${rd.ready}/exp171/readLast`, {method: "POST", body: "[]"}).then(
			(x) => x.status,
			() => 0,
		);
		r[`parentKilled_guard_${guard}`] = {
			tree: procs.map((q) => q.name),
			leftAfter3s: after.left,
			goneMs: after.left.length === 0 ? after.ms : null,
			stillAnswering: answers,
		};
		await stopGroup(rd.pid);
	}
	save("supervise", r);
	console.log(JSON.stringify(r, null, 1).slice(0, 3000));
};

// The two twins as the app would carry them: one esbuild bundle each, with the options
// apps/fabrika/bundles.ts gives `dist/host.mjs`. What will not go into a bundle stays a package
// beside it (`external`), and the answer says which and why.
const REQUIRE =
	'import {createRequire as bannerRequire} from "node:module"; const require = bannerRequire(import.meta.url);';
const buildBundles = async () => {
	const esbuild: typeof import("esbuild") = requireHere("esbuild");
	const out: Record<string, unknown> = {};
	for (const [name, entry, external] of [
		// Alchemy inlined whole failed at start: it imports rolldown, workerd and Vite at its top
		// level once bundled (the write-up has the steps). So Alchemy stays a package beside the
		// bundle, as Miniflare does for today's daemon, and Effect with it: one copy of Effect for
		// both, or Alchemy's services and ours would not match.
		[
			"twin",
			join(dir, "twin.ts"),
			["alchemy", "alchemy/*", "@alchemy.run/*", "effect", "effect/*", "@effect/*"],
		],
		// Miniflare reads its own worker scripts and the workerd binary by path; esbuild is native.
		[
			"daemon",
			join(repo, "packages", "fabrika", "src", "host", "daemon.ts"),
			["miniflare", "esbuild"],
		],
	] as const) {
		const t = now();
		try {
			const r = await esbuild.build({
				entryPoints: [entry],
				outfile: join(dir, "dist", `${name}.mjs`),
				bundle: true,
				platform: "node",
				format: "esm",
				target: "node24",
				banner: {js: REQUIRE},
				external: [...external],
				logLevel: "silent",
				legalComments: "none",
				metafile: true,
			});
			out[name] = {
				ms: Math.round(now() - t),
				mb: Math.round(statSync(join(dir, "dist", `${name}.mjs`)).size / 1e5) / 10,
				external,
				inputs: Object.keys(r.metafile.inputs).length,
			};
		} catch (e) {
			out[name] = {failed: String(e).slice(0, 1500)};
		}
	}
	// Today's daemon finds the Worker beside itself (`beside`: dist/durable-object.mjs) and bundles
	// it again with esbuild when it starts. So a bundled daemon needs that file: the Worker,
	// bundled once, as worker-options.ts bundles it.
	await esbuild.build({
		entryPoints: [join(repo, "packages", "fabrika", "src", "host", "durable-object.ts")],
		outfile: join(dir, "dist", "durable-object.mjs"),
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2023",
		external: ["cloudflare:*"],
		logLevel: "silent",
	});
	await esbuild.stop();
	return out;
};

/** One start: from spawn to ready, then memory after an idle second, then stop. */
const once = async (
	which: "alchemy" | "today",
	r: {runtime: "node" | "electron"; from: "source" | "bundle"; home: string; port: number},
) => {
	const t0 = now();
	const t = which === "alchemy" ? startTwin(r) : startToday(r);
	const ready = await t.ready;
	const readyMs = Math.round(now() - t0);
	// First answer through the door, as the host's first call.
	const url = ready.ready;
	const answered = await fetch(`${url}/exp171/readLast`, {method: "POST", body: "[]"}).then(
		(x) => x.status,
	);
	const firstAnswerMs = Math.round(now() - t0);
	await sleep(1500);
	const tree = treeOf(t.child.pid ?? 0);
	const ping = client(url, "ping", "200");
	const row = {
		readyMs,
		firstAnswerMs,
		answered,
		groupMb: Math.round(tree.reduce((a, p) => a + p.rssMb, 0)),
		byProcess: tree.map((p) => `${p.name} ${Math.round(p.rssMb)}`),
		ping,
	};
	await stopGroup(t.child.pid ?? 0);
	await goneWithin(tree, 5000);
	return row;
};

// Question 4: start time and memory, cold and warm, Node and Electron as Node, source and bundle.
parts.timing = async () => {
	await ensureWorker();
	const built = await buildBundles();
	const rows: Record<string, unknown>[] = [];
	const rounds = Number(process.env.EXP_ROUNDS ?? "3");
	for (const runtime of ["node", "electron"] as const)
		for (const from of ["source", "bundle"] as const)
			for (const which of ["alchemy", "today"] as const)
				for (let i = 1; i <= rounds; i++) {
					// Cold: a fresh home, nothing deployed, no data. Warm: the same home again.
					const home = newHome(`timing-${runtime}-${from}-${which}-${i}`);
					const port = portOf();
					for (const kind of ["cold", "warm"] as const) {
						try {
							const row = await once(which, {runtime, from, home, port});
							rows.push({twin: which, runtime, from, kind, round: i, ...row});
							console.log(which, runtime, from, kind, i, JSON.stringify(row).slice(0, 220));
						} catch (e) {
							rows.push({
								twin: which,
								runtime,
								from,
								kind,
								round: i,
								failed: scrub(String(e)).slice(0, 800),
							});
							console.log(which, runtime, from, kind, i, "FAILED", scrub(String(e)).slice(0, 400));
						}
					}
				}
	save("timing", {built, rows});
};

// Question 7: what a test pays, in one process that loads either once (inproc.ts).
parts.tests = async () => {
	await ensureWorker();
	const home = newHome("inproc");
	const before = ps().filter((p) => p.name === "workerd" || p.name === "esbuild").length;
	const t = now();
	const out = execFileSync(process.execPath, ["--no-warnings", join(dir, "inproc.ts")], {
		env: childEnv({
			INPROC_HOME: home,
			INPROC_WORKER: join(work, "worker", "durable-object.js"),
			ALCHEMY_HOME: join(home, "alchemy-home"),
			DO_NOT_TRACK: "1",
		}),
		encoding: "utf8",
		cwd: dir,
	});
	const wallMs = Math.round(now() - t);
	await sleep(500);
	const after = ps().filter((p) => p.name === "workerd" || p.name === "esbuild").length;
	save("tests", {
		...(JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as object),
		processWallMs: wallMs,
		workerdOrEsbuildLeft: after - before,
	});
};

const main = async () => {
	const wanted = process.argv.slice(2);
	const order = ["bytes", "tree", "supervise", "timing", "tests"];
	for (const p of wanted.length > 0 ? wanted : order) {
		const run = parts[p];
		if (run === undefined) throw new Error(`no part ${p}: ${Object.keys(parts).join(", ")}`);
		console.log(`--- ${p}`);
		await run();
	}
};

try {
	await main();
} finally {
	// Leave nothing behind: every group this run started, then every pid, checked.
	for (const g of groupsStarted) await stopGroup(g);
	await sleep(300);
	const left = [...started].filter(alive);
	const leftInGroups = ps().filter((p) => groupsStarted.has(p.pgid));
	console.log(
		JSON.stringify({
			startedPids: started.size,
			aliveAtEnd: left.length,
			inOurGroups: leftInGroups.map((p) => p.name),
		}),
	);
	if (process.env.EXP_KEEP !== "1") rmSync(work, {recursive: true, force: true});
}
