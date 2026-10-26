// Experiment 148's Worker. The project's host is a Durable Object: it wakes on a message or an
// alarm, steps its programs, writes the ledger, and sleeps. A box is started only for a job that
// needs one, one box per job, and it goes when the job ends.
//
//   laptop ──WS──▶ door ──▶ ProjectHost "p1"      tsh per person, its jobs in the object's storage
//                              │ box --run ...
//                              ▼
//                           JobBox "p1/<job>" ──start──▶ box (Docker locally, a container on Cloudflare)
//                                                          ├─ http://model.internal ─▶ ModelRelay ─▶ upstream, with the starter's key
//                                                          └─ http://host.internal/done ─▶ JobDone ─▶ JobBox ─▶ ProjectHost
//
// The box holds nothing secret: no key, no sign-in, no token. Who it runs for is the props the
// JobBox gave each catch when it started the box, outside it; one box runs one job for one person.
//
// The stand-in door: a session is a made-up token in SESSIONS, set per run by the driver. The
// real door is PR 92's.
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {Effect} from "effect";
import {type Ended, openSession, type Session} from "./host/session.ts";

export {Ledger} from "../../packages/fabrika/src/host/durable-object.ts";

/** As much of the project's ledger (packages/fabrika's Ledger object) as the host calls. */
interface LedgerStub {
	register(name: string, writer: string): Promise<unknown>;
	append(stream: string, expected: "any", event: unknown): Promise<unknown>;
	readStream(stream: string, fromRev: number, limit: number): Promise<unknown>;
	read(fromPos: number, limit: number): Promise<unknown>;
}

interface Env {
	readonly HOSTS: DurableObjectNamespace<ProjectHost>;
	readonly JOBS: DurableObjectNamespace<JobBox>;
	readonly PEOPLE: DurableObjectNamespace<Person>;
	readonly LEDGER: {readonly getByName: (project: string) => LedgerStub};
	/** The secret every person's key is sealed under. A Worker secret: never in a box. */
	readonly KEY_SEAL: string;
	/**
	 * Where the model is: the stand-in on the laptop, https://api.anthropic.com, or "standin": the
	 * stand-in as this Worker's own second entrypoint, for a live round with no real model.
	 */
	readonly UPSTREAM: string;
	/** The second entrypoint's made-up keys, {key: person}. Set only when UPSTREAM is "standin". */
	readonly FAKE_KEYS?: string;
	/** The stand-in door's sessions: {token: person}. */
	readonly SESSIONS: string;
	/** A job's box is stopped after this long, whatever it is doing. */
	readonly JOB_TIMEOUT_MS: string;
	/** The most model calls one job may make. */
	readonly JOB_CALLS: string;
	/** The box's size at start, as JSON, or "" for the application's own. */
	readonly BOX_SIZE: string;
}

/** What the host writes as, on the project's ledger: PR 92's stamp, `agent:<id> for:<person>`. */
export const stampOf = (who: string) => `agent:host for:${who}`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What could keep the object awake: every timer set and not yet run or cleared, counted. A
// Durable Object is not evicted while one is pending, so between messages this should be 0.
const live = new Set<unknown>();
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
const realInterval = globalThis.setInterval;
globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
	const id = realSet(
		() => {
			live.delete(id);
			fn();
		},
		ms,
		...rest,
	);
	live.add(id);
	return id;
}) as typeof setTimeout;
globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
	live.delete(id);
	realClear(id);
}) as typeof clearTimeout;
globalThis.setInterval = ((fn: () => void, ms?: number) => {
	const id = realInterval(fn, ms);
	live.add(id);
	return id;
}) as typeof setInterval;

// ---------------------------------------------------------------- a person's key, sealed

const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer | Uint8Array) =>
	[...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) =>
	new Uint8Array((s.match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));

/** What a person keeps here: a model key (the relay's stand-in path), or a Claude subscription token. */
type Kept = "key" | "token";

