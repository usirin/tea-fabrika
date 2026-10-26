// Experiment 148's live box round: the stack with its job box on Cloudflare, deployed from code
// (experiment 147), played against, and destroyed in a `finally`. Loaded by the driver after it
// has moved into a fresh temp folder, so Alchemy's state (which holds the account id) never lands
// in the repo.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live-box small
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts live-box full
//   ... TF_CLAUDE_TOKEN=... node experiments/148-remote-programs.ts live-box full
//
// small: the image built and pushed, a first box, the three asks. full: the same, then box cold
// starts, the probe, the beat on and a job's end waking a sleeping host, the beat off, and what a
// box leaves behind. With TF_CLAUDE_TOKEN, last: the decided design, real Claude Code in a box on
// its starter's own subscription token, one call. `sweep`: only the cleanup, by the prefix.
//
// The model of the asks is the Worker's own stand-in entrypoint: no real model, no real key.
// Every made-up secret is made here, for this run. Results are written with the account id, the
// workers.dev address and the token taken out; the token is never printed, and is checked for.
import {createHash, randomBytes} from "node:crypto";
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

const full = process.argv.includes("full");
const work = process.cwd();
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const claude = (process.env.TF_CLAUDE_TOKEN ?? "").trim() || null;
// full: -live-box.json (a second full run was saved as -live-box-2.json by hand). small with the
// token: -live-box-token.json, and with `noclaude`, -live-box-token-probe.json.
const kind =
	claude !== null
		? process.argv.includes("noclaude")
			? "-token-probe"
			: "-token"
		: full
			? ""
			: "-small";
const resultsFile = join(
	import.meta.dirname,
	"..",
	"results",
	`148-remote-programs-live-box${kind}.json`,
);
if (!account || !token)
	throw new Error("live needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
// From here on, the credentials live in this process's memory only. Nothing this process starts
// (Alchemy's docker build) inherits them.
for (const k of Object.keys(process.env))
	if (k.startsWith("CLOUDFLARE_") || k === "TF_CLAUDE_TOKEN") delete process.env[k];

const PREFIX = "tf-exp-148";
const PROJECT = "p1";
const REGISTRY = "registry.cloudflare.com";
const hex = (n: number) => randomBytes(n).toString("hex");
const people = {
	a: {who: "github:1", session: `sess-${hex(16)}`, key: `fake-key-${hex(16)}`},
	b: {who: "github:2", session: `sess-${hex(16)}`, key: `fake-key-${hex(16)}`},
	c: {who: "github:3", session: `sess-${hex(16)}`, key: null},
};
const seal = `seal-${hex(16)}`;
const sessions = JSON.stringify(
	Object.fromEntries(Object.values(people).map((p) => [p.session, p.who])),
);
const fakeKeys = JSON.stringify({[people.a.key]: people.a.who, [people.b.key]: people.b.who});

/** The token's text, and the forms a job might print it in, none of which may leave this process. */
const tokenForms =
	claude === null
		? []
		: [
				claude,
				Buffer.from(claude).toString("base64"),
				Buffer.from(`${claude}\n`).toString("base64"),
			];
/** A short hash, to say which token without saying it. */
const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);
const scrub = (s: string) => {
	let out = s
		.split(account)
		.join("<account>")
		.split(work)
		.join("<work>")
		.split(join(import.meta.dirname, "..", ".."))
		.join("<repo>")
		.replace(/[a-z0-9.-]+\.workers\.dev/g, "<workers.dev>");
	for (const [i, f] of tokenForms.entries()) out = out.split(f).join(`<token form ${i}>`);
	return out;
};
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
				FAKE_KEYS: fakeKeys,
			}),
			below,
		),
	),
);
const stack = stackOf({boxes: true, standin: true, secrets});

