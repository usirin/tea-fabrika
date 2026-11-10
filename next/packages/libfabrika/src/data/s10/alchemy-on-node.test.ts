// S10 spike, never merged. Two Node checks.
// 1. The t502 plan's first S10 question: what must a Node law put in Alchemy's `RuntimeContext` for
//    `state.storage`'s methods to run? Route W's store runs here on Alchemy's own wrapper
//    (`fromDurableObjectStorage`) over a hand-written stand-in for the platform's storage.
// 2. How many spans one append ends on main's store and on route E.
import {DatabaseSync} from "node:sqlite";
import {fromDurableObjectStorage} from "@alchemy.run/cloudflare/Workers/DurableObjectStorage";
import {SqliteClient} from "@effect/sql-sqlite-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Tracer} from "effect";
import {ledgerStore} from "../ledger-store.ts";
import {Doorbell} from "../ledger.ts";
import type {Line} from "../log.ts";
import {nodeSql} from "../sqlite.ts";
import {refereeOnAlchemy} from "./store-alchemy.ts";
import {refereeOnSqlClient} from "./store-effect-sql.ts";

const bell = {ring: () => Effect.void};
const line = (n: number): Line => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "b-7c1d073",
	_tag: "saved",
	body: {n},
});

/** A stand-in for the platform's storage, as much of it as the slice calls. Not the platform: its
 *  `transaction` has no input gate, and nothing here says it rolls back as workerd does. */
const standIn = (db: DatabaseSync) => {
	const cursor = (query: string, params: ReadonlyArray<never>) => {
		const statement = db.prepare(query);
		const rows = statement.all(...params);
		return {
			toArray: () => rows,
			one: () => rows[0],
			next: () => ({done: true}),
			raw: () => rows.map((row) => Object.values(row)),
			columnNames: statement.columns().map((column) => column.name),
			rowsRead: rows.length,
			rowsWritten: 0,
			[Symbol.iterator]: () => rows[Symbol.iterator](),
		};
	};
	return {
		sql: {exec: (query: string, ...params: ReadonlyArray<never>) => cursor(query, params)},
		// oxlint-disable-next-line fabrika/no-promises -- edge: the platform's transaction takes an async callback
		transaction: async <A>(step: (txn: {rollback: () => void}) => Promise<A>) => {
			db.exec("BEGIN IMMEDIATE");
			let rolledBack = false;

			try {
				const value = await step({
					rollback: () => {
						rolledBack = true;
					},
				});
				db.exec(rolledBack ? "ROLLBACK" : "COMMIT");
				return value;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
	};
};

describe("S10, Alchemy's storage wrapper on Node", () => {
	it.effect("route W's store runs with nothing put in RuntimeContext", () =>
		Effect.gen(function* () {
			const db = new DatabaseSync(":memory:");
			// oxlint-disable-next-line fabrika/no-type-assertions -- a stand-in for the platform's storage, only workerd makes a real one
			const storage = fromDurableObjectStorage(standIn(db) as never);
			const referee = refereeOnAlchemy(storage, bell);
			// oxlint-disable-next-line fabrika/no-type-assertions -- RuntimeContext is a type-level mark here: nothing reads it at run time
			const run = <A, E>(effect: Effect.Effect<A, E, unknown>) => effect as Effect.Effect<A, E>;
			expect(yield* run(referee.append("a", "one", line(1)))).toEqual({
				_tag: "placed",
				rev: 1,
				pos: 1,
			});
			const refusedTurn = yield* Effect.flip(
				run(
					referee.transact((turn) =>
						Effect.andThen(turn.append("b", "early", line(2)), turn.append("a", "one", line(3))),
					),
				),
			);
			expect(refusedTurn.why).toBe("refused");
			expect(yield* run(referee.read("b", 0, "r"))).toEqual([]);
			expect(yield* run(referee.append("b", "after", line(4)))).toEqual({
				_tag: "placed",
				rev: 2,
				pos: 1,
			});
			db.close();
		}),
	);
});

describe("S10, spans one append ends", () => {
	const counted = () => {
		const names: Array<string> = [];
		const tracer = Tracer.make({
			span(options) {
				names.push(options.name);
				return new Tracer.NativeSpan(options);
			},
		});
		return {names, tracer};
	};

	it.effect("main's store: one span", () => {
		const {names, tracer} = counted();
		return Effect.gen(function* () {
			const db = new DatabaseSync(":memory:");
			const store = ledgerStore(nodeSql(db), bell);
			yield* store.append("a", "one", line(1));
			names.length = 0;
			yield* store.append("a", "two", line(2));
			expect(names).toEqual(["ledger.append"]);
			db.close();
		}).pipe(Effect.withTracer(tracer));
	});

	it.effect(
		"route E: nine spans, the same one plus the turn, its BEGIN and COMMIT, and one per statement",
		() => {
			const {names, tracer} = counted();
			return Effect.gen(function* () {
				const referee = yield* refereeOnSqlClient;
				yield* referee.append("a", "one", line(1));
				names.length = 0;
				yield* referee.append("a", "two", line(2));
				expect(names).toEqual([
					"ledger.append",
					"sql.transaction",
					"BEGIN",
					"sqlite",
					"sqlite",
					"sqlite",
					"sqlite",
					"sqlite",
					"COMMIT",
				]);
			}).pipe(
				Effect.provide(SqliteClient.layer({filename: ":memory:"}).pipe(Layer.orDie)),
				Effect.provideService(Doorbell, bell),
				Effect.withTracer(tracer),
			);
		},
	);
});
