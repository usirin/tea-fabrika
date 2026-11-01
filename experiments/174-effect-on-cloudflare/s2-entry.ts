import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
// Part 2: Effect's cluster, whole, inside one Durable Object.
//
// /call?kind=test|single|tuned   start the cluster if needed and call a counter entity
// /stats                         wakes, SQL calls so far, tables
//
// test     TestRunner: all in memory
// single   SingleRunner on sql-sqlite-do, with default settings
// tuned    the same, with one shard and every poll stretched to an hour: the kindest try
import {DurableObject} from "cloudflare:workers";
import * as ClusterSchema from "effect/cluster/ClusterSchema";
import * as Entity from "effect/cluster/Entity";
import * as Sharding from "effect/cluster/Sharding";
import * as SingleRunner from "effect/cluster/SingleRunner";
import * as TestRunner from "effect/cluster/TestRunner";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PrimaryKey from "effect/PrimaryKey";
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

type Env = {CLUSTER: DurableObjectNamespace};

class Add extends Schema.Class<Add>("Add")({id: Schema.String, by: Schema.Number}) {
	[PrimaryKey.symbol]() {
		return this.id;
	}
}

const Counter = Entity.make("Counter", [
	Rpc.make("add", {payload: Add, success: Schema.Number}),
	Rpc.make("get", {success: Schema.Number}),
]).annotateRpcs(ClusterSchema.Persisted, true);

const webCrypto = Layer.succeed(
	Crypto.Crypto,
	Crypto.make({
		randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
		digest: (algorithm, data) =>
			Effect.promise(() => crypto.subtle.digest(algorithm, data as BufferSource)).pipe(
				Effect.map((b) => new Uint8Array(b)),
			),
	}),
);

export class ClusterObject extends DurableObject<Env> {
	rt: ManagedRuntime.ManagedRuntime<any, any> | undefined;
	count = 0;
	execs = 0;
	started = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS wakes (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER)",
		);
		ctx.storage.sql.exec("INSERT INTO wakes (at) VALUES (?)", Date.now());
	}

	/** Hands the SQL client a storage whose exec counts every statement. */
	counted = () => {
		const storage = this.ctx.storage;
		const sql = storage.sql;
		const countedSql = new Proxy(sql, {
			get: (target, key) => {
				if (key === "exec") {
					return (...args: [string, ...unknown[]]) => {
						this.execs++;
						return target.exec(...args);
					};
				}
				const value = Reflect.get(target, key);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		return new Proxy(storage, {
			get(target, key) {
				if (key === "sql") return countedSql;
				const value = Reflect.get(target, key);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	};

	make = (kind: string) => {
		const handlers = Counter.toLayer(
			Effect.succeed({
				add: ({payload}: {payload: Add}) =>
					Effect.sync(() => {
						this.count += payload.by;
						return this.count;
					}),
				get: () => Effect.sync(() => this.count),
			}),
		);
		const sqlLayer = SqliteClient.layer({storage: this.counted() as never});
		const tuned = {
			shardsPerGroup: 1,
			shardLockRefreshInterval: "1 hour",
			shardLockExpiration: "2 hours",
			entityMessagePollInterval: "1 hour",
			entityReplyPollInterval: "1 hour",
			refreshAssignmentsInterval: "1 hour",
			runnerHealthCheckInterval: "1 hour",
			entityMaxIdleTime: "1 minute",
		} as const;
		const runner =
			kind === "test"
				? TestRunner.layer
				: SingleRunner.layer({
						runnerStorage: "memory",
						...(kind === "tuned" ? {shardingConfig: tuned as never} : {}),
					}).pipe(Layer.provide(sqlLayer), Layer.provide(webCrypto));
		return ManagedRuntime.make(
			Layer.mergeAll(handlers.pipe(Layer.provideMerge(runner))) as Layer.Layer<any, any>,
		);
	};

	async fetch(request: Request) {
		const url = new URL(request.url);
		const sql = this.ctx.storage.sql;
		if (url.pathname === "/stats") {
			const tables = sql
				.exec<{name: string}>("SELECT name FROM sqlite_master WHERE type='table'")
				.toArray()
				.map((r) => r.name);
			return Response.json({
				wakes: sql.exec("SELECT n FROM wakes").toArray().length,
				execs: this.execs,
				started: this.started,
				tables,
				bytes: sql.databaseSize,
			});
		}
		// Controls for part 5: a timer and nothing else, or a promise held open with waitUntil.
		if (url.pathname === "/timer") {
			setInterval(() => {}, 1000);
			return new Response("ok");
		}
		if (url.pathname === "/hold") {
			this.ctx.waitUntil(new Promise(() => {}));
			return new Response("ok");
		}
		if (url.pathname === "/abort") {
			this.ctx.abort("spike");
			return new Response("gone");
		}
		const kind = url.searchParams.get("kind") ?? "test";
		const t0 = Date.now();
		this.rt ??= this.make(kind);
		this.started = true;
		const id = url.searchParams.get("id") ?? crypto.randomUUID();
		const answer = await this.rt
			.runPromise(
				Effect.gen(function* () {
					const client = yield* Counter.client;
					return yield* client("a").add(new Add({id, by: 1}) as never);
				}).pipe(Effect.timeout("20 seconds")),
			)
			.then(
				(value) => ({ok: value}),
				(e) => ({failed: String(e).slice(0, 400)}),
			);
		return Response.json({...answer, ms: Date.now() - t0});
	}
}

void Sharding;

export default {
	fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		const name = url.searchParams.get("name") ?? "one";
		return env.CLUSTER.get(env.CLUSTER.idFromName(name)).fetch(request);
	},
};