// ---- Cloudflare's own API: what this run made, by its prefix only ------------------------------
const cf = async (path: string, method = "GET", body?: unknown) => {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body === undefined ? {} : {"content-type": "application/json"}),
		},
		...(body === undefined ? {} : {body: JSON.stringify(body)}),
	});
	const text = await res.text();
	try {
		return {status: res.status, ...(JSON.parse(text) as {success: boolean; result: unknown})};
	} catch {
		return {status: res.status, success: false, result: null};
	}
};
type App = {id: string; name: string};
const apps = async () =>
	(((await cf("/containers/applications")).result ?? []) as App[]).filter((a) =>
		a.name.startsWith(PREFIX),
	);
/** The registry, as wrangler's `containers images` reads it: a short-lived login, then the catalog. */
const registry = async () => {
	const creds = (
		await cf(`/containers/registries/${REGISTRY}/credentials`, "POST", {
			expiration_minutes: 5,
			permissions: ["pull", "push"],
		})
	).result as {username?: string; user?: string; password?: string} | null;
	if (!creds?.password) return null;
	const auth = `Basic ${Buffer.from(`${creds.username ?? creds.user ?? "v1"}:${creds.password}`).toString("base64")}`;
	const res = await fetch(`https://${REGISTRY}/v2/_catalog?tags=true`, {
		headers: {authorization: auth},
	});
	const repos = res.ok
		? (((await res.json()) as {repositories?: Record<string, string[]>}).repositories ?? {})
		: {};
	const strip = (r: string) => r.replace(/^\/+/, "").replace(`${account}/`, "");
	const mine = Object.entries(repos)
		.filter(([r]) => strip(r).startsWith(PREFIX))
		.map(([r, tags]) => ({repo: strip(r), tags}));
	return {auth, status: res.status, mine, others: Object.keys(repos).length - mine.length};
};
const instances = async (app: App) => {
	const r = await cf(`/containers/dash/applications/${app.id}/instances`);
	const rows = (
		Array.isArray(r.result) ? r.result : ((r.result as {instances?: unknown[]})?.instances ?? [])
	) as Record<string, unknown>[];
	return {
		status: r.status,
		// The answer's shape, in names only: this endpoint is the dashboard's, not documented.
		shape: Array.isArray(r.result) ? "array" : Object.keys(r.result ?? {}).join(","),
		count: rows.length,
		states: rows.map((i) => i.state ?? i.status ?? i.current_state ?? Object.keys(i).join("|")),
	};
};
const ours = async () => {
	const scripts = (((await cf("/workers/scripts")).result ?? []) as {id: string}[]).map(
		(s) => s.id,
	);
	const spaces = ((await cf("/workers/durable_objects/namespaces?per_page=1000")).result ?? []) as {
		script: string | null;
		name: string;
	}[];
	const ns = (n: {script: string | null; name: string}) => n.script ?? n.name ?? "";
	const reg = await registry();
	return {
		scripts: scripts.filter((s) => s.startsWith(PREFIX)),
		namespaces: spaces.filter((n) => ns(n).startsWith(PREFIX)).map((n) => n.name),
		containerApps: (await apps()).map((a) => a.name),
		images: reg?.mine ?? "registry login failed",
		otherScripts: scripts.filter((s) => !s.startsWith(PREFIX)).length,
		otherNamespaces: spaces.filter((n) => !ns(n).startsWith(PREFIX)).length,
		otherRepos: reg?.others ?? null,
	};
};
/** Delete by hand anything named tf-exp-148 that Alchemy left, found by listing, by prefix only. */
const sweep = async () => {
	const swept: string[] = [];
	for (const a of await apps()) {
		if (!a.name.startsWith(PREFIX)) continue;
		swept.push(`app ${a.name}: ${(await cf(`/containers/applications/${a.id}`, "DELETE")).status}`);
	}
	const found = await ours();
	for (const s of found.scripts) {
		if (!s.startsWith(PREFIX)) continue;
		swept.push(`script ${s}: ${(await cf(`/workers/scripts/${s}?force=true`, "DELETE")).success}`);
	}
	// Images: a tag first, then the manifests under it, so a few passes. A manifest an index still
	// points at answers 409 until the index is gone.
	for (let pass = 0; pass < 3; pass++) {
		const reg = await registry();
		if ((reg?.mine.length ?? 0) === 0) break;
		await sweepImages(reg, swept);
	}
	return swept;
};
const sweepImages = async (reg: Awaited<ReturnType<typeof registry>>, swept: string[]) => {
	for (const {repo, tags} of reg?.mine ?? []) {
		if (!repo.startsWith(PREFIX)) continue;
		for (const tag of tags) {
			const url = `https://${REGISTRY}/v2/${account}/${repo}/manifests/${tag}`;
			const accept =
				"application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json";
			const head = await fetch(url, {
				method: "HEAD",
				headers: {authorization: reg?.auth ?? "", accept},
			});
			const del = await fetch(url, {
				method: "DELETE",
				headers: {authorization: reg?.auth ?? "", accept},
			});
			const why = del.ok ? "" : ` ${(await del.text()).slice(0, 300)}`;
			swept.push(`image ${repo}:${tag}: head ${head.status}, delete ${del.status}${why}`);
		}
	}
	if ((reg?.mine.length ?? 0) > 0) {
		const gc = await fetch(`https://${REGISTRY}/v2/gc/layers`, {
			method: "PUT",
			headers: {authorization: reg?.auth ?? "", "content-type": "application/json"},
		});
		swept.push(`registry gc: ${gc.status}`);
	}
	return swept;
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
	wake: {born: number};
	wakes: number[];
	boxes: Record<string, {state: string}>;
	facts: unknown;
};
const status = async () => (await call(people.a.session, `/p/${PROJECT}/status`)).body as Status;
type Row = {
	state: string;
	startMs: number;
	firstMs?: number;
	took?: number;
	beats: number;
	beat: boolean;
	at: number;
	leak?: boolean;
	ended?: {said: string; code: number};
};
const jobRow = async (job: string) =>
	(await call(people.a.session, `/p/${PROJECT}/job?job=${job}`)).body as {
		row: Row | null;
		running: boolean;
	};
