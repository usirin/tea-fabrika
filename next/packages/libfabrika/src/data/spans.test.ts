// p95 (P6's plan writes it out; the lead commit adds it to docs/plan/tier-1-detail.md, "Properties"),
// for `data/referee.ts` and `data/ledger.ts`: every call is one span, with names, ids and numbers
// only. From "monitoring is in Tier 1" (owner, 2026-11-07). Written before the modules (Tier 1, P6,
// ticket 233).
//
// The shape these tests hold the modules to, from the plan's "What this piece records" and flag 9:
// - Span names: `ledger.append`, `ledger.read` (one per page the referee answers), `ledger.wait`,
//   `ledger.ring` (one per ring sent), and `ledger.call` on `Ledger.remote`'s side.
// - Tag keys: OpenTelemetry's `messaging.destination.name` (the stream), `messaging.message.id` (the
//   id) and `messaging.operation.type` (`send` for an append, `receive` for a read); `fab.ledger.*`
//   for the rest: `rev`, `pos`, `reader`, `to`, `after`, `head`, `lag`, `rows`, `visible_ms`,
//   `answer`, `why`, and, by the same rule, `tag` (the line's `_tag`), `by`, `rings` and `ok`.
// - `answer` on an append is `placed`, `resent` or `refused`; on a wait, `ready` or `parked`.
// - `lag` is how many of the stream's entries sit past `after`. A wait's `head` is its stream's newest
//   rev. `visible_ms` is the referee's clock at the answer minus the oldest returned `arrivedAt`.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Duration, Effect, Exit, Layer, Stream, Tracer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Doorbell, Ledger, LedgerError, type LedgerCalls} from "./ledger.ts";
import type {Line} from "./log.ts";
import {Referee, type Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-spans-"));
const opened: Array<DatabaseSync> = [];
let files = 0;

const freshDb = (): DatabaseSync => {
	const db = new DatabaseSync(join(folder, `ledger-${++files}.db`));
	opened.push(db);
	return db;
};

const fresh = (): Sql => nodeSql(freshDb());

afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

const READER = "gateway:t1";
const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});

/** A doorbell whose delivery to `fails` fails, as a gateway that went away would. */
const failing = (fails: string) =>
	Layer.succeed(Doorbell, {
		ring: (to) => (to === fails ? Effect.fail(new LedgerError({why: "unreachable"})) : Effect.void),
	});

const onSql = (sql: Sql, doorbell: Layer.Layer<Doorbell> = quiet) =>
	Ledger.sql(sql, {reader: READER}).pipe(Layer.provide(doorbell));

const BODY = "body-marker-7c1d";
const SENT = "sent-marker-2026-11-07T21:10:01.204Z";

const line = (over: Partial<Line> = {}): Line => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: SENT,
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: BODY, base: 3},
	...over,
});

/** A tracer that keeps every span it makes; `ended(name)` gives each one that ended, with its tags. */
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
	const tags = (name: string): ReadonlyArray<Record<string, unknown>> =>
		ended(name).map((span) => Object.fromEntries(span.attributes));
	const failed = (name: string): ReadonlyArray<boolean> =>
		ended(name).map((span) => span.status._tag === "Ended" && Exit.isFailure(span.status.exit));
	const all = () => spans.flatMap((span) => [...span.attributes.values()]);
	return {tracer, ended, tags, failed, all};
};

const STREAM = "messaging.destination.name";
const ID = "messaging.message.id";
const OP = "messaging.operation.type";
const ERROR = "error.type";
const tag = (name: string) => `fab.ledger.${name}`;

/** The longest text a span tag may hold (p95). */
const MOST = 128;
/** Text a writer or caller hands in may be any length: short, or far past what a tag may hold. Its
 *  letters cannot spell a SQL word or a marker, so the checks on tags below stay about length. */
const letters = fc.constantFrom("a", "b", "7", ":", "-", "_", "é");
const shortText = fc.string({unit: letters, minLength: 1, maxLength: MOST});
const longText = fc.string({unit: letters, minLength: MOST + 1, maxLength: 4096});
const anyText = fc.oneof({arbitrary: longText, weight: 3}, {arbitrary: shortText, weight: 1});

/**
 * A tag that took text from the caller: as it was when it fits, else cut to at most 128 characters
 * with the full length kept beside it as a number, `<key>.length`.
 */
