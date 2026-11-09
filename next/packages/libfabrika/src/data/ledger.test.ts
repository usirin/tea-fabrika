// p18, p19, p20 and p93 (docs/plan/tier-1-detail.md, "Properties"; P6's plan writes them out), for
// `data/ledger.ts` and `data/referee.ts`: the ledger suite on `Ledger.sql` over node:sqlite, `read`
// as a lazy Stream, `arrivedAt` from the referee's Clock, typed failures that pass, and `seen`
// bounded by the log's head. Written before the modules (Tier 1, P6, ticket 233).
//
// The shape these tests hold the modules to:
// - `append(stream, id, line)` answers `{_tag: "placed", rev, pos}` or `{_tag: "refused", why}`.
//   `rev` is the place in the whole log, `pos` the place in the stream, both from 1. The same id on
//   the same stream with the same `by`, `for`, `parent`, `_tag` and `body` gets its first placing
//   again and writes nothing; with any of those different it is `id_reused` (owner, 2026-11-07).
//   `sentAt`, `seen`, `traceId` and `build` may differ on a resend. `seen` past the log's head is `seen_ahead`.
// - `read(stream, after)` is a Stream of the stream's entries past `after`, oldest first, fetched
//   in pages of 256 only when it runs. `wait(stream, after)` answers at once: `{_tag: "ready", rev}`
//   with the stream's newest rev, or `{_tag: "parked"}`.
// - Failures are `LedgerError` with `why`: `unreachable` and `bad_row` from `Ledger.remote`,
//   `storage` when the Sql throws. No Layer fails when it is built.
import {mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Duration, Effect, Layer, ManagedRuntime, References, Stream, Tracer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {processId} from "../id.test-support.ts";
import {Doorbell, Ledger, LedgerError, type LedgerCalls} from "./ledger.ts";
import type {Line} from "./log.ts";
import type {Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "gateway:t1";
const PARENT = `in-${Effect.runSync(processId)}-41`;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE = "5bf92f3577b34da6a3ce929d0e0e4737";

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-ledger-"));
const opened: Array<DatabaseSync> = [];
let files = 0;
const freshPath = (): string => join(folder, `ledger-${++files}.db`);
const openDb = (path: string): DatabaseSync => {
	const db = new DatabaseSync(path);
	opened.push(db);
	return db;
};
const fresh = (): Sql => nodeSql(openDb(freshPath()));
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

type Rung = {readonly to: string; readonly stream: string; readonly rev: number};
const bell = () => {
	const rang: Array<Rung> = [];
	const layer = Layer.succeed(Doorbell, {
		ring: (to, stream, rev) =>
			Effect.sync(() => {
				rang.push({to, stream, rev});
			}),
	});
	return {rang, layer};
};
const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
const onSql = (sql: Sql, doorbell: Layer.Layer<Doorbell> = quiet) =>
	Ledger.sql(sql, {reader: READER}).pipe(Layer.provide(doorbell));

const line = (over: Partial<Line> = {}): Line => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: null,
	traceId: TRACE,
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: "n-7f3a", base: 3},
	...over,
});
const placed = (rev: number, pos: number) => ({_tag: "placed", rev, pos});
const refused = (why: string) => ({_tag: "refused", why});
const readAll = (stream: string, after = 0) =>
	Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, after)));

/** A Sql that counts its calls, so a test can see that nothing was read. */
const counting = (sql: Sql) => {
	let calls = 0;
	const counted: Sql = {
		exec: (query, ...params) => {
			calls++;
			return sql.exec(query, ...params);
		},
		transaction: (step) => {
			calls++;
			return sql.transaction(step);
		},
		size: () => sql.size(),
	};
	return {sql: counted, calls: () => calls};
};

/** node:sqlite's error for a full disk, as it throws it. */
const sqliteFull = (): Error =>
	Object.assign(new Error("database or disk is full"), {
		code: "ERR_SQLITE_ERROR",
		errcode: 13,
		errstr: "database or disk is full",
	});
