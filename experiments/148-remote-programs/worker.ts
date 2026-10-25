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
	/** Where the model is: the stand-in on the laptop, or https://api.anthropic.com. */
	readonly UPSTREAM: string;
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

/** AES-GCM under a key drawn from KEY_SEAL for this one person: one person's row opens no other's. */
const sealKey = async (seal: string, who: string) => {
	const base = await crypto.subtle.importKey("raw", bytes(seal), "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{name: "HKDF", hash: "SHA-256", salt: bytes("exp148/person-key"), info: bytes(who)},
		base,
		{name: "AES-GCM", length: 256},
		false,
		["encrypt", "decrypt"],
	);
};

/** One person: their model key, sealed at rest in this object's own storage. */
export class Person extends DurableObject<Env> {
	async put(who: string, key: string) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const k = await sealKey(this.env.KEY_SEAL, who);
		const sealed = await crypto.subtle.encrypt({name: "AES-GCM", iv}, k, bytes(key));
		this.ctx.storage.kv.put("key", {who, iv: hex(iv), sealed: hex(sealed)});
		return {who};
	}

	/** The key, open, for the one call the relay makes now. Never kept open, never sent to a box. */
	async open(who: string): Promise<string | null> {
		const row = this.ctx.storage.kv.get<{who: string; iv: string; sealed: string}>("key");
		if (row === undefined || row.who !== who) return null;
		const k = await sealKey(this.env.KEY_SEAL, who);
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
		return fetch(`${this.env.UPSTREAM}/v1/messages`, {method: "POST", headers, body: req.body});
	}
}

/** http://host.internal/done, from inside a box: its job ended, with what it printed. */
export class JobDone extends WorkerEntrypoint<Env, BoxProps> {
	async fetch(req: Request) {
		const {project, job} = this.ctx.props;
		if (req.method !== "POST" || new URL(req.url).pathname !== "/done")
			return new Response("not found", {status: 404});
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
	readonly ended?: Ended;
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
	async begin(o: BoxProps & {readonly cmd: string}): Promise<{row: JobRow; fresh: boolean}> {
		const kept = this.row();
		if (kept !== undefined) return {row: kept, fresh: false};
		const t0 = Date.now();
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
			env: {JOB_CMD: o.cmd, JOB: o.job},
		});
		const props = {project: o.project, who: o.who, job: o.job};
		await this.box.interceptOutboundHttp("model.internal", this.ctx.exports.ModelRelay({props}));
		await this.box.interceptOutboundHttp("host.internal", this.ctx.exports.JobDone({props}));
		const row: JobRow = {
			...o,
			state: "running",
			startMs: Date.now() - t0,
			at: t0,
			calls: 0,
			until: t0 + Number(this.env.JOB_TIMEOUT_MS),
			beats: 0,
		};
		this.ctx.storage.kv.put("job", row);
		await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
		return {row, fresh: true};
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
	async finish(ended: Ended) {
		const row = this.row();
		if (row === undefined || row.state === "done") return;
		const done: JobRow = {...row, state: "done", ended, took: Date.now() - row.at};
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
	private async runBox(project: string, who: string, job: string, cmd: string): Promise<Ended> {
		const begun = await this.env.JOBS.getByName(`${project}/${job}`)
			.begin({project, who, job, cmd})
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
