// Experiment 172: when the hands die, how long until the window is back, caught up and usable?
// See 172-hands-restart-time.md.
//
//   pnpm --filter @kampus/fabrika-app-old build      # dist/host.mjs, the host the app runs
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 15 node experiments/172-hands-restart-time.ts
//
// Env: PARTS (cold,crash,brain,hop; default all), RUNS (20), SIZES (asks on the ledger for the
// crash part; 10,1000), RUNTIME (node, or electron: the app's own Electron binary as Node, found
// through apps/fabrika's `electron` package, or ELECTRON=<binary>).
//
// Today's hands are the app's host, apps/fabrika/dist/host.mjs, started as the app starts it
// (src/start-host.ts: detached, stdio ignored, stderr to <home>/host/log) on a home of this run's
// own, in a temp folder. The window is played by a JSON Lines client (lib/host-link.ts) that
// does what the app's `attach` (src/attach.ts) and reconnect machine (src/reconnect.ts) do:
// on the link's end, wait the policy's first full-jitter pick, look at the socket, start a host
// when none answers, look again every 50 ms, then say hello. The brain is Miniflare, in two
// stand-in hands (172-hands-restart-time/). No model, no key, no network, $0. Every process
// started is killed by its pid at the end, and the temp folder removed.
//
// Node at the edge, all of it: this is a harness of processes, sockets and ps.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {asRng, backoffDelay} from "@demlik/tea/retry-backoff";
import {Ledger, streams, writerText} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {Effect} from "effect";
import {type Line, type Link, openLink, reach} from "./lib/host-link.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const dir = join(here, "172-hands-restart-time");
const app = join(repo, "apps", "fabrika");
const HOST = join(app, "dist", "host.mjs");
const DAEMON = join(repo, "packages", "fabrika", "src", "host", "daemon.ts");
const resultsFile = join(here, "results", "172-hands-restart-time.json");

const FORBIDDEN = ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"];
const present = FORBIDDEN.filter((k) => process.env[k] !== undefined);
if (present.length > 0) throw new Error(`unset these first: ${present.join(", ")}`);
if (!existsSync(HOST))
	throw new Error("build the app first: pnpm --filter @kampus/fabrika-app-old build");

const RUNS = Number(process.env.RUNS ?? "20");
const PARTS = (process.env.PARTS ?? "cold,crash,brain,hop").split(",");
const SIZES = (process.env.SIZES ?? "10,1000").split(",").map(Number);
/** How long part 4 watches a brain after its hands are killed. */
const WATCH_MS = Number(process.env.WATCH_MS ?? "3000");
const RUNTIME = process.env.RUNTIME === "electron" ? "electron" : "node";
const electron = (): string => {
	if (process.env.ELECTRON !== undefined) return process.env.ELECTRON;
	return createRequire(join(app, "package.json"))("electron") as string;
};
const BINARY = RUNTIME === "electron" ? electron() : process.execPath;
/** The Node version the host runs on: Electron's own, as Node, or this one. */
const HOST_NODE = execFileSync(BINARY, ["-p", "process.version"], {
	env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
	encoding: "utf8",
}).trim();

/** The app's reconnect policy (apps/fabrika/src/reconnect.ts, `POLICY`), copied: nothing imports an app. */
const POLICY = {
	baseMs: 250,
	factor: 2,
	capMs: 30_000,
	maxElapsedMs: 5 * 60_000,
	jitter: "full",
} as const;
/** How often the app's `attach` looks at the socket of a host it started (src/attach.ts). */
const ATTACH_POLL_MS = 50;
/** The link's version (src/link.ts, `PROTOCOL`). */
const PROTOCOL = 1;

// A fixed seed for the jitter picks, so a rerun waits the same: mulberry32.
let seed = 172;
const rng = asRng(() => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = seed;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
});

// ---------------------------------------------------------------- processes, and leaving none

