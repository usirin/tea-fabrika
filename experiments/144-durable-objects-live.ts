// Experiment 144: the ledger's real Durable Object on real Cloudflare, measured from a laptop.
// Write-up: 144-durable-objects-live.md. Answers: results/144-durable-objects-live.json.
//
//   node experiments/144-durable-objects-live.ts smoke   a few calls of each part, nothing saved
//   node experiments/144-durable-objects-live.ts full    the measured run, about 25 minutes
//   node experiments/144-durable-objects-live.ts code    after full: the law suite on the deployed
//       object, then part 5 again with a redeploy that changes the code (full's changed only a
//       binding), watching the object itself; adds `code` to the saved answers, about 12 minutes
//   node experiments/144-durable-objects-live.ts switch  after code: the laptop's clock against
//       the Worker's, then when busy objects take a redeploy's new code; adds `switch`, 2 minutes
//   node experiments/144-durable-objects-live.ts clocks  after switch: the object's clock, idle and
//       under the law suite, and the three laws that failed, alone and in the suite, three times
//       each; adds `clocks`, 2 minutes
//
// It needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in its environment, set for this one
// command only, and TYPESAFE_API_KEY unset. It deploys with Alchemy (./144-durable-objects-live/),
// measures the seven parts, destroys in a `finally`, then lists the account's Workers and Durable
// Object namespaces to show that nothing of the run is left.
//
// The run's key is 32 random bytes made here. It lives only in this process's memory and in the
// two writer processes' memory (sent on their stdin). The Worker holds only its SHA-256. Nothing
// this script prints or saves holds the key, the Worker's address or the account.
//
//   node experiments/144-durable-objects-live.ts writer <who> <ledger> <seconds> <per second>
//       One of part 5's two writers (the base URL comes on stdin). It writes through the repo's
//       own HTTP client, `layerHttp`, and prints one JSON line when its time is up.
//
// Node at the edge, as 93 to 98: child processes (Alchemy's CLI, the writers), fetch, Node's
// global WebSocket, the clock and the files. The writers and part 1's second half go through
// `@kampus/fabrika-old` and Effect.
import {spawn} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {type Inbox, inboxOf, Ledger, type NewEvent} from "@kampus/fabrika-old";
import {layerHttp} from "@kampus/fabrika-old/http";
import {law3Fencing, law12PrefixFence, law18Reply, runLaws} from "@kampus/fabrika-old/laws";
import {Duration, Effect, Result} from "effect";

const DIR = fileURLToPath(new URL("./144-durable-objects-live/", import.meta.url));
const OUT = fileURLToPath(new URL("./results/144-durable-objects-live.json", import.meta.url));
const STAGE = "exp144";
const WORKER = "tf-exp-144-ledger";
/** Every request this process sends counts here; past the cap the run stops. */
const CAP = 100_000;

// ---------------------------------------------------------------- the two plans

const FULL = {
	n: 300,
	warm: 10,
	cold: [5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300],
	coldPer: (s: number): number => (s >= 150 ? 3 : 2),
	two: 300,
	twoSolo: 100,
	bell: 300,
	bellGapMs: 200,
	sleepy: 10,
	sleepyIdleMs: 12_000,
	soakS: 600,
	soakRate: 5,
	redeployAtS: 300,
	hints: [
		"none",
		"wnam",
		"enam",
		"sam",
		"weur",
		"eeur",
		"apac",
		"apac-ne",
		"apac-se",
		"oc",
		"afr",
		"me",
	],
	place: 20,
	gh: 50,
};
type Plan = typeof FULL;
type Mode = "smoke" | "full" | "code" | "switch" | "clocks";
const SMOKE: Plan = {
	...FULL,
	n: 10,
	warm: 2,
	cold: [5, 15],
	coldPer: () => 1,
	two: 5,
	twoSolo: 3,
	bell: 5,
	sleepy: 1,
	soakS: 90,
	soakRate: 2,
	redeployAtS: 30,
	hints: ["none", "weur"],
	place: 2,
	gh: 2,
};

/**
 * Requests a plan sends before any retry, as [Worker, object]: the cost estimate's input. A ping
 * and a GitHub call touch no object; a part 3 call touches two.
 */
const estimate = (p: Plan, mode: Mode) => {
	const cold = 2 * p.cold.reduce((a, s) => a + p.coldPer(s), 0);
	const client = 1 + 2 * (p.warm + p.n);
	// Half the writes are compare-and-set: a read, then the append.
	const writes = 1.5 * 2 * p.soakS * p.soakRate;
	const hints = p.hints.length * (p.place + 1) + 1;
	// The code run looks at the soak's object every 2 s too: one more call to it each time.
	const looks = mode === "code" ? p.soakS / 2 : 0;
	const soak: [number, number] = [9 + writes + p.soakS / 2 + looks, 9 + writes + looks];
	// The switch run: writes for about 45 s, at most 20 a second, a ping a second for about 80 s.
	const switched: [number, number] = [20 + 45 * 20 + 80, 20 + 45 * 20];
	const parts: Record<string, [number, number]> =
		mode === "code"
			? // The law suite's calls are not counted one by one: 1,000 is a guess, on the high side.
				{laws: [1000, 1000], soak}
			: mode === "switch"
				? {clock: [20, 0], switch: switched}
				: mode === "clocks"
					? // Three whole suites, nine laws alone (guessed as above), a reading every 250 ms.
						{clocks: [3 * 1000 + 9 * 40 + 20 + 3 * 60, 3 * 1000 + 9 * 40 + 20 + 3 * 60]}
					: {
							latency: [3 * p.n + 2 * p.warm + 1 + client, 2 * p.n + p.warm + 1 + client],
							two: [28 + 2 * p.two + 2 * p.twoSolo, 33 + 4 * p.two + 2 * p.twoSolo],
							place: [hints, hints],
							github: [p.gh, 0],
							bell: [3 + p.bell + p.sleepy, 3 + p.bell + p.sleepy],
							cold: [cold, cold],
							soak,
						};
	const worker = Math.round(Object.values(parts).reduce((a, [w]) => a + w, 0));
	const object = Math.round(Object.values(parts).reduce((a, [, o]) => a + o, 0));
	// Workers Paid: 10M Worker requests and 1M object requests a month are included; past that,
	// $0.30 and $0.15 a million (developers.cloudflare.com/workers/platform/pricing/).
	const dollarsIfNothingIncluded = r1(((worker * 0.3 + object * 0.15) / 1e6) * 1e4) / 1e4;
	return {parts, worker, object, dollarsIfNothingIncluded};
};

// ---------------------------------------------------------------- small tools

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const now = () => performance.now();
const r1 = (x: number) => Math.round(x * 10) / 10;
const tag = () => randomBytes(3).toString("hex");

const stats = (xs: readonly number[]) => {
	const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	const at = (p: number) =>
		s.length === 0 ? null : r1(s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] ?? 0);
	return {
		n: s.length,
		p50: at(50),
		p95: at(95),
		p99: at(99),
		min: s.length ? r1(s[0] ?? 0) : null,
		max: s.length ? r1(s[s.length - 1] ?? 0) : null,
	};
};