/** A Sql whose next call throws once `arm` is called, then works again. */
const throwingOnce = (sql: Sql) => {
	let armed = false;
	const trip = (): void => {
		if (!armed) return;
		armed = false;
		throw sqliteFull();
	};
	const wrapped: Sql = {
		exec: (query, ...params) => {
			trip();
			return sql.exec(query, ...params);
		},
		transaction: (step) => sql.transaction(step),
		size: () => sql.size(),
	};
	return {
		sql: wrapped,
		arm: () => {
			armed = true;
		},
	};
};
/** A tracer that keeps every span it makes, so a test can count the ones that ended. */
const capture = () => {
	const spans: Array<Tracer.NativeSpan> = [];
	const tracer = Tracer.make({
		span(options) {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	const ended = (name: string) =>
		spans.filter((span) => span.name === name && span.status._tag === "Ended");
	return {tracer, ended};
};

describe("p18, the ledger suite on Ledger.sql", () => {
	it.effect(
		"the same id sent twice with the same content is one entry, placed the same, the first kept",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const first = yield* ledger.append(
					"notes:1",
					"w-9",
					line({sentAt: "first", seen: 0, build: "b-1"}),
				);
				const again = yield* ledger.append(
					"notes:1",
					"w-9",
					line({sentAt: "second", seen: 1, build: "b-2"}),
				);
				expect(first).toEqual(placed(1, 1));
				expect(again).toEqual(first);
				const entries = yield* readAll("notes:1");
				expect(entries.map((e) => [e.id, e.rev, e.sentAt, e.seen, e.build])).toEqual([
					["w-9", 1, "first", 0, "b-1"],
				]);
				expect(yield* ledger.append("notes:1", "w-10", line())).toEqual(placed(2, 2));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	// Plant: same() compares traceId, so a retry in another trace is refused.
	it.effect(
		"traceId never decides: a resend gets its first placing and keeps the first trace",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("notes:1", "w-1", line())).toEqual(placed(1, 1));
				expect(yield* ledger.append("notes:1", "w-2", line())).toEqual(placed(2, 2));
				expect(yield* ledger.append("notes:1", "w-1", line({traceId: OTHER_TRACE}))).toEqual(
					placed(1, 1),
				);
				const entries = yield* readAll("notes:1");
				expect(entries.map((entry) => [entry.id, entry.rev, entry.pos, entry.traceId])).toEqual([
					["w-1", 1, 1, TRACE],
					["w-2", 2, 2, TRACE],
				]);
				expect(yield* ledger.append("notes:1", "w-3", line())).toEqual(placed(3, 3));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	const changes: ReadonlyArray<readonly [string, Partial<Line>]> = [
		["by", {by: "SHA256:writer-b"}],
		["for", {for: "someone-else"}],
		["parent", {parent: PARENT}],
		["_tag", {_tag: "deleted"}],
		["body", {body: {note: "n-7f3a", base: 4}}],
	];
	it.effect.each(changes)(
		"the same id with another %s is refused id_reused, and nothing is written",
		([, change]) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("notes:1", "w-9", line())).toEqual(placed(1, 1));
				expect(yield* ledger.append("notes:1", "w-9", line(change))).toEqual(refused("id_reused"));
				const entries = yield* readAll("notes:1");
				expect(entries).toHaveLength(1);
				expect(entries[0]).toMatchObject(line());
				expect(yield* ledger.append("notes:1", "w-10", line())).toEqual(placed(2, 2));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect("an id is checked per stream: the same id on another stream is a new entry", () =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			expect(yield* ledger.append("notes:1", "w-1", line())).toEqual(placed(1, 1));
			expect(yield* ledger.append("notes:2", "w-1", line({body: "other"}))).toEqual(placed(2, 1));
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect(
		"two streams written in turn: reads in rev order, pos 1, 2, 3, rev only grows, after cuts",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const answers = [];
				for (const n of [1, 2, 3]) {
					answers.push(yield* ledger.append("a", `a-${n}`, line({body: n})));
					answers.push(yield* ledger.append("b", `b-${n}`, line({body: n})));
				}
				expect(answers).toEqual([
					placed(1, 1),
					placed(2, 1),
					placed(3, 2),
					placed(4, 2),
					placed(5, 3),
					placed(6, 3),
				]);
				const a = yield* readAll("a");
				expect(a.map((e) => [e.id, e.rev, e.pos, e.body])).toEqual([
					["a-1", 1, 1, 1],
					["a-2", 3, 2, 2],
					["a-3", 5, 3, 3],
				]);
				expect((yield* readAll("a", 3)).map((e) => e.id)).toEqual(["a-3"]);
				expect((yield* readAll("b", 2)).map((e) => e.id)).toEqual(["b-2", "b-3"]);
				expect(yield* readAll("b", 6)).toEqual([]);
				expect(yield* readAll("c")).toEqual([]);
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	it("for any run of appends, every answer and every read match a plain model (fast-check)", async () => {
		const command = fc.record({
			stream: fc.constantFrom("a", "b", "c"),
			id: fc.constantFrom("w-1", "w-2", "w-3", "w-4"),
			body: fc.constantFrom(1, 2),
			ahead: fc.nat({max: 2}),
		});
		type Command = typeof command extends fc.Arbitrary<infer C> ? C : never;
		const model = (commands: ReadonlyArray<Command>) => {
			const kept = new Map<string, {id: string; body: number; rev: number; pos: number}>();
			const streams = new Map<
				string,
				Array<{id: string; body: number; rev: number; pos: number}>
			>();
			let head = 0;
			const answers = commands.map(({stream, id, body, ahead}) => {
				const first = kept.get(`${stream} ${id}`);
				if (first !== undefined) {
					return first.body === body ? placed(first.rev, first.pos) : refused("id_reused");
				}
				if (ahead > 0) return refused("seen_ahead");
				const list = streams.get(stream) ?? [];
				const entry = {id, body, rev: ++head, pos: list.length + 1};
				kept.set(`${stream} ${id}`, entry);
				streams.set(stream, [...list, entry]);
				return placed(entry.rev, entry.pos);
			});
			return {answers, streams};
		};
		await fc.assert(
			fc.asyncProperty(fc.array(command, {maxLength: 30}), (commands) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const ledger = yield* Ledger;
						const answers = [];
						let head = 0;
						const ids = new Set<string>();
						for (const {stream, id, body, ahead} of commands) {
							// A new id may be sent ahead of the head; a resend always sends a seen in range.
							const known = ids.has(`${stream} ${id}`);
							const seen = known ? head : head + ahead;
							const answer = yield* ledger.append(stream, id, line({body, seen}));
							if (answer._tag === "placed") {
								ids.add(`${stream} ${id}`);
								head = Math.max(head, answer.rev);
							}
							answers.push(answer);
						}
						const expected = model(commands);
						expect(answers).toEqual(expected.answers);
						for (const stream of ["a", "b", "c"]) {
							const entries = yield* readAll(stream);
							expect(
								entries.map((e) => ({id: e.id, body: e.body, rev: e.rev, pos: e.pos})),
							).toEqual(expected.streams.get(stream) ?? []);
						}
					}).pipe(Effect.provide(onSql(fresh()))),
				),
			),
			{seed: SEED, numRuns: 60},
		);
	});

	it.effect(
		"a wait is ready with news, parks without, and the next append to its stream rings it once",
		() => {
			const {rang, layer} = bell();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-1", line());
				expect(yield* ledger.wait("a", 0)).toEqual({_tag: "ready", rev: 1});
				expect(yield* ledger.wait("a", 1)).toEqual({_tag: "parked"});
				yield* ledger.append("b", "w-1", line());
				yield* ledger.append("a", "w-1", line());
				expect(rang).toEqual([]);
				yield* ledger.append("a", "w-2", line());
				yield* ledger.append("a", "w-3", line());
				expect(rang).toEqual([{to: READER, stream: "a", rev: 3}]);
			}).pipe(Effect.provide(onSql(fresh(), layer)));
		},
	);

	it.effect(
		"the file closed and opened again holds every placed entry once, with no gap, and a parked wait still rings",
		() =>
			Effect.gen(function* () {
				const path = freshPath();
				const first = openDb(path);
				yield* Effect.gen(function* () {
					const ledger = yield* Ledger;
					for (const n of [1, 2, 3, 4, 5]) yield* ledger.append("a", `w-${n}`, line());
					expect(yield* ledger.wait("b", 5)).toEqual({_tag: "parked"});
				}).pipe(Effect.provide(onSql(nodeSql(first))));
				first.close();
				const {rang, layer} = bell();
				yield* Effect.gen(function* () {
					const ledger = yield* Ledger;
					const entries = yield* readAll("a");
					expect(entries.map((e) => [e.id, e.rev, e.pos])).toEqual([
						["w-1", 1, 1],
						["w-2", 2, 2],
						["w-3", 3, 3],
						["w-4", 4, 4],
						["w-5", 5, 5],
					]);
					expect(yield* ledger.append("a", "w-5", line())).toEqual(placed(5, 5));
					expect(yield* ledger.append("b", "w-1", line())).toEqual(placed(6, 1));
					expect(rang).toEqual([{to: READER, stream: "b", rev: 6}]);
				}).pipe(Effect.provide(onSql(nodeSql(openDb(path)), layer)));
			}),
	);

	// Live, not under TestClock: the test clock's scheduler holds a yielded fiber until the clock moves.
	// The plan asks for a yield after every op, `MaxOpsBeforeYield` 1. On effect 4.1.1, 1 hangs even a
	// plain `Effect.forEach` of three fibers and 2 never finishes it (measured 2026-11-07), so this
	// takes 3, the smallest that runs: a fiber still yields every few ops.
	it.live(
		"many writers at once, as fibers that yield every few ops, all place with no rev or pos twice",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const writes = Array.from({length: 60}, (_, i) => i);
				const answers = yield* Effect.forEach(
					writes,
					(i) => ledger.append(`s${i % 3}`, `w-${i}`, line({body: i})),
					{concurrency: "unbounded"},
				).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
				const revs = answers.map((answer) => (answer._tag === "placed" ? answer.rev : -1));
				expect([...revs].sort((x, y) => x - y)).toEqual(writes.map((i) => i + 1));
				for (const stream of ["s0", "s1", "s2"]) {
					const entries = yield* readAll(stream);
					expect(entries.map((e) => e.pos)).toEqual(Array.from({length: 20}, (_, i) => i + 1));
					expect(entries.map((e) => e.rev)).toEqual(
						[...entries.map((e) => e.rev)].sort((x, y) => x - y),
					);
				}
			}).pipe(Effect.provide(onSql(fresh()))),
	);
});