const work = mkdtempSync(join(tmpdir(), "x172-"));
const started = new Set<number>();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const now = () => performance.now();
const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Every process below `pid`, by `ps`. */
const descendants = (pid: number): number[] => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {encoding: "utf8"})
		.trim()
		.split("\n")
		.map((l) => l.trim().split(/\s+/).map(Number));
	const out: number[] = [];
	const look = [pid];
	while (look.length > 0) {
		const p = look.pop();
		for (const [c, pp] of rows) {
			if (pp !== p || c === undefined) continue;
			out.push(c);
			look.push(c);
		}
	}
	return out;
};
const commOf = (pid: number): string => {
	try {
		return execFileSync("ps", ["-o", "comm=", "-p", String(pid)], {encoding: "utf8"}).trim();
	} catch {
		return "";
	}
};

const cleanup = () => {
	for (const pid of started) if (alive(pid)) process.kill(pid, "SIGKILL");
	rmSync(work, {recursive: true, force: true});
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

/** One child, tracked: its exit, and a ready line on stdout if it prints one. */
const child = (
	cmd: string,
	args: string[],
	env: Record<string, string>,
	opts: {quiet?: boolean} = {},
) => {
	const c: ChildProcess = spawn(cmd, args, {
		env: {...process.env, ...env},
		stdio: ["ignore", "pipe", opts.quiet === true ? "ignore" : "inherit"],
	});
	if (c.pid !== undefined) started.add(c.pid);
	const exited = new Promise<number | null>((done) => c.once("exit", (code) => done(code)));
	const ready = new Promise<Record<string, unknown>>((done, fail) => {
		let rest = "";
		c.stdout?.on("data", (chunk: Buffer) => {
			rest += chunk.toString("utf8");
			const nl = rest.indexOf("\n");
			if (nl >= 0) done(JSON.parse(rest.slice(0, nl)) as Record<string, unknown>);
		});
		c.once("exit", () => fail(new Error(`${args.at(-1)} exited before it was ready`)));
	});
	ready.catch(() => {});
	return {proc: c, pid: c.pid ?? -1, exited, ready};
};

const freePort = () =>
	new Promise<number>((done) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => done(typeof a === "object" && a !== null ? a.port : 0));
		});
	});

// ---------------------------------------------------------------- the host, as the app starts it

let homes = 0;
const newHome = () => {
	homes += 1;
	const home = join(work, `h${homes}`);
	mkdirSync(home, {mode: 0o700});
	return {home, sock: join(home, "host", "sock")};
};

/** src/start-host.ts, by hand: the binary as Node on host.mjs, detached, stderr to the host's log. */
const startHost = (home: string) => {
	mkdirSync(join(home, "host"), {recursive: true, mode: 0o700});
	const log = openSync(join(home, "host", "log"), "a", 0o600);
	try {
		const c = spawn(BINARY, [HOST], {
			env: {...process.env, ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: home},
			detached: true,
			stdio: ["ignore", "ignore", log],
		});
		if (c.pid !== undefined) started.add(c.pid);
		// Not let go (`unref`) as the app lets it go: this run waits for its exit.
		const exited = new Promise<number | null>((done) => c.once("exit", (code) => done(code)));
		return {pid: c.pid ?? -1, exited};
	} finally {
		closeSync(log);
	}
};
type Host = ReturnType<typeof startHost>;

/** Say hello on a link just opened; answers once the host's hello is back. */
const hello = async (link: Link) => {
	link.send({type: "hello", version: PROTOCOL});
	await link.until((m) => m.type === "hello", 10_000);
	return link;
};

/** Part 1's look: try to connect every `pollMs` until a host answers the hello. */
const helloWhenUp = async (sock: string, pollMs: number, within = 10_000): Promise<Link> => {
	const end = now() + within;
	for (;;) {
		try {
			return await hello(await openLink(sock));
		} catch (e) {
			if (now() > end) throw e;
			await sleep(pollMs);
		}
	}
};

