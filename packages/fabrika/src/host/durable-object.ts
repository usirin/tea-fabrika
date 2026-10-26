// The ledger as a Cloudflare Durable Object: one SQLite database, every rule in `rules.ts`. It runs
// in workerd (Cloudflare, or Miniflare on a laptop: `local.ts`), not in Node. workerd gets this file
// bundled with what it imports, `effect` too (worker-options.ts), as Cloudflare's own tools bundle
// a Worker.
//
// Lifted from experiment 97 (experiments/97-one-ledger/ledger.ts). What changed: `register` is new;
// the experiment-only calls (`tryExec`, `openCriteria`) are gone. 99 adds OTP's process calls.
//
// The live tail is 96's: a WebSocket per watcher, held by the hibernation API
// (`ctx.acceptWebSocket`), so a ledger with no traffic sleeps and keeps its watchers. After every
// write it sends each matching socket one small notice, `{stream, rev, pos}`, with no event in it:
// the watcher reads from its own cursor, so a lost or doubled notice costs a read, never an event.
//
// Two ways in. The object's methods (`register`, `append`, ...) take a writer and a holder as
// arguments: only code holding the `LEDGER` binding can call them, the Worker on Cloudflare, or a
// test through Miniflare (`inside.ts`). The network's way in is `fetch`, and it goes through the
// door (`door.ts`): no credential, no read and no write; the writer and the holder come from the
// credential, never from the request.
import {DurableObject} from "cloudflare:workers";
import {Layer, ManagedRuntime, Redacted} from "effect";
import {FetchHttpClient} from "effect/http";
import {configOf, Door, type DoorConfig, isWireMethod, type Stamp, trustedArgs} from "./door.ts";
import {type Keys, layerNobody} from "./keys.ts";
import {KEYS_CACHE_MS, KEYS_FAIL_MS, layerGitHub} from "./keys-github.ts";
import * as L from "./rules.ts";

type Cursor = {toArray(): L.SqlRow[]};
type Storage = {
	sql: {exec(sql: string, ...bind: L.Value[]): Cursor};
	transactionSync<T>(fn: () => T): T;
	getAlarm(): Promise<number | null>;
	setAlarm(at: number): Promise<void>;
	deleteAlarm(): Promise<void>;
};
type Ctx = {
	/** `name`: what `idFromName` was given, when workerd knows it. */
	id?: {name?: string};
	storage: Storage;
	acceptWebSocket(ws: WorkerSocket, tags: string[]): void;
	getWebSockets(tag?: string): WorkerSocket[];
};
type Env = {
	LEDGER: Namespace;
	EXPIRY_GRACE_MS?: string;
	MAX_DELIVERIES?: string;
	/**
	 * The door, by config (`configOf`): DOOR, LOCAL_PERSON, LOCAL_SECRET_HASH, FOUNDER, ORIGIN,
	 * SESSION_MS. Where a shared door's keys come from (`keysOf`): KEYS, KEYS_CACHE_MS,
	 * KEYS_FAIL_MS, and the optional secret GITHUB_TOKEN.
	 */
	[door: string]: unknown;
};

/**
 * The `Keys` Layer the env names, or null when it names none this file knows, or says it wrong.
 *
 *   KEYS=github   GitHub's keys and ids (`keys-github.ts`), kept KEYS_CACHE_MS (default 5 min),
 *                 a failure kept KEYS_FAIL_MS (default 30 s), asked with the GITHUB_TOKEN secret
 *                 when it is set (none: GitHub's shared limit)
 *
 * The one place a Layer is picked: a new answer to `Keys` is one more line here.
 */
const keysOf = (env: Env): Layer.Layer<Keys> | null => {
	/** A length of time in ms from the env: the default when left out, null when it does not read. */
	const ms = (k: string, fallback: number): number | null => {
		const s = typeof env[k] === "string" ? env[k] : "";
		return s === "" ? fallback : /^[0-9]{1,12}$/.test(s) ? Number(s) : null;
	};
	const cacheMs = ms("KEYS_CACHE_MS", KEYS_CACHE_MS);
	const failMs = ms("KEYS_FAIL_MS", KEYS_FAIL_MS);
	if (env.KEYS !== "github" || cacheMs === null || failMs === null) return null;
	const token =
		typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN !== ""
			? {token: Redacted.make(env.GITHUB_TOKEN)}
			: {};
	return layerGitHub({cacheMs, failMs, ...token}).pipe(Layer.provide(FetchHttpClient.layer));
};

/** A shared door with no keys to ask is closed: nobody could prove who they are. */
const closedWithout = (config: DoorConfig, keys: Layer.Layer<Keys> | null): DoorConfig =>
	config.kind === "shared" && keys === null ? {kind: "closed" as const} : config;
