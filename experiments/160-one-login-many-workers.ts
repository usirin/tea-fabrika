// Experiment 160: one login, many workers. One login manager per person holds the refresh token;
// several `codex app-server` jobs of that person run at once in `chatgptAuthTokens` mode and get
// only access tokens. The access token runs out mid-run, so every job asks for a refresh at about
// the same time.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 \
//     node experiments/160-one-login-many-workers.ts
//
// Real: `codex app-server` itself, from the laptop's install, each with its own throwaway
// CODEX_HOME under tmp/exp160 (deleted at the end). Fake: the model and the token server, from
// experiment 157 (`157-login-stays-home/fake-openai.ts`), on 127.0.0.1. A small proxy in front of
// the fake holds each job's second model call until every job is waiting and the access token has
// run out, then lets them go: that is how the expiry lands on all of them at once.
//
// Cases (CASES=together,staggered,loose,slow to pick; ROUNDS=3 rounds each, the slow one once):
//   together   4 jobs, the manager serial, all released at once
//   staggered  4 jobs, the manager serial, released 400 ms apart
//   loose      4 jobs, the manager's guards off on purpose, all released at once
//   slow       1 job, the manager serial, its refresh 12 s late (app-server waits about 10 s)
//
// Nothing here calls OpenAI, signs in, or reads the laptop's own Codex or Claude folders. $0.
//
// Node at the edge: node:http for the proxy, node:child_process for app-server's stdio, node:fs
// for the throwaway homes and the leak count.
import {type ChildProcessWithoutNullStreams, execFileSync, spawn} from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {createServer, type IncomingMessage} from "node:http";
import {homedir} from "node:os";
import {join} from "node:path";
import {createInterface} from "node:readline";
import {Effect, Exit, Schema} from "effect";
import {FetchHttpClient} from "effect/http";
import {type FakeOpenAI, startFakeOpenAI, TOOL_PRINTS} from "./157-login-stays-home/fake-openai.ts";
import {type Grant, type LoginManager, makeLoginManager} from "./lib/login-manager.ts";

const HERE = new URL(".", import.meta.url).pathname;
const FIXTURE = join(HERE, "..", "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "160-one-login-many-workers.json");
const WORK = join(HERE, "..", "tmp", "exp160");
const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");
const MODEL = "gpt-6-luna";
/** The first access token's life. Long enough for four app-servers to start and make one call. */
const FIRST_LIFE_MS = 10_000;
/** A refreshed access token's life: an hour, as OpenAI's token reference says. */
const REFRESHED_LIFE_MS = 3_600_000;
const JOB_TIMEOUT_MS = 90_000;
const PROMPT = (run: string) =>
	`Run the check you are given and say what it printed. [[run:${run}]]`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bodyOf = (req: IncomingMessage) =>
	new Promise<string>((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});
/** `codex --version`, with a throwaway home so it reads nothing of the laptop's own. */
const codexVersion = () =>
	execFileSync(CODEX, ["--version"], {
		env: {PATH: process.env.PATH ?? "", HOME: WORK, CODEX_HOME: join(WORK, "v")},
		encoding: "utf8",
	}).trim();
const runOf = (text: string) => /\[\[run:([a-z0-9-]+)\]\]/.exec(text)?.[1] ?? null;
const median = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? null : (s[Math.floor((s.length - 1) / 2)] ?? null);
};

// ---- The proxy: in front of the fake, it holds second calls and counts what passes. ----

/** One call a job made to the model host, as the proxy saw it. */
interface Seen {
	readonly run: string | null;
	readonly path: string;
	readonly status: number;
	/** Which access token it carried: 1 for the sign-in, 2 after one refresh. */
	readonly gen: number | null;
	readonly at: number;
	readonly heldMs: number;
}

/** Hold each job's second model call until `n` wait and `after` has passed; then let them go. */
interface Hold {
	readonly n: number;
	readonly after: number;
	readonly gapMs: number;
}

interface Proxy {
	readonly url: string;
	readonly seen: Seen[];
	/** Calls to the trap where Codex would refresh by itself. Should stay at 0. */
	readonly trap: string[];
	/** Every request's headers and body as text, for the leak count. */
	readonly wire: string[];
	readonly holdFor: (h: Hold | null) => void;
	readonly close: () => Promise<void>;
}

