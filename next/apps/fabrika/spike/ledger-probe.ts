// @ts-nocheck -- S10 spike probe, never merged; the three store files it drives are type-checked.
// Experiment 249 spike, next/. One Alchemy Effect Durable Object that holds the referee's slice on
// five routes, on the same platform storage, so the same laws, the interleave law, the sync probe
// and the timing run on each inside local workerd.
//   S   today's synchronous `Sql`: `ledgerStore(workerSql(state.raw.storage))`, `transactionSync`
//   Sb  the t502 plan's route (b): the same synchronous step inside `state.storage.transaction`
//   E   `effect/sql`'s `SqlClient` on `@effect/sql-sqlite-do`, storage from `state.raw.storage`
//   E2  E with the turn on a "sync" scheduler, as Alchemy's own Drizzle adapter wraps it
//   Es  E with the turn inside the platform's `transactionSync` (`s10/sync-turn.ts`)
//   W   Alchemy's wrapper: `state.storage.sql.exec` and `state.storage.transaction`
import * as Cloudflare from "@alchemy.run/cloudflare";
import {Context, Effect, Exit, Cause, Layer, Scheduler} from "effect";
import {SqlClient} from "effect/sql";
import {ledgerStore, Threw} from "../../../packages/libfabrika/src/data/ledger-store.ts";
import {Doorbell} from "../../../packages/libfabrika/src/data/ledger.ts";
import {SqliteDo} from "../../../packages/libfabrika/src/data/s10/do.ts";
import {refereeOnAlchemy} from "../../../packages/libfabrika/src/data/s10/store-alchemy.ts";
import {refereeOnSqlClient} from "../../../packages/libfabrika/src/data/s10/store-effect-sql.ts";
import {withSyncTurn} from "../../../packages/libfabrika/src/data/s10/sync-turn.ts";
import {workerSql} from "../../../packages/libfabrika/src/data/worker-sql.ts";

export type Route = "S" | "Sb" | "E" | "E2" | "Es" | "W";
export type Pause = "none" | "yield" | "micro" | "sleep" | "kv" | "fetch";

export interface ProbeShape {
	readonly law: (route: Route, index: number) => Effect.Effect<unknown>;
	readonly turn: (route: Route, pause: Pause, id: string) => Effect.Effect<unknown>;
	readonly burst: (route: Route, pause: Pause, n: number) => Effect.Effect<unknown>;
	readonly peek: (route: Route) => Effect.Effect<unknown>;
	readonly report: () => Effect.Effect<unknown>;
	readonly sync: (route: Route) => Effect.Effect<unknown>;
	readonly bench: (route: Route, from: number, n: number) => Effect.Effect<unknown>;
}

export class Probe extends Cloudflare.DurableObject<Probe, ProbeShape>()("Probe") {}

const line = (over = {}) => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: "n-7f3a", base: 3},
	...over,
});

/** An exit as plain data: the value, a typed failure's `why`, or a defect's text. */
const told = (exit) =>
	Exit.isSuccess(exit)
		? exit.value
		: Cause.hasFails(exit.cause)
			? {fail: Cause.squash(exit.cause)?.why ?? String(Cause.squash(exit.cause)).slice(0, 200)}
			: {die: String(Cause.squash(exit.cause)).slice(0, 200)};