/** src/attach.ts, by hand: look at the socket; none: start a host, look every 50 ms; then hello. */
const attach = async (
	home: string,
	sock: string,
): Promise<{link: Link; host: Host | null; listening: number}> => {
	let host: Host | null = null;
	if ((await reach(sock)) !== "live") {
		host = startHost(home);
		const end = now() + 10_000;
		while ((await reach(sock)) !== "live") {
			if (now() > end) throw new Error("the host did not listen within 10 s");
			await sleep(ATTACH_POLL_MS);
		}
	}
	// When the socket first took a connection: the host listens before it has read its ledger,
	// and answers the hello only once its server runs (host/run.ts, host/serve.ts).
	const listening = now();
	return {link: await hello(await openLink(sock)), host, listening};
};

const stopHost = async (host: Host) => {
	process.kill(host.pid, "SIGTERM");
	await host.exited;
	started.delete(host.pid);
};

/**
 * The window caught up after a `page`: the desk, the asks read off the ledger (`size` of them, the
 * read done), and a tile's terminal showing tsh's prompt. Answers when the last of those came.
 */
const caughtUp = (link: Link, size: number, from: number) => {
	let desk = false;
	let asks = false;
	const screens = new Map<string, string>();
	return link.until(
		(m: Line) => {
			if (m.type === "to" && m.port === "desk") {
				const msg = m.m as {
					type: string;
					desk?: {at: string};
					now?: {reach: string; asks: unknown[]; later: unknown[]};
				};
				if (msg.type === "desk" && msg.desk?.at === "open") desk = true;
				if (
					msg.type === "asks" &&
					msg.now?.reach === "ok" &&
					msg.now.asks.length + msg.now.later.length === size
				)
					asks = true;
			}
			if (m.type === "to" && typeof m.port === "string" && m.port.startsWith("tile:")) {
				const data = String((m.m as {data?: unknown}).data ?? "");
				screens.set(m.port, (screens.get(m.port) ?? "") + data);
			}
			const prompt = [...screens.values()].some((s) => s.includes("tsh$"));
			return desk && asks && prompt;
		},
		30_000,
		from,
	);
};

/** Write `size` tickets to the home's own ledger, each filed with one open ask, as host.test.ts does. */
const seedLedger = (home: string, size: number) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const owner = writerText({kind: "user", id: "owner"});
			const agent = writerText({kind: "agent", id: "plan", for: "owner"});
			for (let n = 1; n <= size; n += 1) {
				yield* ledger.register(nameOf(n), owner);
				yield* ledger.send(streams(nameOf(n)).inbox, `f${n}`, {
					kind: "filed",
					writer: owner,
					data: {type: "filed", title: `ticket ${n}`, body: ""},
				});
				yield* ledger.send(streams(nameOf(n)).inbox, `a${n}`, {
					kind: "asked",
					writer: agent,
					data: {type: "asked", ask: "a-1", what: "approve the plan?", picks: ["yes", "no"]},
				});
			}
		}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite"), tickMs: 1000}))),
	);

// ---------------------------------------------------------------- numbers

const stats = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const at = (q: number) =>
		s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? Number.NaN;
	const r = (x: number) =>
		Math.abs(x) < 10 ? Math.round(x * 1000) / 1000 : Math.round(x * 10) / 10;
	return {
		n: s.length,
		min: r(s[0] ?? Number.NaN),
		median: r(at(0.5)),
		p95: r(at(0.95)),
		max: r(s.at(-1) ?? Number.NaN),
	};
};
const results: Record<string, unknown> = {
	runtime: RUNTIME,
	node: HOST_NODE,
	runs: RUNS,
	date: new Date().toLocaleDateString("en-CA"),
};
const show = (name: string, xs: readonly number[]) => {
	const s = stats(xs);
	console.log(
		`  ${name.padEnd(44)} median ${String(s.median).padStart(8)} ms   p95 ${String(s.p95).padStart(8)} ms   (min ${s.min}, max ${s.max}, n ${s.n})`,
	);
	return s;
};

// ---------------------------------------------------------------- part 1: host cold start