type Stub = {fetch(req: Request): Promise<Response>} & Record<
	string,
	((...args: unknown[]) => Promise<unknown>) | undefined
>;
type Namespace = {idFromName(name: string): unknown; get(id: unknown): Stub};

/** If an alarm run dies halfway, the alarm comes back after this long. */
const FALLBACK_MS = 30_000;
/** workerd's own limit on tags per hibernated socket. */
const MAX_TAGS = 10;

export class Ledger extends DurableObject {
	private readonly ctx: Ctx;
	private readonly db: L.Db;
	private readonly graceMs: number;
	private readonly maxDeliveries: number | null;
	private readonly door: Door;

	constructor(ctx: Ctx, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.graceMs = Number(env.EXPIRY_GRACE_MS ?? "1000");
		// "off": a poison message is never set aside (the run that shows OTP's intensity alone).
		const max = env.MAX_DELIVERIES ?? String(L.MAX_DELIVERIES);
		this.maxDeliveries = max === "off" ? null : Number(max);
		this.db = {
			all: (sql, ...bind) => ctx.storage.sql.exec(sql, ...bind).toArray(),
			tx: (fn) => ctx.storage.transactionSync(fn),
		};
		L.migrate(this.db);
		const keys = keysOf(env);
		// One runtime for the object's life: the Layer is built once, so what it keeps (GitHub's
		// answers, for their cache time) is kept across logins. A local or closed door asks nobody.
		this.door = new Door(
			this.db,
			closedWithout(configOf(env), keys),
			ManagedRuntime.make(keys ?? layerNobody),
			{wrote: (w) => this.wake(w.stream, w.rev, w.pos)},
		);
	}

	async register(name: string, writer: string) {
		const res = L.register(this.db, Date.now(), name, writer);
		if (res.ok && res.created) this.wake(name, res.rev, res.pos);
		return res;
	}

	async append(stream: string, expected: L.Expected, event: L.Event, fence?: number | null) {
		const res = L.append(this.db, Date.now(), stream, expected, event, fence ?? null);
		if (res.ok && !res.dup) this.wake(stream, res.rev, res.pos);
		return res;
	}

	async claim(name: string, holder: string, expectedRev: number, ttlMs: number) {
		const res = L.claim(this.db, Date.now(), name, holder, expectedRev, ttlMs, this.graceMs);
		if (res.ok) {
			this.wake(name, res.rev, res.fence);
			await this.arm();
		}
		return res;
	}

	async renew(name: string, fence: number, ttlMs: number) {
		const res = L.renew(this.db, Date.now(), name, fence, ttlMs, this.graceMs);
		if (res.ok) await this.arm();
		return res;
	}

	async cancel(name: string, writer: string) {
		const res = L.cancel(this.db, Date.now(), name, writer);
		if (res.ok) this.wake(name, res.rev, res.pos);
		return res;
	}

	// 99: OTP's process calls. Each may write to several streams (DOWNs, EXITs, a dead letter):
	// every one it wrote is woken.

