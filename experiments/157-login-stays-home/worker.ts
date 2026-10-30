// Experiment 157, round 2: the box holds the login, the GitHub Actions way. One Worker, two parts.
//
//   Locker "<person>"  a Durable Object per person: their Claude token and their Codex auth.json,
//                      sealed with the Worker's secret. It lends auth.json to one Codex job at a
//                      time, queues the next, takes back the copy the box leaves, and ends a loan
//                      past its time with an alarm.
//   Box "<id>"         a Durable Object per job with its own container (Cloudflare's Sandbox SDK
//                      shape: `ctx.container` and `Files`), started with open internet.
//
//   person's app --key, once--> POST /login -----------------------> Locker "a"
//   Box "a-1" --CLAUDE_CODE_OAUTH_TOKEN in the job's env------------> claude in the container
//   Box "a-1" --Files: auth.json in, then out----------------------> codex in the container
//   container --straight out, nothing of ours in between-----------> the model and refresh hosts
//
// Claude takes the token the way anthropics/claude-code-action does. Codex follows OpenAI's CI
// page as written. No handler of ours stands in a model call or a refresh call: experiment 148's
// rule, our Worker never sees a real token on the wire.
//
// `Witness` is for measuring only: one step starts a box with no internet and every call caught,
// to list each host the two programs call. It is not the shape.
//
// It runs in workerd under `wrangler dev`, with Docker for the boxes. Erasable TypeScript; its
// only imports are its own folder's files, `cloudflare:workers` and `@cloudflare/sandbox`.

import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {Files} from "@cloudflare/sandbox";
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
	setAlarm(at: number): Promise<void>;
	deleteAlarm(): Promise<void>;
};
type Ns<T> = {getByName(name: string): T};
type BoxCtx = {
	readonly storage: Storage;
	readonly container: Container;
	readonly exports: {Witness(o: {props: {box: string}}): unknown};
};

type Env = {
	/** Seals logins and signs the people's keys. On Cloudflare, a Worker secret. */
	SECRET: string;
	/**
	 * Where the box's programs are pointed, by their own settings: the fakes, as the box sees them.
	 * On Cloudflare both are left unset and the programs use their own hosts.
	 */
	CLAUDE_BASE?: string;
	CODEX_BASE?: string;
	LOCKER: Ns<Locker>;
	BOX: Ns<Box>;
};

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

/**
 * The box that holds the Codex login now, and until when. Kept in storage: an idle object is
 * dropped from memory (round 1 lost a loan that way).
 */
type Loan = {readonly box: string; readonly until: number};
type Counts = Record<"lent" | "queued" | "back" | "dropped" | "ended" | "late" | "refused", number>;

/** A loan's end time when the job does not say: longer than any job here. */
const LOAN_MS = 10 * 60_000;

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

	/** The Claude token, for the job's env in one of this person's Claude boxes. */
	async claude(box: string): Promise<string | null> {
		if (!(await this.boxIs(box, "claude"))) return null;
		const login = await this.get("claude");
		return isClaude(login) ? login.token : null;
	}

	/**
	 * Lend auth.json to a Codex box until `ms` from now. A second job waits until the first gives
	 * it back, or until its loan ends.
	 */
	async lend(
		box: string,
		o: {queue: boolean; ms: number},
	): Promise<{auth: AuthJson; waitedMs: number} | null> {
		if (!(await this.boxIs(box, "codex"))) return null;
		const t0 = Date.now();
		if (o.queue && (await this.loan()) !== null) await this.count("queued");
		while (o.queue && (await this.loan()) !== null)
			await new Promise<void>((r) => this.line.push(r));
		// Taken before any other wait, so no second job can slip in between.
		const until = Date.now() + o.ms;
		await this.store.put("loan", {box, until} satisfies Loan);
		await this.store.setAlarm(until);
		const auth = await this.get("codex");
		if (!isAuthJson(auth)) return null;
		await this.count("lent");
		return {auth, waitedMs: Date.now() - t0};
	}

	private async release() {
		await this.store.put("loan", null);
		await this.store.deleteAlarm();
		this.line.shift()?.();
	}

	/** The job ended: the box's copy of auth.json comes back, refreshed or not. */
	async back(box: string, auth: unknown): Promise<string> {
		const loan = await this.loan();
		if (loan?.box !== box) {
			await this.count("late");
			return "not the box that holds the loan";
		}
		if (!isAuthJson(auth)) return "not a login";
		await this.count("back");
		await this.put("codex", auth);
		await this.release();
		return "kept";
	}

	/** The box object saw its box die before it gave the login back: the locker keeps what it has. */
	async drop(box: string): Promise<void> {
		if ((await this.loan())?.box !== box) return;
		await this.count("dropped");
		await this.release();
	}

	/**
	 * The loan end time. Nobody gave the login back or said the box died: the box object died too,
	 * or lost track. The box is stopped, in case it still runs, so two boxes never hold the login at
	 * once; the locker keeps what it has, and the next job in line goes.
	 */
	override async alarm(): Promise<void> {
		const loan = await this.loan();
		if (loan === null) return;
		if (loan.until > Date.now()) {
			await this.store.setAlarm(loan.until);
			return;
		}
		log({at: "locker", ended: loan.box});
		await this.count("ended");
		await this.env.BOX.getByName(loan.box).kill();
		await this.release();
	}

	/** Read by the driver: counts, the loan, and a login as it rests, sealed. */
	async look(provider: Agent) {
		return {
			counts: (await this.store.get<Partial<Counts>>("counts")) ?? {},
			loan: await this.loan(),
			sealed: (await this.store.get<Sealed>(`login/${provider}`)) ?? null,
		};
	}
}