describe("p93, seen is bounded by the log's head", () => {
	it.effect(
		"seen past the head is refused seen_ahead and nothing is written; seen at the head is placed",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-1", line({seen: 1}))).toEqual(refused("seen_ahead"));
				expect(yield* ledger.append("a", "w-2", line({seen: 0}))).toEqual(placed(1, 1));
				expect(yield* ledger.append("a", "w-3", line({seen: 1}))).toEqual(placed(2, 2));
				expect(yield* ledger.append("a", "w-4", line({seen: 3}))).toEqual(refused("seen_ahead"));
				expect(yield* ledger.append("a", "w-5", line({seen: 50}))).toEqual(refused("seen_ahead"));
				expect((yield* readAll("a")).map((e) => e.id)).toEqual(["w-2", "w-3"]);
				expect(yield* ledger.append("a", "w-6", line({seen: 2}))).toEqual(placed(3, 3));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect("seen is checked against the whole log's head, not its stream's newest", () =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* ledger.append("a", "w-1", line());
			yield* ledger.append("b", "w-1", line());
			yield* ledger.append("b", "w-2", line());
			expect(yield* ledger.append("a", "w-2", line({seen: 3}))).toEqual(placed(4, 2));
			expect(yield* ledger.append("c", "w-1", line({seen: 4}))).toEqual(placed(5, 1));
			expect(yield* ledger.append("a", "w-3", line({seen: 6}))).toEqual(refused("seen_ahead"));
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	it("for any interleaving of writers, a line is placed exactly when seen is at most the head, and every entry has seen < rev (fast-check)", async () => {
		const write = fc.record({
			stream: fc.constantFrom("a", "b"),
			offset: fc.integer({min: -3, max: 2}),
		});
		await fc.assert(
			fc.asyncProperty(fc.array(write, {maxLength: 25}), (writes) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const ledger = yield* Ledger;
						let head = 0;
						for (const [i, {stream, offset}] of writes.entries()) {
							const seen = Math.max(0, head + offset);
							const answer = yield* ledger.append(stream, `w-${i}`, line({seen}));
							expect(answer).toEqual(
								seen > head ? refused("seen_ahead") : placed(head + 1, expect.any(Number)),
							);
							if (answer._tag === "placed") head = answer.rev;
						}
						const entries = [...(yield* readAll("a")), ...(yield* readAll("b"))];
						expect(entries).toHaveLength(head);
						expect(entries.filter((e) => e.seen >= e.rev)).toEqual([]);
					}).pipe(Effect.provide(onSql(fresh()))),
				),
			),
			{seed: SEED, numRuns: 60},
		);
	});
});