	async exit(
		name: string,
		fence: number,
		reason: L.ExitReason,
		why: string,
		suspect: number | null,
		writer: string,
	) {
		const now = Date.now();
		const res = L.exit(this.db, now, name, fence, reason, why, suspect, writer, this.maxDeliveries);
		if (res.ok) this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	async monitor(fence: number, ref: string, target: string) {
		const res = L.monitor(this.db, Date.now(), fence, ref, target);
		if (res.ok) this.wakeAll(res.written);
		return res;
	}

	async demonitor(fence: number, ref: string) {
		return L.demonitor(this.db, Date.now(), fence, ref);
	}

	async link(fence: number, other: string) {
		return L.link(this.db, Date.now(), fence, other);
	}

	async unlink(fence: number, other: string) {
		return L.unlink(this.db, Date.now(), fence, other);
	}

	async trapExit(fence: number, on: boolean) {
		return L.trapExit(this.db, Date.now(), fence, on);
	}

	async startChild(fence: number, child: string, after: number | null, limits?: L.Limits | null) {
		const res = L.startChild(this.db, Date.now(), fence, child, after, limits ?? null);
		if (res.ok || res.why === "limit") this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	/** 102: spend, counted up the tree; a limit it crosses ends a run, so the alarm may move. */
	async hold(fence: number, id: string, cost: L.Cost) {
		const res = L.hold(this.db, Date.now(), fence, id, cost);
		if (res.ok || res.why === "limit") this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	async charge(fence: number, id: string, cost: L.Cost) {
		const res = L.charge(this.db, Date.now(), fence, id, cost);
		if (res.ok) this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	async setLimits(name: string, limits: L.Limits, writer: string) {
		const res = L.setLimits(this.db, Date.now(), name, limits, writer);
		if (res.ok) this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	async usage(name: string) {
		return L.usage(this.db, name);
	}

	async exitChild(
		fence: number,
		child: string,
		incarnation: number,
		signal: L.Signal,
		why: string,
	) {
		const now = Date.now();
		const res = L.exitChild(
			this.db,
			now,
			fence,
			child,
			incarnation,
			signal,
			why,
			this.maxDeliveries,
		);
		if (res.ok) this.wakeAll(res.written);
		await this.arm();
		return res;
	}

	async processInfo(name: string) {
		return L.processOf(this.db, name);
	}

	async read(fromPos: number, limit: number, prefix?: string | null) {
		return L.read(this.db, fromPos, limit, prefix ?? null);
	}

	async readStream(stream: string, fromRev?: number, limit?: number) {
		return L.readStream(this.db, stream, fromRev ?? 0, limit ?? -1);
	}

	async readLast(stream: string, count: number) {
		return L.readLast(this.db, stream, count);
	}

	async lease(name: string) {
		return L.lease(this.db, name);
	}

	/** Where the one alarm sits, and the earliest job: they should agree. */
	async alarmAt() {
		return {alarm: await this.ctx.storage.getAlarm(), due: L.nextDue(this.db)};
	}

	/** How many watchers are connected now. */
	async watchers() {
		return this.ctx.getWebSockets().length;
	}

	/**
	 * One of the methods above, by name, its answer as JSON text: for a caller that holds the
	 * binding (`inside.ts`). Trusted like the methods themselves: it takes the writer and the holder
	 * as given, and no request from the network reaches it. Text, because an object answer comes to
	 * Miniflare's caller as a proxy that costs a round trip for each field read.
	 */
	async call(method: string, args: unknown[]): Promise<string> {
		if (!isWireMethod(method)) throw new Error(`no method ${method}`);
		const fn: unknown = Reflect.get(this, method);
		if (typeof fn !== "function") throw new Error(`no method ${method}`);
		return JSON.stringify((await Reflect.apply(fn, this, args)) ?? null);
	}

	/**
	 * The network's way in, through the door:
	 *
	 *   POST /<ledger>/door/challenge | login | agent-login     no credential: the login's own steps
	 *   GET  /<ledger>/door/who | members                       any credential
	 *   POST /<ledger>/door/invite | remove | agent             a person's credential
	 *   POST /<ledger>/<method>  [args, no writer]              any credential; the door stamps
	 *   GET  /<ledger>/tail?stream=..  Upgrade: websocket       any credential
	 *
	 * A credential is `Authorization: Bearer <token>`, or for a WebSocket, which cannot send that
	 * header from a browser, the subprotocol `bearer.<token>` beside `fabrika` (Kubernetes carries
	 * its bearer token the same way).
	 *
	 * Whatever the answer, the request's body is read to its end first (`drained`).
	 */
	async fetch(req: Request) {
		return drained(req, await this.through(req));
	}

	private async through(req: Request) {
		const url = new URL(req.url);
		const [, ledger = "", method = "", step = ""] = url.pathname.split("/");
		// The Worker picked this object by the name in the path (`objectOf`). When workerd says
		// which name made this object, they must agree, or a grant for one would open another.
		const named = this.ctx.id?.name;
		if (named !== undefined && named !== ledger)
			return new Response("not this ledger", {status: 404});
		const address = this.door.address(url.origin, ledger);
		const offered = (req.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((p) => p.trim());
		const bearer =
			/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ??
			offered.find((p) => p.startsWith("bearer."))?.slice("bearer.".length) ??
			null;
		if (method === "door") return this.doorStep(req, step, address, bearer);
		const who = await this.door.who(bearer);
		if (!who.ok) return refused(who);
		if (method === "tail") return this.tail(req, url, offered);
		if (req.method !== "POST") return new Response("POST [args]", {status: 405});
		const body: unknown = await req.json().catch(() => null);
		const args = trustedArgs(method, body, who.value);
		if (!args.ok) return refused(args);
		// `trustedArgs` let through only a method in its table, each one a method of this class.
		const call: unknown = Reflect.get(this, method);
		if (typeof call !== "function") return new Response("no such method", {status: 404});
		try {
			return Response.json(await Reflect.apply(call, this, args.value));
		} catch (e) {
			return Response.json({error: e instanceof Error ? e.message : String(e)}, {status: 500});
		}
	}

	private async doorStep(req: Request, step: string, address: string, bearer: string | null) {
		const body = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Record<
			string,
			unknown
		>;
		if (step === "challenge") return answer(this.door.challenge(address));
		if (step === "login") return answer(await this.door.login(body));
		if (step === "agent-login") return answer(await this.door.agentLogin(address, body));
		const who = await this.door.who(bearer);
		if (!who.ok) return refused(who);
		const me: Stamp = who.value;
		if (step === "who") return Response.json({who: me});
		if (step === "members") {
			const m = this.door.members();
			return Response.json({
				members: [...m.members].map(([id, name]) => ({id, name})),
				invited: [...m.invited].map(([id, name]) => ({id, name})),
			});
		}
		if (step === "invite") return answer(await this.door.invite(me, body.name));
		if (step === "remove") return answer(this.door.remove(me, body.id));
		if (step === "agent") return answer(await this.door.addAgent(me, body.name));
		return new Response("not found", {status: 404});
	}

	/** A watcher: upgrade to a WebSocket the runtime holds while the object sleeps. */
	private async tail(req: Request, url: URL, offered: readonly string[]) {
		const tags = [
			...url.searchParams.getAll("stream").map((s) => `s:${s}`),
			...url.searchParams.getAll("prefix").map((p) => `p:${p}`),
		];
		if (req.headers.get("upgrade") !== "websocket" || tags.length === 0 || tags.length > MAX_TAGS)
			return new Response("a watcher names 1 to 10 streams or prefixes", {status: 400});
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1], tags);
		// Name the subprotocol the client offered, or it closes the socket; never echo the token.
		const headers: Record<string, string> = offered.includes("fabrika")
			? {"sec-websocket-protocol": "fabrika"}
			: {};
		return new Response(null, {status: 101, webSocket: pair[0], headers});
	}

	/** A watcher says nothing the ledger needs; it only listens. */
	async webSocketMessage() {}

	async webSocketClose(ws: WorkerSocket, code: number) {
		ws.close(code === 1005 || code === 1006 ? 1000 : code);
	}

	async alarm() {
		// A fallback first, so a crash halfway through still comes back.
		await this.ctx.storage.setAlarm(Date.now() + FALLBACK_MS);
		this.wakeAll(L.runDue(this.db, Date.now()));
		await this.arm();
	}

	private wakeAll(written: readonly L.Written[]) {
		for (const w of written) this.wake(w.stream, w.rev, w.pos);
	}

	/** Tell every watcher of this stream, or of a prefix it sits under, that it moved. */
	private wake(stream: string, rev: number, pos: number) {
		const note = JSON.stringify({stream, rev, pos});
		const told = new Set<WorkerSocket>();
		for (const tag of L.wakeTags(stream)) {
			for (const ws of this.ctx.getWebSockets(tag)) {
				if (told.has(ws)) continue;
				told.add(ws);
				try {
					ws.send(note);
				} catch {
					// A socket closing as we send: its watcher reads from its cursor when it reconnects.
				}
			}
		}
	}

	/** The one alarm always sits at the earliest job. */
	private async arm() {
		const due = L.nextDue(this.db);
		const now = await this.ctx.storage.getAlarm();
		if (due === null) {
			if (now !== null) await this.ctx.storage.deleteAlarm();
		} else if (now !== due) {
			await this.ctx.storage.setAlarm(due);
		}
	}
}

const refused = (r: {status: number; why: string}) =>
	Response.json({error: r.why}, {status: r.status});
const answer = (r: {ok: true; value: unknown} | {ok: false; status: number; why: string}) =>
	r.ok ? Response.json(r.value) : refused(r);

/**
 * `res`, once the rest of `req`'s body has been read and thrown away. workerd drops a kept-alive
 * connection when an answer leaves the body unread, and the client's next call on it fails
 * (experiment 145). An early refusal reads nothing, so this reads it, without keeping it: a body
 * nobody is let in for is never held in memory.
 */
const drained = async (req: Request, res: Response): Promise<Response> => {
	if (req.body !== null && !req.bodyUsed)
		await req.body.pipeTo(new WritableStream()).catch(() => {
			// The client went away mid-body: there is no connection left to keep.
		});
	return res;
};

/**
 * Which object a request is for: the name it is picked by, `idFromName`. One server holds many
 * objects (one per project, one per person); today the name is the path's first part. A router
 * goes here (experiment 145), and every object keeps its own door and its own members.
 */
export const objectOf = (url: URL): string | null => url.pathname.split("/")[1] || null;

/**
 * Plain HTTP for processes that cannot hold an RPC stub: every request goes to its object, whose
 * `fetch` is the door. The Worker itself reads nothing and calls no method.
 */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const name = objectOf(new URL(req.url));
		if (name === null) return drained(req, new Response("not found", {status: 404}));
		return env.LEDGER.get(env.LEDGER.idFromName(name)).fetch(req);
	},
};