const tally = (xs: readonly string[]) => {
	const out: Record<string, number> = {};
	for (const x of xs) out[x] = (out[x] ?? 0) + 1;
	return out;
};

const field = (o: unknown, key: string): unknown =>
	typeof o === "object" && o !== null ? Reflect.get(o, key) : undefined;
const num = (o: unknown, key: string): number => {
	const v = field(o, key);
	return typeof v === "number" ? v : Number.NaN;
};

// ---------------------------------------------------------------- the door

type Door = {base: string; key: string; ws: string};
let spent = 0;

type Hit = {
	status: number;
	ms: number;
	worker: number;
	colo: string;
	edge: string;
	round: string;
	/** The build that answered (`x-code`); "?" before the code run added it. */
	code: string;
	json: unknown;
};

/** One request through the Worker, timed on the laptop. Status 0: it never got an answer. */
const hit = async (d: Door, path: string, body?: unknown): Promise<Hit> => {
	spent += 1;
	if (spent > CAP) throw new Error(`the request cap (${CAP}) is reached`);
	const t = now();
	try {
		const res = await fetch(
			`${d.base}/${d.key}${path}`,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: {"content-type": "application/json"},
						body: JSON.stringify(body),
					},
		);
		const text = await res.text();
		const ms = now() - t;
		let json: unknown = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
		return {
			status: res.status,
			ms,
			worker: Number(res.headers.get("x-worker-ms") ?? Number.NaN),
			colo: res.headers.get("x-colo") ?? "?",
			// cf-ray ends in the colo of the edge that answered the laptop.
			edge: (res.headers.get("cf-ray") ?? "").split("-")[1] ?? "?",
			round: res.headers.get("x-round") ?? "?",
			code: res.headers.get("x-code") ?? "?",
			json,
		};
	} catch {
		return {
			status: 0,
			ms: now() - t,
			worker: Number.NaN,
			colo: "?",
			edge: "?",
			round: "?",
			code: "?",
			json: null,
		};
	}
};

/** A 200 that is no error and no refusal (`{ok: false}`), at the top or in `/x/timed`'s `res`. */
const okOf = (h: Hit) => {
	if (h.status !== 200 || field(h.json, "error") !== undefined) return false;
	return field(field(h.json, "res") ?? h.json, "ok") !== false;
};

const summary = (hs: readonly Hit[]) => ({
	laptop: stats(hs.map((h) => h.ms)),
	worker: stats(hs.map((h) => h.worker)),
	ok: hs.filter(okOf).length,
	statuses: tally(hs.map((h) => String(h.status))),
	colos: tally(hs.map((h) => h.colo)),
});

/** A call through `/x/timed`: the object says whether this instance is new. */
const timed = (d: Door, ledger: string, method: string, args: unknown[], hint?: string) =>
	hit(d, `/x/timed?ledger=${encodeURIComponent(ledger)}${hint ? `&hint=${hint}` : ""}`, {
		method,
		args,
	});

// ---------------------------------------------------------------- Alchemy

const tokenless = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(
			([k]) => !k.startsWith("CLOUDFLARE_") && k !== "TYPESAFE_API_KEY",
		),
	);

let secretsToHide: string[] = [];
/** The repo's folder on this machine: no saved or printed line names it. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const hide = (text: string) => {
	let out = text.split(ROOT).join("");
	for (const s of secretsToHide) if (s) out = out.split(s).join("<hidden>");
	return out.replace(/[a-z0-9.-]+\.workers\.dev/gi, "<a workers.dev address>");
};

const alchemy = (verb: "deploy" | "destroy", env: Record<string, string>, flags: string[] = []) =>
	new Promise<{code: number; ms: number; out: string}>((done) => {
		const t = now();
		// Under nice: another experiment measures typing on this laptop, and a deploy bundles.
		const kid = spawn(
			"nice",
			[
				...["-n", "15", "node_modules/.bin/alchemy", verb, "--stage", STAGE, "--yes", "--no-input"],
				...flags,
			],
			{
				cwd: DIR,
				env: {...process.env, ...env, ALCHEMY_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1"},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let out = "";
		kid.stdout.on("data", (c) => {
			out += String(c);
		});
		kid.stderr.on("data", (c) => {
			out += String(c);
		});
		kid.on("close", (code) => done({code: code ?? -1, ms: now() - t, out}));
	});

const files = (dir: string): string[] => {
	try {
		return readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? files(p) : [p];
		});
	} catch {
		return [];
	}
};

/** Find the Worker's address in Alchemy's answer, or in its state. */
const addressOf = (out: string): string | null => {
	const re = new RegExp(`https://${WORKER}\\.[a-z0-9-]+\\.workers\\.dev`, "i");
	const found = re.exec(out)?.[0];
	if (found) return found;
	for (const f of files(join(DIR, ".alchemy"))) {
		const hit = re.exec(readFileSync(f, "utf8"))?.[0];
		if (hit) return hit;
	}
	return null;
};

/** What Alchemy's local state holds: yes or no for each thing that must stay out of the repo. */
const stateCheck = (key: string, hash: string) => {
	const all = files(join(DIR, ".alchemy")).map((f) => readFileSync(f, "utf8"));
	const holds = (s: string | undefined) => !!s && all.some((t) => t.includes(s));
	return {
		files: all.length,
		holdsKey: holds(key),
		holdsKeyHash: holds(hash),
		holdsToken: holds(process.env.CLOUDFLARE_API_TOKEN),
		holdsAccountId: holds(process.env.CLOUDFLARE_ACCOUNT_ID),
		holdsWorkersDevAddress: all.some((t) => /\.workers\.dev/.test(t)),
	};
};

/** The account's Workers and Durable Object namespaces with this run's name in them. */
const leftovers = async () => {
	const acct = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
	const get = async (path: string) => {
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}${path}`, {
			headers: {authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`},
		});
		const body: unknown = await res.json();
		const result = field(body, "result");
		return {
			ok: res.ok && field(body, "success") === true,
			rows: Array.isArray(result) ? result : [],
		};
	};
	const scripts = await get("/workers/scripts");
	const spaces = await get("/workers/durable_objects/namespaces?per_page=1000");
	// Only this run's names are kept: the account's other Workers are none of this repo's business.
	const mine = (s: unknown) => typeof s === "string" && s.includes("tf-exp-144");
	const ours = (s: unknown) => typeof s === "string" && s.startsWith("tf-exp-") && !mine(s);
	return {
		listed: scripts.ok && spaces.ok,
		otherExperimentWorkers: scripts.rows.map((r) => field(r, "id")).filter(ours),
		workersLeft: scripts.rows.map((r) => field(r, "id")).filter(mine),
		namespacesLeft: spaces.rows
			.filter((r) => mine(field(r, "name")) || mine(field(r, "script")))
			.map((r) => String(field(r, "name"))),
	};
};

