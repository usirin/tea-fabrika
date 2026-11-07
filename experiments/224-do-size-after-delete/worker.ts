// Experiment 224's Worker: one SQLite-backed Durable Object that runs one step per request and
// reads its own size after it. The driver (../224-do-size-after-delete.ts) sends the steps.
//
//   POST /<key>/step  {object, op, ...}   one step on the object named `object`, then its numbers
//
// The ops:
//   stats       read only
//   probe       each statement in PROBES on its own, kept as `ok` or its error text as it is
//   sql         one statement
//   insert      `count` rows of `bytes` random bytes from id `from`; with `cap`, first calls
//               workerd's `setMaxPageCountForTest(cap)` (only there under the experimental flag)
//   deleteAll   the storage API's own
//
// The door is experiment 144's: the key is the first path segment, the Worker holds only its
// SHA-256, and any other path answers 404 before an object is touched.
import {DurableObject} from "cloudflare:workers";

type Cursor = {toArray(): Array<Record<string, unknown>>};
type Sql = {
	databaseSize: number;
	exec(query: string, ...bindings: unknown[]): Cursor;
	setMaxPageCountForTest?: (count: number) => void;
};
type State = {id: {toString(): string}; storage: {sql: Sql; deleteAll(): Promise<void>}};
type Stub = {step(body: unknown): Promise<unknown>};
type Namespace = {idFromName(name: string): unknown; get(id: unknown): Stub};
type Env = {SIZER: Namespace; KEY_HASH: string};

/** What a person might reach for to read or win back free pages. Each runs on its own. */
const PROBES = [
	"PRAGMA page_size",
	"PRAGMA page_count",
	"PRAGMA freelist_count",
	"SELECT * FROM pragma_page_count()",
	"SELECT * FROM pragma_freelist_count()",
	"PRAGMA auto_vacuum",
	"PRAGMA auto_vacuum = 2",
	"PRAGMA auto_vacuum = 1",
	"PRAGMA auto_vacuum = INCREMENTAL",
	"PRAGMA incremental_vacuum",
	"PRAGMA incremental_vacuum(100)",
	"VACUUM",
	"SELECT count(*) AS n FROM dbstat",
];

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const field = (o: unknown, key: string): unknown =>
	typeof o === "object" && o !== null ? Reflect.get(o, key) : undefined;

export class Sizer extends DurableObject<Env> {
	/** The same object as `this.ctx`, kept under the few names this experiment reads. */
	private readonly state: State;

	constructor(state: State, env: Env) {
		super(state, env);
		this.state = state;
	}

	private get sql(): Sql {
		return this.state.storage.sql;
	}

	private rows(): number | null {
		try {
			const n = this.sql.exec("SELECT count(*) AS n FROM t").toArray()[0]?.n;
			return typeof n === "number" ? n : null;
		} catch {
			return null; // no table yet, or after deleteAll
		}
	}

	private run(query: string): unknown {
		try {
			return {ok: this.sql.exec(query).toArray()};
		} catch (e) {
			return {error: messageOf(e)};
		}
	}

	async step(body: unknown) {
		const op = field(body, "op");
		const t = Date.now();
		let result: unknown = null;
		try {
			if (op === "stats") result = null;
			else if (op === "probe") result = Object.fromEntries(PROBES.map((q) => [q, this.run(q)]));
			else if (op === "sql") result = this.run(String(field(body, "query")));
			else if (op === "insert") {
				const from = Number(field(body, "from"));
				const count = Number(field(body, "count"));
				const bytes = Number(field(body, "bytes"));
				const cap = field(body, "cap");
				if (typeof cap === "number") {
					if (typeof this.sql.setMaxPageCountForTest !== "function")
						return {result: {error: "no setMaxPageCountForTest here"}, ms: 0, after: this.after()};
					this.sql.setMaxPageCountForTest(cap);
				}
				let inserted = 0;
				try {
					for (let id = from; id < from + count; id++) {
						this.sql.exec("INSERT INTO t (id, body) VALUES (?, randomblob(?))", id, bytes);
						inserted += 1;
					}
					result = {inserted};
				} catch (e) {
					result = {inserted, error: messageOf(e)};
				}
			} else if (op === "deleteAll") {
				await this.state.storage.deleteAll();
				result = {deletedAll: true};
			} else result = {error: `no op ${String(op)}`};
		} catch (e) {
			result = {error: messageOf(e)};
		}
		return {result, ms: Date.now() - t, after: this.after()};
	}

	private after() {
		let databaseSize: unknown;
		try {
			databaseSize = this.sql.databaseSize;
		} catch (e) {
			databaseSize = {error: messageOf(e)};
		}
		return {databaseSize, rows: this.rows(), id: this.state.id.toString()};
	}
}

const sha256 = async (text: string) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const [, key = "", route = ""] = new URL(req.url).pathname.split("/");
		if (env.KEY_HASH.length !== 64 || key.length === 0 || (await sha256(key)) !== env.KEY_HASH)
			return new Response("not found", {status: 404});
		if (route !== "step" || req.method !== "POST") return new Response("not found", {status: 404});
		const body: unknown = await req.json();
		const name = field(body, "object");
		if (typeof name !== "string") return new Response("object?", {status: 400});
		try {
			return Response.json(await env.SIZER.get(env.SIZER.idFromName(name)).step(body));
		} catch (e) {
			// An object broken by a critical error (SQLITE_FULL) throws here; keep its text.
			return Response.json({result: {error: messageOf(e)}, ms: 0, after: null});
		}
	},
};
