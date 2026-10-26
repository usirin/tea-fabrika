// Experiment 148: fabrika programs on a project's host on Cloudflare, each job on the key of the
// person who started it, the key never in a box. Local only: workerd and Docker through
// `alchemy dev`, a stand-in model, made-up keys. No Cloudflare account, no real model.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/148-remote-programs.ts
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live
//
// The second is the live part (148-remote-programs/live.ts): the same stack on Cloudflare,
// without the box, destroyed in a `finally`. `live-box small|full` is the live box round
// (148-remote-programs/live-box.ts), the stack with its box, and the same `finally`.
// `egress local|live` is the egress round (148-remote-programs/egress.ts): Cloudflare's own allow
// list, on the laptop and on Cloudflare.
//
// It builds the Worker (148-remote-programs/build.ts), starts the stand-in model and the stack's
// local stage, plays two people on the laptop (148-remote-programs/attach.ts), and writes
// experiments/results/148-remote-programs.json. At the end it stops everything it started and
// removes every Docker container and image the run made, and only those.
//
// Node at the edge, said here: child_process for docker and alchemy dev, fetch and WebSocket.
import {execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {attach, type Client} from "./148-remote-programs/attach.ts";
import {buildWorker} from "./148-remote-programs/build.ts";

const dir = join(import.meta.dirname, "148-remote-programs");
const BASE = "http://localhost:1337";
const PROJECT = "p1";
const hex = (n: number) => randomBytes(n).toString("hex");

// Every secret is made up, here, for this run, in a shape the probe knows (box/probe.mjs).
const people = {
	a: {who: "github:1", session: `sess-${hex(16)}`, key: `fake-key-${hex(16)}`},
	b: {who: "github:2", session: `sess-${hex(16)}`, key: `fake-key-${hex(16)}`},
	c: {who: "github:3", session: `sess-${hex(16)}`, key: null},
};
const seal = `seal-${hex(16)}`;
const env = (extra: Record<string, string>) => {
	const e: Record<string, string> = {...(process.env as Record<string, string>), ...extra};
	delete e.TYPESAFE_API_KEY;
	return e;
};

const docker = (...args: string[]) =>
	execFileSync("docker", args, {encoding: "utf8"}).split("\n").filter(Boolean);
// Only what alchemy dev makes for this stack: its images, the job box's snapshots and its
// containers. None of these names can be chosen (see the write-up), so the run tells its own
// apart by name and by being new since the run began.
const OURS = /alchemy-dev\/|workerd-container-snap|workerd-tf-exp-148/;
const imagesNow = () =>
	new Set(
		docker("images", "-a", "--no-trunc", "--format", "{{.ID}} {{.Repository}}")
			.filter((l) => OURS.test(l))
			.map((l) => l.split(" ")[0] ?? ""),
	);
const containersNow = () =>
	new Set(
		docker("ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Names}}")
			.filter((l) => OURS.test(l))
			.map((l) => l.split(" ")[0] ?? ""),
	);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: Record<string, unknown> = {date: new Date().toISOString().slice(0, 10)};
const note = (k: string, v: unknown) => {
	results[k] = v;
	console.log(k, JSON.stringify(v));
};

const call = async (session: string, path: string, init: RequestInit = {}) => {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: {...(init.headers ?? {}), authorization: `Bearer ${session}`},
	});
	const text = await res.text();
	try {
		return {status: res.status, body: JSON.parse(text)};
	} catch {
		return {status: res.status, body: text};
	}
};
const status = async () => (await call(people.a.session, `/p/${PROJECT}/status`)).body;

/** Type a line and wait for the prompt to be back; answers what was printed meanwhile, and how long. */
const run = async (c: Client, line: string, ms = 30000) => {
	const from = c.heard.length;
	const t0 = Date.now();
	c.line(line);
	await c.until((m) => m.type === "ready", ms, from);
	const printed = c.heard
		.slice(from)
		.filter((m) => m.type === "printed")
		.map((m) => m.text ?? "");
	return {line, printed, ms: Date.now() - t0};
};

/** Type a line and wait until something printed matches. */
const runUntil = async (c: Client, line: string, test: RegExp, ms = 60000) => {
	const from = c.heard.length;
	const t0 = Date.now();
	c.line(line);
	const hit = await c.until((m) => m.type === "printed" && test.test(m.text ?? ""), ms, from);
	return {line, printed: hit.text, ms: Date.now() - t0};
};

const open = async (p: {session: string}) => {
	const t0 = Date.now();
	const c = await attach(BASE, PROJECT, p.session);
	const opened = await c.until((m) => m.type === "opened", 30000);
	return {c, opened, ms: Date.now() - t0};
};