/** AES-GCM under a key drawn from KEY_SEAL for this one person: one person's row opens no other's. */
const sealKey = async (seal: string, who: string, kind: Kept = "key") => {
	const base = await crypto.subtle.importKey("raw", bytes(seal), "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{name: "HKDF", hash: "SHA-256", salt: bytes(`exp148/person-${kind}`), info: bytes(who)},
		base,
		{name: "AES-GCM", length: 256},
		false,
		["encrypt", "decrypt"],
	);
};

/**
 * One person: their model key and their Claude subscription token, each sealed at rest in this
 * object's own storage. The key is opened only by the relay, per call, and never reaches a box.
 * The token is opened only by the person's own job object, to start the person's box with it:
 * the decided design (docs/direction/programs-run-in-a-box.md) hands it to Claude Code itself.
 */
export class Person extends DurableObject<Env> {
	async put(who: string, secret: string, kind: Kept = "key") {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const k = await sealKey(this.env.KEY_SEAL, who, kind);
		const sealed = await crypto.subtle.encrypt({name: "AES-GCM", iv}, k, bytes(secret));
		this.ctx.storage.kv.put(kind, {who, iv: hex(iv), sealed: hex(sealed)});
		return {who};
	}

	/** Open, for the one use now. Never kept open. */
	async open(who: string, kind: Kept = "key"): Promise<string | null> {
		const row = this.ctx.storage.kv.get<{who: string; iv: string; sealed: string}>(kind);
		if (row === undefined || row.who !== who) return null;
		const k = await sealKey(this.env.KEY_SEAL, who, kind);
		const open = await crypto.subtle.decrypt(
			{name: "AES-GCM", iv: unhex(row.iv)},
			k,
			unhex(row.sealed),
		);
		return new TextDecoder().decode(open);
	}

	/** What is kept at rest, for the driver to see that it is sealed. */
	async row() {
		return this.ctx.storage.kv.get("key") ?? null;
	}
}

// ---------------------------------------------------------------- a box's two ways out

/** Who a box runs for, set by its JobBox outside it. The box cannot change it. */
type BoxProps = {readonly project: string; readonly who: string; readonly job: string};

/** The only headers the relay carries on to the model. Anything the box said about who it is goes. */
const CARRIED = ["content-type", "anthropic-version", "anthropic-beta"];

/** http://model.internal/v1/messages, from inside a box: the call goes on with its starter's key. */
export class ModelRelay extends WorkerEntrypoint<Env, BoxProps> {
	async fetch(req: Request) {
		const {project, who, job} = this.ctx.props;
		const url = new URL(req.url);
		if (req.method !== "POST" || url.pathname !== "/v1/messages")
			return new Response("the relay carries POST /v1/messages only", {status: 404});
		// A box whose job is over, or past its calls, gets nothing.
		const ok = await this.env.JOBS.getByName(`${project}/${job}`).charge();
		if (!ok) return new Response("this job may not call the model now", {status: 403});
		const key = await this.env.PEOPLE.getByName(who).open(who);
		if (key === null) return new Response(`${who} has no key yet`, {status: 403});
		const headers = new Headers();
		for (const h of CARRIED) {
			const v = req.headers.get(h);
			if (v !== null) headers.set(h, v);
		}
		headers.set("x-api-key", key);
		const upstream = this.env.UPSTREAM === STANDIN ? "http://standin" : this.env.UPSTREAM;
		const call = new Request(`${upstream}/v1/messages`, {
			method: "POST",
			headers,
			body: req.body,
		});
		// The live round's stand-in is this Worker's own entrypoint: the call never leaves Cloudflare.
		if (this.env.UPSTREAM === STANDIN) return this.ctx.exports.Standin.fetch(call);
		return fetch(call);
	}
}

const STANDIN = "standin";

/** The one host a box with its starter's Claude token may reach. */
const ANTHROPIC = "api.anthropic.com";