const runUntil = async (c: Client, line: string, test: RegExp, ms = 90000) => {
	const from = c.heard.length;
	const t0 = Date.now();
	c.line(line);
	const hit = await c.until((m) => m.type === "printed" && test.test(m.text ?? ""), ms, from);
	return {line, printed: hit.text ?? "", ms: Date.now() - t0};
};
const open = async (p: {session: string}) => {
	const c = await attach(base, PROJECT, p.session);
	const opened = await c.until((m) => m.type === "opened", 30000);
	return {c, opened};
};
/**
 * Run one box job in tsh to its end, and say which job it was, from the host's own table. In the
 * foreground, so what the page heard is the answer. Two foreground jobs of the live rounds never
 * printed their end to the open page (see the write-up), so `rowJob` below is the other way.
 */
const fgJob = async (c: Client, cmd: string, ms = 90000) => {
	const before = new Set(Object.keys((await status()).boxes));
	const newJob = async () =>
		Object.keys((await status()).boxes)
			.find((k) => !before.has(k))
			?.slice(4) ?? "";
	try {
		const r = await runUntil(c, `box --run '${cmd}'`, /\(exit -?\d+\)/, ms);
		return {...r, job: await newJob()};
	} catch (e) {
		// Not ended in time: say how the job's object sees it, then go on.
		const job = await newJob();
		throw new Error(`${cmd}: ${String(e)}; job ${JSON.stringify(await jobRow(job))}`);
	}
};
/** Start a box job in the background in tsh; answers its id once the host has it running. */
const bgJob = async (c: Client, cmd: string) => {
	const before = new Set(Object.keys((await status()).boxes));
	const from = c.heard.length;
	c.line(`box --run '${cmd}' &`);
	await c.until((m) => m.type === "ready", 30000, from);
	for (let i = 0; i < 60; i++) {
		const now = (await status()).boxes;
		const job = Object.keys(now).find((k) => !before.has(k));
		if (job !== undefined) return job.slice(4);
		await wait(250);
	}
	return "";
};
/** Run one box job in the background in tsh, and read its end from the job's own object. */
const rowJob = async (c: Client, cmd: string, ms = 90000) => {
	const t0 = Date.now();
	const job = await bgJob(c, cmd);
	for (;;) {
		const r = await jobRow(job);
		if (r.row?.state === "done")
			return {
				line: cmd,
				printed: `${r.row.ended?.said ?? ""} (exit ${r.row.ended?.code})`,
				ms: Date.now() - t0,
				job,
			};
		if (Date.now() - t0 > ms)
			throw new Error(`${cmd}: not done in ${ms} ms; job ${JSON.stringify(r)}`);
		await wait(1000);
	}
};
/** The token round, and every run with the token, uses the background way only. */
const boxJob = (c: Client, cmd: string, ms = 90000) =>
	claude === null ? fgJob(c, cmd, ms) : rowJob(c, cmd, ms);