const ready = async (d: Door) => {
	const t = now();
	for (let i = 0; i < 90; i++) {
		const h = await hit(d, "/x/ping");
		if (h.status === 200) return {afterMs: r1(now() - t), firstOkMs: r1(h.ms), tries: i + 1};
		await sleep(1000);
	}
	throw new Error("the Worker never answered");
};

// ---------------------------------------------------------------- part 1: one object, small calls

const NOTE = "a made-up note, about sixty bytes long, with nothing real in it";

const partLatency = async (d: Door, p: Plan) => {
	const L = `bench-${tag()}`;
	const first = await hit(d, `/${L}/register`, ["lat:a", "exp"]);
	for (let i = 0; i < p.warm; i++) {
		await hit(d, "/x/ping");
		await hit(d, `/${L}/readLast`, ["lat:a/inbox", 1]);
	}
	const append: Hit[] = [];
	const read: Hit[] = [];
	const ping: Hit[] = [];
	for (let i = 0; i < p.n; i++) {
		const event = {kind: "note", writer: "exp", data: {i, note: NOTE}, id: `a-${i}`};
		append.push(await hit(d, `/${L}/append`, ["lat:a/inbox", "any", event, null]));
		read.push(await hit(d, `/${L}/readLast`, ["lat:a/inbox", 1]));
		ping.push(await hit(d, "/x/ping"));
	}
	const client = await viaClient(d, L, p);
	return {
		ledger: "one object, made-up notes of about 100 bytes",
		newObjectFirstCallMs: r1(first.ms),
		append: summary(append),
		readLast: summary(read),
		ping: summary(ping),
		edges: tally(append.map((h) => h.edge)),
		client,
	};
};

/** The same two calls through the repo's own client, `layerHttp` from `@kampus/fabrika-old/http`. */
const viaClient = (d: Door, ledger: string, p: Plan) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		yield* l.register("lat:b", "exp");
		const inbox = inboxOf("lat:b/inbox");
		if (inbox === null) return yield* Effect.die("lat:b/inbox is not an inbox");
		const send: number[] = [];
		const read: number[] = [];
		for (let i = 0; i < p.warm + p.n; i++) {
			const t = now();
			yield* l.send(inbox, `b-${i}`, {kind: "note", writer: "exp", data: {i, note: NOTE}});
			const t2 = now();
			yield* l.readLast(inbox, 1);
			if (i >= p.warm) {
				send.push(t2 - t);
				read.push(now() - t2);
			}
		}
		spent += 1 + 2 * (p.warm + p.n);
		return {send: stats(send), readLast: stats(read)};
	}).pipe(Effect.provide(layerHttp({url: `${d.base}/${d.key}`, ledger})), Effect.runPromise);

// ---------------------------------------------------------------- part 2: a cold object

const partCold = async (d: Door, p: Plan) => {
	const run = tag();
	const objects = p.cold.flatMap((idle) =>
		Array.from({length: p.coldPer(idle)}, (_, j) => ({idle, name: `cold-${idle}-${j}-${run}`})),
	);
	const firsts: Hit[] = [];
	const probes = await Promise.all(
		objects.map(async (o, k) => {
			await sleep(k * 300);
			const warm = await timed(d, o.name, "readLast", ["x/inbox", 1]);
			firsts.push(warm);
			const warmed = now();
			await sleep(o.idle * 1000);
			const probe = await timed(d, o.name, "readLast", ["x/inbox", 1]);
			return {
				idleS: o.idle,
				waitedS: r1((now() - warmed) / 1000),
				ms: r1(probe.ms),
				workerMs: probe.worker,
				fresh: num(probe.json, "served") === 1,
				newIsolate: field(probe.json, "isolate") !== field(warm.json, "isolate"),
				ok: okOf(probe),
			};
		}),
	);
	const bySteps = p.cold.map((idle) => {
		const at = probes.filter((x) => x.idleS === idle);
		return {
			idleS: idle,
			n: at.length,
			fresh: at.filter((x) => x.fresh).length,
			ms: at.map((x) => x.ms),
		};
	});
	const fresh = probes.filter((x) => x.fresh);
	const kept = probes.filter((x) => !x.fresh);
	return {
		newObjectFirstCall: summary(firsts),
		probes: probes.length,
		freshCalls: fresh.length,
		freshNewIsolate: fresh.filter((x) => x.newIsolate).length,
		fresh: {laptop: stats(fresh.map((x) => x.ms)), worker: stats(fresh.map((x) => x.workerMs))},
		kept: {laptop: stats(kept.map((x) => x.ms)), worker: stats(kept.map((x) => x.workerMs))},
		bySteps,
		failed: probes.filter((x) => !x.ok).length,
	};
};

// ---------------------------------------------------------------- part 3: two objects in one call

const partTwo = async (d: Door, p: Plan) => {
	const run = tag();
	const person = `person-a-${run}`;
	const project = `project-x-${run}`;
	const reg = await hit(d, `/${person}/register`, ["desk", "app-a"]);
	const claim = await hit(d, `/${person}/claim`, [
		"desk",
		"app-a",
		num(reg.json, "rev"),
		3_600_000,
	]);
	const fence = num(claim.json, "fence");
	if (!Number.isFinite(fence)) throw new Error("part 3: the desk claim failed");
	await hit(d, `/${project}/register`, ["ticket:1", "exp"]);
	for (let i = 0; i < 20; i++) {
		const event = {kind: "comment", writer: "exp", data: {i, note: NOTE}, id: `c-${i}`};
		await hit(d, `/${project}/append`, ["ticket:1/inbox", "any", event, null]);
	}
	const save = (i: number) => ({
		ledger: person,
		method: "append",
		args: [
			"desk/state",
			"any",
			{kind: "desk_saved", writer: "app-a", data: {i, tiles: [{x: 0, y: 0, w: 6, h: 4}]}},
			fence,
		],
	});
	const read = {ledger: project, method: "readLast", args: ["ticket:1/inbox", 20]};
	const batch = (mode: string, calls: unknown[]) => hit(d, "/x/batch", {mode, calls});
	for (let i = 0; i < 5; i++) await batch("parallel", [save(-1 - i), read]);
	const parallel: Hit[] = [];
	const serial: Hit[] = [];
	for (let i = 0; i < p.two; i++) {
		parallel.push(await batch("parallel", [save(2 * i), read]));
		serial.push(await batch("serial", [save(2 * i + 1), read]));
	}
	const soloSave: Hit[] = [];
	const soloRead: Hit[] = [];
	for (let i = 0; i < p.twoSolo; i++) {
		soloSave.push(await batch("serial", [save(10_000 + i)]));
		soloRead.push(await batch("serial", [read]));
	}
	const inner = (hs: readonly Hit[]) => stats(hs.map((h) => num(h.json, "ms")));
	const saved = (h: Hit) => {
		const each = field(h.json, "each");
		const first = Array.isArray(each) ? each[0] : null;
		return field(field(first, "res"), "ok") === true;
	};
	return {
		parallel: {
			...summary(parallel),
			inWorker: inner(parallel),
			saved: parallel.filter(saved).length,
		},
		serial: {...summary(serial), inWorker: inner(serial), saved: serial.filter(saved).length},
		soloSave: {...summary(soloSave), inWorker: inner(soloSave)},
		soloRead: {...summary(soloRead), inWorker: inner(soloRead)},
	};
};

