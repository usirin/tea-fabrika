// A job's record as a Cloudflare Durable Object: one per host job, in the ledger's own Worker,
// beside the ledger's objects (docs/direction/a-job-record-holds-its-trace.md). It runs in
// workerd, on Cloudflare or in Miniflare on a laptop (`worker-options.ts` binds it as
// `JOB_RECORD`), and is bundled into the same Worker as `durable-object.ts`.
//
// Its name is `<ledger>/<trace id>`: a record belongs to one ledger, so one project's members
// cannot write into another's jobs by naming a trace. Its SQL is in ./job-rules.ts.
//
// No request from the network reaches it. The ledger's object (`durable-object.ts`) lets a
// request through its door, then calls `call` or `spans` here with who the door said sent it.
// A test holding the binding calls the same methods (`inside.ts`).
import {DurableObject} from "cloudflare:workers";
import {Exit, Schema} from "effect";
import {
	callJob,
	type Heads,
	KEYFRAME,
	keepSpans,
	migrateJob,
	stepBytes,
	TABLES,
} from "./job-rules.ts";
import type {SpanRow} from "./otlp.ts";
import type * as L from "./rules.ts";
import {JobCall} from "./traces.ts";

type Cursor = {toArray(): L.SqlRow[]};
type Ctx = {
	id?: {name?: string};
	storage: {
		sql: {exec(sql: string, ...bind: L.Value[]): Cursor};
		transactionSync<T>(fn: () => T): T;
	};
};
type Env = {STEP_KEYFRAME?: string};

const decodeCall = Schema.decodeUnknownExit(JobCall);

export class JobRecord extends DurableObject {
	private readonly ctx: Ctx;
	private readonly db: L.Db;
	private readonly heads: Heads = new Map();
	private readonly keyframe: number;

	constructor(ctx: Ctx, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.db = {
			all: (sql, ...bind) => ctx.storage.sql.exec(sql, ...bind).toArray(),
			tx: (fn) => ctx.storage.transactionSync(fn),
		};
		const k = Number(env.STEP_KEYFRAME ?? KEYFRAME);
		this.keyframe = Number.isInteger(k) && k >= 1 ? k : KEYFRAME;
		migrateJob(this.db);
	}

	/** Refuse a caller that named another record than this one. */
	private mine(name: string) {
		const named = this.ctx.id?.name;
		if (named !== undefined && named !== name) throw new Error("not this record");
	}

	/**
	 * One call (`JobCall`), its answer as JSON text. `name`: the record's name as the caller
	 * picked it; `by`: who the door said sent it. Text, as the ledger's `call` answers, so a
	 * Miniflare caller gets one value, not a proxy.
	 */
	async call(name: string, body: unknown, by: string): Promise<string> {
		this.mine(name);
		const exit = decodeCall(body);
		if (Exit.isFailure(exit)) return JSON.stringify({error: "not a call this record takes"});
		return JSON.stringify(callJob(this.db, this.heads, exit.value, by, Date.now(), this.keyframe));
	}

	/** Keep spans of this record's trace, sent by `by`. */
	async spans(name: string, rows: readonly SpanRow[], by: string): Promise<string> {
		this.mine(name);
		return JSON.stringify(keepSpans(this.db, rows, by));
	}

	/** Every row of every table, as text: what a law reads to see that no secret was written. */
	async dump(name: string): Promise<string> {
		this.mine(name);
		return JSON.stringify(
			Object.fromEntries(TABLES.map((t) => [t, this.db.all(`SELECT * FROM ${t}`)])),
		);
	}

	/** What the steps table holds, in bytes: what experiment 166 measures. */
	async sizes(name: string): Promise<string> {
		this.mine(name);
		return JSON.stringify(stepBytes(this.db));
	}
}