const startProxy = (fake: FakeOpenAI): Promise<Proxy> => {
	const seen: Seen[] = [];
	const trap: string[] = [];
	const wire: string[] = [];
	const calls = new Map<string, number>();
	let hold: Hold | null = null;
	let waiting: (() => void)[] = [];

	const release = async (h: Hold) => {
		const go = waiting;
		waiting = [];
		const left = h.after - Date.now();
		if (left > 0) await sleep(left);
		for (const [i, f] of go.entries()) {
			if (i > 0 && h.gapMs > 0) await sleep(h.gapMs);
			f();
		}
	};

	const server = createServer(async (req, res) => {
		const path = new URL(req.url ?? "/", "http://proxy").pathname;
		const body = await bodyOf(req);
		wire.push(JSON.stringify(req.headers), body);
		if (path.startsWith("/trap")) {
			trap.push(path);
			res.writeHead(401, {"content-type": "application/json"});
			return void res.end(JSON.stringify({error: {code: "trap"}}));
		}
		const run = runOf(body);
		const t0 = Date.now();
		if (run !== null && path.endsWith("/responses")) {
			const n = (calls.get(run) ?? 0) + 1;
			calls.set(run, n);
			const h = hold;
			if (n === 2 && h !== null) {
				const wait = new Promise<void>((r) => waiting.push(r));
				if (waiting.length === h.n) void release(h);
				await wait;
			}
		}
		const heldMs = Date.now() - t0;
		const headers: Record<string, string> = {};
		for (const k of ["authorization", "chatgpt-account-id", "content-type", "accept"]) {
			const v = req.headers[k];
			if (typeof v === "string") headers[k] = v;
		}
		const up = await fetch(`${fake.url}${path}`, {
			method: req.method ?? "GET",
			headers,
			body: req.method === "GET" || req.method === "HEAD" ? null : body,
		});
		const bearer = /^Bearer (\S+)$/.exec(headers.authorization ?? "")?.[1];
		seen.push({
			run,
			path,
			status: up.status,
			gen: bearer === undefined ? null : fake.genOf(bearer),
			at: Date.now(),
			heldMs,
		});
		res.writeHead(up.status, {
			"content-type": up.headers.get("content-type") ?? "application/json",
		});
		if (up.body === null) return void res.end();
		for await (const chunk of up.body) res.write(chunk);
		res.end();
	});

	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const a = server.address();
			const port = typeof a === "object" && a !== null ? a.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}`,
				seen,
				trap,
				wire,
				holdFor: (h) => {
					hold = h;
					calls.clear();
				},
				close: () =>
					new Promise((r) => {
						server.closeAllConnections();
						server.close(() => r());
					}),
			});
		}),
	);
};

// ---- One worker: a `codex app-server` over stdio, given only access tokens. ----

const CONFIG = (proxy: string) =>
	[
		'cli_auth_credentials_store = "file"',
		`chatgpt_base_url = "${proxy}/backend-api/"`,
		'model_provider = "chatgpt"',
		"[model_providers.chatgpt]",
		'name = "chatgpt"',
		`base_url = "${proxy}/backend-api/codex"`,
		'wire_api = "responses"',
		"requires_openai_auth = true",
		"request_max_retries = 1",
		"stream_max_retries = 1",
		"[analytics]",
		"enabled = false",
		"[features]",
		"apps = false",
		"plugins = false",
		"",
	].join("\n");

/** The parts of app-server's messages we read. Everything else passes as unknown. */
const Message = Schema.Struct({
	id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
	method: Schema.optional(Schema.String),
	params: Schema.optional(Schema.Unknown),
	result: Schema.optional(Schema.Unknown),
	error: Schema.optional(Schema.Unknown),
});
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Message));

const Item = Schema.Struct({type: Schema.String, text: Schema.optional(Schema.String)});
const ItemDone = Schema.Struct({item: Item});
const TurnDone = Schema.Struct({
	turn: Schema.Struct({status: Schema.String, error: Schema.optional(Schema.Unknown)}),
});

/** One refresh app-server asked its host for: when, how long our answer took, what it sent. */
interface Ask {
	readonly at: number;
	readonly answerMs: number;
	readonly ok: boolean;
	readonly params: unknown;
}

/** What one job came back with. */
interface Job {
	readonly run: string;
	readonly ok: boolean;
	/** The answer quotes what the check printed. */
	readonly right: boolean;
	readonly status: string;
	readonly error: string | null;
	readonly ms: number;
	readonly asks: readonly Ask[];
	/** The methods of every notification it sent, once each, in order. */
	readonly told: readonly string[];
}

interface Worker {
	readonly job: Promise<Job>;
	/** Everything sent and received on its stdio, for the leak count. */
	readonly wire: string[];
	/** Its folder: its home, its copy of the project, its temp folder. */
	readonly dir: string;
	readonly stop: () => void;
}

const startWorker = (o: {
	readonly run: string;
	readonly dir: string;
	readonly proxy: Proxy;
	readonly manager: LoginManager;
}): Worker => {
	const home = join(o.dir, "home");
	const cwd = join(o.dir, "repo");
	mkdirSync(join(home, ".codex"), {recursive: true});
	cpSync(FIXTURE, cwd, {recursive: true});
	writeFileSync(join(home, ".codex", "config.toml"), CONFIG(o.proxy.url));
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: home,
		CODEX_HOME: join(home, ".codex"),
		// If Codex tried to refresh by itself, it would land on the proxy's trap.
		CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${o.proxy.url}/trap/oauth/token`,
		TMPDIR: join(o.dir, "tmp"),
	};
	mkdirSync(env.TMPDIR ?? "", {recursive: true});
	const child: ChildProcessWithoutNullStreams = spawn(CODEX, ["app-server"], {cwd, env});
	const wire: string[] = [];
	const told: string[] = [];
	const asks: Ask[] = [];
	const pending = new Map<number, (m: typeof Message.Type) => void>();
	let next = 0;
	let given = "";
	let answer = "";
	const t0 = Date.now();

	const send = (m: object) => {
		const line = JSON.stringify(m);
		wire.push(line);
		child.stdin.write(`${line}\n`);
	};
	const call = (method: string, params: unknown) =>
		new Promise<typeof Message.Type>((resolve) => {
			const id = ++next;
			pending.set(id, resolve);
			send({method, id, params});
		});

	const job = new Promise<Job>((resolve) => {
		const end = (status: string, error: string | null) => {
			clearTimeout(timer);
			resolve({
				run: o.run,
				ok: status === "completed",
				right: answer.includes(TOOL_PRINTS),
				status,
				error,
				ms: Date.now() - t0,
				asks,
				told,
			});
		};
		const timer = setTimeout(() => end("timeout", null), JOB_TIMEOUT_MS);
		child.on("exit", (code) => end("exited", `app-server exited ${code}`));

		const lines = createInterface({input: child.stdout});
		lines.on("line", (line) => {
			wire.push(line);
			const m = decodeMessage(line);
			if (m._tag === "None") return;
			const msg = m.value;
			if (msg.method === undefined && typeof msg.id === "number") {
				pending.get(msg.id)?.(msg);
				pending.delete(msg.id);
				return;
			}
			if (msg.method === "account/chatgptAuthTokens/refresh" && msg.id !== undefined) {
				const at = Date.now();
				void Effect.runPromiseExit(o.manager.renew(given)).then((exit) => {
					if (Exit.isSuccess(exit)) {
						given = exit.value.accessToken;
						send({id: msg.id, result: exit.value});
					} else send({id: msg.id, error: {code: -32000, message: "login dead: sign in again"}});
					asks.push({at, answerMs: Date.now() - at, ok: Exit.isSuccess(exit), params: msg.params});
				});
				return;
			}
			if (msg.id !== undefined) {
				// Any other ask (an approval): decline, the job should not need one.
				send({id: msg.id, error: {code: -32601, message: "not offered"}});
				return;
			}
			if (msg.method !== undefined && !told.includes(msg.method)) told.push(msg.method);
			if (msg.method === "item/completed") {
				const d = Schema.decodeUnknownOption(ItemDone)(msg.params);
				if (d._tag === "Some" && d.value.item.type === "agentMessage")
					answer += d.value.item.text ?? "";
			}
			if (msg.method === "turn/completed") {
				const d = Schema.decodeUnknownOption(TurnDone)(msg.params);
				const t = d._tag === "Some" ? d.value.turn : {status: "unknown", error: undefined};
				end(t.status, t.error === undefined || t.error === null ? null : JSON.stringify(t.error));
			}
		});

		void (async () => {
			const init = await call("initialize", {
				clientInfo: {name: "exp160", title: null, version: "0.0.0"},
				capabilities: {experimentalApi: true, requestAttestation: false},
			});
			if (init.error !== undefined) return end("init_failed", JSON.stringify(init.error));
			send({method: "initialized"});
			const g: Grant = await Effect.runPromise(o.manager.grant);
			given = g.accessToken;
			const login = await call("account/login/start", {type: "chatgptAuthTokens", ...g});
			if (login.error !== undefined) return end("login_failed", JSON.stringify(login.error));
			const thread = await call("thread/start", {
				model: MODEL,
				cwd,
				approvalPolicy: "never",
				sandbox: "workspace-write",
				ephemeral: true,
			});
			if (thread.error !== undefined) return end("thread_failed", JSON.stringify(thread.error));
			const threadId = (thread.result as {thread?: {id?: string}} | undefined)?.thread?.id;
			const turn = await call("turn/start", {
				threadId,
				input: [{type: "text", text: PROMPT(o.run), text_elements: []}],
				effort: "low",
			});
			if (turn.error !== undefined) return end("turn_failed", JSON.stringify(turn.error));
		})();
	});

	return {job, wire, dir: o.dir, stop: () => child.kill("SIGTERM")};
};

