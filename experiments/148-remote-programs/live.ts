// Experiment 148's live part: the same stack on Cloudflare, deployed from code (experiment 147),
// played against, and destroyed in a `finally`. Loaded by the driver after it has moved into a
// fresh temp folder, so Alchemy's state (which holds the account id) never lands in the repo.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live
//
// The token may not use Containers (its listing answers 403), so the box is left out: a box job
// answers "the box did not start". What this part measures is the host as a Durable Object on
// Cloudflare: does it sleep when idle, with and without a page open, what a wake costs, and
// does every job come back. Every made-up secret is made here, for this run. Results are written
// with the account id and the workers.dev address taken out.
import {randomBytes} from "node:crypto";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemy from "alchemy";
import {AlchemyContextLive} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import {destroy} from "alchemy/Destroy";
import * as Interaction from "alchemy/Interaction";
import {ConfigProvider, Effect, Layer} from "effect";
import {attach, type Client} from "./attach.ts";
import {buildWorker} from "./build.ts";
import {stackOf} from "./stack.ts";

const resultsFile = join(import.meta.dirname, "..", "results", "148-remote-programs-live.json");
const work = process.cwd();
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if (!account || !token)
	throw new Error("live needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
// From here on, the credentials live in this process's memory only, and go to Alchemy in code.
for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];

const PREFIX = "tf-exp-148";
const PROJECT = "p1";
const hex = (n: number) => randomBytes(n).toString("hex");
const people = {
	a: {who: "github:1", session: `sess-${hex(16)}`, key: `fake-key-${hex(16)}`},
	b: {who: "github:2", session: `sess-${hex(16)}`, key: null},
};
const seal = `seal-${hex(16)}`;
const sessions = JSON.stringify(
	Object.fromEntries(Object.values(people).map((p) => [p.session, p.who])),
);

const scrub = (s: string) =>
	s
		.split(account)
		.join("<account>")
		.split(work)
		.join("<work>")
		.split(join(import.meta.dirname, "..", ".."))
		.join("<repo>")
		.replace(/[a-z0-9.-]+\.workers\.dev/g, "<workers.dev>");
const results: Record<string, unknown> = {date: new Date().toISOString().slice(0, 10)};
const note = (k: string, v: unknown) => {
	results[k] = JSON.parse(scrub(JSON.stringify(v ?? null)));
	console.log(k, scrub(JSON.stringify(v ?? null)).slice(0, 1500));
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const engine = Layer.mergeAll(
	AlchemyContextLive,
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),
	Alchemy.localState(),
).pipe(Layer.provideMerge(NodeServices.layer));
const secrets = ConfigProvider.layer(
	Effect.map(ConfigProvider.ConfigProvider, (below) =>
		ConfigProvider.orElse(
			ConfigProvider.fromUnknown({
				CLOUDFLARE_API_TOKEN: token,
				CLOUDFLARE_ACCOUNT_ID: account,
				KEY_SEAL: seal,
				SESSIONS: sessions,
			}),
			below,
		),
	),
);
const stack = stackOf({boxes: false, secrets});

// ---- Cloudflare's own API, for the listing that confirms cleanup ------------------------------
const cf = async (path: string, method = "GET") => {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
		method,
		headers: {authorization: `Bearer ${token}`},
	});
	return {status: res.status, ...((await res.json()) as {success: boolean; result: unknown})};
};
const ours = async () => {
	const scripts = (((await cf("/workers/scripts")).result ?? []) as {id: string}[]).map(
		(s) => s.id,
	);
	const spaces = ((await cf("/workers/durable_objects/namespaces?per_page=1000")).result ?? []) as {
		id: string;
		script: string | null;
		name: string;
	}[];
	const ns = (n: {script: string | null; name: string}) => n.script ?? n.name ?? "";
	return {
		scripts: scripts.filter((s) => s.startsWith(PREFIX)),
		namespaces: spaces.filter((n) => ns(n).startsWith(PREFIX)).map((n) => `${ns(n)} / ${n.name}`),
		otherScripts: scripts.filter((s) => !s.startsWith(PREFIX)).length,
		otherNamespaces: spaces.filter((n) => !ns(n).startsWith(PREFIX)).length,
		containers: (await cf("/containers/applications")).status,
	};
};
/** Delete by hand anything named tf-exp-148 that Alchemy left, found by listing, by prefix only. */
const sweep = async () => {
	const found = await ours();
	for (const s of found.scripts) {
		if (!s.startsWith(PREFIX)) continue;
		const r = await cf(`/workers/scripts/${s}?force=true`, "DELETE");
		console.log(`swept ${s}: ${r.success}`);
	}
	return found.scripts;
};