/** Throw the host object away, as an eviction does, keeping its storage. */
const evict = async (clients: Client[]) => {
	await call(people.a.session, `/p/${PROJECT}/evict`).catch(() => undefined);
	await Promise.race([Promise.all(clients.map((c) => c.closed)), wait(3000)]);
	for (const c of clients) c.close();
};

const main = async () => {
	const imagesBefore = imagesNow();
	const containersBefore = containersNow();
	// Every run starts on empty objects: what a run before kept in workerd's local storage goes.
	rmSync(join(dir, ".alchemy", "local"), {recursive: true, force: true});
	const built = await buildWorker();
	note("bundle", {bytes: built.bytes, nodeImports: built.nodeImports});

	const fakeKeys: Record<string, string> = {
		[people.a.key]: people.a.who,
		[people.b.key]: people.b.who,
	};
	const standin = spawn("node", [join(dir, "standin.ts"), "8799"], {
		env: env({FAKE_KEYS: JSON.stringify(fakeKeys)}),
		stdio: "ignore",
	});
	const sessions = Object.fromEntries(Object.values(people).map((p) => [p.session, p.who]));
	const dev = spawn(
		join(dir, "node_modules", ".bin", "alchemy"),
		["dev", "stack.run.ts", "--stage", "local", "--no-input"],
		{
			cwd: dir,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: env({
				// The egress catch's helper, the build for this laptop's CPU (see the write-up).
				CONTAINER_EGRESS_INTERCEPTOR_IMAGE:
					"cloudflare/proxy-everything@sha256:78c7910f4575a511d928d7824b1cbcaec6b7c4bf4dbb3fafaeeae3104030e73c",
				DO_NOT_TRACK: "1",
				CI: "1",
				ALCHEMY_HOME: join(dir, "alchemy-home"),
				UPSTREAM: "http://127.0.0.1:8799",
				KEY_SEAL: seal,
				SESSIONS: JSON.stringify(sessions),
			}),
		},
	);
	let devLog = "";
	dev.stdout.on("data", (d) => {
		devLog += d;
	});
	dev.stderr.on("data", (d) => {
		devLog += d;
	});
	const stop = async () => {
		if (dev.pid !== undefined) {
			try {
				process.kill(-dev.pid, "SIGTERM");
			} catch {}
		}
		standin.kill("SIGTERM");
		await wait(3000);
		if (dev.pid !== undefined) {
			try {
				process.kill(-dev.pid, "SIGKILL");
			} catch {}
		}
	};

	try {
		for (let i = 0; i < 240 && !devLog.includes("Started in"); i++) await wait(500);
		if (!devLog.includes("Started in")) throw new Error(`alchemy dev did not start:\n${devLog}`);

		// Keys: each person's, sealed in their own object. What is kept at rest is not the key.
		for (const p of [people.a, people.b])
			await call(p.session, "/person/key", {method: "PUT", body: p.key ?? ""});
		const row = (await call(people.a.session, "/person/row")).body;
		note("keyAtRest", {
			fields: Object.keys(row ?? {}),
			holdsKeyText: JSON.stringify(row).includes(people.a.key),
		});
		note("noSession", (await call("sess-none", `/p/${PROJECT}/status`)).status);

		// Q1, Q2: tsh in the host object; the counter, its jobs, presses.
		const a1 = await open(people.a);
		note("firstOpen", {attachMs: a1.ms, opened: a1.opened});
		const A = a1.c;
		note("counterBg", await run(A, "counter &"));
		note("jobs", await run(A, "jobs"));
		for (let i = 0; i < 3; i++) await run(A, "tell %1 press plus");
		note("jobsAfterPresses", await run(A, "jobs"));
		note("timersIdle", (await status()).timers);

		// Q3: a job that needs a box: one box, its model call on the starter's key.
		note("askA", await runUntil(A, "box --run 'node /app/ask.mjs hello'", /exit/));
		const b1 = await open(people.b);
		const B = b1.c;
		note("askB", await runUntil(B, "box --run 'node /app/ask.mjs hi'", /exit/));
		const c1 = await open(people.c);
		note("askNoKey", await runUntil(c1.c, "box --run 'node /app/ask.mjs hi'", /exit/));
		c1.c.close();
		note("standinLog", (await (await fetch("http://127.0.0.1:8799/log")).json()) as unknown);

		// The probe: a box running a job, looked through as root and as the job's user. The job outlives the probe: the box goes when its job ends.
		const before = A.heard.length;
		const sleeper = await run(A, "box --run 'sleep 40; echo slept' &");
		let job = "";
		for (let i = 0; i < 40 && job === ""; i++) {
			const boxes = (await status()).boxes as Record<string, {state: string}>;
			job =
				Object.entries(boxes)
					.find(([, v]) => v.state === "running")?.[0]
					.slice(4) ?? "";
			if (job === "") await wait(250);
		}
		await wait(1500);
		const probeAt = Date.now();
		const found = (await call(people.a.session, `/p/${PROJECT}/probe?job=${job}`)).body;
		note("probe", {job, sleeper, probeMs: Date.now() - probeAt, found});
		await A.until((m) => m.type === "printed" && /slept/.test(m.text ?? ""), 90000, before);
		note("sleeperJob", (await call(people.a.session, `/p/${PROJECT}/job?job=${job}`)).body);

		// Q4: eviction. Storage stays, memory goes; the next message opens tsh again on it.
		const wakes: unknown[] = [];
		await evict([A, B]);
		const a2 = await open(people.a);
		wakes.push({attachMs: a2.ms, opened: a2.opened});
		note("afterEviction", {
			wake: wakes[0],
			jobs: await run(a2.c, "jobs"),
			press: await run(a2.c, "tell %1 press plus"),
		});
		note("counterDone", await runUntil(a2.c, "tell %1 press done", /\b4\b/));

		// A job's end wakes an evicted host: the box ends while no host object is in memory.
		const doneNow = async () =>
			Object.values((await status()).boxes as Record<string, {state: string}>).filter(
				(v) => v.state === "done",
			).length;
		const doneBefore = await doneNow();
		const fg = a2.c.heard.length;
		a2.c.line("box --run 'sleep 4; echo woke-me' &");
		await a2.c.until((m) => m.type === "ready", 20000, fg);
		await wait(1500);
		await evict([a2.c]);
		const t0 = Date.now();
		let woke = null;
		for (let i = 0; i < 60 && woke === null; i++) {
			await wait(500);
			if ((await doneNow()) > doneBefore) woke = {afterMs: Date.now() - t0, status: await status()};
		}
		const a3 = await open(people.a);
		note("jobEndWokeHost", {woke, reopened: a3.opened, jobs: await run(a3.c, "jobs")});

		// Rebuild time on wake: a job in the table, five evictions in a row.
		await run(a3.c, "counter &");
		let c = a3.c;
		for (let i = 0; i < 5; i++) {
			await evict([c]);
			const o = await open(people.a);
			wakes.push({attachMs: o.ms, opened: o.opened});
			c = o.c;
		}
		note("wakes", wakes);
		note("timersAfter", (await status()).timers);
		note("ledger", (await call(people.a.session, `/p/${PROJECT}/ledger`)).body);
		c.close();
		B.close();
		note("facts", (await status()).facts);
		// Every job's box is gone once its job ended: what Docker still holds of this stack now.
		await wait(2000);
		note(
			"boxesLeft",
			docker("ps", "-a", "--format", "{{.Names}} {{.Status}}").filter((l) => OURS.test(l)),
		);
	} finally {
		await stop();
		// Everything this run made in Docker goes, and nothing else.
		const newContainers = [...containersNow()].filter((id) => !containersBefore.has(id));
		for (const id of newContainers) docker("rm", "-f", id);
		const newImages = [...imagesNow()].filter((id) => !imagesBefore.has(id));
		for (const id of newImages) {
			try {
				docker("rmi", "-f", id);
			} catch {}
		}
		results.cleanup = {containers: newContainers.length, images: newImages.length};
		writeFileSync(join(dir, "dev.log"), devLog);
	}
	const out = join(import.meta.dirname, "results", "148-remote-programs.json");
	mkdirSync(join(import.meta.dirname, "results"), {recursive: true});
	writeFileSync(out, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(`wrote ${out}`);
};

const lives = {
	live: "./148-remote-programs/live.ts",
	"live-box": "./148-remote-programs/live-box.ts",
	egress: "./148-remote-programs/egress.ts",
};
const part = lives[process.argv[2] as keyof typeof lives] as string | undefined;
if (part !== undefined) {
	// Alchemy reads the working folder once, as it loads (experiment 147), and would read a `.env`
	// there: so first a fresh, empty temp folder, then Alchemy.
	const work = mkdtempSync(join(tmpdir(), "tf-exp-148-"));
	process.chdir(work);
	process.env.ALCHEMY_HOME = join(work, "alchemy-home");
	process.env.DO_NOT_TRACK = "1";
	delete process.env.TYPESAFE_API_KEY;
	await import(part);
} else await main();