// ---- The leak count: how often each token shows up where a worker can see it. ----

const filesUnder = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		const s = statSync(p);
		return s.isDirectory() ? filesUnder(p) : s.isFile() ? [p] : [];
	});

const countIn = (texts: readonly string[], secrets: readonly string[]) =>
	texts.reduce((n, t) => n + secrets.filter((s) => t.includes(s)).length, 0);

// ---- One case. ----

interface Case {
	readonly name: string;
	readonly jobs: number;
	readonly serial: boolean;
	readonly gapMs: number;
	readonly delayMs?: number;
}

const CASES: readonly Case[] = [
	{name: "together", jobs: 4, serial: true, gapMs: 0},
	{name: "staggered", jobs: 4, serial: true, gapMs: 400},
	{name: "loose", jobs: 4, serial: false, gapMs: 0},
	{name: "slow", jobs: 1, serial: true, gapMs: 0, delayMs: 12_000},
];

const runCase = async (c: Case, round: number, fake: FakeOpenAI, proxy: Proxy) => {
	const name = `${c.name}-r${round}`;
	const who = `p-${name}`;
	const auth = fake.login(who, FIRST_LIFE_MS);
	const signedAt = Date.now();
	const manager = await Effect.runPromise(
		makeLoginManager({
			tokenUrl: `${fake.url}/oauth/token`,
			clientId: "app_fake",
			signIn: {
				accessToken: auth.tokens.access_token,
				refreshToken: auth.tokens.refresh_token,
				accountId: auth.tokens.account_id,
				planType: "plus",
			},
			serial: c.serial,
			...(c.delayMs === undefined ? {} : {delayMs: c.delayMs}),
		}).pipe(Effect.provide(FetchHttpClient.layer)),
	);
	proxy.holdFor({n: c.jobs, after: signedAt + FIRST_LIFE_MS + 200, gapMs: c.gapMs});
	const seenFrom = proxy.seen.length;
	const wireFrom = proxy.wire.length;
	const refreshFrom = fake.refreshes.length;
	const trapFrom = proxy.trap.length;
	const workers = Array.from({length: c.jobs}, (_, i) =>
		startWorker({
			run: `${name}-${i + 1}`,
			dir: join(WORK, name, `w${i + 1}`),
			proxy,
			manager,
		}),
	);
	const jobs = await Promise.all(workers.map((w) => w.job));
	for (const w of workers) w.stop();
	await sleep(300);
	proxy.holdFor(null);

	const seen = proxy.seen.slice(seenFrom);
	const refreshes = fake.refreshes.slice(refreshFrom);
	const counts = await Effect.runPromise(manager.counts);
	const mine = fake.secretsOf(who);
	const refreshTokens = mine.filter((s) => s.startsWith("fake-refresh-"));
	const accessTokens = mine.filter((s) => s.startsWith("fake-access-"));
	const files = workers.map((w) => filesUnder(w.dir));
	const disk = files.flat().map((f) => readFileSync(f, "latin1"));
	const stdio = workers.flatMap((w) => w.wire);
	const http = proxy.wire.slice(wireFrom);

	/** Per job: from the 401 the model host gave it to its next call with a new token. */
	const added = jobs.flatMap((j) => {
		const mineSeen = seen.filter((s) => s.run === j.run && s.path.endsWith("/responses"));
		const refused = mineSeen.find((s) => s.status === 401);
		const retry = mineSeen.find(
			(s) => refused !== undefined && s.at > refused.at && s.status === 200,
		);
		return refused === undefined || retry === undefined ? [] : [retry.at - refused.at];
	});

	return {
		case: c,
		round,
		jobs: jobs.map((j) => ({
			...j,
			asks: j.asks.map((a) => ({...a, at: a.at - signedAt})),
			told: j.told.length,
			toldFirst: j.told.slice(0, 12),
		})),
		allOk: jobs.every((j) => j.ok && j.right),
		refreshes: refreshes.map((r) => ({what: r.what, gen: r.gen, at: r.at - signedAt})),
		realRefreshes: refreshes.filter((r) => r.what === "ok").length,
		familyKilled: fake.deadFor(who),
		manager: {
			asks: counts.asks,
			shared: counts.shared,
			spends: counts.spends.map((s) => ({ok: s.ok, ms: s.to - s.from})),
		},
		model: seen.map((s) => ({
			run: s.run,
			path: s.path,
			status: s.status,
			gen: s.gen,
			at: s.at - signedAt,
			heldMs: s.heldMs,
		})),
		addedMs: {
			each: added,
			median: median(added),
			max: added.length === 0 ? null : Math.max(...added),
		},
		trap: proxy.trap.length - trapFrom,
		leaks: {
			refreshInStdio: countIn(stdio, refreshTokens),
			refreshInHttp: countIn(http, refreshTokens),
			refreshOnDisk: countIn(disk, refreshTokens),
			accessInStdio: countIn(stdio, accessTokens),
			accessOnDisk: countIn(disk, accessTokens),
			/** Files in each worker's folder, and how many workers have a saved login file. */
			files: files.map((f) => f.length),
			authJson: files.filter((f) => f.some((p) => p.endsWith("auth.json"))).length,
		},
	};
};

