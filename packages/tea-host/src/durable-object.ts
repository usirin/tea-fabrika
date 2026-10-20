// The ledger as a Cloudflare Durable Object: one SQLite database, every rule in `rules.ts`. It runs
// in workerd (Cloudflare, or Miniflare on a laptop: `local.ts`), not in Node. workerd gets this file
// and `rules.ts` with their types stripped by Node's own stripper, so both stay erasable TypeScript.
//
// Lifted from experiment 97 (experiments/97-one-ledger/ledger.ts). What changed: `register` is new;
// the experiment-only calls (`tryExec`, `openCriteria`) are gone. 99 adds OTP's process calls.
//
// The live tail is 96's: a WebSocket per watcher, held by the hibernation API
// (`ctx.acceptWebSocket`), so a ledger with no traffic sleeps and keeps its watchers. After every
// write it sends each matching socket one small notice, `{stream, rev, pos}`, with no event in it:
// the watcher reads from its own cursor, so a lost or doubled notice costs a read, never an event.
import {DurableObject} from "cloudflare:workers";
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
	storage: Storage;
	acceptWebSocket(ws: WorkerSocket, tags: string[]): void;
	getWebSockets(tag?: string): WorkerSocket[];
};
type Env = {LEDGER: Namespace; EXPIRY_GRACE_MS?: string; MAX_DELIVERIES?: string};
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

	async startChild(fence: number, child: string, after: number | null) {
		const res = L.startChild(this.db, Date.now(), fence, child, after);
		if (res.ok) this.wakeAll(res.written);
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

	/** A watcher: upgrade to a WebSocket the runtime holds while the object sleeps. */
	async fetch(req: Request) {
		const url = new URL(req.url);
		const tags = [
			...url.searchParams.getAll("stream").map((s) => `s:${s}`),
			...url.searchParams.getAll("prefix").map((p) => `p:${p}`),
		];
		if (req.headers.get("upgrade") !== "websocket" || tags.length === 0 || tags.length > MAX_TAGS)
			return new Response("a watcher names 1 to 10 streams or prefixes", {status: 400});
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1], tags);
		return new Response(null, {status: 101, webSocket: pair[0]});
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

const METHODS = new Set([
	"register",
	"append",
	"claim",
	"renew",
	"cancel",
	"exit",
	"monitor",
	"demonitor",
	"link",
	"unlink",
	"trapExit",
	"startChild",
	"processInfo",
	"read",
	"readStream",
	"readLast",
	"lease",
	"alarmAt",
	"watchers",
]);

/**
 * Plain HTTP for processes that cannot hold an RPC stub: POST /<ledger>/<method> [args]. And
 * GET /<ledger>/tail?stream=..&prefix=.. with `Upgrade: websocket`: the live tail's notices.
 */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const [, name, method] = new URL(req.url).pathname.split("/");
		if (name && method === "tail") return env.LEDGER.get(env.LEDGER.idFromName(name)).fetch(req);
		if (!name || !method || !METHODS.has(method)) return new Response("not found", {status: 404});
		const body: unknown = req.method === "POST" ? await req.json() : [];
		const args = Array.isArray(body) ? body : [];
		const stub = env.LEDGER.get(env.LEDGER.idFromName(name));
		try {
			return Response.json(await stub[method]?.(...args));
		} catch (e) {
			return Response.json({error: e instanceof Error ? e.message : String(e)}, {status: 500});
		}
	},
};