// ---------------------------------------------------------------- the box

/** The made-up name a caught box reaches the fakes by: the witness sends it on to 127.0.0.1. */
const WITNESS_HOSTS: Readonly<Record<string, "CLAUDE_BASE" | "CODEX_BASE">> = {
	"claude.fakes.internal": "CLAUDE_BASE",
	"codex.fakes.internal": "CODEX_BASE",
};
/** The platform's CA for the HTTPS it ends, only for the witness step. */
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const TRUST = {NODE_EXTRA_CA_CERTS: CA, SSL_CERT_FILE: CA, CURL_CA_BUNDLE: CA};
const PATH = "/usr/local/bin:/usr/bin:/bin";
const PROMPT = (run: string) =>
	`Run the check you are given and say what it printed. [[run:${run}]]`;

/** Where Claude Code reads a project's settings from: rules.ts's NO_PROJECT_CONFIG. */
const NO_PROJECT_CONFIG = "/var/empty";
/** rules.ts's AGENTS_MD: AGENTS.md is read beside CLAUDE.md. */
const AGENTS_MD = {
	"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
};

/** Codex with file storage, its ChatGPT login pointed at `base` when set. */
const codexConfig = (base: string | undefined) =>
	[
		'cli_auth_credentials_store = "file"',
		...(base === undefined
			? []
			: [
					`chatgpt_base_url = "${base}/backend-api/"`,
					'model_provider = "chatgpt"',
					"[model_providers.chatgpt]",
					'name = "chatgpt"',
					`base_url = "${base}/backend-api/codex"`,
					'wire_api = "responses"',
					"requires_openai_auth = true",
					"request_max_retries = 1",
					"stream_max_retries = 1",
				]),
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
	/** False plants the mistake: two Codex jobs share the login at once. */
	readonly queue?: boolean;
	/** The Codex loan's end time, from when it is lent. */
	readonly loanMs?: number;
	/**
	 * Planted: the box object dies with its box, so nothing tells the locker. Here the object stays
	 * and only keeps quiet: it never drops the loan and never gives the login back.
	 */
	readonly quiet?: boolean;
	/** The witness step: no internet, every call caught and its host written down. */
	readonly witness?: boolean;
}

export interface Done {
	readonly ok: boolean;
	readonly answer: string | null;
	readonly error: string | null;
	readonly ms: number;
	/** Codex only: how long the job waited for the login, and what the locker said on take-back. */
	readonly waitedMs?: number;
	readonly back?: string;
	/** Codex only: when the take-back answered, for the window a refresh lives only in the box. */
	readonly backAt?: number;
	/** Codex only: when the job got the login, to set against the loan before it. */
	readonly lentAt?: number;
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

	/** Start the container with open internet; only the witness step catches its calls. */
	private async boot(witness: boolean): Promise<void> {
		const box = (await this.store.get<string>("box")) ?? "";
		if (this.c.running) return;
		this.c.start({image: this.c.images.box, enableInternet: !witness});
		if (witness) {
			const out = this.out.Witness({props: {box}});
			try {
				await this.c.interceptAllOutboundHttp(out);
				await this.c.interceptOutboundHttps("*", out);
			} catch (e) {
				await this.c.destroy();
				throw e;
			}
		}
	}