// ---------------------------------------------------------------- part 4: the doorbell

const watcher = (url: string) => {
	const rings = new Map<number, number>();
	const waiting = new Map<number, (t: number) => void>();
	let closes = 0;
	const sock = new WebSocket(url);
	sock.addEventListener("message", (e) => {
		const t = now();
		let note: unknown = null;
		try {
			note = JSON.parse(String(e.data));
		} catch {
			note = null;
		}
		const rev = num(note, "rev");
		if (!Number.isFinite(rev)) return;
		if (!rings.has(rev)) rings.set(rev, t);
		waiting.get(rev)?.(t);
	});
	sock.addEventListener("close", () => {
		closes += 1;
	});
	const opened = new Promise<void>((ok, bad) => {
		sock.addEventListener("open", () => ok());
		sock.addEventListener("error", () => bad(new Error("a watcher's socket failed")));
	});
	const ringOf = (rev: number, ms: number) =>
		new Promise<number | null>((done) => {
			const seen = rings.get(rev);
			if (seen !== undefined) return done(seen);
			const timer = setTimeout(() => done(null), ms);
			waiting.set(rev, (t) => {
				clearTimeout(timer);
				done(t);
			});
		});
	return {opened, ringOf, closes: () => closes, close: () => sock.close()};
};

const partBell = async (d: Door, p: Plan) => {
	const L = `bell-${tag()}`;
	const S = "bell:1/inbox";
	await hit(d, `/${L}/register`, ["bell:1", "exp"]);
	const url = `${d.ws}/${d.key}/${L}/tail?stream=${encodeURIComponent(S)}`;
	const a = watcher(url);
	const b = watcher(url);
	spent += 2;
	await Promise.all([a.opened, b.opened]);
	const ring = async (i: number) => {
		const t0 = now();
		const h = await timed(d, L, "append", [
			S,
			"any",
			{kind: "ring", writer: "a", id: `r-${i}`},
			null,
		]);
		const t1 = now();
		const rev = num(field(h.json, "res"), "rev");
		const [ra, rb] = await Promise.all([a.ringOf(rev, 5000), b.ringOf(rev, 5000)]);
		return {
			ack: t1 - t0,
			sendToRingB: rb === null ? null : rb - t0,
			ackToRingB: rb === null ? null : rb - t1,
			sendToRingA: ra === null ? null : ra - t0,
			fresh: num(h.json, "served") === 1,
		};
	};
	const awake: Awaited<ReturnType<typeof ring>>[] = [];
	for (let i = 0; i < p.bell; i++) {
		awake.push(await ring(i));
		await sleep(p.bellGapMs);
	}
	const sleepy: typeof awake = [];
	for (let i = 0; i < p.sleepy; i++) {
		await sleep(p.sleepyIdleMs);
		sleepy.push(await ring(100_000 + i));
	}
	const closes = a.closes() + b.closes();
	a.close();
	b.close();
	const sum = (rs: typeof awake) => ({
		n: rs.length,
		sendToRingB: stats(rs.flatMap((r) => (r.sendToRingB === null ? [] : [r.sendToRingB]))),
		ackToRingB: stats(rs.flatMap((r) => (r.ackToRingB === null ? [] : [r.ackToRingB]))),
		sendToRingA: stats(rs.flatMap((r) => (r.sendToRingA === null ? [] : [r.sendToRingA]))),
		ack: stats(rs.map((r) => r.ack)),
		missedB: rs.filter((r) => r.sendToRingB === null).length,
		ringBeforeAck: rs.filter((r) => r.ackToRingB !== null && r.ackToRingB < 0).length,
		freshObject: rs.filter((r) => r.fresh).length,
	});
	return {
		awake: sum(awake),
		afterIdle: {...sum(sleepy), idleMs: p.sleepyIdleMs},
		socketCloses: closes,
	};
};

// ---------------------------------------------------------------- part 5: two writers, a redeploy

type Ack = {
	id: string;
	stream: string;
	rev: number;
	dup: boolean;
	tries: number;
	at: number;
	ms: number;
};
type Fail = {at: number; why: string; cas: boolean};
type WriterOut = {
	who: string;
	acks: Ack[];
	fails: Fail[];
	unacked: string[];
	fatal: string[];
	calls: number;
};

/** A watcher that comes back on its own, as the doorbell does: 100 ms after a close. */
const comeback = (url: string, t0: number) => {
	const gaps: {closedAtS: number; code: number; gapMs: number | null; tries: number}[] = [];
	let rings = 0;
	let stop = false;
	let sock: WebSocket | null = null;
	let tries = 0;
	let connects = 0;
	const open = () => {
		connects += 1;
		const s = new WebSocket(url);
		sock = s;
		s.addEventListener("open", () => {
			const last = gaps.at(-1);
			if (last && last.gapMs === null) {
				last.gapMs = r1(Date.now() - t0 - last.closedAtS * 1000);
				last.tries = tries;
			}
			tries = 0;
		});
		s.addEventListener("message", () => {
			rings += 1;
		});
		s.addEventListener("close", (e) => {
			if (stop) return;
			const last = gaps.at(-1);
			if (!last || last.gapMs !== null)
				gaps.push({closedAtS: r1((Date.now() - t0) / 1000), code: e.code, gapMs: null, tries: 0});
			tries += 1;
			setTimeout(open, 100);
		});
		s.addEventListener("error", () => {});
	};
	open();
	return {
		done: () => {
			stop = true;
			sock?.close();
			return {gaps, rings, connects};
		},
	};
};

const writerKid = (who: string, ledger: string, p: Plan, d: Door) =>
	new Promise<WriterOut | {who: string; error: string}>((done) => {
		const me = fileURLToPath(import.meta.url);
		const kid = spawn(
			process.execPath,
			[me, "writer", who, ledger, String(p.soakS), String(p.soakRate)],
			{env: tokenless(), stdio: ["pipe", "pipe", "pipe"]},
		);
		let out = "";
		let err = "";
		kid.stdout.on("data", (c) => {
			out += String(c);
		});
		kid.stderr.on("data", (c) => {
			err += String(c);
		});
		kid.stdin.end(`${d.base}/${d.key}\n`);
		kid.on("close", (code) => {
			const line = out.trim().split("\n").at(-1) ?? "";
			try {
				const parsed: WriterOut = JSON.parse(line);
				done(parsed);
			} catch {
				done({who, error: hide(`exit ${code}: ${err.slice(-2000)}`)});
			}
		});
	});

/** One look at the soak's object every 2 s (the `code` run): instance, build, sockets. */
type Look = {
	atS: number;
	status: number;
	round: string;
	code: string;
	born: number;
	isolate: string;
	watchers: number;
};

