// Experiment 145: one server, many Durable Objects. One Worker is the door in front of them, and
// it picks the object by name: `project/<id>` for shared work, `person/<github id>` for one
// person's desk, `lane/<project>~<key>` for the lane spike (question 6).
//
// It runs in workerd (Miniflare here; Cloudflare later, experiment 144). `options.ts` puts this
// file in one folder with the package's own `durable-object.ts` and `rules.ts`, types stripped,
// so `./durable-object.ts` below names the package's Durable Object, unchanged: every kind of
// object is that same `Ledger` with a door of its own in front of its methods. The router and
// the access rule are plain functions in `router.ts`.
//
// Erasable TypeScript only, like the package's worker files.
import {DurableObject} from "cloudflare:workers";
import {Ledger} from "./durable-object.ts";
import {
	type Address,
	BINDING,
	FACTS,
	type Kind,
	METHODS,
	type Members,
	mayOpen,
	membersOf,
	objectOf,
	projectOf,
	type Rules,
	routeOf,
	rulesOf,
	touchesDoor,
} from "./router.ts";
import * as L from "./rules.ts";
import {verify, type Who} from "./session.ts";

type Id = {equals(other: Id): boolean; readonly name?: string};
type Stub = {
	fetch(req: Request): Promise<Response>;
	members(): Promise<Members>;
	add(name: string): Promise<void>;
};
type Namespace = {idFromName(name: string): Id; get(id: Id): Stub};
type Cursor = {toArray(): L.SqlRow[]; readonly columnNames: string[]};
type Storage = {
	sql: {exec(sql: string, ...bind: L.Value[]): Cursor};
	transactionSync<T>(fn: () => T): T;
	setAlarm(at: number): Promise<void>;
};
type Ctx = {readonly id: Id; readonly storage: Storage};
type Env = {
	/** Signs every session (`session.ts`). */
	SECRET: string;
	/** The one who runs this server: creates projects, moves the server. A member of nothing. */
	OPERATOR: string;
	/** Planted mistakes by name (`router.ts`), comma-separated, for the tests that must fail. */
	PLANTED?: string;
	PROJECT: Namespace;
	PERSON: Namespace;
	LANE: Namespace;
	INDEX: Namespace;
};

const text = (status: number, why: string) => Response.json({error: why}, {status});
/**
 * A request's body, read before anything is answered. A refusal that leaves the body unread makes
 * workerd drop the connection, and the client's next call on that kept-alive connection fails.
 */
const bodyOf = async (req: Request): Promise<unknown> => {
	if (req.method !== "POST") return null;
	try {
		return JSON.parse(await req.text());
	} catch {
		return null;
	}
};
const bearerOf = (req: Request) =>
	/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
const PERSON_ID = /^github:[1-9][0-9]{0,11}$/;

/** The Worker: it reads nothing and calls no method. It only hands the request to its object. */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/index") return env.INDEX.get(env.INDEX.idFromName("index")).fetch(req);
		const at = objectOf(url);
		if (at === null) {
			await bodyOf(req);
			return text(404, "no such object");
		}
		const ns = env[BINDING[at.kind]];
		return ns.get(ns.idFromName(routeOf(rulesOf(env.PLANTED ?? ""), at))).fetch(req);
	},
};

/** Every table but SQLite's own and Cloudflare's, in name order. */
const TABLES =
	"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name";
/** Tables every object fills for itself when it wakes: an import replaces their rows. */
const OWN_TABLES = new Set(["migrations", "door_self"]);

/** The package's ledger, with a door in front: every kind of object below is one of these. */
class Door extends Ledger {
	readonly #ctx: Ctx;
	readonly #env: Env;
	readonly #kind: Kind;
	readonly #rules: Rules;
	readonly #db: L.Db;
	#listed = false;
	/** A lane's project members, read from the project's object, kept 5 s. */
	#cached: {readonly at: number; readonly members: Members} | null = null;