	async run(job: Job): Promise<Done> {
		const witness = job.witness === true;
		const person = (await this.store.get<string>("person")) ?? "";
		const box = (await this.store.get<string>("box")) ?? "";
		const locker = this.env.LOCKER.getByName(person);
		// A Codex job gets its login before its box starts: a job waiting in line holds no box.
		const lent =
			job.agent === "codex"
				? await locker.lend(box, {queue: job.queue !== false, ms: job.loanMs ?? LOAN_MS})
				: null;
		if (job.agent === "codex" && lent === null)
			return {ok: false, answer: null, error: "no login lent", ms: 0};
		const lentAt = Date.now();
		try {
			await this.boot(witness);
		} catch (e) {
			if (job.quiet !== true) await locker.drop(box);
			throw e;
		}
		const dir = `/work/${job.run}`;
		const home = `${dir}/home`;
		const copy = `${dir}/copy`;
		const trust = witness ? TRUST : {};
		// Locally the catch takes only port 80, and the fakes sit on other ports. So a caught box is
		// pointed at a made-up name on port 80, and the witness sends it on to the fake.
		const point = (base: string | undefined, as: string) => (witness ? `http://${as}` : base);
		await this.files.mkdir(copy, {recursive: true});
		await this.files.mkdir(`${home}/.codex`, {recursive: true});
		for (const [path, body] of Object.entries(job.files))
			await this.files.writeFile(`${copy}/${path}`, body);
		const t0 = Date.now();
		if (job.agent === "claude") {
			const token = await locker.claude(box);
			if (token === null) return {ok: false, answer: null, error: "no login for this box", ms: 0};
			const base = point(this.env.CLAUDE_BASE, "claude.fakes.internal");
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
					// The CLI form of rules.ts's ownRules: the folder's rule files, none of its settings.
					// biome-ignore lint/plugin/no-project-settings: this is ownRules written as Claude Code's flags, for a box that runs the CLI with no Agent SDK; the config root is the empty folder the Dockerfile makes
					"--setting-sources",
					"project",
					// biome-ignore lint/plugin/no-project-settings: the same ownRules flags; the root is NO_PROJECT_CONFIG, root's and read-only, and the box runs as another user
					"--project-config-root",
					NO_PROJECT_CONFIG,
					"--settings",
					JSON.stringify({pluginConfigs: AGENTS_MD}),
					"--",
					PROMPT(job.run),
				],
				{
					cwd: copy,
					env: {
						PATH,
						HOME: home,
						CLAUDE_CONFIG_DIR: `${home}/.claude`,
						// As anthropics/claude-code-action hands it to Claude Code.
						CLAUDE_CODE_OAUTH_TOKEN: token,
						...(base === undefined ? {} : {ANTHROPIC_BASE_URL: base}),
						CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
						IS_SANDBOX: "1",
						...trust,
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
		if (lent === null) return {ok: false, answer: null, error: "no login lent", ms: 0};
		const codexHome = `${home}/.codex`;
		const base = point(this.env.CODEX_BASE, "codex.fakes.internal");
		await this.files.writeFile(`${codexHome}/auth.json`, JSON.stringify(lent.auth, null, 2));
		await this.files.writeFile(`${codexHome}/config.toml`, codexConfig(base));
		const ran = Date.now();
		const dropIt = () => (job.quiet === true ? Promise.resolve() : locker.drop(box));
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
						...(base === undefined
							? {}
							: {CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${base}/oauth/token`}),
						...trust,
					},
				},
			);
			o = await p.output();
		} catch (e) {
			// The box died with the login in it: nothing to take back.
			await dropIt();
			return {
				ok: false,
				answer: null,
				error: `the box died: ${String(e).slice(0, 160)}`,
				ms: Date.now() - ran,
				waitedMs: lent.waitedMs,
				back: job.quiet === true ? "nothing said" : "dropped",
			};
		}
		const r = readCodex(text(o.stdout));
		let back: string;
		if (job.quiet === true) back = "nothing said";
		else
			try {
				const copyBack = await (await this.files.readFile(`${codexHome}/auth.json`)).text();
				// The box stops before the login goes back: the next job never shares it with this one.
				await this.c.destroy();
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
			backAt: Date.now(),
			lentAt,
		};
	}

	/** Run a Node script in the box, for the open internet and timing probes. */
	async probe(script: string): Promise<{exit: number; out: string; err: string}> {
		await this.boot(false);
		const base = {CLAUDE_BASE: this.env.CLAUDE_BASE ?? "", CODEX_BASE: this.env.CODEX_BASE ?? ""};
		const p = await this.c.exec(["node", "-e", script], {cwd: "/work", env: {PATH, ...base}});
		const o = await p.output();
		return {exit: o.exitCode, out: text(o.stdout), err: text(o.stderr).slice(-500)};
	}

	/** Everything in the box a token could hide in: its files and its processes' environments. */
	async peek(): Promise<Uint8Array<ArrayBuffer>> {
		if (!this.c.running) return new Uint8Array();
		const p = await this.c.exec([
			"sh",
			"-c",
			"tar -cf - /work /home /tmp 2>/dev/null; cat /proc/[0-9]*/environ /proc/[0-9]*/cmdline 2>/dev/null; true",
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
			codex: (await other.lend(box, {queue: false, ms: 1_000})) !== null,
		};
	}
}

// ---------------------------------------------------------------- the witness, for measuring

/**
 * The witness step only: writes down the host and path of every call a box makes, never a header
 * or a body. A call to the fakes goes on to them; any other host gets 403 and nothing else.
 */
export class Witness extends WorkerEntrypoint<Env, {box: string}> {
	override async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const up = WITNESS_HOSTS[url.hostname];
		const fake = up !== undefined;
		log({at: "witness", box: this.ctx.props.box, host: url.host, path: url.pathname, fake});
		if (!fake) return new Response("witness: not a fake", {status: 403});
		const base = (this.env[up] ?? "").replace("host.docker.internal", "127.0.0.1");
		const headers = new Headers(req.headers);
		headers.delete("host");
		const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
		const res = await fetch(`${base}${url.pathname}${url.search}`, {
			method: req.method,
			headers,
			body,
		});
		return new Response(res.body, {status: res.status, headers: res.headers});
	}
}

// ---------------------------------------------------------------- the front door

const refuse = (status: number, why: string) =>
	Response.json({error: {type: "permission_error", message: why}}, {status});

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
