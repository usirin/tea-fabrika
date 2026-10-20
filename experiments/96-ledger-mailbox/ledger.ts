// Copied from experiments/93-ledger/ledger.ts. What changed:
//
//   - `append` takes "any" for the rev and an event `id` (sql.ts), and `readStream` a rev to read
//     from; `read` takes an optional prefix.
//   - The live tail: a WebSocket per watcher, held by the Durable Object's hibernation API
//     (`ctx.acceptWebSocket`), so a ledger with no traffic sleeps and still keeps its watchers.
//     A watcher names the streams it follows (`?stream=a&prefix=b`, at most 10). After every
//     write the object sends each matching socket one small notice, `{stream, rev, pos}`: a wake-up
//     with no event in it. The watcher then reads from its own cursor (`readStream`), so a lost or
//     doubled wake-up can only cost a read, never skip or repeat an event.
//
// It runs in workerd (Cloudflare, or Miniflare on a laptop), not in Node. Not type-checked:
// experiments sit outside `pnpm typecheck`, and `cloudflare:workers` has no types in this repo.
// The harness strips the types with Node's own stripper before it hands the files to workerd.
import {DurableObject} from "cloudflare:workers";
import * as L from "./sql.ts";

type Cursor = {toArray(): L.Row[]};
type Socket = {send(text: string): void; close(code?: number, reason?: string): void};
type Storage = {
	sql: {exec(sql: string, ...bind: L.Value[]): Cursor; databaseSize: number};
	transactionSync<T>(fn: () => T): T;
	getAlarm(): Promise<number | null>;
	setAlarm(at: number): Promise<void>;
	deleteAlarm(): Promise<void>;
};
type Ctx = {
	storage: Storage;
	acceptWebSocket(ws: Socket, tags: string[]): void;
	getWebSockets(tag?: string): Socket[];
};
type Env = {LEDGER: Namespace; EXPIRY_GRACE_MS?: string};
type Namespace = {
	idFromName(name: string): unknown;
	get(id: unknown): Record<string, Rpc> & {fetch(req: Request): Promise<Response>};
};
type Rpc = (...args: unknown[]) => Promise<unknown>;

/** If an alarm run dies halfway, the alarm comes back after this long. */
const FALLBACK_MS = 30_000;
/** workerd's own limit on tags per hibernated socket. */
const MAX_TAGS = 10;

export class Ledger extends DurableObject {
	private readonly ctx: Ctx;
	private readonly storage: Storage;
	private readonly db: L.Db;
	private readonly graceMs: number;

	constructor(ctx: Ctx, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.storage = ctx.storage;
		this.graceMs = Number(env.EXPIRY_GRACE_MS ?? "1000");
		this.db = {
			all: (sql, ...bind) => ctx.storage.sql.exec(sql, ...bind).toArray(),
			tx: (fn) => ctx.storage.transactionSync(fn),
		};
		L.migrate(this.db);
	}

	async append(stream: string, expected: L.Expected, event: L.Event, fence?: number | null) {
		const res = L.append(this.db, Date.now(), stream, expected, event, fence ?? null);
		if (res.ok && !res.dup) this.wake(stream, res.rev, res.pos);
		return res;
	}

	async claim(stream: string, holder: string, expectedRev: number, ttlMs: number) {
		const res = L.claim(this.db, Date.now(), stream, holder, expectedRev, ttlMs, this.graceMs);
		if (res.ok) {
			this.wake(stream, res.rev, res.fence);
			await this.arm();
		}
		return res;
	}

	async renew(stream: string, fence: number, ttlMs: number) {
		const res = L.renew(this.db, Date.now(), stream, fence, ttlMs, this.graceMs);
		if (res.ok) await this.arm();
		return res;
	}

	async cancel(stream: string, writer: string) {
		const res = L.cancel(this.db, Date.now(), stream, writer);
		if (res.ok) this.wake(stream, res.rev, res.pos);
		return res;
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

	async lease(stream: string) {
		return L.lease(this.db, stream);
	}

	async openCriteria(stream: string) {
		return L.openCriteria(this.db, stream);
	}

	async alarmAt() {
		return {alarm: await this.storage.getAlarm(), due: L.nextDue(this.db)};
	}

	/** How many watchers are connected now. */
	async watchers() {
		return this.ctx.getWebSockets().length;
	}

	/** Experiment only: run one statement and say what came back. A real ledger has no such call. */
	async tryExec(sql: string) {
		try {
			return {ok: true, rows: this.storage.sql.exec(sql).toArray()};
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
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

	async webSocketClose(ws: Socket, code: number) {
		ws.close(code === 1005 || code === 1006 ? 1000 : code);
	}

	async alarm() {
		// A fallback first, so a crash halfway through still comes back.
		await this.storage.setAlarm(Date.now() + FALLBACK_MS);
		for (const w of L.runDue(this.db, Date.now())) this.wake(w.stream, w.rev, w.pos);
		await this.arm();
	}

	/** Tell every watcher of this stream, or of a prefix it sits under, that it moved. */
	private wake(stream: string, rev: number, pos: number) {
		const note = JSON.stringify({stream, rev, pos});
		const told = new Set<Socket>();
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
		const now = await this.storage.getAlarm();
		if (due === null) {
			if (now !== null) await this.storage.deleteAlarm();
		} else if (now !== due) {
			await this.storage.setAlarm(due);
		}
	}
}

const METHODS = new Set([
	"append",
	"claim",
	"renew",
	"cancel",
	"read",
	"readStream",
	"readLast",
	"lease",
	"openCriteria",
	"alarmAt",
	"watchers",
	"tryExec",
]);

/**
 * Plain HTTP for processes that cannot hold an RPC stub: POST /<ledger>/<method> [args]. And
 * GET /<ledger>/tail?stream=..&prefix=.. with `Upgrade: websocket`: the live tail's wake-ups.
 */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const [, name, method] = new URL(req.url).pathname.split("/");
		if (name && method === "tail") return env.LEDGER.get(env.LEDGER.idFromName(name)).fetch(req);
		if (!name || !method || !METHODS.has(method)) return new Response("not found", {status: 404});
		const args: unknown[] = req.method === "POST" ? await req.json() : [];
		const stub = env.LEDGER.get(env.LEDGER.idFromName(name));
		try {
			return Response.json(await stub[method]?.(...args));
		} catch (e) {
			return Response.json({error: e instanceof Error ? e.message : String(e)}, {status: 500});
		}
	},
};
