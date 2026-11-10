// p94 (P6's plan writes it out; the lead commit adds it to docs/plan/tier-1-detail.md, "Properties"),
// for `data/referee.ts` and `Doorbell`: a parked wait is a row, rung once. The data half of the
// owner's 2026-11-02 call, "a wait is data". Written before the modules (Tier 1, P6, ticket 233).
//
// The shape these tests hold the modules to:
// - `Referee.wait(stream, after, reader)` answers `{_tag: "ready", rev}` with the stream's newest
//   rev when it is past `after`, or keeps one ring `{to: reader, stream, after}` in the object's own
//   SQLite and answers `{_tag: "parked"}`. A second wait by the same reader on the same stream keeps
//   one ring, with the lower `after`.
// - The append that places a rev past a ring's `after` takes the ring out in its own step, then
//   calls `Doorbell.ring(to, stream, rev)` once. A ring is at most once: one whose delivery fails is
//   gone all the same, and the append still answers `placed`. A resend or a refused line rings
//   nothing.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Deferred, Effect, Fiber, Layer} from "effect";
import {TestClock} from "effect/testing";
import {Doorbell, Ledger, LedgerError} from "./ledger.ts";
import type {Line} from "./log.ts";
import {Referee, type Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-rings-"));
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
	for (const db of opened.splice(0)) {
		if (db.isOpen) {
			db.close();
		}
	}

	rmSync(folder, {recursive: true, force: true});
});

type Rung = {readonly to: string; readonly stream: string; readonly rev: number};

/** A doorbell that writes down each ring; `fails` names the waiters whose delivery fails. */
const bell = (fails: ReadonlyArray<string> = []) => {
	const rang: Array<Rung> = [];
	const layer = Layer.succeed(Doorbell, {
		ring: (to, stream, rev) =>
			Effect.sync(() => {
				rang.push({to, stream, rev});
			}).pipe(
				Effect.andThen(
					fails.includes(to) ? Effect.fail(new LedgerError({reason: "unreachable"})) : Effect.void,
				),
			),
	});
	return {rang, layer};
};

const onReferee = (sql: Sql, doorbell: Layer.Layer<Doorbell>) =>
	Referee.layer(sql).pipe(Layer.provide(doorbell));

const onLedger = (sql: Sql, doorbell: Layer.Layer<Doorbell>, reader: string) =>
	Ledger.sql(sql, {reader}).pipe(Layer.provide(doorbell));