/**
 * https://api.anthropic.com, from inside a box that carries its starter's Claude token. Cloudflare
 * has no allow list that passes TLS through untouched: a box with no internet reaches a host only
 * through a catch, and an HTTPS catch ends TLS at Cloudflare and hands the request to a Worker. So
 * this one passes it on as it came. It reads no header and adds none: the token in it is Claude
 * Code's own, sent by Claude Code.
 */
export class AnthropicPass extends WorkerEntrypoint<Env, BoxProps> {
	async fetch(req: Request) {
		return fetch(req);
	}
}

/** Where a box finds the CA that Cloudflare's HTTPS catch signs with. */
const CATCH_CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

/** What a job hands back, with its starter's token taken out if it is there as it is. */
const withheld = (said: string, token: string | null) =>
	token !== null && said.includes(token)
		? {said: "[withheld: the job's output held its starter's token]", leak: true}
		: {said, leak: false};

/**
 * The stand-in model as a second entrypoint, for a live round (standin.ts is the laptop's). It
 * answers a made-up key it knows, and says whose it was and which header names came with it.
 */
export class Standin extends WorkerEntrypoint<Env> {
	async fetch(req: Request) {
		const keys = JSON.parse(this.env.FAKE_KEYS ?? "{}") as Record<string, string>;
		const who = keys[req.headers.get("x-api-key") ?? ""];
		if (who === undefined) return Response.json({error: "unknown key"}, {status: 401});
		const names = [...req.headers.keys()].sort().join(",");
		return Response.json({
			content: [{type: "text", text: `standin answered ${who}; headers ${names}`}],
		});
	}
}

/**
 * http://host.internal, from inside a box: `/began`, its first sign of life (a cold start's end),
 * and `/done`, its job ended, with what it printed.
 */
export class JobDone extends WorkerEntrypoint<Env, BoxProps> {
	async fetch(req: Request) {
		const {project, job} = this.ctx.props;
		const path = new URL(req.url).pathname;
		if (req.method === "POST" && path === "/began") {
			await this.env.JOBS.getByName(`${project}/${job}`).began();
			return Response.json({ok: true});
		}
		if (req.method !== "POST" || path !== "/done") return new Response("not found", {status: 404});
		const body = (await req.json()) as {said?: unknown; code?: unknown};
		const ended: Ended = {
			said: String(body.said ?? "").slice(0, 64 * 1024),
			code: Number(body.code ?? -1),
		};
		await this.env.JOBS.getByName(`${project}/${job}`).finish(ended);
		return Response.json({ok: true});
	}
}

// ---------------------------------------------------------------- one job's box

/** How often a job's object wakes while its box runs: well under the ~10 s an idle object lasts. */
const BEAT_MS = 5000;

interface JobRow extends BoxProps {
	readonly cmd: string;
	readonly state: "running" | "done";
	readonly startMs: number;
	readonly at: number;
	readonly calls: number;
	/** When the job runs out of time. */
	readonly until: number;
	/** How many beats the job's object has had while its box ran. */
	readonly beats: number;
	/** Whether the job's object beats. Off only when the driver asks, to see what an idle object does. */
	readonly beat: boolean;
	/** From begin to the box's first call out: the cold start, as the job's object saw it. */
	readonly firstMs?: number;
	readonly ended?: Ended;
	/** Whether what the job said held its starter's token, as it is, and was withheld. */
	readonly leak?: boolean;
	readonly took?: number;
}

/** One job: its box, started at `begin`, gone at its end or its timeout. */
export class JobBox extends DurableObject<Env> {
	private get box() {
		// biome-ignore lint/style/noNonNullAssertion: a Durable Object with a container always has one.
		return this.ctx.container!;
	}
	private row() {
		return this.ctx.storage.kv.get<JobRow>("job");
	}