describe("p19, read is a lazy Stream, and arrivedAt is the referee's Clock", () => {
	it.effect("making the read Stream reads nothing, and take(1) asks for one page only", () => {
		const {sql, calls} = counting(fresh());
		const {tracer, ended} = capture();
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			for (let n = 1; n <= 300; n++) yield* ledger.append("a", `w-${n}`, line());
			const before = calls();
			const stream = ledger.read("a", 0);
			expect(calls()).toBe(before);
			expect(ended("ledger.read")).toHaveLength(0);
			const one = yield* Stream.runCollect(Stream.take(stream, 1));
			expect(one.map((e) => e.rev)).toEqual([1]);
			expect(ended("ledger.read")).toHaveLength(1);
			const all = yield* Stream.runCollect(stream);
			expect(all.map((e) => e.rev)).toEqual(Array.from({length: 300}, (_, i) => i + 1));
		}).pipe(Effect.provide(onSql(sql)), Effect.withTracer(tracer));
	});

	it.effect("arrivedAt is the Clock's time, and never goes back when the clock does", () =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const t = 1_762_549_801_311;
			yield* TestClock.setTime(t);
			yield* ledger.append("a", "w-1", line());
			yield* TestClock.adjust(Duration.millis(37));
			yield* ledger.append("b", "w-1", line());
			yield* TestClock.setTime(t - 60_000);
			yield* ledger.append("a", "w-2", line());
			yield* TestClock.setTime(t + 100);
			yield* ledger.append("a", "w-3", line());
			const a = yield* readAll("a");
			const b = yield* readAll("b");
			expect(a.map((e) => e.arrivedAt)).toEqual([t, t + 37, t + 100]);
			expect(b.map((e) => e.arrivedAt)).toEqual([t + 37]);
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect("sentAt reads back as the writer sent it, byte for byte", () =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const sent = [
				"2026-11-07T23:12:04.5+03:00",
				"07/11/2026 23:12",
				"٢٠٢٦-١١-٠٧",
				"1762549801311",
			];
			for (const [i, sentAt] of sent.entries()) yield* ledger.append("a", `w-${i}`, line({sentAt}));
			expect((yield* readAll("a")).map((e) => e.sentAt)).toEqual(sent);
		}).pipe(Effect.provide(onSql(fresh()))),
	);
});