	constructor(ctx: Ctx, env: Env, kind: Kind) {
		super(ctx, env);
		this.#ctx = ctx;
		this.#env = env;
		this.#kind = kind;
		this.#rules = rulesOf(env.PLANTED ?? "");
		this.#db = {
			all: (sql, ...bind) => ctx.storage.sql.exec(sql, ...bind).toArray(),
			tx: (fn) => ctx.storage.transactionSync(fn),
		};
		this.#db.all(
			"CREATE TABLE IF NOT EXISTS door_self (name TEXT PRIMARY KEY, at INTEGER NOT NULL)",
		);
	}

	/** The network's way in. The Worker forwarded the request here; the door decides. */
	async fetch(req: Request): Promise<Response> {
		const body = await bodyOf(req);
		const at = objectOf(new URL(req.url));
		if (at === null || at.kind !== this.#kind) return text(404, "no such object");
		// This object answers only to the name it was made from. `idFromName(name).equals(id)`
		// holds whether or not the runtime fills in `ctx.id.name`.
		const ns = this.#env[BINDING[this.#kind]];
		if (this.#rules.nameCheck === "on" && !ns.idFromName(at.name).equals(this.#ctx.id))
			return text(404, "not this object");
		const who = await verify(this.#env.SECRET, bearerOf(req));
		if (who === null) return text(401, "log in first");
		const [method = "", step = ""] = at.rest;
		if (method === "door") return this.#step(req, body, at, who, step);
		if (!mayOpen(this.#rules, at, who, await this.#membersFor(at))) return text(403, "not yours");
		await this.#list(at.name);
		if (method === "tail") return super.fetch(req);
		if (req.method !== "POST" || !METHODS.has(method)) return text(404, "no such call");
		const args = body;
		if (!Array.isArray(args)) return text(400, "the arguments, as one JSON array");
		if (touchesDoor(this.#rules, method, args))
			return text(403, "only the door writes under door/");
		const call: unknown = Reflect.get(this, method);
		if (typeof call !== "function") return text(404, "no such call");
		try {
			return Response.json(await Reflect.apply(call, this, args));
		} catch (e) {
			return text(500, e instanceof Error ? e.message : String(e));
		}
	}

	/** The members of the project this object belongs to, or null for a person's object. */
	async #membersFor(at: Address): Promise<Members | null> {
		const project = projectOf(at);
		if (project === null) return null;
		if (at.kind === "project") return this.members();
		const now = Date.now();
		if (this.#cached !== null && now - this.#cached.at < 5000) return this.#cached.members;
		const members = await this.#env.PROJECT.get(this.#env.PROJECT.idFromName(project)).members();
		this.#cached = {at: now, members};
		return members;
	}

	/** RPC, for a lane's door: reached only through the binding, never from the network. */
	async members(): Promise<Members> {
		return membersOf(L.readStream(this.#db, FACTS), this.#rules, this.#env.OPERATOR);
	}

	/** The first time an allowed call reaches this object, the server's index learns its name. */
	async #list(name: string) {
		if (this.#listed) return;
		if (this.#db.all("SELECT 1 FROM door_self WHERE name = ?", name).length === 0) {
			await this.#env.INDEX.get(this.#env.INDEX.idFromName("index")).add(name);
			this.#db.all("INSERT OR IGNORE INTO door_self (name, at) VALUES (?, ?)", name, Date.now());
		}
		this.#listed = true;
	}

	/** One of the door's own facts, written as the ledger writes its own: no fence, no name check. */
	#fact(kind: string, id: string, by: string) {
		this.#db.all(
			`INSERT INTO events (stream, rev, writer, kind, at, data, id)
			SELECT ?1, coalesce((SELECT max(rev) FROM events WHERE stream = ?1), 0) + 1, ?2, ?3, ?4, ?5, NULL`,
			FACTS,
			`user:${by}`,
			kind,
			Date.now(),
			JSON.stringify({id}),
		);
	}

	async #step(req: Request, body: unknown, at: Address, who: Who, step: string): Promise<Response> {
		const field = (k: string) => {
			const v: unknown = typeof body === "object" && body !== null ? Reflect.get(body, k) : null;
			return typeof v === "string" ? v : null;
		};
		const operator = who.kind === "user" && who.id === this.#env.OPERATOR;
		const own = at.kind === "person" && who.kind === "user" && who.id === `github:${at.id}`;
		// Moving the server: the operator for any object, a person for their own.
		if (step === "export" || step === "import" || step === "digest") {
			if (!operator && !own) return text(403, "the operator's, or your own object's");
			await this.#list(at.name);
			if (step === "digest") return Response.json(await this.#digest());
			if (step === "export") {
				const url = new URL(req.url);
				return Response.json(
					this.#dump(
						url.searchParams.get("table") ?? "",
						Number(url.searchParams.get("after") ?? "0"),
						Number(url.searchParams.get("limit") ?? "500"),
					),
				);
			}
			return Response.json(await this.#load(body));
		}
		if (step === "self") {
			if (!mayOpen(this.#rules, at, who, await this.#membersFor(at))) return text(403, "not yours");
			return Response.json({name: at.name, idName: this.#ctx.id.name ?? null});
		}
		if (at.kind !== "project") return text(404, "no such step");
		if (step === "create") {
			// A project's founder comes from its own creation, named by the operator, never from
			// the server's config: one founder never spreads to another object.
			const founder = field("founder");
			if (!operator) return text(403, "only the operator creates a project");
			if (founder === null || !PERSON_ID.test(founder)) return text(400, "founder: github:<id>");
			if (L.readStream(this.#db, FACTS).some((r) => r.kind === "created"))
				return text(409, "made already");
			this.#fact("created", founder, who.id);
			await this.#list(at.name);
			return Response.json({founder});
		}
		const members = await this.members();
		if (!mayOpen(this.#rules, at, who, members)) return text(403, "not yours");
		if (step === "members") return Response.json(members);
		if (step === "invite" || step === "remove") {
			const id = field("id");
			if (who.kind !== "user" || who.id !== members.founder) return text(403, "the founder's call");
			if (id === null || !PERSON_ID.test(id)) return text(400, "id: github:<id>");
			if (step === "remove" && id === members.founder) return text(400, "the founder stays");
			this.#fact(step === "invite" ? "invited" : "removed", id, who.id);
			return Response.json(await this.members());
		}
		return text(404, "no such step");
	}

	// ---------------------------------------------------------------- moving a whole server

	#tables(): string[] {
		return this.#db.all(TABLES).map((r) => String(r.name));
	}

	/** Up to `limit` rows of one table after `after` (a rowid), every column, in rowid order. */
	#dump(table: string, after: number, limit: number) {
		if (!this.#tables().includes(table)) return {error: "no such table", tables: this.#tables()};
		const cur = this.#ctx.storage.sql.exec(
			`SELECT rowid AS rowid_, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
			after,
			limit,
		);
		const all = cur.toArray();
		const columns = cur.columnNames.filter((c) => c !== "rowid_");
		return {
			table,
			tables: this.#tables(),
			columns,
			rows: all.map((r) => columns.map((c) => r[c] ?? null)),
			last: all.length === 0 ? after : Number(all[all.length - 1]?.rowid_),
		};
	}

	/**
	 * One batch of one table, as one transaction: refused unless it follows the last batch (its
	 * `from` is the table's row count), so a retry can leave no gap and no double.
	 */
	async #load(body: unknown) {
		const get = (k: string): unknown =>
			typeof body === "object" && body !== null ? Reflect.get(body, k) : undefined;
		const table = get("table");
		const columns = get("columns");
		const rows = get("rows");
		const from = get("from");
		if (typeof table !== "string" || !this.#tables().includes(table))
			return {error: "no such table"};
		if (!Array.isArray(columns) || !Array.isArray(rows) || typeof from !== "number")
			return {error: "table, columns, rows, from"};
		const cols = columns.map(String);
		const count = () => Number(this.#db.all(`SELECT count(*) AS n FROM "${table}"`)[0]?.n ?? 0);
		const res = this.#db.tx(() => {
			if (OWN_TABLES.has(table) && from === 0) this.#db.all(`DELETE FROM "${table}"`);
			else if (count() !== from)
				return {error: `out of order: ${count()} rows here, the batch is from ${from}`};
			const picks = cols.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");
			this.#db.all(
				`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${picks} FROM json_each(?)`,
				JSON.stringify(rows),
			);
			return {ok: true, rows: count()};
		});
		// The one alarm sits at the earliest job, as after any write.
		const due = L.nextDue(this.#db);
		if (due !== null) await this.#ctx.storage.setAlarm(due);
		return res;
	}

	/** Every row of every table, in table then rowid order, hashed: the same on both sides. */
	async #digest() {
		const counts: Record<string, number> = {};
		const lines: string[] = [];
		for (const table of this.#tables()) {
			const cur = this.#ctx.storage.sql.exec(`SELECT * FROM "${table}" ORDER BY rowid`);
			const rows = cur.toArray();
			counts[table] = rows.length;
			for (const r of rows)
				lines.push(JSON.stringify([table, ...cur.columnNames.map((c) => r[c] ?? null)]));
		}
		const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("\n")));
		const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
		return {hash, counts};
	}
}

export class Project extends Door {
	constructor(ctx: Ctx, env: Env) {
		super(ctx, env, "project");
	}
}
export class Person extends Door {
	constructor(ctx: Ctx, env: Env) {
		super(ctx, env, "person");
	}
}
export class Lane extends Door {
	constructor(ctx: Ctx, env: Env) {
		super(ctx, env, "lane");
	}
}

/**
 * The server's list of its objects. Cloudflare gives no way to list a namespace's objects by name,
 * so moving a whole server needs its own list. Each object adds itself on its first allowed call.
 */
export class Index extends DurableObject {
	readonly #ctx: Ctx;
	readonly #env: Env;

	constructor(ctx: Ctx, env: Env) {
		super(ctx, env);
		this.#ctx = ctx;
		this.#env = env;
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS objects (name TEXT PRIMARY KEY, at INTEGER NOT NULL)",
		);
	}

	/** RPC, from an object, through the binding: never from the network. */
	async add(name: string) {
		this.#ctx.storage.sql.exec(
			"INSERT OR IGNORE INTO objects (name, at) VALUES (?, ?)",
			name,
			Date.now(),
		);
	}

	/** The operator's list of every object, by name. */
	async fetch(req: Request): Promise<Response> {
		const who = await verify(this.#env.SECRET, bearerOf(req));
		if (who === null) return text(401, "log in first");
		if (who.kind !== "user" || who.id !== this.#env.OPERATOR) return text(403, "the operator's");
		const rows = this.#ctx.storage.sql.exec("SELECT name FROM objects ORDER BY name").toArray();
		return Response.json(rows.map((r) => String(r.name)));
	}
}