	/** Start the job's box, once. Asked again, it answers how the job is. */
	async begin(
		o: BoxProps & {readonly cmd: string; readonly beat?: boolean},
	): Promise<{row: JobRow; fresh: boolean}> {
		const kept = this.row();
		if (kept !== undefined) return {row: kept, fresh: false};
		const t0 = Date.now();
		// Kept before the box starts: its first call out may come before the catches are set.
		this.ctx.storage.kv.put("job", {
			project: o.project,
			who: o.who,
			job: o.job,
			cmd: o.cmd,
			state: "running",
			startMs: -1,
			at: t0,
			calls: 0,
			until: t0 + Number(this.env.JOB_TIMEOUT_MS),
			beats: 0,
			beat: o.beat !== false,
		} satisfies JobRow);
		// The starter's own Claude token, if they keep one: Claude Code in the box signs in with it.
		const token = await this.env.PEOPLE.getByName(o.who).open(o.who, "token");
		this.box.start({
			image: this.box.images.Job,
			enableInternet: false,
			// 1/4 vCPU and 1 GiB, "basic"'s size. The default under a Durable Object is lite,
			// 256 MiB: too small for the probe here, and for an agent run. Local workerd refuses the
			// name "basic" ("Invalid container instance type"), so locally the size is given in
			// numbers here; on Cloudflare the application says "basic" (stack.ts).
			...(this.env.BOX_SIZE
				? {instance: JSON.parse(this.env.BOX_SIZE) as ContainerStartResources}
				: {}),
			env: {
				JOB_CMD: o.cmd,
				JOB: o.job,
				...(token === null
					? {}
					: {
							CLAUDE_CODE_OAUTH_TOKEN: token,
							NODE_EXTRA_CA_CERTS: CATCH_CA,
							CLAUDE_CONFIG_DIR: "/work/.claude",
							CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
						}),
			},
		});
		const props = {project: o.project, who: o.who, job: o.job};
		await this.box.interceptOutboundHttp("model.internal", this.ctx.exports.ModelRelay({props}));
		await this.box.interceptOutboundHttp("host.internal", this.ctx.exports.JobDone({props}));
		if (token !== null)
			await this.box.interceptOutboundHttps(ANTHROPIC, this.ctx.exports.AnthropicPass({props}));
		// Read again: the box may have called /began or even /done meanwhile.
		const row: JobRow = {...(this.row() as JobRow), startMs: Date.now() - t0};
		this.ctx.storage.kv.put("job", row);
		if (row.beat && row.state === "running") await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
		return {row, fresh: true};
	}

	/** The box's first call out: its cold start is over. */
	async began() {
		const row = this.row();
		if (row === undefined || row.firstMs !== undefined) return;
		this.ctx.storage.kv.put("job", {...row, firstMs: Date.now() - row.at});
	}

	/** One model call more, if the job runs and has calls left. */
	async charge(): Promise<boolean> {
		const row = this.row();
		if (row === undefined || row.state !== "running") return false;
		if (row.calls >= Number(this.env.JOB_CALLS)) return false;
		this.ctx.storage.kv.put("job", {...row, calls: row.calls + 1});
		return true;
	}

	/** The job ended: kept, its box goes, and the host is told. */
	async finish(said: Ended) {
		const row = this.row();
		if (row === undefined || row.state === "done") return;
		// Before what the job said goes anywhere (this row, the host, the ledger, a page): no token
		// in it, as it is. A token encoded or cut up gets past this; see the write-up.
		const token = await this.env.PEOPLE.getByName(row.who).open(row.who, "token");
		const checked = withheld(said.said, token);
		const ended: Ended = {...said, said: checked.said};
		const done: JobRow = {
			...row,
			state: "done",
			ended,
			leak: checked.leak,
			took: Date.now() - row.at,
		};
		this.ctx.storage.kv.put("job", done);
		await this.ctx.storage.deleteAlarm();
		// After this answer is on its way: the box is still sending it.
		this.ctx.waitUntil(this.stop());
		await this.env.HOSTS.getByName(row.project).jobDone(row.project, row.who, row.job, ended);
	}

