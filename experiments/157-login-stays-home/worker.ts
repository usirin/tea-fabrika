// Experiment 157: the login lives in the person's own locker. One Worker, three parts.
//
//   Locker "<person>"  a Durable Object per person: their Claude token and their Codex auth.json,
//                      sealed with the Worker's secret. It lends auth.json to one Codex job at a
//                      time, queues the next, and takes back the refreshed copy.
//   Box "<id>"         a Durable Object per job with its own container (Cloudflare's Sandbox SDK
//                      shape: `ctx.container` and `Files`), started with no internet.
//   Outbound           every call a box makes lands here, with the box's person and id as props
//                      the box cannot change. It is the allow list (`gate.ts`).
//
//   person's app --key, once--> PUT /login ----------------------------> Locker "a"
//   Box "a-1" --Files: auth.json in / out--------------------------------> Locker "a"
//   container --anthropic.internal--> Outbound {person: "a"} --token-----> fake Anthropic
//   container --chatgpt.internal----> Outbound --as sent (the box's own)--> fake OpenAI
//
// The Claude path is Cloudflare's own tutorial: a placeholder in the box, the token added by the
// Worker. The Codex path is OpenAI's CI page as written: auth.json in before, back out after.
//
// It runs in workerd under `wrangler dev`, with Docker for the boxes. Erasable TypeScript; its
// only imports are its own folder's files, `cloudflare:workers` and `@cloudflare/sandbox`.

import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {Files} from "@cloudflare/sandbox";
import {claudeHeaders, headersBack, routeOf} from "./gate.ts";
import {open, type Sealed, seal} from "./seal.ts";
import {verify} from "./ticket.ts";

// ---------------------------------------------------------------- the platform, as used here

type Output = {exitCode: number; stdout: Uint8Array<ArrayBuffer>; stderr: Uint8Array<ArrayBuffer>};
type Exec = {cwd?: string; env?: Record<string, string>};
type Container = {
	readonly running: boolean;
	readonly images: Record<string, unknown>;
	start(o: {image?: unknown; enableInternet?: boolean}): void;
	destroy(reason?: unknown): Promise<void>;
	exec(cmd: string[], o?: Exec): Promise<{output(): Promise<Output>}>;
	interceptAllOutboundHttp(binding: unknown): Promise<void>;
	interceptOutboundHttps(host: string, binding: unknown): Promise<void>;
};
type Storage = {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
};
type Ns<T> = {getByName(name: string): T};
type BoxCtx = {
	readonly storage: Storage;
	readonly container: Container;
	readonly exports: {Outbound(o: {props: Props}): unknown};
};

type Env = {
	/** Seals logins and signs the people's keys. On Cloudflare, a Worker secret. */
	SECRET: string;
	/** The fake OpenAI, for both the model and the refresh. */
	OPENAI_UP: string;
	ANTHROPIC_UP: string;
	LOCKER: Ns<Locker>;
	BOX: Ns<Box>;
};

/** What the Outbound handler knows of a call: set by the box's object, never by the box. */
type Props = {readonly person: string; readonly box: string; readonly catch: boolean};

// ---------------------------------------------------------------- logins

type Agent = "codex" | "claude";

/** `auth.json` as `codex login` saves it with file storage: the parts the locker reads. */
type AuthJson = {
	readonly auth_mode: "chatgpt";
	readonly tokens: {readonly refresh_token: string; readonly access_token: string};
	readonly [k: string]: unknown;
};
type ClaudeLogin = {readonly token: string};

const isAuthJson = (x: unknown): x is AuthJson =>
	typeof x === "object" &&
	x !== null &&
	"auth_mode" in x &&
	x.auth_mode === "chatgpt" &&
	"tokens" in x &&
	typeof x.tokens === "object" &&
	x.tokens !== null &&
	"refresh_token" in x.tokens &&
	typeof x.tokens.refresh_token === "string" &&
	"access_token" in x.tokens &&
	typeof x.tokens.access_token === "string";