const line = (over: Partial<Line> = {}): Line => ({
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

const placed = (rev: number, pos: number) => ({_tag: "placed", rev, pos});
const parked = {_tag: "parked"};
const T1 = "gateway:t1";
const T2 = "gateway:t2";

const byWaiter = (rungs: ReadonlyArray<Rung>) =>
	[...rungs].sort((x, y) => `${x.to} ${x.stream}`.localeCompare(`${y.to} ${y.stream}`));

describe("p94, a parked wait is a row, rung once", () => {
	it.effect(
		"a wait with news is ready with its stream's newest rev, not the log's, and leaves no ring",
		() => {
			const {rang, layer} = bell();
			return Effect.gen(function* () {
				const referee = yield* Referee;
				yield* referee.append("a", "w-1", line());
				yield* referee.append("b", "w-1", line());
				expect(yield* referee.wait("a", 0, T1)).toEqual({_tag: "ready", rev: 1});
				expect(yield* referee.wait("b", 1, T1)).toEqual({_tag: "ready", rev: 2});
				yield* referee.append("a", "w-2", line());
				yield* referee.append("b", "w-2", line());
				expect(rang).toEqual([]);
			}).pipe(Effect.provide(onReferee(fresh(), layer)));
		},
	);

	it.effect(
		"the append that passes a parked wait rings it once with its rev, and the next rings nothing",
		() => {
			const {rang, layer} = bell();
			return Effect.gen(function* () {
				const referee = yield* Referee;
				yield* referee.append("a", "w-1", line());
				yield* referee.append("b", "w-1", line());
				yield* referee.append("b", "w-2", line());
				expect(yield* referee.wait("a", 3, T1)).toEqual(parked);
				yield* referee.append("b", "w-3", line());
				expect(rang).toEqual([]);
				expect(yield* referee.append("a", "w-2", line())).toEqual(placed(5, 2));
				expect(rang).toEqual([{to: T1, stream: "a", rev: 5}]);
				yield* referee.append("a", "w-3", line());
				expect(rang).toHaveLength(1);
			}).pipe(Effect.provide(onReferee(fresh(), layer)));
		},
	);

	it.effect("a resend and every refused line ring nothing", () => {
		const {rang, layer} = bell();
		return Effect.gen(function* () {
			const referee = yield* Referee;
			yield* referee.append("a", "w-1", line());
			expect(yield* referee.wait("a", 1, T1)).toEqual(parked);
			expect(yield* referee.append("a", "w-1", line({sentAt: "later"}))).toEqual(placed(1, 1));
			const refusals = [
				yield* referee.append("a", "w-1", line({body: "another"})),
				yield* referee.append("a", "w-2", line({seen: 9})),
				yield* referee.append("a", "w-3", {...line(), rev: 2}),
				yield* referee.append("a", "w-4", line({parent: "not an input id"})),
			];
			expect(refusals.map((answer) => answer._tag)).toEqual([
				"refused",
				"refused",
				"refused",
				"refused",
			]);
			expect(rang).toEqual([]);
			expect(yield* referee.append("a", "w-5", line())).toEqual(placed(2, 2));
			expect(rang).toEqual([{to: T1, stream: "a", rev: 2}]);
		}).pipe(Effect.provide(onReferee(fresh(), layer)));
	});

	it.effect.each([
		["lower after first", [1, 4]],
		["higher after first", [4, 1]],
	] as const)(
		"a second wait by one reader on one stream keeps one ring, with the lower after (%s)",
		([, afters]) => {
			const {rang, layer} = bell();
			return Effect.gen(function* () {
				const referee = yield* Referee;
				yield* referee.append("a", "w-1", line());

				for (const after of afters) {
					expect(yield* referee.wait("a", after, T1)).toEqual(parked);
				}

				expect(yield* referee.append("a", "w-2", line())).toEqual(placed(2, 2));
				expect(rang).toEqual([{to: T1, stream: "a", rev: 2}]);
				yield* referee.append("a", "w-3", line());
				yield* referee.append("a", "w-4", line());
				yield* referee.append("a", "w-5", line());
				expect(rang).toHaveLength(1);
			}).pipe(Effect.provide(onReferee(fresh(), layer)));
		},
	);

	it.effect("each reader and stream has its own ring", () => {
		const {rang, layer} = bell();
		return Effect.gen(function* () {
			const referee = yield* Referee;
			expect(yield* referee.wait("a", 0, T1)).toEqual(parked);
			expect(yield* referee.wait("a", 0, T2)).toEqual(parked);
			expect(yield* referee.wait("b", 0, T1)).toEqual(parked);
			yield* referee.append("a", "w-1", line());
			expect(byWaiter(rang)).toEqual([
				{to: T1, stream: "a", rev: 1},
				{to: T2, stream: "a", rev: 1},
			]);
			yield* referee.append("b", "w-1", line());
			expect(rang.slice(2)).toEqual([{to: T1, stream: "b", rev: 2}]);
		}).pipe(Effect.provide(onReferee(fresh(), layer)));
	});

	it.effect("a slow reader does not hold up another reader's ring", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const started = yield* Deferred.make<void>();
			const rang: Array<string> = [];
			const doorbell = Layer.succeed(Doorbell, {
				ring: (to) =>
					Effect.gen(function* () {
						rang.push(to);

						if (to === T1) {
							yield* Deferred.succeed(started, undefined);
							yield* Deferred.await(release);
						}
					}),
			});
			yield* Effect.gen(function* () {
				const referee = yield* Referee;
				yield* referee.wait("a", 0, T1);
				yield* referee.wait("a", 0, T2);
				const appending = yield* Effect.forkChild(referee.append("a", "w-1", line()));
				yield* Deferred.await(started);
				yield* TestClock.adjust(1);
				expect([...rang].sort()).toEqual([T1, T2]);
				yield* Deferred.succeed(release, undefined);
				expect(yield* Fiber.join(appending)).toEqual(placed(1, 1));
			}).pipe(Effect.provide(onReferee(fresh(), doorbell)));
		}),
	);

	it.effect(
		"a ring whose delivery fails is gone all the same, the others ring, and the append is placed",
		() => {
			const {rang, layer} = bell([T1]);
			return Effect.gen(function* () {
				const referee = yield* Referee;
				yield* referee.wait("a", 0, T1);
				yield* referee.wait("a", 0, T2);
				expect(yield* referee.append("a", "w-1", line())).toEqual(placed(1, 1));
				expect(byWaiter(rang)).toEqual([
					{to: T1, stream: "a", rev: 1},
					{to: T2, stream: "a", rev: 1},
				]);
				expect(yield* referee.append("a", "w-2", line())).toEqual(placed(2, 2));
				expect(rang).toHaveLength(2);
			}).pipe(Effect.provide(onReferee(fresh(), layer)));
		},
	);

	it.effect("a ring survives the file closed and opened again, and rings once there", () =>
		Effect.gen(function* () {
			const path = freshPath();
			const first = openDb(path);
			const before = bell();
			yield* Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-1", line());
				expect(yield* ledger.wait("a", 1)).toEqual(parked);
			}).pipe(Effect.provide(onLedger(nodeSql(first), before.layer, T1)));
			first.close();
			const after = bell();
			yield* Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-2", line())).toEqual(placed(2, 2));
				yield* ledger.append("a", "w-3", line());
			}).pipe(Effect.provide(onLedger(nodeSql(openDb(path)), after.layer, T2)));
			expect(before.rang).toEqual([]);
			expect(after.rang).toEqual([{to: T1, stream: "a", rev: 2}]);
		}),
	);

	it.effect("Ledger.sql parks and rings as the reader it was built for", () => {
		const {rang, layer} = bell();
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			expect(yield* ledger.wait("notes:1", 0)).toEqual(parked);
			yield* ledger.append("notes:1", "w-1", line());
			expect(rang).toEqual([{to: "process:notes:1", stream: "notes:1", rev: 1}]);
		}).pipe(Effect.provide(onLedger(fresh(), layer, "process:notes:1")));
	});
});