	private async stop() {
		await wait(100);
		if (this.box.running) await this.box.destroy();
	}

	/**
	 * The beat, while the box runs. An idle object is evicted after about 10 s, and locally its
	 * box goes with it (a 25 s job never ended, with no beat). So the job's object wakes every
	 * BEAT_MS: it checks the box is still there and the job has time left. Only this object stays
	 * awake, for as long as its box runs; the project's host still sleeps.
	 */
	async alarm() {
		const row = this.row();
		if (row?.state !== "running") return;
		if (Date.now() >= row.until) return this.finish({said: "the job ran out of time", code: 124});
		if (!this.box.running)
			return this.finish({said: "the box stopped before the job ended", code: 137});
		this.ctx.storage.kv.put("job", {...row, beats: row.beats + 1});
		await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
	}

	async status() {
		return {row: this.row() ?? null, running: this.box.running};
	}

	/**
	 * Look for anything secret in the running box, as root: every process's environment, command
	 * line and memory, and every file. It is handed no secret, only their shapes (box/probe.mjs).
	 */
	async probe() {
		if (!this.box.running) return {error: "no box runs"};
		// As root, for every file; as the job's own user, for its processes (root in a box has no
		// CAP_SYS_PTRACE, so it may not read another user's /proc/<pid>/environ or mem).
		const as = async (user: string) => {
			const p = await this.box.exec(["node", "/app/probe.mjs"], {user});
			const out = await p.output();
			const text = new TextDecoder().decode(out.stdout);
			try {
				return JSON.parse(text);
			} catch {
				return {
					error: "the probe's answer did not parse",
					exit: out.exitCode,
					stdout: text.slice(0, 500),
					stderr: new TextDecoder().decode(out.stderr).slice(0, 2000),
				};
			}
		};
		return {root: await as("root"), job: await as("node")};
	}
}

// ---------------------------------------------------------------- the project's host

/** What one wake of the host did, for the driver. */
interface Wake {
	readonly born: number;
	readonly opened: {who: string; ms: number; attached: readonly number[]}[];
}

