// P33, p79 atomic exit's storage contract. Each plant is named beside its law.
import {Buffer} from "node:buffer";
import {DatabaseSync} from "node:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Exit, Layer, Schema, Stream, Tracer} from "effect";
import {LedgerTransaction} from "./ledger-transaction.ts";
import {Doorbell, Ledger, LedgerError} from "./ledger.ts";
import type {Line} from "./log.ts";
import type {Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

const opened: Array<DatabaseSync> = [];
afterEach(() => {
	for (const db of opened.splice(0)) db.close();
});
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
const N = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const T = (minLength: number, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(N(0, 65535)), {minLength, maxLength}).pipe(
		Arbitrary.map((units) => Buffer.from(String.fromCharCode(...units), "utf8").toString("utf8")),
	);
const Inputs = {
	line: Arbitrary.all({
		by: T(1, 256),
		for: T(1, 256),
		sentAt: T(0, 4096),
		build: T(1, 256),
		_tag: T(1, 256),
	}),
	count: Arbitrary.schema(N(1, 8)),
	pages: Arbitrary.schema(N(257, 1501)),
	code: T(1, 64),
	bad: T(0, 4096),
};
const law = <A>(
	name: string,
	input: Arbitrary.Arbitrary<A>,
	examples: ReadonlyArray<A>,
	check: (value: A) => Effect.Effect<unknown, unknown>,
	runs = 60,
) =>
	describe(name, () => {
		const run = (value: A) =>
			Effect.suspend(() => check(value)).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						for (const db of opened.splice(0)) if (db.isOpen) db.close();
					}),
				),
			);
		beforeEach(() => Effect.runPromise(Effect.forEach(examples, run, {concurrency: 1})));
		it.effect.prop(name, {input}, ({input}) => run(input), {
			arbitrary: {seed: 119120, runs, size: 4096},
			timeout: 60000,
		});
	});
const setup = (
	ring: (to: string, stream: string, rev: number) => Effect.Effect<void, LedgerError> = () =>
		Effect.void,
) => {
	const db = new DatabaseSync(":memory:");
	opened.push(db);
	const backend = nodeSql(db);
	const fault: {after: number | null; passed: number} = {after: null, passed: 0};
	const sql: Sql = {
		...backend,
		exec: (query, ...params) => {
			if (/^\s*INSERT\s+INTO\s+entries\b/i.test(query)) {
				if (fault.after === 0) throw new Error("planted SQLITE_FULL");
				if (fault.after !== null) fault.after--;
				const rows = backend.exec(query, ...params);
				fault.passed++;
				return rows;
			}
			return backend.exec(query, ...params);
		},
	};
	const layer = Layer.mergeAll(
		Ledger.sql(sql, {reader: "watcher"}),
		LedgerTransaction.layer(sql),
	).pipe(Layer.provide(Layer.succeed(Doorbell, {ring})));
	return {db, sql, fault, layer};
};

/** A step that throws as the platform does: a string `code`, no SQLite `errcode`. */
const diskFailure = (): never => {
	throw Object.assign(new Error("disk"), {code: "EIO"});
};