const timing = (r: {row: Row | null}) => ({
	startMs: r.row?.startMs,
	firstMs: r.row?.firstMs,
	took: r.row?.took,
	code: r.row?.ended?.code,
});
/** Watch the application's instances from Cloudflare's API, without touching any object. */
const watch = async (ms: number, every = 5000) => {
	const app = (await apps())[0];
	const seen: unknown[] = [];
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (app !== undefined) seen.push({at: Date.now() - t0, ...(await instances(app))});
		await wait(every);
	}
	return seen;
};

/** The token round runs only once the stand-in round has passed, in the same run. */
let standinPassed = false;

const smallRound = async (a: Client) => {
	// The first box after a deploy: tried until one ends right, every try kept.
	const tries: unknown[] = [];
	for (let i = 0; i < 10; i++) {
		const t0 = Date.now();
		try {
			const r = await boxJob(a, "echo hi", 120000);
			const row = await jobRow(r.job);
			tries.push({afterDeployMs: Date.now() - t0, printed: r.printed, ms: r.ms, ...timing(row)});
			if (/^hi/.test(r.printed)) break;
		} catch (e) {
			tries.push({error: String(e)});
		}
		await wait(15000);
	}
	note("firstBox", tries);
	const askA = await boxJob(a, "node /app/ask.mjs hello");
	note("askA", askA);
	standinPassed = /standin answered github:1/.test(askA.printed);
	const b = await open(people.b);
	note("askB", await boxJob(b.c, "node /app/ask.mjs hi"));
	b.c.close();
	const c = await open(people.c);
	note("askNoKey", await boxJob(c.c, "node /app/ask.mjs hi"));
	c.c.close();
	const app = (await apps())[0];
	if (app !== undefined) note("instancesAfterAsks", await instances(app));
};

const fullRound = async (a: Client) => {
	// Cold starts: a new box for each, one after another.
	const cold: unknown[] = [];
	for (let i = 0; i < 4; i++) {
		const r = await boxJob(a, "echo hi");
		cold.push({ms: r.ms, ...timing(await jobRow(r.job))});
	}
	note("coldStarts", cold);

	// The probe: a running box, looked through as root and as the job's user.
	const sleeper = await bgJob(a, "sleep 40; echo slept");
	await wait(3000);
	const probeAt = Date.now();
	const found = (await call(people.a.session, `/p/${PROJECT}/probe?job=${sleeper}`)).body;
	note("probe", {probeMs: Date.now() - probeAt, found});
	await a.until((m) => m.type === "printed" && /slept/.test(m.text ?? ""), 120000);
	note("sleeperJob", timing(await jobRow(sleeper)));
	note("instancesAfterSleeper", await watch(11000));

	// The beat on, a 40 s job, the page closed: does the job's end wake the sleeping host?
	const woke = await bgJob(a, "sleep 40; echo woke-me");
	const bornBefore = (await status()).wake.born;
	a.close();
	const startedAt = Date.now();
	note("instancesBeatOn", await watch(75000));
	const s = await status();
	const row = await jobRow(woke);
	const endAt = (row.row?.at ?? 0) + (row.row?.took ?? 0);
	note("beatOn", {
		...timing(row),
		beats: row.row?.beats,
		state: row.row?.state,
		hostBornBefore: bornBefore - startedAt,
		hostBornNow: s.wake.born - startedAt,
		jobEndedAt: endAt - startedAt,
		// Every time the host was made again since the job began, from the page's close on.
		hostWakes: s.wakes.filter((w) => w >= bornBefore).map((w) => w - startedAt),
		hostWokeByJobEnd: s.wakes.some((w) => w > bornBefore && w >= endAt - 1000 && w <= endAt + 5000),
		hostBox: s.boxes[`box:${woke}`],
	});
	const back = await open(people.a);
	const from = back.c.heard.length;
	back.c.line("jobs");
	await back.c.until((m) => m.type === "ready", 30000, from);
	note("jobsAfterWake", {
		opened: back.opened,
		printed: back.c.heard
			.slice(from)
			.filter((m) => m.type === "printed")
			.map((m) => m.text),
	});

	// The beat off: one 40 s job whose object sets no alarm. Nothing touches it for 90 s.
	const nb = (
		await call(people.a.session, `/p/${PROJECT}/nobeat`, {
			method: "POST",
			body: "sleep 40; echo slept-without-beat",
		})
	).body as {job: string};
	note("instancesBeatOff", await watch(90000));
	const off = await jobRow(nb.job);
	note("beatOff", {
		...timing(off),
		state: off.row?.state,
		running: off.running,
		said: off.row?.ended?.said,
		beats: off.row?.beats,
	});
	return back.c;
};