export class ProjectHost extends DurableObject<Env> {
	/** In memory only: gone when the object is evicted, and opened again at the next message. */
	private readonly sessions = new Map<string, Promise<Session>>();
	/** Box jobs a program waits on now, by job: in memory only, like the sessions. */
	private readonly waiting = new Map<string, (e: Ended) => void>();
	private readonly wake: Wake = {born: Date.now(), opened: []};

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Every wake, kept: the driver reads when the host was made again, and so what woke it.
		const wakes = ctx.storage.kv.get<number[]>("wakes") ?? [];
		ctx.storage.kv.put("wakes", [...wakes, this.wake.born].slice(-50));
	}

	private project() {
		return this.ctx.storage.kv.get<string>("project") ?? "";
	}

	/** Each person's name on the ledger, registered once per wake (registering again is a no-op). */
	private readonly named = new Map<string, Promise<unknown>>();

	/**
	 * Note a fact on the project's ledger, stamped for the person. Errors are said, not thrown.
	 *
	 * The ledger denies a write under a name nobody registered, and a registered name takes writes
	 * only under a lease. The host holds no lease (a lease needs renewing, and renewing keeps the
	 * object awake), so it registers `jobs/<who>` and writes to that name's inbox, which is open.
	 */
	private fact(who: string, kind: string, data: unknown) {
		const ledger = this.env.LEDGER.getByName(this.project());
		const name = `jobs/${who}`;
		let named = this.named.get(name);
		if (named === undefined) {
			named = ledger.register(name, stampOf(who));
			this.named.set(name, named);
		}
		const tally = (k: "ok" | "refused", why?: string) => {
			const t = this.ctx.storage.kv.get<{ok: number; refused: number; why?: string}>("facts") ?? {
				ok: 0,
				refused: 0,
			};
			this.ctx.storage.kv.put("facts", {...t, [k]: t[k] + 1, ...(why ? {why} : {})});
		};
		this.ctx.waitUntil(
			named
				.then(() => ledger.append(`${name}/inbox`, "any", {kind, writer: stampOf(who), data}))
				.then(
					(r) => {
						const res = r as {ok?: boolean};
						tally(
							res.ok === false ? "refused" : "ok",
							res.ok === false ? JSON.stringify(r) : undefined,
						);
					},
					(e) => tally("refused", String(e)),
				),
		);
	}

	/** Send to every page this person has open on the host. */
	private send(who: string, m: unknown) {
		const text = JSON.stringify(m);
		for (const ws of this.ctx.getWebSockets(who)) {
			try {
				ws.send(text);
			} catch {
				// closing as we send: it reads the rest from the ledger when it comes back
			}
		}
	}

	/** This person's tsh, opened once per wake. */
	private session(who: string): Promise<Session> {
		const kept = this.sessions.get(who);
		if (kept !== undefined) return kept;
		const project = this.project();
		const opening = openSession({
			who,
			kv: this.ctx.storage.kv,
			out: (m) => this.send(who, m),
			fact: (kind, data) => this.fact(who, kind, data),
			boxes: {
				run: (job, cmd) => Effect.promise(() => this.runBox(project, who, job, cmd)),
			},
		}).then((s) => {
			this.wake.opened.push({who, ms: s.openMs, attached: s.attached});
			return s;
		});
		this.sessions.set(who, opening);
		return opening;
	}

	/** Start the job's box, or find it, and wait for its end. The wait holds no I/O: it does not keep the object awake. */
	private async runBox(
		project: string,
		who: string,
		job: string,
		cmd: string,
		beat = true,
	): Promise<Ended> {
		const begun = await this.env.JOBS.getByName(`${project}/${job}`)
			.begin({project, who, job, cmd, beat})
			.catch((e: unknown) => ({error: String(e)}));
		if ("error" in begun) return {said: `the box did not start: ${begun.error}`, code: 125};
		const {row, fresh} = begun;
		if (row.ended !== undefined) return row.ended;
		if (fresh) this.fact(who, "box_began", {job, cmd, startMs: row.startMs});
		this.ctx.storage.kv.put(`box:${job}`, {who, cmd, state: "running"});
		return new Promise((resolve) => this.waiting.set(job, resolve));
	}

	/** A job's box ended. The program waiting on it hears it now, or at its next attach after an eviction. */
	async jobDone(project: string, who: string, job: string, ended: Ended) {
		this.ctx.storage.kv.put("project", project);
		this.ctx.storage.kv.put(`box:${job}`, {who, state: "done", code: ended.code});
		// What it printed is kept on the ledger too: a page not open when it ended reads it there.
		this.fact(who, "box_ended", {job, code: ended.code, said: ended.said.slice(0, 2048)});
		const waiter = this.waiting.get(job);
		this.waiting.delete(job);
		if (waiter !== undefined) waiter(ended);
		// Evicted since: opening the session attaches the job again, and it finds its box done.
		else await this.session(who);
	}

	async fetch(req: Request) {
		const url = new URL(req.url);
		const who = url.searchParams.get("who") ?? "";
		this.ctx.storage.kv.put("project", url.searchParams.get("project") ?? "");
		switch (url.pathname) {
			case "/attach": {
				if (req.headers.get("upgrade") !== "websocket")
					return new Response("a WebSocket only", {status: 426});
				const pair = new WebSocketPair();
				// Hibernatable: the object sleeps with the page still open, and a message wakes it.
				const page = pair[1];
				this.ctx.acceptWebSocket(page, [who]);
				// The page hears how its person's tsh was opened: at this wake, by this attach or before it.
				const fresh = !this.sessions.has(who);
				this.ctx.waitUntil(
					this.session(who).then((s) =>
						page.send(
							JSON.stringify({
								type: "opened",
								ms: s.openMs,
								attached: s.attached,
								born: this.wake.born,
								fresh,
							}),
						),
					),
				);
				return new Response(null, {status: 101, webSocket: pair[0]});
			}
			case "/status":
				return Response.json({
					wake: this.wake,
					wakes: this.ctx.storage.kv.get("wakes") ?? [],
					timers: live.size,
					// The host sets no alarm of its own: nothing it runs today waits on a clock.
					alarm: await this.ctx.storage.getAlarm(),
					facts: this.ctx.storage.kv.get("facts") ?? null,
					inMemory: [...this.sessions.keys()],
					boxes: Object.fromEntries(this.ctx.storage.kv.list({prefix: "box:"})),
				});
			case "/evict":
				// The driver's stand-in for an eviction: the object is thrown away, its storage kept.
				this.ctx.abort("evicted by the driver");
				return new Response("gone");
			case "/nobeat": {
				// The driver's: one box job whose object does not beat, started outside tsh, to see
				// whether an idle job object and its box are dropped. Its end is heard as any job's.
				const job = `nobeat-${crypto.randomUUID()}`;
				const ended = this.runBox(this.project(), who, job, await req.text(), false);
				this.ctx.waitUntil(ended.then(() => undefined));
				return Response.json({job});
			}
			case "/probe":
				return Response.json(
					await this.env.JOBS.getByName(
						`${this.project()}/${url.searchParams.get("job") ?? ""}`,
					).probe(),
				);
			case "/job":
				return Response.json(
					await this.env.JOBS.getByName(
						`${this.project()}/${url.searchParams.get("job") ?? ""}`,
					).status(),
				);
		}
		return new Response("not found", {status: 404});
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		const who = this.ctx.getTags(ws)[0] ?? "";
		const m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as {
			type?: string;
			text?: string;
		};
		if (m.type === "line" && typeof m.text === "string")
			await (await this.session(who)).line(m.text);
	}

	async webSocketClose(ws: WebSocket, code: number) {
		ws.close(code, "bye");
	}
}