const cold = async () => {
	console.log(`part 1: host cold start (${RUNTIME}), spawn until the hello is answered`);
	const {home, sock} = newHome();
	await seedLedger(home, 10);
	const ms: number[] = [];
	let first = 0;
	for (let i = 0; i <= RUNS; i += 1) {
		const t0 = now();
		const host = startHost(home);
		const link = await helloWhenUp(sock, 5);
		const t = now() - t0;
		if (i === 0) first = t;
		else ms.push(t);
		link.close();
		await stopHost(host);
	}
	console.log(`  first start on a new home: ${Math.round(first)} ms (not counted)`);
	results.cold = {
		firstOnNewHome: Math.round(first),
		toHello: show("spawn to hello (poll 5 ms)", ms),
	};
};

// ---------------------------------------------------------------- parts 2 and 3: crash, back, caught up

const crash = async (size: number) => {
	console.log(
		`parts 2 and 3: SIGKILL the host with a window attached, ${size} asks on the ledger (${RUNTIME})`,
	);
	const {home, sock} = newHome();
	await seedLedger(home, size);
	let {link, host} = await attach(home, sock);
	if (host === null) throw new Error("a host answered on a fresh home");
	let from = link.got.length;
	link.send({type: "page"});
	await caughtUp(link, size, from);
	const rows: {
		detect: number;
		jitter: number;
		attach: number;
		listen: number;
		caught: number;
		total: number;
		kids: number;
		left: number;
	}[] = [];
	const leftNames = new Set<string>();
	for (let i = 0; i < RUNS; i += 1) {
		const kids = descendants(host.pid);
		const t0 = now();
		process.kill(host.pid, "SIGKILL");
		const tEnd = await link.ended;
		await host.exited;
		started.delete(host.pid);
		// The reconnect machine: `ended` → jitter {attempt: 1} → the timer → attach.
		const jitter = backoffDelay(1, POLICY, rng);
		await sleep(jitter);
		const tTry = now();
		const back = await attach(home, sock);
		const tUp = now();
		if (back.host === null) throw new Error("a host answered after the kill");
		link = back.link;
		host = back.host;
		from = link.got.length;
		link.send({type: "page"});
		await caughtUp(link, size, from);
		const tCaught = now();
		const left = kids.filter(alive);
		for (const k of left) {
			leftNames.add(commOf(k));
			started.add(k);
		}
		rows.push({
			detect: tEnd - t0,
			jitter,
			attach: tUp - tTry,
			listen: back.listening - tTry,
			caught: tCaught - tUp,
			total: tCaught - t0,
			kids: kids.length,
			left: left.length,
		});
	}
	link.close();
	await stopHost(host);
	const out = {
		size,
		killToSocketEnd: show(
			"kill to the window seeing the socket end",
			rows.map((r) => r.detect),
		),
		jitter: show(
			"the app's jitter wait (seeded, 0 to 500 ms)",
			rows.map((r) => r.jitter),
		),
		listen: show(
			"attach: look, start, until the socket takes a connection",
			rows.map((r) => r.listen),
		),
		listenToHello: show(
			"socket taking connections to the hello answered",
			rows.map((r) => r.attach - r.listen),
		),
		attach: show(
			"attach: look, start, look every 50 ms, hello",
			rows.map((r) => r.attach),
		),
		killToHello: show(
			"kill to hello again",
			rows.map((r) => r.detect + r.jitter + r.attach),
		),
		killToHelloNoJitter: show(
			"kill to hello, without the jitter",
			rows.map((r) => r.detect + r.attach),
		),
		caught: show(
			"hello to caught up (desk, asks, prompt)",
			rows.map((r) => r.caught),
		),
		total: show(
			"kill to caught up",
			rows.map((r) => r.total),
		),
		hostChildren: Math.max(...rows.map((r) => r.kids)),
		childrenLeft: rows.reduce((a, r) => a + r.left, 0),
		childrenLeftNames: [...leftNames],
	};
	console.log(`  the host's own child processes, at most: ${out.hostChildren}`);
	console.log(`  children of the killed host still running after: ${out.childrenLeft}`);
	return out;
};