const partSoak = async (
	d: Door,
	p: Plan,
	redeploy: () => Promise<{code: number; ms: number}>,
	look = false,
) => {
	const L = `soak-${tag()}`;
	for (const k of [1, 2, 3]) await hit(d, `/${L}/register`, [`soak:${k}`, "exp"]);
	const t0 = Date.now();
	const watchers = [1, 2, 3].map((k) =>
		comeback(`${d.ws}/${d.key}/${L}/tail?stream=${encodeURIComponent(`soak:${k}/inbox`)}`, t0),
	);
	const kids = Promise.all(["w1", "w2"].map((who) => writerKid(who, L, p, d)));
	const rounds: {atS: number; round: string; status: number}[] = [];
	const looks: Look[] = [];
	let polling = true;
	const poll = (async () => {
		while (polling) {
			const h = await hit(d, "/x/ping");
			const atS = r1((Date.now() - t0) / 1000);
			rounds.push({atS, round: h.round, status: h.status});
			if (look) {
				const o = await timed(d, L, "watchers", []);
				looks.push({
					atS,
					status: o.status,
					round: o.round,
					code: String(field(o.json, "code") ?? "?"),
					born: num(o.json, "born"),
					isolate: String(field(o.json, "isolate") ?? "?"),
					watchers: num(o.json, "res"),
				});
			}
			await sleep(2000);
		}
	})();
	await sleep(p.redeployAtS * 1000);
	const deployStartS = r1((Date.now() - t0) / 1000);
	const rd = await redeploy();
	const deployEndS = r1((Date.now() - t0) / 1000);
	const writers = await kids;
	polling = false;
	await poll;
	const sockets = watchers.map((w) => w.done());
	for (const s of sockets) spent += s.connects;
	const rows: unknown[] = [];
	const revGaps: number[] = [];
	for (const k of [1, 2, 3]) {
		const h = await hit(d, `/${L}/readStream`, [`soak:${k}/inbox`, 0, -1]);
		const got = Array.isArray(h.json) ? h.json : [];
		rows.push(...got);
		const revs = got.map((r) => num(r, "rev"));
		revGaps.push(revs.filter((rev, i) => rev !== i + 1).length);
	}
	return {
		writers,
		rows,
		revGaps,
		t0,
		deploy: {startS: deployStartS, endS: deployEndS, code: rd.code, ms: r1(rd.ms)},
		firstNewRoundS: rounds.find((r) => r.round === "2")?.atS ?? null,
		pingsFailed: rounds.filter((r) => r.status !== 200).length,
		sockets,
		looks,
	};
};

/**
 * The soak's object as the looks saw it: each instance it ran as (a new one is a restart), the
 * build each answered from, and the fewest sockets it held. Empty when nobody looked.
 */
const looked = (looks: readonly Look[]) => {
	const lives: {born: number; isolate: string; code: string; fromS: number; toS: number}[] = [];
	for (const l of looks) {
		if (l.status !== 200) continue;
		const last = lives.at(-1);
		if (last && last.born === l.born && last.isolate === l.isolate) last.toS = l.atS;
		else lives.push({born: l.born, isolate: l.isolate, code: l.code, fromS: l.atS, toS: l.atS});
	}
	const ok = looks.filter((l) => l.status === 200);
	return {
		looks: looks.length,
		failed: looks.length - ok.length,
		lives: lives.map((x) => ({code: x.code, fromS: x.fromS, toS: x.toS})),
		restarts: Math.max(0, lives.length - 1),
		watchers: tally(ok.map((l) => String(l.watchers))),
		firstNewCodeS: ok.find((l) => l.code === "2")?.atS ?? null,
		lastOldCodeS: ok.filter((l) => l.code === "1").at(-1)?.atS ?? null,
	};
};

/** Lost and doubled facts, from the writers' acks and the streams as read back. */
const audit = (soak: Awaited<ReturnType<typeof partSoak>>) => {
	const outs = soak.writers.filter((w): w is WriterOut => "acks" in w);
	const acks = outs.flatMap((w) => w.acks);
	const count = new Map<string, number>();
	const where = new Map<string, string>();
	for (const r of soak.rows) {
		const id = field(r, "id");
		if (typeof id !== "string") continue;
		count.set(id, (count.get(id) ?? 0) + 1);
		where.set(id, String(field(r, "stream")));
	}
	const acked = new Set(acks.map((a) => a.id));
	const rel = (at: number) => r1((at - soak.t0) / 1000);
	const writers = outs.map((w) => {
		const ends = w.acks.map((a) => a.at + a.ms).sort((x, y) => x - y);
		let gap = 0;
		let gapAt = 0;
		for (let i = 1; i < ends.length; i++) {
			const g = (ends[i] ?? 0) - (ends[i - 1] ?? 0);
			if (g > gap) {
				gap = g;
				gapAt = ends[i - 1] ?? 0;
			}
		}
		return {
			who: w.who,
			acked: w.acks.length,
			send: stats(w.acks.filter((a) => a.id.endsWith("s")).map((a) => a.ms)),
			cas: stats(w.acks.filter((a) => a.id.endsWith("c")).map((a) => a.ms)),
			retried: w.acks.filter((a) => a.tries > 1).length,
			dupAnswers: w.acks.filter((a) => a.dup).length,
			fails: tally(w.fails.map((f) => f.why)),
			failWindowS:
				w.fails.length === 0
					? null
					: [
							rel(Math.min(...w.fails.map((f) => f.at))),
							rel(Math.max(...w.fails.map((f) => f.at))),
						],
			longestAckGapMs: r1(gap),
			longestAckGapAtS: rel(gapAt),
			unacked: w.unacked.length,
			fatal: w.fatal,
			calls: w.calls,
		};
	});
	return {
		writers,
		writerErrors: soak.writers.filter((w) => !("acks" in w)),
		factsAcked: acks.length,
		rowsRead: soak.rows.length,
		lost: acks.filter((a) => !count.has(a.id)).length,
		doubled: [...count.values()].filter((c) => c > 1).length,
		wrongStream: acks.filter((a) => count.has(a.id) && where.get(a.id) !== a.stream).length,
		writtenNeverAcked: [...count.keys()].filter((id) => !acked.has(id)).length,
		revGaps: soak.revGaps,
		deploy: soak.deploy,
		firstNewRoundS: soak.firstNewRoundS,
		pingsFailed: soak.pingsFailed,
		sockets: soak.sockets.map((s) => ({
			connects: s.connects,
			rings: s.rings,
			gaps: s.gaps,
		})),
		...(soak.looks.length > 0 ? {object: looked(soak.looks)} : {}),
	};
};

// ---------------------------------------------------------------- the law suite, deployed

/** The package's own law suite (`runLaws`, as laws.test.ts runs it in Miniflare), deployed. */
const partLaws = async (d: Door) => {
	const t = now();
	const rs = await runLaws({alarm: true, graceMs: 1000}).pipe(
		Effect.provide(layerHttp({url: `${d.base}/${d.key}`, ledger: `laws-${tag()}`})),
		Effect.scoped,
		Effect.runPromise,
	);
	return {
		laws: rs.length,
		passed: rs.filter((r) => r.pass).length,
		failed: rs.filter((r) => !r.pass).map((r) => ({law: r.law, numbers: r.numbers})),
		passedLaws: rs.filter((r) => r.pass).map((r) => r.law.split(".")[0] ?? r.law),
		wallS: r1((now() - t) / 1000),
	};
};