// ---------------------------------------------------------------- the stand-in door

const signedIn = (env: Env, req: Request, url: URL): string | null => {
	const sessions = JSON.parse(env.SESSIONS) as Record<string, string>;
	const header = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
	// A browser's WebSocket can set no header: the session rides in the query on attach only.
	const token = header !== "" ? header : (url.searchParams.get("session") ?? "");
	return sessions[token] ?? null;
};

export default {
	async fetch(req: Request, env: Env) {
		const url = new URL(req.url);
		const who = signedIn(env, req, url);
		if (who === null) return new Response("sign in first", {status: 401});
		if (url.pathname === "/person/key" && req.method === "PUT")
			return Response.json(await env.PEOPLE.getByName(who).put(who, await req.text()));
		if (url.pathname === "/person/token" && req.method === "PUT")
			return Response.json(await env.PEOPLE.getByName(who).put(who, await req.text(), "token"));
		if (url.pathname === "/person/row") return Response.json(await env.PEOPLE.getByName(who).row());
		const m = url.pathname.match(/^\/p\/([\w.-]+)\/([\w-]+)(?:\/(.*))?$/);
		if (m === null) return new Response("not found", {status: 404});
		const project = m[1] ?? "";
		const what = m[2] ?? "";
		const rest = m[3];
		if (what === "ledger") {
			const ledger = env.LEDGER.getByName(project);
			// One stream, or with none named, every row on the project's ledger.
			const rows = rest
				? await ledger.readStream(decodeURIComponent(rest), 0, -1)
				: await ledger.read(0, 10000);
			return Response.json(rows);
		}
		// The person is the door's to say: whatever the request said goes.
		const inner = new URL(`http://host/${what}`);
		inner.searchParams.set("project", project);
		inner.searchParams.set("who", who);
		const job = url.searchParams.get("job");
		if (job !== null) inner.searchParams.set("job", job);
		return env.HOSTS.getByName(project).fetch(new Request(inner, req));
	},
};