const main = async () => {
	const pick = process.env.CASES?.split(",");
	rmSync(WORK, {recursive: true, force: true});
	mkdirSync(WORK, {recursive: true});
	const fake = await startFakeOpenAI({lifeMs: REFRESHED_LIFE_MS});
	const proxy = await startProxy(fake);
	const out: unknown[] = [];
	try {
		const rounds = Number(process.env.ROUNDS ?? 3);
		for (const c of CASES.filter((c) => pick === undefined || pick.includes(c.name))) {
			// The slow case takes 22 s a round and asks one question: once is enough.
			for (let round = 1; round <= (c.delayMs === undefined ? rounds : 1); round++) {
				console.log(`case ${c.name}, round ${round}`);
				const r = await runCase(c, round, fake, proxy);
				console.log(
					JSON.stringify({
						allOk: r.allOk,
						jobs: r.jobs.map((j) => [j.run, j.status, j.right, j.ms, j.asks.length, j.error]),
						realRefreshes: r.realRefreshes,
						refreshes: r.refreshes,
						familyKilled: r.familyKilled,
						manager: r.manager,
						addedMs: r.addedMs,
						trap: r.trap,
						leaks: {...r.leaks, files: undefined},
					}),
				);
				out.push(r);
			}
		}
		const others = proxy.seen.filter((s) => !s.path.endsWith("/responses"));
		writeFileSync(
			RESULTS,
			`${JSON.stringify({codex: codexVersion(), cases: out, otherPaths: [...new Set(others.map((s) => `${s.status} ${s.path}`))]}, null, 2)}\n`,
		);
		console.log(`wrote ${RESULTS}`);
	} finally {
		await proxy.close();
		await fake.close();
		if (process.env.KEEP === undefined) rmSync(WORK, {recursive: true, force: true});
	}
};

await main();