const isClaude = (x: unknown): x is ClaudeLogin =>
	typeof x === "object" && x !== null && "token" in x && typeof x.token === "string";

const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

/** The box that holds the Codex login now. Kept in storage: an idle object is dropped from memory. */
type Loan = {readonly box: string; readonly caught: boolean};
type Counts = Record<"lent" | "queued" | "back" | "dropped" | "caught" | "refused", number>;

/** One person's locker: their logins, and the one Codex loan at a time. */
export class Locker extends DurableObject<Env> {
	private readonly store: Storage;
	/** Codex jobs waiting for the loan, first come first served. Each is a call still open. */
	private readonly line: (() => void)[] = [];

	constructor(ctx: {storage: Storage}, env: Env) {
		super(ctx, env);
		this.store = ctx.storage;
	}

	private async loan(): Promise<Loan | null> {
		return (await this.store.get<Loan | null>("loan")) ?? null;
	}

	private async count(name: keyof Counts) {
		const c = (await this.store.get<Partial<Counts>>("counts")) ?? {};
		await this.store.put("counts", {...c, [name]: (c[name] ?? 0) + 1});
	}

	/** The person the locker is for: fixed by the first login it keeps. */
	private async mine(person: string) {
		const me = await this.store.get<string>("person");
		if (me === undefined) await this.store.put("person", person);
		return me === undefined || me === person;
	}

	private async put(provider: Agent, login: unknown) {
		const person = (await this.store.get<string>("person")) ?? "";
		await this.store.put(`login/${provider}`, await seal(this.env.SECRET, person, provider, login));
	}

	private async get(provider: Agent): Promise<unknown> {
		const person = (await this.store.get<string>("person")) ?? "";
		const sealed = await this.store.get<Sealed>(`login/${provider}`);
		return sealed === undefined ? null : open(this.env.SECRET, person, provider, sealed);
	}

	/** The person's app sends a login, once. */
	async keep(person: string, provider: Agent, login: unknown): Promise<string> {
		if (!(await this.mine(person))) return "not this person's locker";
		const fits = provider === "codex" ? isAuthJson(login) : isClaude(login);
		if (!fits) return "not a login";
		await this.put(provider, login);
		return "kept";
	}

	/** A job is starting: its box is this person's from now on. */
	async open(person: string, box: string, agent: Agent): Promise<boolean> {
		if (!(await this.mine(person))) return false;
		await this.store.put(`box/${box}`, agent);
		return true;
	}

	private async boxIs(box: string, agent: Agent) {
		const ok = (await this.store.get<Agent>(`box/${box}`)) === agent;
		if (!ok) await this.count("refused");
		return ok;
	}

	/** The Claude token, for the Outbound handler of one of this person's Claude boxes. */
	async claude(box: string): Promise<string | null> {
		if (!(await this.boxIs(box, "claude"))) return null;
		const login = await this.get("claude");
		return isClaude(login) ? login.token : null;
	}

	/** Lend auth.json to a Codex box. A second job waits until the first gives it back. */
	async lend(box: string, queue: boolean): Promise<{auth: AuthJson; waitedMs: number} | null> {
		if (!(await this.boxIs(box, "codex"))) return null;
		const t0 = Date.now();
		if (queue && (await this.loan()) !== null) await this.count("queued");
		while (queue && (await this.loan()) !== null) await new Promise<void>((r) => this.line.push(r));
		// Taken before any other wait, so no second job can slip in between.
		await this.store.put("loan", {box, caught: false} satisfies Loan);
		const auth = await this.get("codex");
		if (!isAuthJson(auth)) return null;
		await this.count("lent");
		return {auth, waitedMs: Date.now() - t0};
	}

	private async release() {
		await this.store.put("loan", null);
		this.line.shift()?.();
	}

