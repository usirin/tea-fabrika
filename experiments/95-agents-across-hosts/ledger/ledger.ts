// The ledger as one Durable Object class. It runs in workerd (Cloudflare, or Miniflare on a
// laptop), not in Node. One object per team or repo, picked by name. All rules are in
// `sql.ts`; this file only wires them to `ctx.storage` and to plain HTTP.
//
// Experiment 95's copy of experiment 93's file: `append` passes `fenceOn` through (see sql.ts).
//
// Not type-checked: experiments sit outside `pnpm typecheck`, and `cloudflare:workers` has no
// types in this repo. The harness strips the types with Node's own stripper before it hands
// the two files to workerd.
import {DurableObject} from "cloudflare:workers";
import * as L from "./sql.ts";

type Cursor = {toArray(): L.Row[]};
type Storage = {
	sql: {exec(sql: string, ...bind: L.Value[]): Cursor; databaseSize: number};
	transactionSync<T>(fn: () => T): T;
	getAlarm(): Promise<number | null>;
	setAlarm(at: number): Promise<void>;
	deleteAlarm(): Promise<void>;
};
type Env = {LEDGER: Namespace; EXPIRY_GRACE_MS?: string};
type Namespace = {idFromName(name: string): unknown; get(id: unknown): Record<string, Rpc>};
type Rpc = (...args: unknown[]) => Promise<unknown>;

/** If an alarm run dies halfway, the alarm comes back after this long. */
const FALLBACK_MS = 30_000;

export class Ledger extends DurableObject {
	private readonly storage: Storage;
	private readonly db: L.Db;
	private readonly graceMs: number;

	constructor(ctx: {storage: Storage}, env: Env) {
		super(ctx, env);
		this.storage = ctx.storage;
		this.graceMs = Number(env.EXPIRY_GRACE_MS ?? "1000");
		this.db = {
			all: (sql, ...bind) => ctx.storage.sql.exec(sql, ...bind).toArray(),
			tx: (fn) => ctx.storage.transactionSync(fn),
		};
		L.migrate(this.db);
	}

	async append(
		stream: string,
		expectedRev: number,
		event: L.Event,
		fence?: number | null,
		fenceOn?: string | null,
	) {
		return L.append(
			this.db,
			Date.now(),
			stream,
			expectedRev,
			event,
			fence ?? null,
			fenceOn ?? null,
		);
	}

	async claim(stream: string, holder: string, expectedRev: number, ttlMs: number) {
		const res = L.claim(this.db, Date.now(), stream, holder, expectedRev, ttlMs, this.graceMs);
		if (res.ok) await this.arm();
		return res;
	}

	async renew(stream: string, fence: number, ttlMs: number) {
		const res = L.renew(this.db, Date.now(), stream, fence, ttlMs, this.graceMs);
		if (res.ok) await this.arm();
		return res;
	}

	async cancel(stream: string, writer: string) {
		return L.cancel(this.db, Date.now(), stream, writer);
	}

	async read(fromPos: number, limit: number) {
		return L.read(this.db, fromPos, limit);
	}

	async readStream(stream: string) {
		return L.readStream(this.db, stream);
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

	/** Experiment only: run one statement and say what came back. A real ledger has no such call. */
	async tryExec(sql: string) {
		try {
			return {ok: true, rows: this.storage.sql.exec(sql).toArray()};
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
	}

	async alarm() {
		// A fallback first, so a crash halfway through still comes back.
		await this.storage.setAlarm(Date.now() + FALLBACK_MS);
		L.runDue(this.db, Date.now());
		await this.arm();
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
	"lease",
	"openCriteria",
	"alarmAt",
	"tryExec",
]);

/** Plain HTTP for processes that cannot hold an RPC stub: POST /<ledger>/<method> [args]. */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const [, name, method] = new URL(req.url).pathname.split("/");
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