describe("p20, failures are typed, and pass", () => {
	const page = [
		{
			id: "w-1",
			stream: "a",
			pos: 1,
			rev: 1,
			arrivedAt: 1_762_549_801_311,
			...line(),
		},
	];

	it.effect("a stub whose calls reject gives unreachable on append, read and wait", () => {
		const reject = () => Promise.reject(new Error("the object went away"));
		const stub: LedgerCalls = {append: reject, read: reject, wait: reject};
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			const errors = [
				yield* Effect.flip(ledger.append("a", "w-1", line())),
				yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
				yield* Effect.flip(ledger.wait("a", 0)),
			];
			for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
			expect(errors.map((error) => error.why)).toEqual([
				"unreachable",
				"unreachable",
				"unreachable",
			]);
		}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})));
	});

	it.effect(
		"a stub that answers what does not decode gives bad_row on append, read and wait",
		() => {
			const stub: LedgerCalls = {
				append: () => Promise.resolve({_tag: "placed", rev: "one"}),
				read: () => Promise.resolve([{id: "w-1"}]),
				wait: () => Promise.resolve({_tag: "soon"}),
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const errors = [
					yield* Effect.flip(ledger.append("a", "w-1", line())),
					yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
					yield* Effect.flip(ledger.wait("a", 0)),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual(["bad_row", "bad_row", "bad_row"]);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})));
		},
	);

	it.effect(
		"a stub that answers well is decoded, and the reader's name rides on each read and wait",
		() => {
			const asked: Array<readonly [string, string, number, string]> = [];
			const stub: LedgerCalls = {
				append: () => Promise.resolve({_tag: "placed", rev: 1, pos: 1}),
				read: (stream, after, reader) => {
					asked.push(["read", stream, after, reader]);
					return Promise.resolve(page.filter((entry) => entry.rev > after));
				},
				wait: (stream, after, reader) => {
					asked.push(["wait", stream, after, reader]);
					return Promise.resolve({_tag: "parked"});
				},
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-1", line())).toEqual(placed(1, 1));
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toEqual(page);
				expect(yield* ledger.wait("a", 1)).toEqual({_tag: "parked"});
				expect(asked[0]).toEqual(["read", "a", 0, READER]);
				expect(asked.at(-1)).toEqual(["wait", "a", 1, READER]);
				expect(asked.every(([, , , reader]) => reader === READER)).toBe(true);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})));
		},
	);

	it("a SQL throw on one call gives storage, and the next call on the same runtime works", async () => {
		const {sql, arm} = throwingOnce(fresh());
		const runtime = ManagedRuntime.make(onSql(sql));
		const append = (id: string) => Ledger.use((ledger) => ledger.append("a", id, line()));
		expect(await runtime.runPromise(append("w-1"))).toEqual(placed(1, 1));
		arm();
		const failed = await runtime.runPromise(Effect.flip(append("w-2")));
		expect(failed).toBeInstanceOf(LedgerError);
		expect(failed.why).toBe("storage");
		expect(await runtime.runPromise(append("w-3"))).toEqual(placed(2, 2));
		arm();
		const read = await runtime.runPromise(Effect.flip(readAll("a")));
		expect(read.why).toBe("storage");
		arm();
		const waited = await runtime.runPromise(
			Effect.flip(Ledger.use((ledger) => ledger.wait("a", 9))),
		);
		expect(waited.why).toBe("storage");
		expect((await runtime.runPromise(readAll("a"))).map((e) => e.id)).toEqual(["w-1", "w-3"]);
		await runtime.dispose();
	});

	it.effect.each([
		["an Error", sqliteFull()],
		["text", "disk full"],
		["a number", 13],
		["null", null],
		["undefined", undefined],
	] as const)(
		"no Layer fails at build: a Sql throwing %s still builds, and each call answers storage",
		([, thrown]) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const errors = [
					yield* Effect.flip(ledger.append("a", "w-1", line())),
					yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
					yield* Effect.flip(ledger.wait("a", 0)),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual(["storage", "storage", "storage"]);
			}).pipe(
				Effect.provide(
					onSql({
						exec: () => {
							throw thrown;
						},
						transaction: (step) => step(),
						size: () => 0,
					}),
				),
			),
	);

	it.effect(
		"a stored row that does not decode gives bad_row, not storage, on a read and on its id's resend",
		() => {
			const db = openDb(freshPath());
			// Rows the referee never wrote, planted past it straight in SQLite: one whose body is not
			// JSON, one whose `_tag` is empty. Every other column holds what an entry may hold.
			const plant = (rev: number, stream: string, id: string, kind: string, body: string) =>
				db
					.prepare(
						`INSERT INTO entries (rev, stream, pos, id, "arrivedAt", "by", "for", "sentAt", seen,
							parent, "traceId", build, "_tag", body) VALUES (?, ?, 1, ?, 0, 'SHA256:writer-a', 'owner', 'x', 0,
							NULL, ?, 'b-7c1d073', ?, ?)`,
					)
					.run(rev, stream, id, TRACE, kind, body);
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("ok", "w-1", line())).toEqual(placed(1, 1));
				plant(2, "a", "w-2", "saved", "{not json");
				plant(3, "b", "w-3", "", JSON.stringify({note: "n-7f3a"}));
				const errors = [
					yield* Effect.flip(readAll("a")),
					yield* Effect.flip(readAll("b")),
					yield* Effect.flip(ledger.append("a", "w-2", line())),
					yield* Effect.flip(ledger.append("b", "w-3", line())),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual([
					"bad_row",
					"bad_row",
					"bad_row",
					"bad_row",
				]);
				// The rows that do decode still read.
				expect((yield* readAll("ok")).map((e) => e.id)).toEqual(["w-1"]);
			}).pipe(Effect.provide(onSql(nodeSql(db))));
		},
	);

	it("a wait leaves nothing running: Effect.runSync of a parking wait answers parked", () => {
		const answer = Effect.runSync(
			Ledger.use((ledger) => ledger.wait("a", 0)).pipe(Effect.provide(onSql(fresh()))),
		);
		expect(answer).toEqual({_tag: "parked"});
	});
});

// The plan's "what this piece records": P6 gives `Sql.size()` and its Node half, page_count times
// page_size, for P37's hourly size row (how close the one object is to 10 GB; experiment 224).
describe("Sql.size on node:sqlite, the object's bytes for P37's size row", () => {
	it.effect(
		"answers the file's bytes, positive once the ledger is used, and grows with writes",
		() => {
			const path = freshPath();
			const sql = nodeSql(openDb(path));
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-0", line());
				const first = sql.size();
				expect(first).toBeGreaterThan(0);
				// With SQLite's default rollback journal, the file holds exactly page_count pages.
				expect(first).toBe(statSync(path).size);
				for (let n = 1; n <= 50; n++)
					yield* ledger.append("a", `w-${n}`, line({body: {note: "x".repeat(4_000)}}));
				const after = sql.size();
				expect(after).toBeGreaterThan(first + 50 * 4_000);
				expect(after).toBe(statSync(path).size);
			}).pipe(Effect.provide(onSql(sql)));
		},
	);
});