	/** The job ended: the box's copy of auth.json comes back, refreshed or not. */
	async back(box: string, auth: unknown): Promise<string> {
		const loan = await this.loan();
		if (loan?.box !== box) return "not the box that holds the loan";
		if (!isAuthJson(auth)) return "not a login";
		await this.count("back");
		// With `catch`, the locker already holds each refresh the box got: it keeps its own copy.
		if (loan.caught) {
			const now = await this.get("codex");
			const same = isAuthJson(now) && now.tokens.refresh_token === auth.tokens.refresh_token;
			await this.release();
			return same ? "the same as caught" : "kept the caught copy";
		}
		await this.put("codex", auth);
		await this.release();
		return "kept";
	}

	/** The box died before it gave the login back: the locker keeps what it has. */
	async drop(box: string): Promise<void> {
		if ((await this.loan())?.box !== box) return;
		await this.count("dropped");
		await this.release();
	}

	/** The fix: the Outbound handler saw a refresh answer go to this box. Keep it now. */
	async caught(box: string, answer: unknown): Promise<boolean> {
		if ((await this.loan())?.box !== box) return false;
		const a = typeof answer === "object" && answer !== null ? answer : {};
		const access = "access_token" in a ? a.access_token : undefined;
		const refresh = "refresh_token" in a ? a.refresh_token : undefined;
		const id = "id_token" in a ? a.id_token : undefined;
		const now = await this.get("codex");
		if (!isAuthJson(now) || typeof access !== "string" || typeof refresh !== "string") return false;
		const tokens = {
			...now.tokens,
			access_token: access,
			refresh_token: refresh,
			...(typeof id === "string" ? {id_token: id} : {}),
		};
		await this.put("codex", {...now, tokens, last_refresh: new Date().toISOString()});
		await this.store.put("loan", {box, caught: true} satisfies Loan);
		await this.count("caught");
		return true;
	}

	/** Read by the driver: counts, and a login as it rests, sealed. */
	async look(provider: Agent) {
		return {
			counts: (await this.store.get<Partial<Counts>>("counts")) ?? {},
			sealed: (await this.store.get<Sealed>(`login/${provider}`)) ?? null,
		};
	}
}

// ---------------------------------------------------------------- the box

/** The platform's CA for the HTTPS it ends. Every TLS client in the box is told to trust it. */
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const TRUST = {NODE_EXTRA_CA_CERTS: CA, SSL_CERT_FILE: CA, CURL_CA_BUNDLE: CA};
const PATH = "/usr/local/bin:/usr/bin:/bin";
const PROMPT = (run: string) =>
	`Run the check you are given and say what it printed. [[run:${run}]]`;