// ---------------------------------------------------------------- the switch run: clocks, new code

/**
 * How far the laptop's clock is from the Worker's: the Worker's `Date.now()` against the middle of
 * the round trip. Positive: the laptop is ahead. The law suite waits on the laptop's clock for
 * times the ledger wrote with Cloudflare's.
 */
const partClock = async (d: Door) => {
	const offsets: number[] = [];
	const rtts: number[] = [];
	for (let i = 0; i < 20; i++) {
		const sent = Date.now();
		const h = await hit(d, "/x/now");
		const back = Date.now();
		const there = num(h.json, "now");
		if (h.status !== 200 || !Number.isFinite(there)) continue;
		offsets.push((sent + back) / 2 - there);
		rtts.push(back - sent);
		await sleep(100);
	}
	return {laptopAheadMs: stats(offsets), rttMs: stats(rtts)};
};

/** What one object said: the build it ran, and its instance. */
type Said = {atS: number; status: number; code: string; born: number; isolate: string};

/**
 * When does a busy object take a redeploy's new code? Seven objects take turns, one write each
 * about every 0.8 s, with a watcher on each. The redeploy (new code) starts at 20 s. Writes go on
 * until 20 s after it ends. Then each object is left alone for its own quiet time and asked once,
 * then once more 15 s later. A ping a second says when the Worker itself answers with new code.
 */
const partSwitch = async (d: Door, redeploy: () => Promise<{code: number; ms: number}>) => {
	const run = tag();
	const quiet = [0.5, 1, 2, 3, 5, 8, 12];
	type Obj = {q: number; name: string; said: Said[]};
	const objs: Obj[] = quiet.map((q, i) => ({q, name: `switch-${i}-${run}`, said: []}));
	for (const o of objs) await hit(d, `/${o.name}/register`, ["s:1", "exp"]);
	const t0 = Date.now();
	const atS = () => r1((Date.now() - t0) / 1000);
	const watchers = objs.map((o) =>
		comeback(`${d.ws}/${d.key}/${o.name}/tail?stream=${encodeURIComponent("s:1/inbox")}`, t0),
	);
	spent += objs.length;
	const say1 = async (o: Obj, method: string, args: unknown[]) => {
		const h = await timed(d, o.name, method, args);
		o.said.push({
			atS: atS(),
			status: h.status,
			code: String(field(h.json, "code") ?? "?"),
			born: num(h.json, "born"),
			isolate: String(field(h.json, "isolate") ?? "?"),
		});
	};
	const pings: {atS: number; status: number; code: string; round: string}[] = [];
	let pinging = true;
	const pinger = (async () => {
		while (pinging) {
			const h = await hit(d, "/x/ping");
			pings.push({atS: atS(), status: h.status, code: h.code, round: h.round});
			await sleep(1000);
		}
	})();
	let busy = true;
	let n = 0;
	const writer = (async () => {
		while (busy) {
			const o = objs[n % objs.length];
			if (o === undefined) break;
			const event = {kind: "note", writer: "exp", data: {n, note: NOTE}, id: `w-${n}`};
			await say1(o, "append", ["s:1/inbox", "any", event, null]);
			n += 1;
			await sleep(50);
		}
	})();
	await sleep(20_000);
	const deployStartS = atS();
	const rd = await redeploy();
	const deployEndS = atS();
	await sleep(20_000);
	busy = false;
	await writer;
	const stoppedS = atS();
	await Promise.all(
		objs.map(async (o) => {
			await sleep(o.q * 1000);
			await say1(o, "readLast", ["s:1/inbox", 1]);
			await sleep(15_000);
			await say1(o, "readLast", ["s:1/inbox", 1]);
		}),
	);
	// An object made after the redeploy.
	const late: Obj = {q: -1, name: `switch-late-${run}`, said: []};
	await say1(late, "readLast", ["s:1/inbox", 1]);
	pinging = false;
	await pinger;
	const sockets = watchers.map((w) => w.done());
	const okSaid = (o: Obj) => o.said.filter((s) => s.status === 200);
	return {
		writes: n,
		deploy: {startS: deployStartS, endS: deployEndS, code: rd.code, ms: r1(rd.ms)},
		stoppedS,
		workerFirstNewCodeS: pings.find((p) => p.code === "2")?.atS ?? null,
		workerLastOldCodeS: pings.filter((p) => p.code === "1").at(-1)?.atS ?? null,
		pingsFailed: pings.filter((p) => p.status !== 200).length,
		objects: objs.map((o, i) => {
			const ok = okSaid(o);
			const busyOnes = ok.filter((s) => s.atS < stoppedS);
			const after = ok.filter((s) => s.atS >= stoppedS);
			return {
				quietS: o.q,
				writes: busyOnes.length,
				failed: o.said.length - ok.length,
				lastOldCodeWhileBusyS: busyOnes.filter((s) => s.code === "1").at(-1)?.atS ?? null,
				firstNewCodeWhileBusyS: busyOnes.find((s) => s.code === "2")?.atS ?? null,
				instancesWhileBusy: new Set(busyOnes.map((s) => `${s.born}/${s.isolate}`)).size,
				afterQuiet: after[0]?.code ?? null,
				afterQuietNewInstance:
					after[0] && busyOnes.at(-1) ? after[0].born !== busyOnes.at(-1)?.born : null,
				fifteenLater: after[1]?.code ?? null,
				socket: sockets[i] ?? null,
			};
		}),
		lateObject: late.said[0]?.code ?? null,
	};
};

// ---------------------------------------------------------------- the clocks run: three laws

/**
 * One reading of the clocks, against the middle of the round trip: how far the laptop is ahead of
 * the Worker and of the named object, and the object's clock less the Worker's, read just before
 * the call.
 */
const readClocks = async (d: Door, ledger: string) => {
	const sent = Date.now();
	const h = await hit(d, `/x/now?ledger=${encodeURIComponent(ledger)}`);
	const back = Date.now();
	const mid = (sent + back) / 2;
	const worker = num(h.json, "now");
	const object = num(h.json, "object");
	if (h.status !== 200 || !Number.isFinite(object)) return [];
	return [
		{
			worker: mid - worker,
			object: mid - object,
			objectLessWorker: object - worker,
			rtt: back - sent,
		},
	];
};

const clockStats = (rs: readonly Awaited<ReturnType<typeof readClocks>>[]) => {
	const ok = rs.flat();
	return {
		readings: rs.length,
		failed: rs.length - ok.length,
		laptopAheadOfWorkerMs: stats(ok.map((r) => r.worker)),
		laptopAheadOfObjectMs: stats(ok.map((r) => r.object)),
		objectLessWorkerMs: stats(ok.map((r) => r.objectLessWorker)),
		rttMs: stats(ok.map((r) => r.rtt)),
	};
};

