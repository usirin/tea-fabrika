// S10 spike, never merged: `../ledger-transaction.test.ts` on route E. The harness changed, and each
// step is an Effect, since a turn's `read` and `append` are Effects there. What each law asserts is as
// on main, except where a comment starting `S10:` says so.
// P33, p79 atomic exit's storage contract. Each plant is named beside its law.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {SqliteClient} from "@effect/sql-sqlite-node";
import {afterAll, afterEach, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Stream, Tracer} from "effect";
import {Doorbell, Ledger, LedgerError} from "../ledger.ts";
import type {Line} from "../log.ts";
import {hooked, pass, turned, type Verdict} from "./harness.ts";
import {ledgerOnSqlClient, LedgerTransactionE as LedgerTransaction} from "./store-effect-sql.ts";

const folder = mkdtempSync(join(tmpdir(), "s10-tx-"));
let files = 0;
const opened: Array<DatabaseSync> = [];

afterEach(() => {
	for (const db of opened.splice(0)) {
		db.close();
	}
});

afterAll(() => rmSync(folder, {recursive: true, force: true}));

const line = (n: number): Line => ({
	by: "SHA256:brain",
	for: "person-a",
	sentAt: "2026-11-07T00:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "writer-build",
	_tag: "fact",
	body: {n},
});

const setup = (
	ring: (to: string, stream: string, rev: number) => Effect.Effect<void, LedgerError> = () =>
		Effect.void,
) => {
	// S10: the driver owns the ledger's connection, so `db` is a second connection to the same file.
	// It sees only what is committed.
	const path = join(folder, `tx-${++files}.db`);
	const db = new DatabaseSync(path);
	opened.push(db);
	const fault: {after: number | null; passed: number; thrown: unknown} = {
		after: null,
		passed: 0,
		thrown: new Error("planted SQLITE_FULL"),
	};
	const hook = (query: string): Verdict => {
		if (/^\s*INSERT\s+INTO\s+entries\b/i.test(query)) {
			if (fault.after === 0) {
				return {thrown: fault.thrown};
			}

			if (fault.after !== null) {
				fault.after--;
			}

			fault.passed++;
		}

		return pass();
	};
	const layer = ledgerOnSqlClient({reader: "watcher"}).pipe(
		Layer.provide(hooked(hook)),
		Layer.provide(turned),
		Layer.provide(SqliteClient.layer({filename: path}).pipe(Layer.orDie)),
		Layer.provide(Layer.succeed(Doorbell, {ring})),
	);
	return {db, fault, layer};
};

/** A failure as the platform gives it: a string `code`, no SQLite `errcode`. */
const diskFailure = (): Error => Object.assign(new Error("disk"), {code: "EIO"});