describe("p79, LedgerTransaction", () => {
	law(
		"plant, separate numbering: reads see earlier writes and share P6's rev and pos",
		Inputs.line,
		[line(0)],
		(fields) => {
			const line = (n: number) => ({
				...fields,
				seen: 0,
				parent: null,
				traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
				body: {n},
			});
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				expect(yield* ledger.append("a", "one", line(1))).toEqual({_tag: "placed", rev: 1, pos: 1});
				expect(
					yield* tx.transact((turn) => {
						const a = turn.append("a", "two", line(2));
						const b = turn.append("b", "three", line(3));
						return {a, b, read: [...turn.read("a", 1)].map((row) => row.id)};
					}),
				).toEqual({a: {rev: 2, pos: 2}, b: {rev: 3, pos: 1}, read: ["two"]});
				expect(yield* ledger.append("b", "four", line(4))).toEqual({
					_tag: "placed",
					rev: 4,
					pos: 2,
				});
			}).pipe(Effect.provide(store.layer));
		},
	);
	// From the T546 mutation step: no law kept a turn past its callback, so `!open` in
	// ledger-store.ts's `ensureOpen` could be `false` and every check still passed.
	law(
		"a turn kept past its callback refuses every read and append as storage, and writes nothing",
		Arbitrary.all({
			count: Inputs.count,
			ops: Arbitrary.schema(
				Schema.Array(Schema.Literals(["read", "append"])).check(
					Schema.isMinLength(1),
					Schema.isMaxLength(8),
				),
			),
		}),
		[{count: 1, ops: ["read", "append"]}],
		({count, ops}) => {
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				const kept = yield* tx.transact((turn) => {
					for (let i = 0; i < count; i++) turn.append("a", `in-${i}`, line(i));
					return turn;
				});
				for (const [i, op] of ops.entries()) {
					const late = () =>
						op === "read" ? [...kept.read("a", 0)] : kept.append("a", `late-${i}`, line(100 + i));
					let thrown: unknown;
					try {
						late();
					} catch (error) {
						thrown = error;
					}
					expect(thrown).toBeInstanceOf(LedgerError);
					expect((thrown as LedgerError).why).toBe("storage");
				}
				expect((yield* Stream.runCollect(ledger.read("a", 0))).map((row) => row.id)).toEqual(
					Array.from({length: count}, (_, i) => `in-${i}`),
				);
			}).pipe(Effect.provide(store.layer));
		},
	);
	law(
		"plant, swallow a later storage failure: an earlier successful INSERT rolls back",
		Inputs.count,
		[1],
		(successes) => {
			const store = setup();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const tx = yield* LedgerTransaction;
				yield* ledger.append("a", "one", line(1));
				store.fault.after = successes;
				const before = store.fault.passed;
				expect(
					(yield* Effect.flip(
						tx.transact((turn) => {
							for (let i = 0; i < successes; i++)
								turn.append("a", i === 0 ? "two" : `early-${i}`, line(2 + i));
							turn.append("b", "three", line(3));
						}),
					)).why,
				).toBe("storage");
				expect(store.fault.passed - before).toBe(successes);
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
	law(
		"plant, drop a string code: a platform error's code rides as a span tag",
		Inputs.code,
		["EIO"],
		(code) => {
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
				const error = yield* Effect.flip(
					tx.transact(
						code === "EIO"
							? diskFailure
							: () => {
									// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- the transaction callback models a platform throw
									throw Object.assign(new Error("disk"), {code});
								},
					),
				);
				expect(error.why).toBe("storage");
				const codes = spans.flatMap((span) =>
					[...span.attributes].filter(([key]) => key.endsWith(".code")).map(([, value]) => value),
				);
				expect(codes).toEqual([code]);
			}).pipe(Effect.provide(store.layer), Effect.withTracer(tracer));
		},
	);
	for (const why of ["id_reused", "seen_ahead", "bad_trace"] as const) {
		law(
			`plant, keep the first append on ${why}: refusal aborts the entire turn`,
			Inputs.line,
			[line(0)],
			(fields) => {
				const line = (n: number) => ({
					...fields,
					seen: 0,
					parent: null,
					traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
					body: {n},
				});
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
							tx.transact((turn) => {
								turn.append("b", "early", line(2));
								turn.append("a", why === "id_reused" ? "one" : "late", refused);
							}),
						)).why,
					).toBe("refused");
					expect(yield* Stream.runCollect(ledger.read("b", 0))).toEqual([]);
					expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
				}).pipe(Effect.provide(store.layer));
			},
		);
	}
	law(
		"plant, reappend on retry: the original placings return without new rows or rings",
		Inputs.line,
		[line(0)],
		(fields) => {
			const line = (n: number) => ({
				...fields,
				seen: 0,
				parent: null,
				traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
				body: {n},
			});
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
					tx.transact((turn) => [
						turn.append("a", "one", line(1)),
						turn.append("b", "two", line(2)),
					]);
				const a = yield* write();
				expect(yield* write()).toEqual(a);
				expect(rings.sort()).toEqual(["a", "b"]);
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
			}).pipe(Effect.provide(store.layer));
		},
	);
	law(
		"plant, ring before commit: every notification sees both committed appends",
		Inputs.count,
		[1],
		(count) => {
			const observations: Array<{inTransaction: boolean; rows: number}> = [];
			const store = setup(() =>
				Effect.sync(() => {
					observations.push({
						inTransaction: store.db.isTransaction,
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
					tx.transact((turn) => {
						turn.append("a", "one", line(1));
						for (let i = 0; i < count; i++)
							turn.append("b", i === 0 ? "two" : `extra-${i}`, line(2 + i));
					}),
				);
				expect(observations).toEqual([]);
				store.fault.after = null;
				yield* tx.transact((turn) => {
					turn.append("a", "one", line(1));
					for (let i = 0; i < count; i++)
						turn.append("b", i === 0 ? "two" : `extra-${i}`, line(2 + i));
				});
				expect(observations).toEqual([
					{inTransaction: false, rows: count + 1},
					{inTransaction: false, rows: count + 1},
				]);
			}).pipe(Effect.provide(store.layer));
		},
	);
	law(
		"plant, undo a commit on notification failure: a failed bell cannot lose entries",
		Inputs.line,
		[line(0)],
		(fields) => {
			const line = (n: number) => ({
				...fields,
				seen: 0,
				parent: null,
				traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
				body: {n},
			});
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
				const first = yield* Effect.exit(write());
				expect(Exit.isSuccess(first), "a failed bell cannot fail a committed turn").toBe(true);
				expect(yield* first).toEqual({rev: 1, pos: 1});
				expect(yield* write()).toEqual({rev: 1, pos: 1});
				expect(rings).toBe(1);
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
			}).pipe(Effect.provide(store.layer));
		},
	);
	law(
		"plant, one page is all history: a turn reads past P6's 256-row page",
		Inputs.pages,
		[260],
		(made) => {
			const store = setup();
			return Effect.gen(function* () {
				const tx = yield* LedgerTransaction;
				yield* tx.transact((turn) => {
					for (let n = 1; n <= made; n++) turn.append("a", `m${n}`, line(n));
				});
				expect(yield* tx.transact((turn) => [...turn.read("a", 0)].map((row) => row.rev))).toEqual(
					Array.from({length: made}, (_, i) => i + 1),
				);
			}).pipe(Effect.provide(store.layer));
		},
		10,
	);
	law(
		"plant, reset corrupt storage: a malformed saved row fails as bad_row",
		Inputs.bad,
		["not JSON"],
		(bad) => {
			const store = setup();
			return Effect.gen(function* () {
				const tx = yield* LedgerTransaction;
				yield* tx.transact((turn) => turn.append("a", "one", line(1)));
				store.db.prepare("UPDATE entries SET body=?").run(bad === "not JSON" ? bad : `!${bad}`);
				expect((yield* Effect.flip(tx.transact((turn) => [...turn.read("a", 0)]))).why).toBe(
					"bad_row",
				);
			}).pipe(Effect.provide(store.layer));
		},
	);
});
