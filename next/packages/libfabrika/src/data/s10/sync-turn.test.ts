// S10 spike, never merged. What a turn that waits does on Node, on the driver's own turn and on the
// synchronous turn. Node has no input gate, so only the second can show the mistake in a Node law.
import {SqliteClient} from "@effect/sql-sqlite-node";
import {describe, expect, it} from "@effect/vitest";
import {Cause, Effect, Exit, Layer} from "effect";
import {SqlClient} from "effect/sql";
import {nodeTurn} from "./harness.ts";
import {withSyncTurn} from "./sync-turn.ts";

const memory = SqliteClient.layer({filename: ":memory:"}).pipe(Layer.orDie);
const synced = Layer.effect(
	SqlClient.SqlClient,
	Effect.map(SqlClient.SqlClient, (client) => withSyncTurn(client, nodeTurn(client))),
).pipe(Layer.provide(memory));

const turn = (wait: Effect.Effect<void>, settle: Effect.Effect<void> = Effect.sleep("30 millis")) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`CREATE TABLE IF NOT EXISTS t (n INTEGER)`;
		const exit = yield* Effect.exit(
			sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO t ${sql.insert({n: 1})}`;
					yield* wait;
					yield* sql`INSERT INTO t ${sql.insert({n: 2})}`;
				}),
			),
		);
		yield* settle;
		const rows = yield* sql<{n: number}>`SELECT n FROM t ORDER BY n`;
		return {exit, rows: rows.map((row) => row.n)};
	});

describe("a turn that waits, on Node", () => {
	it.live("the driver's own turn lets it wait and commits: Node cannot see the mistake", () =>
		Effect.gen(function* () {
			const {exit, rows} = yield* turn(Effect.sleep("5 millis"));
			expect(Exit.isSuccess(exit)).toBe(true);
			expect(rows).toEqual([1, 2]);
		}).pipe(Effect.provide(memory)),
	);

	it.live.each([
		["a timer", Effect.sleep("5 millis")],
		["a resolved Promise", Effect.promise(() => Promise.resolve())],
	] as const)("the synchronous turn dies on %s, at once, and writes nothing", ([, wait]) =>
		Effect.gen(function* () {
			const {exit, rows} = yield* turn(wait);
			expect(Exit.isFailure(exit) && Cause.isAsyncFiberError(Cause.squash(exit.cause))).toBe(true);
			expect(rows).toEqual([]);
		}).pipe(Effect.provide(synced)),
	);

	it.live("the synchronous turn runs a turn that only yields to the scheduler", () =>
		Effect.gen(function* () {
			const {exit, rows} = yield* turn(Effect.yieldNow);
			expect(Exit.isSuccess(exit)).toBe(true);
			expect(rows).toEqual([1, 2]);
		}).pipe(Effect.provide(synced)),
	);

	it("a whole turn runs under Effect.runSync on both", () => {
		for (const layer of [memory, synced]) {
			const {rows} = Effect.runSync(turn(Effect.void, Effect.void).pipe(Effect.provide(layer)));
			expect(rows).toEqual([1, 2]);
		}
	});
});