describe("p79, LedgerTransaction", () => {
	it.effect(
		"plant, separate numbering: reads see earlier writes and share P6's rev and pos",
		() => {
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				expect(yield* ledger.append("a", "one", line(1))).toEqual({_tag: "placed", rev: 1, pos: 1});
				expect(
					yield* tx.transact(
						Effect.fnUntraced(function* (turn) {
							const a = yield* turn.append("a", "two", line(2));
							const b = yield* turn.append("b", "three", line(3));
							return {a, b, read: (yield* turn.read("a", 1)).map((row) => row.id)};
						}),
					),
				).toEqual({a: {rev: 2, pos: 2}, b: {rev: 3, pos: 1}, read: ["two"]});
				expect(yield* ledger.append("b", "four", line(4))).toEqual({
					_tag: "placed",
					rev: 4,
					pos: 2,
				});
			}).pipe(Effect.provide(store.layer));
		},
	);
	it.effect(
		"plant, swallow a later storage failure: an earlier successful INSERT rolls back",
		() => {
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				yield* ledger.append("a", "one", line(1));
				store.fault.after = 1;
				const before = store.fault.passed;
				expect(
					(yield* Effect.flip(
						tx.transact((turn) =>
							Effect.andThen(turn.append("a", "two", line(2)), turn.append("b", "three", line(3))),
						),
					)).why,
				).toBe("storage");
				expect(store.fault.passed - before).toBe(1);
				store.fault.after = null;
				expect((yield* Stream.runCollect(ledger.read("a", 0))).map((row) => row.id)).toEqual([
					"one",
				]);
				expect(yield* Stream.runCollect(ledger.read("b", 0))).toEqual([]);
				expect(yield* ledger.append("b", "after", line(4))).toEqual({
					_tag: "placed",
					rev: 2,
					pos: 1,
				});
			}).pipe(Effect.provide(store.layer));
		},
	);
	it.effect("plant, drop a string code: a platform error's code rides as a span tag", () => {
		const store = setup();
		const spans: Array<Tracer.NativeSpan> = [];
		const tracer = Tracer.make({
			span: (options) => {
				const span = new Tracer.NativeSpan(options);
				spans.push(span);
				return span;
			},
		});
		return Effect.gen(function* () {
			const tx = yield* LedgerTransaction;
			// S10: on main the step itself throws. Here a throw in a step is a defect, so the platform
			// failure is planted where the platform makes one: at a statement.
			store.fault.thrown = diskFailure();
			store.fault.after = 0;
			const error = yield* Effect.flip(tx.transact((turn) => turn.append("a", "one", line(1))));
			expect(error.why).toBe("storage");
			const codes = spans.flatMap((span) =>
				[...span.attributes].filter(([key]) => key.endsWith(".code")).map(([, value]) => value),
			);
			expect(codes).toEqual(["EIO"]);
		}).pipe(Effect.provide(store.layer), Effect.withTracer(tracer));
	});

	for (const why of ["id_reused", "seen_ahead", "bad_trace"] as const) {
		it.effect(`plant, keep the first append on ${why}: refusal aborts the entire turn`, () => {
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				yield* ledger.append("a", "one", line(1));
				const refused =
					why === "seen_ahead"
						? {...line(3), seen: 900}
						: why === "bad_trace"
							? {...line(3), traceId: "wrong"}
							: line(3);
				expect(
					(yield* Effect.flip(
						tx.transact((turn) =>
							Effect.andThen(
								turn.append("b", "early", line(2)),
								turn.append("a", why === "id_reused" ? "one" : "late", refused),
							),
						),
					)).why,
				).toBe("refused");
				expect(yield* Stream.runCollect(ledger.read("b", 0))).toEqual([]);
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
			}).pipe(Effect.provide(store.layer));
		});
	}

	it.effect(
		"plant, reappend on retry: the original placings return without new rows or rings",
		() => {
			const rings: Array<string> = [];
			const store = setup((_to, stream) =>
				Effect.sync(() => {
					rings.push(stream);
				}),
			);
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				yield* ledger.wait("a", 0);
				yield* ledger.wait("b", 0);
				const write = () =>
					tx.transact((turn) =>
						Effect.all([turn.append("a", "one", line(1)), turn.append("b", "two", line(2))]),
					);
				const a = yield* write();
				expect(yield* write()).toEqual(a);
				expect(rings.sort()).toEqual(["a", "b"]);
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
			}).pipe(Effect.provide(store.layer));
		},
	);
	it.effect("plant, ring before commit: every notification sees both committed appends", () => {
		const observations: Array<{inTransaction: boolean; rows: number}> = [];
		const store = setup(() =>
			Effect.sync(() => {
				// S10: `inTransaction` was the ledger's own connection. From a second connection the
				// same fact is: both rows are already visible, so the turn has committed.
				observations.push({
					inTransaction: false,
					rows: Number(store.db.prepare("SELECT count(*) AS n FROM entries").get()?.["n"]),
				});
			}),
		);
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			const tx = yield* LedgerTransaction;
			yield* ledger.wait("a", 0);
			yield* ledger.wait("b", 0);
			store.fault.after = 1;
			yield* Effect.flip(
				tx.transact((turn) =>
					Effect.andThen(turn.append("a", "one", line(1)), turn.append("b", "two", line(2))),
				),
			);
			expect(observations).toEqual([]);
			store.fault.after = null;
			yield* tx.transact((turn) =>
				Effect.andThen(turn.append("a", "one", line(1)), turn.append("b", "two", line(2))),
			);
			expect(observations).toEqual([
				{inTransaction: false, rows: 2},
				{inTransaction: false, rows: 2},
			]);
		}).pipe(Effect.provide(store.layer));
	});
	it.effect(
		"plant, undo a commit on notification failure: a failed bell cannot lose entries",
		() => {
			let rings = 0;
			const store = setup(() =>
				Effect.sync(() => {
					rings++;
				}).pipe(Effect.andThen(Effect.fail(new LedgerError({why: "unreachable"})))),
			);
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				yield* ledger.wait("a", 0);
				const write = () => tx.transact((turn) => turn.append("a", "one", line(1)));
				expect(yield* write()).toEqual({rev: 1, pos: 1});
				expect(yield* write()).toEqual({rev: 1, pos: 1});
				expect(rings).toBe(1);
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
			}).pipe(Effect.provide(store.layer));
		},
	);
	it.effect("plant, one page is all history: a turn reads past P6's 256-row page", () => {
		const store = setup();
		return Effect.gen(function* () {
			const tx = yield* LedgerTransaction;
			yield* tx.transact((turn) =>
				Effect.forEach(
					Array.from({length: 260}, (_, i) => i + 1),
					(n) => turn.append("a", `m${n}`, line(n)),
					{discard: true},
				),
			);
			expect(
				yield* tx.transact((turn) =>
					Effect.map(turn.read("a", 0), (rows) => rows.map((row) => row.rev)),
				),
			).toEqual(Array.from({length: 260}, (_, i) => i + 1));
		}).pipe(Effect.provide(store.layer));
	});
	it.effect("plant, reset corrupt storage: a malformed saved row fails as bad_row", () => {
		const store = setup();
		return Effect.gen(function* () {
			const tx = yield* LedgerTransaction;
			yield* tx.transact((turn) => turn.append("a", "one", line(1)));
			store.db.exec("UPDATE entries SET body='not JSON'");
			expect((yield* Effect.flip(tx.transact((turn) => turn.read("a", 0)))).why).toBe("bad_row");
		}).pipe(Effect.provide(store.layer));
	});
});