const heldShort = (span: Record<string, unknown>, key: string, full: string) => {
	if (full.length <= MOST) {
		expect(span[key], key).toBe(full);
		return;
	}
	expect(typeof span[key], key).toBe("string");
	expect(String(span[key]).length, key).toBeLessThanOrEqual(MOST);
	expect(span[`${key}.length`], `${key}.length`).toBe(full.length);
};

describe("p95, every call is one span, names and numbers only", () => {
	it.effect("each append, read, wait and ring ends one span of its name, with its tags", () => {
		const {tracer, tags} = capture();
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* TestClock.setTime(1_762_549_801_000);
			yield* ledger.append("notes:1", "w-1", line());
			yield* ledger.append("other", "w-1", line());
			yield* ledger.append("notes:1", "w-2", line());
			yield* ledger.append("other", "w-2", line());
			// The log's head is 4; notes:1's newest is 3, and the reader has read up to 3.
			expect(yield* ledger.wait("notes:1", 3)).toEqual({_tag: "parked"});
			expect(tags("ledger.wait")).toEqual([
				expect.objectContaining({
					[STREAM]: "notes:1",
					[tag("reader")]: READER,
					[tag("after")]: 3,
					[tag("head")]: 3,
					[tag("lag")]: 0,
					[tag("answer")]: "parked",
				}),
			]);
			expect(yield* ledger.append("notes:1", "w-9", line({seen: 4}))).toEqual({
				_tag: "placed",
				rev: 5,
				pos: 3,
			});
			expect(tags("ledger.append")).toHaveLength(5);
			expect(tags("ledger.append")[4]).toEqual(
				expect.objectContaining({
					[STREAM]: "notes:1",
					[ID]: "w-9",
					[OP]: "send",
					[tag("tag")]: "saved",
					[tag("by")]: "SHA256:writer-a",
					[tag("answer")]: "placed",
					[tag("rev")]: 5,
					[tag("pos")]: 3,
					[tag("rings")]: 1,
				}),
			);
			expect(tags("ledger.ring")).toEqual([
				expect.objectContaining({
					[STREAM]: "notes:1",
					[tag("to")]: READER,
					[tag("after")]: 3,
					[tag("rev")]: 5,
					[tag("ok")]: true,
				}),
			]);
			yield* TestClock.adjust(Duration.millis(37));
			const read = yield* Stream.runCollect(ledger.read("notes:1", 3));
			expect(read.map((entry) => entry.id)).toEqual(["w-9"]);
			expect(tags("ledger.read")).toEqual([
				expect.objectContaining({
					[STREAM]: "notes:1",
					[OP]: "receive",
					[tag("reader")]: READER,
					[tag("after")]: 3,
					[tag("head")]: expect.any(Number),
					[tag("lag")]: 1,
					[tag("rows")]: 1,
					[tag("visible_ms")]: 37,
				}),
			]);
			expect(yield* ledger.wait("notes:1", 3)).toEqual({_tag: "ready", rev: 5});
			expect(tags("ledger.wait")[1]).toEqual(
				expect.objectContaining({
					[tag("head")]: 5,
					[tag("lag")]: 1,
					[tag("answer")]: "ready",
				}),
			);
			expect(tags("ledger.append")).toHaveLength(5);
			expect(tags("ledger.read")).toHaveLength(1);
			expect(tags("ledger.wait")).toHaveLength(2);
			expect(tags("ledger.ring")).toHaveLength(1);
		}).pipe(Effect.provide(onSql(fresh())), Effect.withTracer(tracer));
	});

	it.effect(
		"a resend and each refusal still end one ledger.append span, with answer and why",
		() => {
			const {tracer, tags} = capture();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const referee = yield* Referee;
				yield* ledger.append("a", "w-1", line());
				yield* ledger.append("a", "w-1", line({sentAt: "later"}));
				yield* ledger.append("a", "w-1", line({body: "another"}));
				yield* ledger.append("a", "w-2", line({seen: 50}));
				yield* referee.append("a", "w-3", {...line(), arrivedAt: 1});
				yield* referee.append("a", "w-4", line({parent: "not an input id"}));
				expect(tags("ledger.append").map((t) => [t[ID], t[tag("answer")], t[tag("why")]])).toEqual([
					["w-1", "placed", undefined],
					["w-1", "resent", undefined],
					["w-1", "refused", "id_reused"],
					["w-2", "refused", "seen_ahead"],
					["w-3", "refused", "bad_line"],
					["w-4", "refused", "bad_parent"],
				]);
			}).pipe(
				Effect.provide(
					Layer.merge(onSql(fresh()), Referee.layer(fresh()).pipe(Layer.provide(quiet))),
				),
				Effect.withTracer(tracer),
			);
		},
	);

	it.effect("lag counts the stream's entries past after, not the log's revs", () => {
		const {tracer, tags} = capture();
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			for (const n of [1, 2, 3]) {
				yield* ledger.append("a", `a-${n}`, line());
				yield* ledger.append("b", `b-${n}`, line());
			}
			// a holds revs 1, 3 and 5. Past rev 1 sit two of them; the log's head is five past it.
			yield* Stream.runCollect(ledger.read("a", 1));
			yield* ledger.wait("a", 1);
			expect(tags("ledger.read").map((t) => [t[tag("lag")], t[tag("rows")]])).toEqual([[2, 2]]);
			expect(tags("ledger.wait").map((t) => [t[tag("lag")], t[tag("head")]])).toEqual([[2, 5]]);
		}).pipe(Effect.provide(onSql(fresh())), Effect.withTracer(tracer));
	});

	it.effect(
		"visible_ms is the clock at the answer minus the oldest returned entry's arrivedAt",
		() => {
			const {tracer, tags} = capture();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* TestClock.setTime(1_000_000);
				yield* ledger.append("a", "w-1", line({sentAt: "2026-11-07T21:10:01.204Z"}));
				yield* TestClock.adjust(Duration.millis(10));
				yield* ledger.append("a", "w-2", line({sentAt: "1970-01-01T00:00:00.000Z"}));
				yield* TestClock.adjust(Duration.millis(27));
				yield* Stream.runCollect(ledger.read("a", 0));
				yield* Stream.runCollect(ledger.read("a", 1));
				expect(tags("ledger.read").map((t) => t[tag("visible_ms")])).toEqual([37, 27]);
			}).pipe(Effect.provide(onSql(fresh())), Effect.withTracer(tracer));
		},
	);

	it.effect("a read makes one span per page: fewer than 256 entries are one, 300 are two", () => {
		const {tracer, tags} = capture();
		return Effect.gen(function* () {
			const ledger = yield* Ledger;
			for (let n = 1; n <= 300; n++) yield* ledger.append("a", `w-${n}`, line());
			yield* Stream.runCollect(ledger.read("a", 100));
			expect(tags("ledger.read").map((t) => t[tag("rows")])).toEqual([200]);
			yield* Stream.runCollect(ledger.read("a", 0));
			expect(
				tags("ledger.read")
					.map((t) => t[tag("rows")])
					.slice(1, 3),
			).toEqual([256, 44]);
		}).pipe(Effect.provide(onSql(fresh())), Effect.withTracer(tracer));
	});

	it("for any stream, id, _tag, by and reader, short or long, no tag holds the body, sentAt, SQL text, or a string over 128 characters (fast-check)", async () => {
		const names = fc.record({
			stream: anyText,
			id: anyText,
			kind: anyText,
			by: anyText,
			reader: anyText,
		});
		type Names = typeof names extends fc.Arbitrary<infer N> ? N : never;
		const run = ({stream, id, kind, by, reader}: Names) => {
			const {tracer, all, tags} = capture();
			const named = (over: Partial<Line> = {}) => line({_tag: kind, by, ...over});
			return Effect.runPromise(
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					yield* ledger.wait(stream, 0);
					yield* ledger.append(stream, id, named());
					yield* ledger.append(stream, id, named());
					yield* ledger.append(stream, id, named({body: {note: `${BODY}-2`}}));
					yield* ledger.append(stream, `${id}2`, named({seen: 9}));
					yield* Stream.runCollect(ledger.read(stream, 0));
					yield* ledger.wait(stream, 0);
					expect(tags("ledger.ring")).toHaveLength(1);
					const texts = all()
						.filter((value) => typeof value === "string")
						.map((value) => String(value));
					expect(texts.length).toBeGreaterThan(0);
					expect(
						texts.filter((text) => text.includes(BODY) || text.includes("sent-marker")),
					).toEqual([]);
					expect(
						texts.filter((text) => /\b(select|insert|update|delete|create)\b/i.test(text)),
					).toEqual([]);
					expect(texts.filter((text) => text.length > MOST).map((text) => text.length)).toEqual([]);
				}).pipe(
					Effect.provide(Ledger.sql(fresh(), {reader}).pipe(Layer.provide(quiet))),
					Effect.withTracer(tracer),
				),
			);
		};
		await fc.assert(fc.asyncProperty(names, run), {
			seed: SEED,
			numRuns: 30,
			// The case this test held before it took generated names.
			examples: [[{stream: "a", id: "w-1", kind: "saved", by: "SHA256:writer-a", reader: READER}]],
		});
	});

	it.effect(
		"a 1.9 MB id and a 200-character _tag are placed, and their tags hold at most 128 characters with the full length beside",
		() => {
			const {tracer, tags} = capture();
			const id = "x".repeat(1_900_000);
			const kind = "t".repeat(200);
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("notes:1", id, line({_tag: kind}))).toEqual({
					_tag: "placed",
					rev: 1,
					pos: 1,
				});
				const [span = {}] = tags("ledger.append");
				heldShort(span, ID, id);
				heldShort(span, tag("tag"), kind);
				heldShort(span, STREAM, "notes:1");
			}).pipe(Effect.provide(onSql(fresh())), Effect.withTracer(tracer));
		},
	);

	it("for any long stream, id, _tag, by and reader, every span on both sides cuts its tags to 128 characters and keeps each full length as <key>.length (fast-check)", async () => {
		const names = fc.record({
			stream: anyText,
			id: anyText,
			kind: anyText,
			by: anyText,
			reader: anyText,
		});
		type Names = typeof names extends fc.Arbitrary<infer N> ? N : never;
		const run = ({stream, id, kind, by, reader}: Names) => {
			const {tracer, tags} = capture();
			const one = (name: string) => {
				const found = tags(name);
				expect(found, name).toHaveLength(1);
				return found[0] ?? {};
			};
			const referee = Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.wait(stream, 0)).toEqual({_tag: "parked"});
				expect(yield* ledger.append(stream, id, line({_tag: kind, by}))).toEqual({
					_tag: "placed",
					rev: 1,
					pos: 1,
				});
				expect((yield* Stream.runCollect(ledger.read(stream, 0))).map((e) => e.id)).toEqual([id]);
				const append = one("ledger.append");
				heldShort(append, STREAM, stream);
				heldShort(append, ID, id);
				heldShort(append, tag("tag"), kind);
				heldShort(append, tag("by"), by);
				const wait = one("ledger.wait");
				heldShort(wait, STREAM, stream);
				heldShort(wait, tag("reader"), reader);
				const ring = one("ledger.ring");
				heldShort(ring, STREAM, stream);
				heldShort(ring, tag("to"), reader);
				const read = one("ledger.read");
				heldShort(read, STREAM, stream);
				heldShort(read, tag("reader"), reader);
			}).pipe(
				Effect.provide(Ledger.sql(fresh(), {reader}).pipe(Layer.provide(quiet))),
				Effect.withTracer(tracer),
			);
			// The caller's side: `Ledger.remote`'s `ledger.call` span takes the stream and the reader too.
			const {tracer: callTracer, tags: callTags} = capture();
			const stub: LedgerCalls = {
				append: () => Promise.resolve({_tag: "placed", rev: 1, pos: 1}),
				read: () => Promise.resolve([]),
				wait: () => Promise.resolve({_tag: "parked"}),
			};
			const remote = Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append(stream, id, line({_tag: kind, by}));
				yield* Stream.runCollect(ledger.read(stream, 0));
				yield* ledger.wait(stream, 0);
				const calls = callTags("ledger.call");
				expect(calls).toHaveLength(3);
				for (const call of calls) {
					heldShort(call, STREAM, stream);
					heldShort(call, tag("reader"), reader);
				}
			}).pipe(Effect.provide(Ledger.remote(stub, {reader})), Effect.withTracer(callTracer));
			return Effect.runPromise(Effect.andThen(referee, remote));
		};
		await fc.assert(fc.asyncProperty(names, run), {seed: SEED, numRuns: 30});
	});

	it.effect(
		"a storage failure's span fails, holds the SQLite error code, and its message in no tag",
		() => {
			const {tracer, tags, failed, all} = capture();
			const message = "database or disk is full: message-marker";
			const full = Object.assign(new Error(message), {
				code: "ERR_SQLITE_ERROR",
				errcode: 13,
				errstr: "database or disk is full",
			});
			const broken: Sql = {
				exec: () => {
					throw full;
				},
				transaction: () => {
					throw full;
				},
				size: () => {
					throw full;
				},
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const error = yield* Effect.flip(ledger.append("a", "w-1", line()));
				expect(error.why).toBe("storage");
				expect(failed("ledger.append")).toEqual([true]);
				const values = Object.values(tags("ledger.append")[0] ?? {});
				expect(values.some((value) => value === full.code || value === full.errcode)).toBe(true);
				expect(all().filter((value) => String(value).includes("message-marker"))).toEqual([]);
			}).pipe(Effect.provide(onSql(broken)), Effect.withTracer(tracer));
		},
	);

	it.effect(
		"a storage failure tags each call's span with fab.ledger.why, fab.ledger.code and error.type",
		() => {
			const {tracer, tags} = capture();
			const full = Object.assign(new Error("database or disk is full"), {
				code: "ERR_SQLITE_ERROR",
				errcode: 13,
			});
			const broken: Sql = {
				exec: () => {
					throw full;
				},
				transaction: () => {
					throw full;
				},
				size: () => {
					throw full;
				},
			};
			const keys = {[tag("why")]: "storage", [tag("code")]: 13, [ERROR]: "Error"};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* Effect.flip(ledger.append("a", "w-1", line()));
				yield* Effect.flip(Stream.runCollect(ledger.read("a", 0)));
				yield* Effect.flip(ledger.wait("a", 0));
				expect(tags("ledger.append")).toEqual([expect.objectContaining(keys)]);
				expect(tags("ledger.read")).toEqual([expect.objectContaining(keys)]);
				expect(tags("ledger.wait")).toEqual([expect.objectContaining(keys)]);
			}).pipe(Effect.provide(onSql(broken)), Effect.withTracer(tracer));
		},
	);

	it.effect(
		"a storage failure with no SQLite code tags its class as error.type and no fab.ledger.code",
		() => {
			const {tracer, tags} = capture();
			const odd: Sql = {
				exec: () => {
					throw new TypeError("a blob column, which the ledger never writes");
				},
				transaction: (step) => step(),
				size: () => 0,
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const error = yield* Effect.flip(ledger.append("a", "w-1", line()));
				expect(error.why).toBe("storage");
				const [span = {}] = tags("ledger.append");
				expect(span).toEqual(
					expect.objectContaining({[tag("why")]: "storage", [ERROR]: "TypeError"}),
				);
				expect(Object.keys(span)).not.toContain(tag("code"));
			}).pipe(Effect.provide(onSql(odd)), Effect.withTracer(tracer));
		},
	);

	it.effect(
		"a full disk on node:sqlite keeps SQLite's own code, 13, in the span, not the code of a ROLLBACK SQLite already did",
		() => {
			const {tracer, tags, failed} = capture();
			const db = freshDb();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-1", line())).toEqual({_tag: "placed", rev: 1, pos: 1});
				// No page past the ones there now: the next big row fails with SQLITE_FULL, and SQLite rolls
				// the whole transaction back by itself, so a ROLLBACK after it finds none.
				const {page_count: pages} = db.prepare("PRAGMA page_count").get() ?? {};
				db.exec(`PRAGMA max_page_count = ${Number(pages)}`);
				const error = yield* Effect.flip(
					ledger.append("a", "w-2", line({body: {note: "y".repeat(100_000)}})),
				);
				expect(error).toBeInstanceOf(LedgerError);
				expect(error.why).toBe("storage");
				expect(failed("ledger.append")).toEqual([false, true]);
				expect(tags("ledger.append")[1]?.[tag("code")]).toBe(13);
				expect(tags("ledger.append")[1]).toEqual(
					expect.objectContaining({[tag("why")]: "storage"}),
				);
				expect(error.message ?? "").not.toMatch(/no transaction is active/);
				// With room again, the failed step left nothing behind and the next append is placed.
				db.exec("PRAGMA max_page_count = 1073741823");
				expect(yield* ledger.append("a", "w-3", line())).toEqual({_tag: "placed", rev: 2, pos: 2});
			}).pipe(Effect.provide(onSql(nodeSql(db))), Effect.withTracer(tracer));
		},
	);

	/** A doorbell whose ring to `dies` dies with a defect, as a thin class that throws would. */
	class BellBroke extends Error {
		override readonly name = "BellBroke";
	}
	const DIES = "gateway:dies";
	const dying = (how: "inside" | "outside", rang: Array<string>) =>
		Layer.succeed(Doorbell, {
			ring: (to) => {
				if (to !== DIES) {
					return Effect.sync(() => {
						rang.push(to);
					});
				}
				// "inside": a sync throw inside the ring's Effect. "outside": a throw before any Effect.
				if (how === "outside") throw new BellBroke("message-marker");
				return Effect.sync(() => {
					throw new BellBroke("message-marker");
				});
			},
		});

	for (const how of ["inside", "outside"] as const) {
		it.effect(
			`a ring that dies with a defect (a sync throw ${how} its Effect) leaves the append placed, its span failed with ok false, and the other ring rung`,
			() => {
				const {tracer, tags, ended, all} = capture();
				const rang: Array<string> = [];
				return Effect.gen(function* () {
					const referee = yield* Referee;
					expect(yield* referee.wait("a", 0, DIES)).toEqual({_tag: "parked"});
					expect(yield* referee.wait("a", 0, READER)).toEqual({_tag: "parked"});
					const exit = yield* Effect.exit(referee.append("a", "w-1", line()));
					expect(exit).toEqual(Exit.succeed({_tag: "placed", rev: 1, pos: 1}));
					expect(rang).toEqual([READER]);
					const rings = ended("ledger.ring");
					expect(rings).toHaveLength(2);
					const died = rings.find((span) => span.attributes.get(tag("to")) === DIES);
					const rung = rings.find((span) => span.attributes.get(tag("to")) === READER);
					expect(died?.status._tag === "Ended" && Exit.isFailure(died.status.exit)).toBe(true);
					expect(Object.fromEntries(died?.attributes ?? [])).toEqual(
						expect.objectContaining({[tag("ok")]: false, [ERROR]: "BellBroke"}),
					);
					expect(rung?.attributes.get(tag("ok"))).toBe(true);
					expect(tags("ledger.append")).toEqual([
						expect.objectContaining({[tag("answer")]: "placed", [tag("rings")]: 2}),
					]);
					expect(all().filter((value) => String(value).includes("message-marker"))).toEqual([]);
				}).pipe(
					Effect.provide(Referee.layer(fresh()).pipe(Layer.provide(dying(how, rang)))),
					Effect.withTracer(tracer),
				);
			},
		);
	}

	it.effect(
		"a ring whose delivery fails ends its span with ok false and the error's class; the append is placed",
		() => {
			const {tracer, tags} = capture();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.wait("a", 0);
				expect(yield* ledger.append("a", "w-1", line())).toEqual({_tag: "placed", rev: 1, pos: 1});
				const rings = tags("ledger.ring");
				expect(rings).toHaveLength(1);
				expect(rings[0]).toEqual(
					expect.objectContaining({[tag("to")]: READER, [tag("ok")]: false}),
				);
				expect(Object.values(rings[0] ?? {})).toContain("LedgerError");
				expect(rings[0]).toEqual(expect.objectContaining({[ERROR]: "LedgerError"}));
				expect(tags("ledger.append")[0]).toEqual(
					expect.objectContaining({[tag("answer")]: "placed", [tag("rings")]: 1}),
				);
			}).pipe(Effect.provide(onSql(fresh(), failing(READER))), Effect.withTracer(tracer));
		},
	);

	it.effect(
		"Ledger.remote ends one ledger.call span per call, failed with its why when the call fails",
		() => {
			const {tracer, tags, failed} = capture();
			const reject = () => Promise.reject(new Error("the object went away"));
			const stub: LedgerCalls = {
				append: () => Promise.resolve({_tag: "placed", rev: 1, pos: 1}),
				read: reject,
				wait: () => Promise.resolve({_tag: "soon"}),
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-1", line());
				yield* Effect.flip(Stream.runCollect(ledger.read("a", 0)));
				yield* Effect.flip(ledger.wait("a", 0));
				const calls = tags("ledger.call");
				expect(calls).toHaveLength(3);
				expect(failed("ledger.call")).toEqual([false, true, true]);
				expect(calls.map((t) => t[tag("reader")])).toEqual([READER, READER, READER]);
				expect(calls.map((t) => t[tag("why")])).toEqual([undefined, "unreachable", "bad_row"]);
				expect(calls.map((t) => Object.values(t))).toEqual([
					expect.arrayContaining(["append"]),
					expect.arrayContaining(["read"]),
					expect.arrayContaining(["wait"]),
				]);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})), Effect.withTracer(tracer));
		},
	);
});