/** The decided design: real Claude Code in a box, on its starter's own subscription token. */
const tokenRound = async (a: Client) => {
	if (claude === null || !standinPassed) return;
	note("token", {shape: /^sk-ant-oat01-/.test(claude), hash: short(claude)});
	await call(people.a.session, "/person/token", {method: "PUT", body: claude});
	const has = (s: string, f: string) => (s.includes(f) ? "yes" : "no");

	// The network: only api.anthropic.com, with no credential sent.
	const net = await boxJob(a, "node /app/net.mjs", 120000);
	note("tokenNet", {printed: net.printed, ...timing(await jobRow(net.job))});

	// The output check: a job that prints its token as it is, and one that prints it encoded.
	const plain = await boxJob(a, "printenv CLAUDE_CODE_OAUTH_TOKEN");
	const plainRow = await jobRow(plain.job);
	note("tokenPrinted", {
		outputGotToken: has(plain.printed, claude),
		withheld: plainRow.row?.leak,
		rowHoldsToken: has(JSON.stringify(plainRow), claude),
	});
	const b64 = await boxJob(a, "printenv CLAUDE_CODE_OAUTH_TOKEN | base64 -w0");
	const b64Row = await jobRow(b64.job);
	note("tokenPrintedBase64", {
		outputGotEncodedToken: tokenForms.slice(1).some((f) => b64.printed.includes(f)) ? "yes" : "no",
		withheld: b64Row.row?.leak,
	});
	const ledger = JSON.stringify((await call(people.a.session, `/p/${PROJECT}/ledger`)).body);
	note("tokenOnLedger", {
		plain: has(ledger, claude),
		encoded: tokenForms.slice(1).some((f) => ledger.includes(f)) ? "yes" : "no",
	});

	// The probe: now the token is in the box, on purpose. Found or not, no value.
	// The first try, in the full round with the token, answered no box: it had not started yet.
	const sleeper = await bgJob(a, "sleep 45; echo slept");
	type Probe = {error?: string; root?: {found?: unknown}; job?: {found?: unknown}};
	let p: Probe = {error: "not asked"};
	const tries: unknown[] = [];
	for (let i = 0; i < 10; i++) {
		await wait(3000);
		const r = await call(people.a.session, `/p/${PROJECT}/probe?job=${sleeper}`);
		p = (typeof r.body === "object" && r.body !== null ? r.body : {error: String(r.body)}) as Probe;
		if (p.root !== undefined) break;
		tries.push({status: r.status, error: String(p.error ?? "").slice(0, 300)});
	}
	note("tokenProbe", {tries, root: p.root?.found ?? p.root, job: p.job?.found ?? p.job});
	for (let i = 0; i < 90 && (await jobRow(sleeper)).row?.state !== "done"; i++) await wait(1000);

	// One real call: unmodified Claude Code, the cheapest model, one turn. Not with `noclaude`:
	// the call ran once, and a rerun for the probe makes none.
	if (process.argv.includes("noclaude")) return;
	const t0 = Date.now();
	const real = await boxJob(
		a,
		'claude -p "say hi in two words" --model haiku --max-turns 1 --output-format json',
		180000,
	);
	const realRow = await jobRow(real.job);
	let answer: Record<string, unknown> = {};
	try {
		const j = JSON.parse(real.printed.replace(/\s*\(exit -?\d+\)\s*$/, "")) as Record<
			string,
			unknown
		>;
		answer = {
			is_error: j.is_error,
			subtype: j.subtype,
			result: j.result,
			duration_ms: j.duration_ms,
			duration_api_ms: j.duration_api_ms,
			num_turns: j.num_turns,
			total_cost_usd: j.total_cost_usd,
			usage: j.usage,
		};
	} catch {
		answer = {raw: real.printed.slice(0, 600)};
	}
	note("claudeCall", {
		wallMs: Date.now() - t0,
		...timing(realRow),
		answer,
		outputGotToken: has(real.printed, claude),
	});
	// Everything the page heard in this run, the token round's jobs included.
	note("tokenOnPage", {
		plain: has(a.printed(), claude),
		encoded: tokenForms.slice(1).some((f) => a.printed().includes(f)) ? "yes" : "no",
	});
};

