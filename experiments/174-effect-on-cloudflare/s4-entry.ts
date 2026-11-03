import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
// Part 4: Effect's event log server inside one object, on sql-sqlite-do, with a compare-and-set
// rule in the event's handler. This is the spike the old study left undone.
import {DurableObject} from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as EventGroup from "effect/eventlog/EventGroup";
import * as EventLog from "effect/eventlog/EventLog";
import * as EventLogServerUnencrypted from "effect/eventlog/EventLogServerUnencrypted";
import * as SqlEventLogServerUnencrypted from "effect/eventlog/SqlEventLogServerUnencrypted";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";

type Env = {LOG: DurableObjectNamespace};

class Stale extends Schema.TaggedError<Stale>()("Stale", {top: Schema.Number}) {}

const Facts = EventGroup.empty.add({
	tag: "posted",
	primaryKey: (p) => p.stream,
	payload: Schema.Struct({stream: Schema.String, base: Schema.Number, text: Schema.String}),
	success: Schema.Number,
	error: Stale,
});
const Log = EventLog.schema(Facts);

export class LogObject extends DurableObject<Env> {
	rt: ManagedRuntime.ManagedRuntime<any, any>;
	wakes: number;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;
		sql.exec("CREATE TABLE IF NOT EXISTS wakes (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER)");
		sql.exec("CREATE TABLE IF NOT EXISTS tops (stream TEXT PRIMARY KEY, top INTEGER)");
		sql.exec("INSERT INTO wakes (at) VALUES (?)", Date.now());
		this.wakes = sql.exec("SELECT n FROM wakes").toArray().length;
		const handlers = EventLog.group(Facts, (h) =>
			h.handle("posted", ({payload}) =>
				Effect.suspend(() => {
					const row = sql
						.exec<{top: number}>("SELECT top FROM tops WHERE stream = ?", payload.stream)
						.toArray()[0];
					const top = row?.top ?? 0;
					if (payload.base !== top) return Effect.fail(new Stale({top}));
					sql.exec(
						"INSERT OR REPLACE INTO tops (stream, top) VALUES (?, ?)",
						payload.stream,
						top + 1,
					);
					return Effect.succeed(top + 1);
				}),
			),
		);
		const storage = SqlEventLogServerUnencrypted.layerStorage().pipe(
			Layer.provide(SqliteClient.layer({storage: ctx.storage as never})),
		);
		this.rt = ManagedRuntime.make(
			handlers.pipe(
				Layer.provideMerge(EventLogServerUnencrypted.layerServer),
				Layer.provide(storage),
			) as Layer.Layer<any, any>,
		);
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const sql = this.ctx.storage.sql;
		if (url.pathname === "/stats") {
			const tables = sql
				.exec<{name: string}>("SELECT name FROM sqlite_master WHERE type='table'")
				.toArray()
				.map((r) => r.name);
			const counts = Object.fromEntries(
				tables
					.filter((t) => !t.startsWith("_cf") && !t.startsWith("sqlite"))
					.map((t) => [t, sql.exec(`SELECT COUNT(*) AS c FROM "${t}"`).one().c]),
			);
			return Response.json({wakes: this.wakes, counts, bytes: sql.databaseSize});
		}
		const base = Number(url.searchParams.get("base") ?? "0");
		const text = url.searchParams.get("text") ?? "x";
		const stream = url.searchParams.get("stream") ?? "s";
		const t0 = Date.now();
		const answer = await this.rt
			.runPromise(
				Effect.gen(function* () {
					const write = yield* EventLogServerUnencrypted.makeWrite(Log);
					return yield* write({
						storeId: "one" as never,
						event: "posted",
						payload: {stream, base, text},
					} as never);
				}).pipe(
					Effect.match({
						onSuccess: (place) => ({place}),
						onFailure: (e) => ({refused: e}),
					}),
				),
			)
			.then(
				(a) => a,
				(e) => ({died: String(e).slice(0, 500)}),
			);
		return Response.json({...answer, ms: Date.now() - t0});
	}
}

export default {
	fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		const name = url.searchParams.get("name") ?? "one";
		return env.LOG.get(env.LOG.idFromName(name)).fetch(request);
	},
};