// ---------------------------------------------------------------- part 4: the brain

const fetchOk = async (url: string): Promise<boolean> => {
	try {
		const r = await fetch(url, {signal: AbortSignal.timeout(500)});
		await r.arrayBuffer();
		return true;
	} catch {
		return false;
	}
};

const brain = async () => {
	console.log("part 4: the brain (Miniflare), its cold start, and whether it dies with the hands");
	const shapes = {
		inproc: {file: join(dir, "hands-miniflare.ts"), env: {} as Record<string, string>},
		daemon: {
			file: join(dir, "hands-daemon.ts"),
			env: {DAEMON, DOOR_SECRET: randomBytes(24).toString("hex")},
		},
	};
	const out: Record<string, unknown> = {};
	for (const [name, shape] of Object.entries(shapes)) {
		const coldMs: number[] = [];
		const toDead: number[] = [];
		let survived = 0;
		let answeredAfter = 0;
		const workerds: number[] = [];
		const restartSamePort = {ready: 0, exited: 0, timeout: 0};
		for (let i = 0; i < RUNS; i += 1) {
			const port = await freePort();
			const persist = join(work, `do-${name}-${i}`);
			const t0 = now();
			const hands = child(process.execPath, ["--no-warnings", shape.file], {
				...shape.env,
				PORT: String(port),
				PERSIST: persist,
			});
			const ready = await hands.ready;
			const url = String(ready.ready);
			while (!(await fetchOk(url))) await sleep(5);
			coldMs.push(now() - t0);
			const below = descendants(hands.pid);
			for (const p of below) started.add(p);
			const workerd = below.filter((p) => commOf(p).includes("workerd"));
			workerds.push(workerd.length);
			// The hands crash.
			const tKill = now();
			process.kill(hands.pid, "SIGKILL");
			await hands.exited;
			// Watch for WATCH_MS: when does the brain stop answering and its processes go?
			let dead = Number.NaN;
			while (now() - tKill < WATCH_MS) {
				const up = below.some(alive) || (await fetchOk(url));
				if (!up) {
					dead = now() - tKill;
					break;
				}
				await sleep(25);
			}
			if (Number.isNaN(dead)) {
				survived += 1;
				if (await fetchOk(url)) answeredAfter += 1;
				// The hands come back, as the app would start them, and start their brain on the same
				// port: does it start beside the one left running?
				const again = child(
					process.execPath,
					["--no-warnings", shape.file],
					{...shape.env, PORT: String(port), PERSIST: persist},
					{quiet: true},
				);
				const came = await Promise.race([
					again.ready.then(() => "ready" as const),
					again.exited.then(() => "exited" as const),
					sleep(15_000).then(() => "timeout" as const),
				]);
				restartSamePort[came] += 1;
				const more = descendants(again.pid);
				for (const p of [again.pid, ...more]) if (alive(p)) process.kill(p, "SIGKILL");
				await again.exited;
				for (const p of more) while (alive(p)) await sleep(10);
				started.delete(again.pid);
			} else toDead.push(dead);
			// Ours to stop: whatever is left of it.
			for (const p of below) if (alive(p)) process.kill(p, "SIGKILL");
			for (const p of below) {
				while (alive(p)) await sleep(10);
				started.delete(p);
			}
			started.delete(hands.pid);
		}
		console.log(
			`  ${name}: workerd processes under the hands: ${[...new Set(workerds)].join(", ")}`,
		);
		const coldStats = show(`${name}: spawn to first answer`, coldMs);
		console.log(
			`  ${name}: brain still up ${WATCH_MS} ms after the hands' SIGKILL: ${survived} of ${RUNS}; answering then: ${answeredAfter}`,
		);
		if (survived > 0)
			console.log(
				`  ${name}: new hands, brain on the same port, beside the one left: ${JSON.stringify(restartSamePort)}`,
			);
		out[name] = {
			coldToAnswer: coldStats,
			workerdUnderHands: [...new Set(workerds)],
			survived,
			watchMs: WATCH_MS,
			answeredAfterWatch: answeredAfter,
			restartSamePort,
			killToBrainGone:
				toDead.length > 0 ? show(`${name}: hands' SIGKILL to brain gone`, toDead) : null,
		};
	}
	results.brain = out;
};