const main = async () => {
	const built = await buildWorker();
	note("bundle", {bytes: built.bytes, nodeImports: built.nodeImports});
	note("before", await ours());
	let a: Client | null = null;
	try {
		const t = Date.now();
		const out = (await Effect.runPromise(
			deploy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		)) as {url?: string};
		note("deploy", {ms: Date.now() - t, url: out.url !== undefined});
		if (out.url === undefined) throw new Error("no workers.dev address");
		base = out.url.replace(/\/$/, "");
		note("afterDeploy", await ours());
		for (let up = 0; up < 120; up++) {
			const r = await fetch(`${base}/p/${PROJECT}/status`).catch(() => null);
			if (r?.status === 401) break;
			await wait(1000);
		}
		for (const p of [people.a, people.b])
			await call(p.session, "/person/key", {method: "PUT", body: p.key ?? ""});
		a = (await open(people.a)).c;
		await smallRound(a);
		if (full) a = await fullRound(a);
		await tokenRound(a);
		note("facts", (await status()).facts);
	} catch (e) {
		note("error", scrub(String((e as Error)?.stack ?? e)).slice(0, 3000));
	} finally {
		a?.close();
		const t = Date.now();
		const gone = await Effect.runPromiseExit(
			destroy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		);
		note("destroy", {ms: Date.now() - t, ok: gone._tag === "Success"});
		note("afterDestroy", await ours());
		note("swept", await sweep());
		note("afterCleanup", await ours());
		mkdirSync(join(import.meta.dirname, "..", "results"), {recursive: true});
		const text = `${JSON.stringify(results, null, "\t")}\n`;
		// The last check: nothing the run saves holds the token in any form it knows. If it does,
		// nothing is written and the run fails, but the work folder still goes.
		if (tokenForms.some((f) => text.includes(f))) {
			console.error("not written: the results held the token");
			process.exitCode = 1;
		} else writeFileSync(resultsFile, text);
		// Alchemy's state holds the account id and the address in plain text (experiment 144).
		rmSync(work, {recursive: true, force: true});
	}
};

if (process.argv.includes("sweep")) {
	// Only the cleanup: list by the prefix, delete what is there, list again.
	console.log("before", scrub(JSON.stringify(await ours())));
	console.log("swept", scrub(JSON.stringify(await sweep())));
	console.log("after", scrub(JSON.stringify(await ours())));
	rmSync(work, {recursive: true, force: true});
} else await main();