const same = (got, want) =>
	JSON.stringify(got) === JSON.stringify(want)
		? null
		: `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;

const BOOM = `CREATE TRIGGER boom BEFORE INSERT ON entries WHEN NEW.id = 'boom'
	BEGIN SELECT RAISE(ABORT, 'planted: database or disk is full'); END`;

export const ProbeLive = Probe.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState;

		return Effect.gen(function* () {
			const raw = state.raw.storage;
			const context = yield* Effect.context();
			const bell = {ring: () => Effect.void};
			const sync = new Scheduler.MixedScheduler("sync");

			// Route S: as on main.
			const S = ledgerStore(workerSql(raw), bell);

			// Route Sb: main's store and its synchronous step; only the turn is Alchemy's Effect transaction.
			const rawSql = {
				exec: (query, ...params) => Array.from(state.storage.sql.raw.exec(query, ...params)),
				transaction: () => {
					throw new Error("route Sb has no synchronous transaction");
				},
				size: () => state.storage.sql.databaseSize,
			};
			const Sb = ledgerStore(rawSql, bell, (step) =>
				state.storage
					.transaction(Effect.try({try: step, catch: (error) => new Threw({error})}))
					.pipe(
						Effect.catchTag("DurableObjectStorageError", (error) =>
							Effect.fail(new Threw({error: error.cause ?? error})),
						),
						Effect.provideContext(context),
					),
			);

			// Route E: Effect's own driver, handed the platform's storage.
			const built = yield* Layer.build(SqliteDo.layer({storage: raw}));
			const client = Context.get(built, SqlClient.SqlClient);
			const E = yield* refereeOnSqlClient.pipe(
				Effect.provideService(SqlClient.SqlClient, client),
				Effect.provideService(Doorbell, bell),
			);

			// Route E2: a second client whose turn runs on a "sync" scheduler (Alchemy's Drizzle adapter).
			const built2 = yield* Layer.build(SqliteDo.layer({storage: raw}));
			const client2 = Context.get(built2, SqlClient.SqlClient);
			const turn2 = client2.withTransaction;
			Object.assign(client2, {
				withTransaction: (body) =>
					turn2(body).pipe(Effect.provideService(Scheduler.Scheduler, sync)),
			});
			const E2 = yield* refereeOnSqlClient.pipe(
				Effect.provideService(SqlClient.SqlClient, client2),
				Effect.provideService(Doorbell, bell),
			);

			// Route Es: Effect's driver for the statements, the platform's synchronous transaction for the turn.
			const built3 = yield* Layer.build(SqliteDo.layer({storage: raw}));
			const client3 = withSyncTurn(Context.get(built3, SqlClient.SqlClient), (step) =>
				raw.transactionSync(step),
			);
			const Es = yield* refereeOnSqlClient.pipe(
				Effect.provideService(SqlClient.SqlClient, client3),
				Effect.provideService(Doorbell, bell),
			);

			// Route W: Alchemy's wrapper.
			const W = refereeOnAlchemy(state.storage, bell);

			const stepSync = (store) => ({
				append: (stream, id, input) => store.append(stream, id, input),
				read: (stream, after) => store.read(stream, after, "probe"),
				pair: (a, b) =>
					store.transact((turn) => {
						const first = turn.append(...a);
						const second = turn.append(...b);
						return {a: first, b: second, read: [...turn.read("a", 0)].map((row) => row.id)};
					}),
				many: (n) =>
					store.transact((turn) => {
						for (let i = 1; i <= n; i++) {
							turn.append("a", `m${i}`, line({body: i}));
						}

						return [...turn.read("a", 0)].map((row) => row.rev);
					}),
			});
			const stepEffect = (store) => ({
				append: (stream, id, input) => store.append(stream, id, input),
				read: (stream, after) => store.read(stream, after, "probe"),
				pair: (a, b) =>
					store.transact((turn) =>
						Effect.gen(function* () {
							const first = yield* turn.append(...a);
							const second = yield* turn.append(...b);
							return {
								a: first,
								b: second,
								read: (yield* turn.read("a", 0)).map((row) => row.id),
							};
						}),
					),
				many: (n) =>
					store.transact((turn) =>
						Effect.gen(function* () {
							for (let i = 1; i <= n; i++) {
								yield* turn.append("a", `m${i}`, line({body: i}));
							}

							return (yield* turn.read("a", 0)).map((row) => row.rev);
						}),
					),
			});
			const apis = {
				S: stepSync(S),
				Sb: stepSync(Sb),
				E: stepEffect(E),
				E2: stepEffect(E2),
				Es: stepEffect(Es),
				W: stepEffect(W),
			};
			const plant = (query) => Effect.sync(() => raw.sql.exec(query).toArray());
			const run = (effect) => Effect.map(Effect.exit(effect), told);
			const placed = (rev, pos) => ({_tag: "placed", rev, pos});

			// The slice's laws, taken from `data/ledger.test.ts` and `data/ledger-transaction.test.ts`.
			const laws = [
				[
					"p18: first, resend, id_reused, the same id on another stream",
					(api) =>
						Effect.gen(function* () {
							const got = [
								yield* run(api.append("a", "w-1", line())),
								yield* run(api.append("a", "w-1", line({sentAt: "2026-11-08T00:00:00.000Z"}))),
								yield* run(api.append("a", "w-1", line({body: {other: 1}}))),
								yield* run(api.append("b", "w-1", line())),
								(yield* run(api.read("a", 0))).map((entry) => [entry.id, entry.rev, entry.pos]),
							];
							return same(got, [
								placed(1, 1),
								placed(1, 1),
								{_tag: "refused", why: "id_reused"},
								placed(2, 1),
								[["w-1", 1, 1]],
							]);
						}),
				],
				[
					"p93: seen is bounded by the log's head",
					(api) =>
						Effect.gen(function* () {
							const got = [
								yield* run(api.append("a", "w-1", line({seen: 1}))),
								yield* run(api.append("a", "w-1", line())),
								yield* run(api.append("b", "w-2", line({seen: 1}))),
								yield* run(api.append("b", "w-3", line({seen: 3}))),
							];
							return same(got, [
								{_tag: "refused", why: "seen_ahead"},
								placed(1, 1),
								placed(2, 1),
								{_tag: "refused", why: "seen_ahead"},
							]);
						}),
				],
				[
					"p79: a turn's reads see its writes and share the ledger's rev and pos",
					(api) =>
						Effect.gen(function* () {
							const got = [
								yield* run(api.append("a", "one", line({body: 1}))),
								yield* run(
									api.pair(["a", "two", line({body: 2})], ["b", "three", line({body: 3})]),
								),
								yield* run(api.append("b", "four", line({body: 4}))),
							];
							return same(got, [
								placed(1, 1),
								{a: {rev: 2, pos: 2}, b: {rev: 3, pos: 1}, read: ["one", "two"]},
								placed(4, 2),
							]);
						}),
				],
				[
					"p79: a refusal aborts the whole turn",
					(api) =>
						Effect.gen(function* () {
							const got = [
								yield* run(api.append("a", "one", line({body: 1}))),
								yield* run(
									api.pair(["b", "early", line({body: 2})], ["a", "one", line({body: 3})]),
								),
								yield* run(api.read("b", 0)),
								(yield* run(api.read("a", 0))).length,
								yield* run(api.append("b", "after", line({body: 4}))),
							];
							return same(got, [placed(1, 1), {fail: "refused"}, [], 1, placed(2, 1)]);
						}),
				],
				[
					"p79: a storage failure late in a turn rolls back its earlier insert, as a typed storage",
					(api) =>
						Effect.gen(function* () {
							const first = yield* run(api.append("a", "one", line({body: 1})));
							yield* plant(BOOM);
							const got = [
								first,
								yield* run(api.pair(["a", "two", line({body: 2})], ["b", "boom", line({body: 3})])),
								(yield* run(api.read("a", 0))).map((entry) => entry.id),
								yield* run(api.read("b", 0)),
								yield* run(api.append("b", "after", line({body: 4}))),
							];
							return same(got, [placed(1, 1), {fail: "storage"}, ["one"], [], placed(2, 1)]);
						}),
				],
				[
					"p20: a SQL failure on one call is a typed storage, and the next call works with no gap",
					(api) =>
						Effect.gen(function* () {
							const first = yield* run(api.append("a", "w-1", line()));
							yield* plant(BOOM);
							const got = [
								first,
								yield* run(api.append("a", "boom", line())),
								yield* run(api.append("a", "w-3", line())),
							];
							return same(got, [placed(1, 1), {fail: "storage"}, placed(2, 2)]);
						}),
				],
				[
					"p79: one turn of 260 appends reads all 260 back (past the 256 page and Effect's 2,048-op budget)",
					(api) =>
						Effect.gen(function* () {
							const got = yield* run(api.many(260));
							return same(
								got,
								Array.from({length: 260}, (_, i) => i + 1),
							);
						}),
				],
				[
					"p20: a stored row that does not decode is bad_row, not storage",
					(api) =>
						Effect.gen(function* () {
							const first = yield* run(api.append("a", "one", line()));
							yield* plant(`UPDATE entries SET body = 'not JSON'`);
							const got = [
								first,
								yield* run(api.read("a", 0)),
								yield* run(api.append("a", "one", line())),
							];
							return same(got, [placed(1, 1), {fail: "bad_row"}, {fail: "bad_row"}]);
						}),
				],
			];

			// The interleave law's own table and trace.
			raw.sql.exec("CREATE TABLE IF NOT EXISTS iso (n INTEGER, id TEXT)");
			const trace = [];
			const count = () => Number(raw.sql.exec("SELECT count(*) AS n FROM iso").one().n);
			const pauses = {
				none: Effect.void,
				yield: Effect.yieldNow.pipe(
					Effect.andThen(Effect.yieldNow),
					Effect.andThen(Effect.yieldNow),
				),
				micro: Effect.promise(() => Promise.resolve().then(() => Promise.resolve())),
				sleep: Effect.sleep("5 millis"),
				kv: Effect.promise(() => raw.get("k")),
				fetch: Effect.promise(() =>
					fetch("http://127.0.0.1:" + (state.raw.id.name?.split("@")[1] ?? "1") + "/plain").then(
						(reply) => reply.text(),
						(error) => String(error),
					),
				).pipe(Effect.tap((text) => Effect.sync(() => trace.push(`fetched ${text.slice(0, 40)}`)))),
			};
			const syncStep = (id) => () => {
				trace.push(`enter ${id}`);
				const head = Number(raw.sql.exec("SELECT coalesce(max(n), 0) AS head FROM iso").one().head);
				raw.sql.exec("INSERT INTO iso (n, id) VALUES (?, ?)", head + 1, id);
				trace.push(`exit ${id}`);
			};
			const viaClient = (sql) => (pause, id) =>
				sql.withTransaction(
					Effect.gen(function* () {
						trace.push(`enter ${id}`);
						const [row] = yield* sql`SELECT coalesce(max(n), 0) AS head FROM iso`;
						yield* pauses[pause];
						yield* sql`INSERT INTO iso ${sql.insert({n: Number(row.head) + 1, id})}`;
						trace.push(`exit ${id}`);
					}),
				);
			const turns = {
				S: (_pause, id) => Effect.sync(() => raw.transactionSync(syncStep(id))),
				Sb: (_pause, id) => state.storage.transaction(Effect.sync(syncStep(id))),
				E: viaClient(client),
				E2: viaClient(client2),
				Es: viaClient(client3),
				W: (pause, id) =>
					state.storage.transaction(
						Effect.gen(function* () {
							trace.push(`enter ${id}`);
							const cursor = yield* state.storage.sql.exec(
								"SELECT coalesce(max(n), 0) AS head FROM iso",
							);
							const row = yield* cursor.one();
							yield* pauses[pause];
							yield* state.storage.sql.exec(
								"INSERT INTO iso (n, id) VALUES (?, ?)",
								Number(row.head) + 1,
								id,
							);
							trace.push(`exit ${id}`);
						}),
					),
			};
			const peeks = {
				S: Effect.sync(count),
				Sb: Effect.sync(count),
				E: Effect.map(client`SELECT count(*) AS n FROM iso`, ([row]) => Number(row.n)),
				E2: Effect.map(client2`SELECT count(*) AS n FROM iso`, ([row]) => Number(row.n)),
				Es: Effect.map(client3`SELECT count(*) AS n FROM iso`, ([row]) => Number(row.n)),
				W: Effect.flatMap(state.storage.sql.exec("SELECT count(*) AS n FROM iso"), (cursor) =>
					Effect.map(cursor.one(), (row) => Number(row.n)),
				),
			};
			const oneTurn = (route, pause, id) =>
				turns[route](pause, id).pipe(
					Effect.tap(() => Effect.sync(() => trace.push(`done ${id}`))),
					Effect.exit,
					Effect.map((exit) => (Exit.isSuccess(exit) ? "ok" : told(exit))),
				);

			return {
				law: (route, index) =>
					Effect.gen(function* () {
						const [name, body] = laws[index];
						const exit = yield* Effect.exit(body(apis[route]));
						const detail = Exit.isSuccess(exit)
							? exit.value
							: `threw ${JSON.stringify(told(exit))}`;
						return {law: name, laws: laws.length, ok: detail === null, detail};
					}),
				turn: (route, pause, id) => oneTurn(route, pause, id),
				burst: (route, pause, n) =>
					Effect.forEach(
						Array.from({length: n}, (_, i) => `f${i}`),
						(id) => oneTurn(route, pause, id),
						{concurrency: "unbounded"},
					),
				peek: (route) =>
					peeks[route].pipe(
						Effect.tap((n) => Effect.sync(() => trace.push(`peek ${n}`))),
						Effect.exit,
						Effect.map(told),
					),
				report: () =>
					Effect.sync(() => ({
						trace: [...trace],
						rows: raw.sql
							.exec("SELECT n, id FROM iso ORDER BY rowid")
							.toArray()
							.map((row) => [Number(row.n), String(row.id)]),
					})),
				sync: (route) =>
					Effect.sync(() => {
						const attempt = (effect) => {
							try {
								const value = Effect.runSync(Effect.provideContext(effect, context));
								return {ran: "sync", value};
							} catch (error) {
								return {ran: "not sync", error: String(error).slice(0, 160)};
							}
						};
						const statement = {
							S: null,
							Sb: null,
							E: client`SELECT 1 AS one`,
							E2: client2`SELECT 1 AS one`,
							Es: client3`SELECT 1 AS one`,
							W: Effect.flatMap(state.storage.sql.exec("SELECT 1 AS one"), (c) => c.toArray()),
						}[route];
						return {
							statement: statement === null ? "a plain call, not an Effect" : attempt(statement),
							append: attempt(apis[route].append("a", "sync-1", line())),
						};
					}),
				bench: (route, from, n) =>
					Effect.gen(function* () {
						const api = apis[route];
						const started = Date.now();
						let last;

						for (let i = 0; i < n; i++) {
							last = yield* api.append(`s${i % 3}`, `w-${from + i}`, line({body: from + i}));
						}

						return {ms: Date.now() - started, last};
					}).pipe(Effect.exit, Effect.map(told)),
			};
		});
	}),
);