// ---- the play ---------------------------------------------------------------------------------
let base = "";
const call = async (session: string, path: string, init: RequestInit = {}) => {
	const res = await fetch(`${base}${path}`, {
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
type Status = {
	wake: {born: number; opened: unknown[]};
	timers: number;
	facts: unknown;
	inMemory: string[];
};
const status = async () => (await call(people.a.session, `/p/${PROJECT}/status`)).body as Status;
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
const runUntil = async (c: Client, line: string, test: RegExp, ms = 60000) => {
	const from = c.heard.length;
	const t0 = Date.now();
	c.line(line);
	const hit = await c.until((m) => m.type === "printed" && test.test(m.text ?? ""), ms, from);
	return {line, printed: hit.text, ms: Date.now() - t0};
};
/** Type a line, then keep everything heard for `ms`: what a wake prints, in its order. */
const heardAfter = async (c: Client, line: string, ms = 6000) => {
	const from = c.heard.length;
	c.line(line);
	await wait(ms);
	return {
		line,
		heard: c.heard.slice(from).map((m) => (m.type === "printed" ? m.text : `<${m.type}>`)),
	};
};
const open = async (p: {session: string}) => {
	const t0 = Date.now();
	const c = await attach(base, PROJECT, p.session);
	const opened = await c.until((m) => m.type === "opened", 30000);
	return {c, opened, ms: Date.now() - t0};
};

/** Idle for `ms` with no message at all, then ask: was the host evicted meanwhile? */
const idle = async (ms: number, born: number) => {
	await wait(ms);
	const t0 = Date.now();
	const s = await status();
	return {idleMs: ms, evicted: s.wake.born !== born, statusMs: Date.now() - t0, born: s.wake.born};
};

const play = async () => {
	// Up: until the new address answers.
	let up = 0;
	const t0 = Date.now();
	for (; up < 120; up++) {
		const r = await fetch(`${base}/p/${PROJECT}/status`).catch(() => null);
		if (r?.status === 401) break;
		await wait(1000);
	}
	note("firstAnswer", {ms: Date.now() - t0, tries: up + 1});

	await call(people.a.session, "/person/key", {method: "PUT", body: people.a.key});
	const row = (await call(people.a.session, "/person/row")).body;
	note("keyAtRest", {
		fields: Object.keys(row ?? {}),
		holdsKeyText: JSON.stringify(row).includes(people.a.key),
	});
	note("noSession", (await call("sess-none", `/p/${PROJECT}/status`)).status);

	// tsh in the host object on Cloudflare: the counter, its jobs, presses.
	const a1 = await open(people.a);
	note("firstOpen", {attachMs: a1.ms, opened: a1.opened});
	note("counterBg", await run(a1.c, "counter &"));
	for (let i = 0; i < 3; i++) await run(a1.c, "tell %1 press plus");
	note("jobsAfterPresses", await run(a1.c, "jobs"));
	note("boxJob", await runUntil(a1.c, "box --run 'echo hi'", /exit/));
	const s1 = await status();
	note("statusOpen", s1);

	// Does it sleep with the page still open? Hibernatable: it may. Then a line wakes it.
	// First a line on the open page, with nothing before it, so the line is what wakes it.
	await wait(30000);
	const lineAfter = await heardAfter(a1.c, "jobs");
	note("lineAfterIdle", {line: lineAfter, evicted: (await status()).wake.born !== s1.wake.born});
	note("lineAwake", await heardAfter(a1.c, "jobs"));
	const openIdle = await idle(30000, (await status()).wake.born);
	note("idleWithPageOpen", openIdle);

	// Page closed: idle 15 s, 30 s, 70 s, each ended by one status call.
	a1.c.close();
	const closed: unknown[] = [];
	let born = (await status()).wake.born;
	for (const ms of [15000, 30000, 70000]) {
		const r = await idle(ms, born);
		closed.push(r);
		born = r.born;
	}
	note("idlePageClosed", closed);

	// A wake by a page: tsh opens again, the counter attaches again where it left off.
	const wakes: unknown[] = [];
	for (let i = 0; i < 3; i++) {
		await wait(15000);
		const o = await open(people.a);
		wakes.push({attachMs: o.ms, opened: o.opened, jobs: await heardAfter(o.c, "jobs")});
		o.c.close();
	}
	note("wakesAfterIdle", wakes);
	// The same, with the host awake: what a wake adds is the difference.
	const warm: unknown[] = [];
	for (let i = 0; i < 3; i++) {
		const o = await open(people.a);
		warm.push({attachMs: o.ms, fresh: o.opened.fresh});
		if (i < 2) o.c.close();
		else {
			note("attachAwake", warm);
			await run(o.c, "tell %1 press plus");
			note("counterDone", await runUntil(o.c, "tell %1 press done", /^\[1\] \d+$/));
			o.c.close();
		}
	}
	const a2 = await open(people.a);
	note("timersAfter", (await status()).timers);
	note("facts", (await status()).facts);
	note("ledger", (await call(people.a.session, `/p/${PROJECT}/ledger`)).body);
	a2.c.close();
};

const main = async () => {
	const built = await buildWorker();
	note("bundle", {bytes: built.bytes, nodeImports: built.nodeImports});
	note("before", await ours());
	try {
		const t = Date.now();
		const out = (await Effect.runPromise(
			deploy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		)) as {url?: string};
		note("deploy", {ms: Date.now() - t, url: out.url !== undefined});
		if (out.url === undefined) throw new Error("no workers.dev address");
		base = out.url.replace(/\/$/, "");
		note("afterDeploy", await ours());
		await play();
	} catch (e) {
		note("error", scrub(String((e as Error)?.stack ?? e)).slice(0, 3000));
	} finally {
		const t = Date.now();
		const gone = await Effect.runPromiseExit(
			destroy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		);
		note("destroy", {ms: Date.now() - t, ok: gone._tag === "Success"});
		note("swept", await sweep());
		note("afterCleanup", await ours());
		mkdirSync(join(import.meta.dirname, "..", "results"), {recursive: true});
		writeFileSync(resultsFile, `${JSON.stringify(results, null, "\t")}\n`);
		// Alchemy's state holds the account id and the address in plain text (experiment 144).
		rmSync(work, {recursive: true, force: true});
	}
};

await main();