// ---------------------------------------------------------------- part 5: the extra hop

const hop = async () => {
	console.log("part 5: one small message there and back");
	const N = 2000;
	// a. Through the real host: a desk key it does not take, and its answer (serve.ts `press`).
	const {home, sock} = newHome();
	await seedLedger(home, 10);
	const {link, host} = await attach(home, sock);
	if (host === null) throw new Error("a host answered on a fresh home");
	link.send({type: "page"});
	await caughtUp(link, 10, 0);
	const viaHost: number[] = [];
	for (let id = 0; id < N; id += 1) {
		const from = link.got.length;
		const t0 = now();
		link.send({type: "on", port: "desk", m: {type: "press", id, key: "x"}});
		await link.until(
			(m) =>
				m.type === "to" &&
				(m.m as {type?: string; id?: number}).type === "answer" &&
				(m.m as {id?: number}).id === id,
			5000,
			from,
		);
		viaHost.push(now() - t0);
	}
	link.close();
	await stopHost(host);
	// b. The hop alone: a JSON Lines echo in another Node process, on a Unix socket.
	const echoSock = join(work, "echo.sock");
	const echoCode = `const s=require("node:net").createServer((c)=>{let r="";c.on("data",(d)=>{r+=d;let i;while((i=r.indexOf("\\n"))>=0){const l=r.slice(0,i);r=r.slice(i+1);c.write(JSON.stringify(JSON.parse(l))+"\\n")}})});s.listen(process.argv[1],()=>process.stdout.write("{}\\n"));`;
	const echo = child(process.execPath, ["-e", echoCode, echoSock], {});
	await echo.ready;
	const e = await openLink(echoSock);
	const viaSocket: number[] = [];
	for (let id = 0; id < N; id += 1) {
		const from = e.got.length;
		const t0 = now();
		e.send({type: "on", port: "desk", m: {type: "press", id, key: "x"}});
		await e.until(() => true, 5000, from);
		viaSocket.push(now() - t0);
	}
	e.close();
	echo.proc.kill("SIGTERM");
	await echo.exited;
	started.delete(echo.pid);
	// c. In the same process: the same message, encoded and decoded, through a function call.
	const call = (line: string) => JSON.stringify(JSON.parse(line));
	const inProcess: number[] = [];
	for (let id = 0; id < N; id += 1) {
		const t0 = now();
		call(JSON.stringify({type: "on", port: "desk", m: {type: "press", id, key: "x"}}));
		inProcess.push(now() - t0);
	}
	results.hop = {
		messages: N,
		viaHost: show("window → host → back (a desk key and its answer)", viaHost),
		viaSocket: show("window → echo process → back (the hop alone)", viaSocket),
		inProcess: show("a function call with JSON both ways", inProcess),
	};
};

// ---------------------------------------------------------------- run

console.log(`experiment 172: the host on ${RUNTIME}, Node ${HOST_NODE}, ${RUNS} runs each`);
if (PARTS.includes("cold")) await cold();
if (PARTS.includes("crash")) {
	const out = [];
	for (const size of SIZES) out.push(await crash(size));
	results.crash = out;
}
if (PARTS.includes("brain")) await brain();
if (PARTS.includes("hop")) await hop();

const leftover = [...started].filter(alive);
results.leftover = leftover.length;
console.log(`processes this run started still running: ${leftover.length}`);
mkdirSync(dirname(resultsFile), {recursive: true});
const key = `${RUNTIME}:${PARTS.join(",")}`;
const all = existsSync(resultsFile)
	? (JSON.parse(readFileSync(resultsFile, "utf8")) as Record<string, unknown>)
	: {};
all[key] = results;
writeFileSync(resultsFile, `${JSON.stringify(all, null, "\t")}\n`);