/** The code run's three failed laws. Each waits on the laptop's clock for a lease's end. */
const THREE = [
	["3", law3Fencing],
	["12", law12PrefixFence],
	["18", law18Reply],
] as const;

/**
 * Three laws failed on the deployed object and pass in Miniflare (laws.test.ts). Each waits, on
 * the laptop's clock, for a lease's end the object wrote with its own clock. The switch run read
 * the Worker's clock only. This one reads the object's: idle, then while the whole suite runs on
 * it. And it runs the three alone, one after the other, to see whether they fail without the
 * other laws beside them.
 */
const partClocks = async (d: Door) => {
	const run = tag();
	const lawOn = (ledger: string) => layerHttp({url: `${d.base}/${d.key}`, ledger});
	const idle: Awaited<ReturnType<typeof readClocks>>[] = [];
	for (let i = 0; i < 20; i++) {
		idle.push(await readClocks(d, `clock-${run}`));
		await sleep(100);
	}
	const alone = [];
	for (let round = 1; round <= 3; round++)
		for (const [n, law] of THREE) {
			const r = await Effect.gen(function* () {
				return yield* law(yield* Ledger, 1000);
			}).pipe(
				Effect.catchCause((c) =>
					Effect.succeed({law: n, pass: false, numbers: `stopped: ${String(c).slice(0, 300)}`}),
				),
				Effect.provide(lawOn(`alone-${n}-${round}-${run}`)),
				Effect.scoped,
				Effect.runPromise,
			);
			alone.push({law: n, round, pass: r.pass, ...(r.pass ? {} : {numbers: r.numbers})});
		}
	const suites = [];
	for (let round = 1; round <= 3; round++) {
		const ledger = `suite-${round}-${run}`;
		const busy: Awaited<ReturnType<typeof readClocks>>[] = [];
		let reading = true;
		const reader = (async () => {
			while (reading) {
				busy.push(await readClocks(d, ledger));
				await sleep(250);
			}
		})();
		const t = now();
		const rs = await runLaws({alarm: true, graceMs: 1000}).pipe(
			Effect.provide(lawOn(ledger)),
			Effect.scoped,
			Effect.runPromise,
		);
		reading = false;
		await reader;
		suites.push({
			round,
			laws: rs.length,
			passed: rs.filter((r) => r.pass).length,
			failed: rs.filter((r) => !r.pass).map((r) => r.law.split(".")[0] ?? r.law),
			wallS: r1((now() - t) / 1000),
			clocksWhileBusy: clockStats(busy),
		});
	}
	return {idle: clockStats(idle), alone, suites};
};

// ---------------------------------------------------------------- part 6: placement

const partPlace = async (d: Door, p: Plan) => {
	const run = tag();
	const rows = [];
	for (const hint of p.hints) {
		const name = `place-${hint}-${run}`;
		const h = hint === "none" ? undefined : hint;
		const where = await hit(d, `/x/where?ledger=${name}${h ? `&hint=${h}` : ""}`);
		const calls: Hit[] = [];
		for (let i = 0; i < p.place; i++)
			calls.push(await timed(d, name, "readLast", ["x/inbox", 1], h));
		rows.push({
			hint,
			colo: field(where.json, "colo"),
			workerColo: where.colo,
			laptop: stats(calls.map((c) => c.ms)),
			worker: stats(calls.map((c) => c.worker)),
		});
	}
	// A hint on an object that exists already: does it move? (The docs say only the first get counts.)
	const first = `place-${p.hints[0]}-${run}`;
	const again = await hit(d, `/x/where?ledger=${first}&hint=apac`);
	return {rows, existingWithNewHint: {hint: "apac", colo: field(again.json, "colo")}};
};

// ---------------------------------------------------------------- part 7: GitHub from the Worker

const partGithub = async (d: Door, p: Plan) => {
	const rows: Record<string, unknown>[] = [];
	for (let i = 0; i < p.gh; i++) {
		const h = await hit(d, "/x/gh");
		rows.push({...(typeof h.json === "object" && h.json !== null ? h.json : {}), colo: h.colo});
		await sleep(200);
	}
	const pick = (k: string) => rows.map((r) => String(field(r, k)));
	return {
		calls: rows.length,
		statuses: tally(pick("status")),
		limit: tally(pick("limit")),
		resource: tally(pick("resource")),
		remainingFirst: field(rows[0], "remaining") ?? null,
		remainingLast: field(rows.at(-1), "remaining") ?? null,
		remaining: pick("remaining"),
		keys: tally(pick("keys")),
		colos: tally(pick("colo")),
		ms: stats(rows.map((r) => num(r, "ms"))),
		retryAfter: tally(pick("retryAfter")),
	};
};

// ---------------------------------------------------------------- the run

const say = (s: string) => console.log(hide(s));