/** Codex with file storage, its ChatGPT login pointed at the made-up names. */
const CODEX_CONFIG = (scheme: string) =>
	[
		'cli_auth_credentials_store = "file"',
		`chatgpt_base_url = "${scheme}://chatgpt.internal/backend-api/"`,
		'model_provider = "chatgpt"',
		"[model_providers.chatgpt]",
		'name = "chatgpt"',
		`base_url = "${scheme}://chatgpt.internal/backend-api/codex"`,
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

export interface Job {
	readonly agent: Agent;
	readonly run: string;
	/** The project the job works on: path to text. */
	readonly files: Readonly<Record<string, string>>;
	/** The fix: the Outbound handler keeps each refresh answer in the locker at once. */
	readonly catch?: boolean;
	/** False plants the mistake: two Codex jobs share the login at once. */
	readonly queue?: boolean;
	/** "https" or "http" for Codex's made-up names. */
	readonly scheme?: string;
}

export interface Done {
	readonly ok: boolean;
	readonly answer: string | null;
	readonly error: string | null;
	readonly ms: number;
	/** Codex only: how long the job waited for the login, and what the locker said on take-back. */
	readonly waitedMs?: number;
	readonly back?: string;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** Codex's last message and first error, from its JSON lines. */
const readCodex = (out: string) => {
	let answer: string | null = null;
	let error: string | null = null;
	let done = false;
	for (const line of out.split("\n")) {
		try {
			const e = JSON.parse(line);
			if (e.type === "item.completed" && e.item?.type === "agent_message") answer = e.item.text;
			if (e.type === "turn.completed") done = true;
			if ((e.type === "turn.failed" || e.type === "error") && error === null)
				error = String(e.error?.message ?? e.message);
		} catch {
			// Not a JSON line.
		}
	}
	return {answer, error, done};
};

/** One job's box: a container of its own, owned by one person. */
export class Box extends DurableObject<Env> {
	private readonly c: Container;
	private readonly files: Files;
	private readonly store: Storage;
	private readonly out: BoxCtx["exports"];

	constructor(ctx: BoxCtx, env: Env) {
		super(ctx, env);
		this.c = ctx.container;
		this.files = new Files(ctx.container);
		this.store = ctx.storage;
		this.out = ctx.exports;
	}

	async own(person: string, box: string): Promise<void> {
		if ((await this.store.get("person")) === undefined) {
			await this.store.put("person", person);
			await this.store.put("box", box);
		}
	}

	async owner(): Promise<string | null> {
		return (await this.store.get<string>("person")) ?? null;
	}

	/** Start the container with no internet, every call it makes caught by Outbound. */
	private async boot(caught: boolean): Promise<{person: string; box: string}> {
		const person = (await this.store.get<string>("person")) ?? "";
		const box = (await this.store.get<string>("box")) ?? "";
		if (!this.c.running) this.c.start({image: this.c.images.box, enableInternet: false});
		const out = this.out.Outbound({props: {person, box, catch: caught}});
		try {
			await this.c.interceptAllOutboundHttp(out);
			await this.c.interceptOutboundHttps("*", out);
		} catch (e) {
			// No catch, no job: the next request starts a new container.
			await this.c.destroy();
			throw e;
		}
		return {person, box};
	}

	async run(job: Job): Promise<Done> {
		const {person, box} = await this.boot(job.catch === true);
		const locker = this.env.LOCKER.getByName(person);
		const dir = `/work/${job.run}`;
		const home = `${dir}/home`;
		const copy = `${dir}/copy`;
		await this.files.mkdir(copy, {recursive: true});
		await this.files.mkdir(`${home}/.codex`, {recursive: true});
		for (const [path, body] of Object.entries(job.files))
			await this.files.writeFile(`${copy}/${path}`, body);
		const t0 = Date.now();
		if (job.agent === "claude") {
			const p = await this.c.exec(
				[
					"claude",
					"--print",
					"--output-format",
					"json",
					"--model",
					"claude-haiku-4-5",
					"--tools",
					"Bash",
					"--dangerously-skip-permissions",
					"--no-session-persistence",
					"--max-turns",
					"4",
					"--",
					PROMPT(job.run),
				],
				{
					cwd: copy,
					env: {
						PATH,
						HOME: home,
						CLAUDE_CONFIG_DIR: `${home}/.claude`,
						ANTHROPIC_BASE_URL: "https://anthropic.internal",
						CLAUDE_CODE_OAUTH_TOKEN: "box-holds-no-key",
						CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
						IS_SANDBOX: "1",
						...TRUST,
					},
				},
			);
			const o = await p.output();
			let r: {is_error?: boolean; result?: string; subtype?: string} = {};
			try {
				r = JSON.parse(text(o.stdout));
			} catch {
				// Read below as a failure.
			}
			const ok = o.exitCode === 0 && r.subtype === "success" && r.is_error !== true;
			return {
				ok,
				answer: r.result ?? null,
				error: ok ? null : (r.result ?? text(o.stderr).slice(-300)) || `exit ${o.exitCode}`,
				ms: Date.now() - t0,
			};
		}
		const lent = await locker.lend(box, job.queue !== false);
		if (lent === null) return {ok: false, answer: null, error: "no login lent", ms: 0};
		const codexHome = `${home}/.codex`;
		const scheme = job.scheme ?? "https";
		await this.files.writeFile(`${codexHome}/auth.json`, JSON.stringify(lent.auth, null, 2));
		await this.files.writeFile(`${codexHome}/config.toml`, CODEX_CONFIG(scheme));
		const ran = Date.now();
		let o: Output;
		try {
			const p = await this.c.exec(
				[
					"codex",
					"exec",
					"--json",
					"--skip-git-repo-check",
					"-s",
					"danger-full-access",
					"-m",
					"gpt-6-luna",
					"-c",
					'model_reasoning_effort="low"',
					"-c",
					'web_search="disabled"',
					"-c",
					'approval_policy="never"',
					PROMPT(job.run),
				],
				{
					cwd: copy,
					env: {
						PATH,
						HOME: home,
						CODEX_HOME: codexHome,
						CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${scheme}://auth.internal/oauth/token`,
						...TRUST,
					},
				},
			);
			o = await p.output();
		} catch (e) {
			// The box died with the login in it: nothing to take back.
			await locker.drop(box);
			return {
				ok: false,
				answer: null,
				error: `the box died: ${String(e).slice(0, 160)}`,
				ms: Date.now() - ran,
				waitedMs: lent.waitedMs,
				back: "dropped",
			};
		}
		const r = readCodex(text(o.stdout));
		let back: string;
		try {
			const copyBack = await (await this.files.readFile(`${codexHome}/auth.json`)).text();
			back = await locker.back(box, JSON.parse(copyBack));
		} catch {
			await locker.drop(box);
			back = "dropped";
		}
		const ok = o.exitCode === 0 && r.done && r.error === null;
		return {
			ok,
			answer: r.answer,
			error: ok ? null : (r.error ?? text(o.stderr).slice(-300)),
			ms: Date.now() - ran,
			waitedMs: lent.waitedMs,
			back,
		};
	}

	/** Run a Node script in the box, for the allow list and the timing probes. */
	async probe(script: string): Promise<{exit: number; out: string; err: string}> {
		await this.boot(false);
		const p = await this.c.exec(["node", "-e", script], {cwd: "/work", env: {PATH, ...TRUST}});
		const o = await p.output();
		return {exit: o.exitCode, out: text(o.stdout), err: text(o.stderr).slice(-500)};
	}

	/** Everything in the box a token could hide in: its files and its processes' environments. */
	async peek(): Promise<Uint8Array<ArrayBuffer>> {
		if (!this.c.running) return new Uint8Array();
		const p = await this.c.exec([
			"sh",
			"-c",
			"tar -cf - /work /root /tmp 2>/dev/null; cat /proc/[0-9]*/environ /proc/[0-9]*/cmdline 2>/dev/null; true",
		]);
		return (await p.output()).stdout;
	}

	/** The box dies now, whatever it is doing. */
	async kill(): Promise<void> {
		if (this.c.running) await this.c.destroy();
	}

	/** A planted wrong ask: this box asks another person's locker for their logins. */
	async cross(to: string): Promise<{claude: boolean; codex: boolean}> {
		const box = (await this.store.get<string>("box")) ?? "";
		const other = this.env.LOCKER.getByName(to);
		return {
			claude: (await other.claude(box)) !== null,
			codex: (await other.lend(box, false)) !== null,
		};
	}
}

// ---------------------------------------------------------------- the box's calls

const refuse = (status: number, why: string) =>
	Response.json({error: {type: "permission_error", message: `outbound: ${why}`}}, {status});

/** Every HTTP and HTTPS call a box makes. The props say whose box it is. */
export class Outbound extends WorkerEntrypoint<Env, Props> {
	override async fetch(req: Request): Promise<Response> {
		const t0 = Date.now();
		const props = this.ctx.props;
		const url = new URL(req.url);
		const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
		const route = routeOf(req.method, url, body);
		const note = (o: Record<string, unknown>) =>
			log({at: "outbound", person: props.person, host: url.hostname, ms: Date.now() - t0, ...o});
		if (typeof route === "string") {
			note({refused: route});
			return refuse(403, route);
		}
		if (route.kind === "ping") return new Response("pong");
		const locker = this.env.LOCKER.getByName(props.person);
		if (route.kind === "claude") {
			const t1 = Date.now();
			const token = await locker.claude(props.box);
			const lockerMs = Date.now() - t1;
			if (token === null) {
				note({refused: "no login for this box"});
				return refuse(401, "no login for this box");
			}
			const t2 = Date.now();
			const res = await fetch(`${this.env.ANTHROPIC_UP}${url.pathname}${url.search}`, {
				method: "POST",
				headers: claudeHeaders(req.headers, token),
				body,
			});
			note({kind: "claude", status: res.status, lockerMs, upMs: Date.now() - t2});
			return new Response(res.body, {status: res.status, headers: headersBack(res.headers)});
		}
		const headers = new Headers(req.headers);
		headers.delete("host");
		const t2 = Date.now();
		const res = await fetch(`${this.env.OPENAI_UP}${url.pathname}`, {
			method: "POST",
			headers,
			body,
		});
		if (route.kind === "codex" || !props.catch || !res.ok) {
			note({kind: route.kind, status: res.status, upMs: Date.now() - t2});
			return new Response(res.body, {status: res.status, headers: headersBack(res.headers)});
		}
		// The fix: the refreshed login is in the locker before the box sees it.
		const answer = await res.text();
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(answer);
		} catch {
			// Kept as it is: the box gets the answer either way.
		}
		const kept = await locker.caught(props.box, parsed);
		note({kind: "token", status: res.status, upMs: Date.now() - t2, caught: kept});
		return new Response(answer, {status: res.status, headers: headersBack(res.headers)});
	}
}

// ---------------------------------------------------------------- the front door

const bearerOf = (req: Request) =>
	/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

/**
 * The person's app and the driver come in here with the person's key. Every route acts for the
 * person in the key, never for a name in the body.
 */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const key = bearerOf(req);
		const pass = key === null ? null : await verify(env.SECRET, key, "person");
		if (pass === null) return refuse(401, "not a person's key");
		const person = pass.person;
		const b: Record<string, unknown> =
			req.method === "POST" || req.method === "PUT" ? await req.json() : {};
		const locker = env.LOCKER.getByName(person);
		if (typeof b.person === "string" && b.person !== person)
			return refuse(403, "a key acts only for its own person");
		if (url.pathname === "/login") {
			const provider = b.provider === "codex" ? "codex" : "claude";
			const said = await locker.keep(person, provider, b.login);
			return Response.json({said}, {status: said === "kept" ? 200 : 400});
		}
		if (url.pathname === "/look") {
			const provider = url.searchParams.get("provider") === "codex" ? "codex" : "claude";
			return Response.json(await locker.look(provider));
		}
		if (url.pathname === "/box") {
			const agent = b.agent === "codex" ? "codex" : "claude";
			const box = `${person}-${crypto.randomUUID().slice(0, 8)}`;
			if (!(await locker.open(person, box, agent))) return refuse(403, "not this person's locker");
			await env.BOX.getByName(box).own(person, box);
			return Response.json({box});
		}
		const id = typeof b.box === "string" ? b.box : "";
		const stub = env.BOX.getByName(id);
		if ((await stub.owner()) !== person) return refuse(403, "not this person's box");
		try {
			if (url.pathname === "/run") return Response.json(await stub.run(b.job as Job));
			if (url.pathname === "/probe") return Response.json(await stub.probe(String(b.script)));
			if (url.pathname === "/peek") return new Response(await stub.peek());
			if (url.pathname === "/kill") return Response.json(await stub.kill());
			if (url.pathname === "/cross") return Response.json(await stub.cross(String(b.to)));
		} catch (e) {
			return Response.json({error: String(e).slice(0, 300)}, {status: 500});
		}
		return refuse(404, "no such route");
	},
};