const main = async (mode: Mode) => {
	if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)
		throw new Error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for this command");
	if (process.env.TYPESAFE_API_KEY) throw new Error("run with TYPESAFE_API_KEY unset");
	const p = mode === "smoke" ? SMOKE : FULL;
	// The first deploy is build 1, round 1. Full's redeploy changes a binding only (round 2);
	// the code and switch runs' change the code too (build 2), as a real deploy does.
	const key = randomBytes(32).toString("base64url");
	const hash = createHash("sha256").update(key).digest("hex");
	secretsToHide = [key, process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN];
	const first = {EXP_KEY_HASH: hash, EXP_ROUND: "1", EXP_CODE: "1"};
	const newCode = mode === "code" || mode === "switch";
	const second = {...first, EXP_ROUND: "2", EXP_CODE: newCode ? "2" : "1"};
	const est = estimate(p, mode);
	say(`plan ${mode}: about ${est.worker} Worker and ${est.object} object requests`);
	const results: Record<string, unknown> = {
		experiment: 144,
		mode,
		date: new Date().toISOString().slice(0, 10),
		alchemy: "alchemy@2.0.0-beta.84, @alchemy.run/cloudflare@2.0.0-beta.84",
		estimate: est,
	};
	const started = Date.now();
	let door: Door | null = null;
	try {
		const dep = await alchemy("deploy", first);
		results.deploy = {code: dep.code, ms: r1(dep.ms)};
		if (dep.code !== 0) throw new Error(`deploy failed: ${hide(dep.out.slice(-3000))}`);
		const base = addressOf(dep.out);
		if (base === null)
			throw new Error(`no address in the deploy's answer: ${hide(dep.out.slice(-3000))}`);
		secretsToHide.push(base, new URL(base).host);
		door = {base, key, ws: base.replace(/^https/, "wss")};
		say(`deployed in ${r1(dep.ms / 1000)} s`);
		results.state = stateCheck(key, hash);
		results.ready = await ready(door);
		const wrong = await fetch(`${base}/not-the-key/x/ping`);
		const none = await fetch(`${base}/x/ping`);
		spent += 2;
		results.door = {wrongKey: wrong.status, noKey: none.status};
		const d = door;
		// The build number must be in the code, or the code run's redeploy would change nothing.
		const build = (await hit(d, "/x/ping")).code;
		if (build !== first.EXP_CODE) throw new Error(`the Worker says build ${build}, not 1`);
		const step = async (name: string, f: () => Promise<unknown>) => {
			const t = Date.now();
			say(`part ${name}...`);
			results[name] = await f();
			say(`part ${name} done in ${r1((Date.now() - t) / 1000)} s`);
		};
		const redeploy = async () => {
			const r = await alchemy("deploy", second);
			say(`redeployed (code ${r.code}) in ${r1(r.ms / 1000)} s`);
			return r;
		};
		if (mode === "switch") {
			await step("clock", () => partClock(d));
			await step("switch", () => partSwitch(d, redeploy));
		} else if (mode === "clocks") await step("clocks", () => partClocks(d));
		else {
			if (mode === "code") await step("laws", () => partLaws(d));
			else {
				await step("latency", () => partLatency(d, p));
				await step("two", () => partTwo(d, p));
				await step("place", () => partPlace(d, p));
				await step("github", () => partGithub(d, p));
				await step("bell", () => partBell(d, p));
				await step("cold", () => partCold(d, p));
			}
			await step("soak", async () => audit(await partSoak(d, p, redeploy, mode === "code")));
		}
	} catch (e) {
		results.error = hide(e instanceof Error ? (e.stack ?? e.message) : String(e));
		say(`stopped: ${String(results.error)}`);
	} finally {
		const des = await alchemy("destroy", first);
		results.destroy = {code: des.code, ms: r1(des.ms)};
		if (des.code !== 0) say(`destroy failed: ${des.out.slice(-3000)}`);
		results.left = await leftovers();
		const left = results.left;
		const clean =
			field(left, "listed") === true &&
			[field(left, "workersLeft"), field(left, "namespacesLeft")].every(
				(x) => Array.isArray(x) && x.length === 0,
			);
		// Alchemy's local state holds the account id: once the cloud side is gone, so is the state.
		if (clean && des.code === 0) rmSync(join(DIR, ".alchemy"), {recursive: true, force: true});
		results.stateRemoved = clean && des.code === 0;
		results.requests = {
			fromThisProcess: spent,
			fromWriters: (() => {
				const soak = results.soak;
				const ws = field(soak, "writers");
				return Array.isArray(ws) ? ws.reduce((a, w) => a + num(w, "calls"), 0) : 0;
			})(),
		};
		results.wallS = r1((Date.now() - started) / 1000);
		const text = `${JSON.stringify(results, null, "\t")}\n`;
		const leaks = secretsToHide.filter((s) => s && text.includes(s));
		if (leaks.length > 0 || /\.workers\.dev/.test(text)) {
			say("the results hold a secret: not saved");
			process.exitCode = 1;
		} else if (mode === "full") {
			mkdirSync(join(OUT, ".."), {recursive: true});
			writeFileSync(OUT, text);
			say(`wrote ${OUT.slice(OUT.indexOf("experiments/"))}`);
		} else if (mode === "code" || mode === "switch" || mode === "clocks") {
			// Kept beside full's answers, under the mode's name. A new full run drops them: run them again.
			const saved: unknown = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
			const all = {...(typeof saved === "object" && saved !== null ? saved : {}), [mode]: results};
			mkdirSync(join(OUT, ".."), {recursive: true});
			writeFileSync(OUT, `${JSON.stringify(all, null, "\t")}\n`);
			say(`wrote ${OUT.slice(OUT.indexOf("experiments/"))}, under ${mode}`);
		} else say(text);
		say(`left: ${JSON.stringify(results.left)}`);
	}
};

// ---------------------------------------------------------------- a writer (part 5's child)

const readStdin = async () => {
	let s = "";
	for await (const c of process.stdin) s += String(c);
	return s.trim();
};

const writer = async (who: string, ledger: string, seconds: number, rate: number) => {
	const url = await readStdin();
	const inboxes = [1, 2, 3].flatMap((k) => {
		const i = inboxOf(`soak:${k}/inbox`);
		return i === null ? [] : [i];
	});
	const program = Effect.gen(function* () {
		const l = yield* Ledger;
		const end = Date.now() + seconds * 1000;
		const gap = 1000 / rate;
		const out: WriterOut = {who, acks: [], fails: [], unacked: [], fatal: [], calls: 0};
		const cas = (stream: Inbox, event: NewEvent) =>
			l
				.readLast(stream, 1)
				.pipe(Effect.flatMap((rows) => l.append(stream, rows.at(-1)?.rev ?? 0, event)));
		for (let n = 0; Date.now() < end && out.fatal.length === 0; n++) {
			const at = Date.now();
			const stream = inboxes[n % inboxes.length];
			if (stream === undefined) break;
			// Odd facts are compare-and-set appends ("c"), even ones plain sends ("s").
			const isCas = n % 2 === 1;
			const id = `${who}-${n}-${isCas ? "c" : "s"}`;
			const data = {n, who, note: NOTE};
			for (let tries = 1; ; tries++) {
				const res = yield* Effect.result(
					isCas
						? cas(stream, {kind: "fact", writer: who, data, id})
						: l.send(stream, id, {kind: "fact", writer: who, data}),
				);
				out.calls += isCas ? 2 : 1;
				if (Result.isSuccess(res)) {
					const {rev, dup} = res.success;
					out.acks.push({id, stream, rev, dup, tries, at, ms: Date.now() - at});
					break;
				}
				const why = res.failure._tag;
				out.fails.push({at: Date.now(), why, cas: isCas});
				if (why !== "LedgerUnreachable" && why !== "Stale") {
					out.fatal.push(`${id}: ${why}`);
					break;
				}
				if (tries >= 400) {
					out.unacked.push(id);
					break;
				}
				if (why === "LedgerUnreachable") yield* Effect.sleep(Duration.millis(200));
			}
			const wait = gap - (Date.now() - at);
			if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
		}
		return out;
	});
	const out = await Effect.runPromise(program.pipe(Effect.provide(layerHttp({url, ledger}))));
	process.stdout.write(`${JSON.stringify(out)}\n`);
};

const [cmd = "", ...args] = process.argv.slice(2);
if (cmd === "writer") {
	const [who = "w", ledger = "", seconds = "0", rate = "1"] = args;
	await writer(who, ledger, Number(seconds), Number(rate));
} else if (
	cmd === "smoke" ||
	cmd === "full" ||
	cmd === "code" ||
	cmd === "switch" ||
	cmd === "clocks"
) {
	await main(cmd);
} else if (cmd === "plan") {
	// Alchemy's plan alone: what a deploy would do, deploying nothing.
	secretsToHide = [process.env.CLOUDFLARE_ACCOUNT_ID ?? "", process.env.CLOUDFLARE_API_TOKEN ?? ""];
	const env = {EXP_KEY_HASH: "0".repeat(64), EXP_ROUND: "0", EXP_CODE: "0"};
	const r = await alchemy("deploy", env, ["--dry-run"]);
	say(`plan: code ${r.code}\n${r.out}`);
} else {
	console.error(
		"usage: node experiments/144-durable-objects-live.ts smoke|full|code|switch|clocks|plan",
	);
	process.exitCode = 2;
}
