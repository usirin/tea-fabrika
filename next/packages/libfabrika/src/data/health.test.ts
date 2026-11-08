// p99 (P37's plan writes it out; the lead commit adds it to docs/plan/tier-1-detail.md,
// "Properties"), for `data/health.ts` and `data/archive.ts`: health in two levels, and no raw row is
// ever lost. From "design for bounded objects" and "monitoring is in Tier 1" (owner, 2026-11-07),
// and the owner's archive answer (each object writes its own R2 files). Written before the modules
// (Tier 1, P37, ticket 238).
//
// The shape these tests hold the modules to, from the plan:
// - Every span that ends writes a raw `health` row (piece, at, ms, ok, error, lag), `at` in ms on the
//   object's Clock. Hours and days are UTC.
// - The first span of an hour past the newest `summarized` hour rolls up every closed hour that has
//   health rows: one `summary` row per piece and hour, and the hour into `summarized`. A summary's
//   `hour` is the ms at that hour's start. p50 and p95 are nearest rank over the hour's `ms`, `max`
//   the largest, `errors` the failed ones, `lag` the largest numeric tag whose key ends in `.lag`
//   (null when none). `SpanSink.summaries(from, to)` rolls up closed hours first, never the open one.
// - A `sizes` row `{at, bytes}` from `Sql.size()`, at most once an hour, only in a span's `end`.
// - `flush` archives each UTC day whose hours with health rows are all `summarized` and that is
//   older than 336 hours: one file `health/<object>/<yyyy-mm-dd>.jsonl` of its rows as JSON lines,
//   through `Archive.put`. Only when the stored SHA-256 (hex) matches its own does it write
//   `archived (day, key, sha256, rows)` and delete that day's rows. Summaries, sizes and `archived`
//   rows are never deleted. R2 here is a memory fake behind our own `BucketCalls`.
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Archive, type BucketCalls} from "./archive.ts";
import {RecordManager} from "./records.ts";
import type {Sql} from "./referee.ts";
import {SinkError, SpanSink} from "./sink.ts";
import {nodeSql} from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const folder = mkdtempSync(join(tmpdir(), "p37-health-"));
const opened: Array<DatabaseSync> = [];
let files = 0;
const fresh = () => {
	const db = new DatabaseSync(join(folder, `object-${++files}.db`));
	opened.push(db);
	return {db, sql: nodeSql(db)};
};
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

const OBJECT = "process_01JC9Q4W7Z3M8N5R2T6V0XKB4D";
const H = 3_600_000;
const DAY = 24 * H;
const KEEP = 336 * H;
/** 2026-10-23 00:00 UTC, the plan's traced day. */
const D = Date.UTC(2026, 9, 23);
const hourStart = (at: number) => Math.floor(at / H) * H;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const fileKey = (day: string) => `health/${OBJECT}/${day}.jsonl`;

const hex = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
/** R2 in memory, as its binding behaves: `put` fails when the body does not match its SHA-256.
 *  `lie` makes `head` answer another hash, as a bad copy would. */
const bucket = (lie = false) => {
	const stored = new Map<string, Uint8Array>();
	const puts: Array<string> = [];
	const calls: BucketCalls = {
		put: (key, body, sha256) => {
			puts.push(key);
			if (hex(body) !== sha256) return Promise.reject(new Error("checksum mismatch"));
			stored.set(key, body.slice());
			return Promise.resolve();
		},
		head: (key) => {
			const body = stored.get(key);
			return Promise.resolve(
				body === undefined ? null : {sha256: lie ? "0".repeat(64) : hex(body)},
			);
		},
	};
	const lines = (key: string): Array<Record<string, unknown>> =>
		new TextDecoder()
			.decode(stored.get(key))
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	return {calls, stored, puts, lines};
};

const world = (sql: Sql, archive: Layer.Layer<Archive> = Archive.memory) =>
	Layer.mergeAll(
		SpanSink.layer(sql, {object: OBJECT}),
		RecordManager.memory(1024 * 1024 * 1024),
		archive,
	);

const flush = SpanSink.use((sink) => sink.flush);
const summaries = SpanSink.use((sink) => sink.summaries(0, Number.MAX_SAFE_INTEGER));

/** One span named `piece` that starts at `at`, lasts `ms` on the TestClock, and fails unless `ok`. */
const span = (
	piece: string,
	at: number,
	ms = 1,
	ok = true,
	attributes: Record<string, unknown> = {},
) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(at);
		yield* Effect.exit(
			TestClock.adjust(ms).pipe(
				Effect.andThen(ok ? Effect.void : Effect.fail(new Error("p99"))),
				Effect.withSpan(piece, {attributes}),
			),
		);
	});

const count = (db: DatabaseSync, table: string, where = "1"): number =>
	Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get()?.["n"]);
const inDay = (day: number) => `at >= ${day} AND at < ${day + DAY}`;

type Raw = {
	readonly piece: string;
	readonly hour: number;
	readonly ms: number;
	readonly ok: boolean;
};
const key = (r: Raw) => `${r.piece} ${r.hour} ${r.ms} ${r.ok}`;
const raw = (row: Record<string, unknown>): Raw => ({
	piece: String(row["piece"]),
	hour: hourStart(Number(row["at"])),
	ms: Number(row["ms"]),
	ok: Boolean(row["ok"]),
});

/** The rollup the summaries must match, worked out from the raw spans. */
const rollup = (spans: ReadonlyArray<Raw & {readonly lag: number | null}>) => {
	const groups = new Map<string, Array<Raw & {readonly lag: number | null}>>();
	for (const s of spans)
		groups.set(`${s.piece} ${s.hour}`, [...(groups.get(`${s.piece} ${s.hour}`) ?? []), s]);
	return [...groups.values()]
		.map((group) => {
			const ms = group.map((s) => s.ms).sort((x, y) => x - y);
			const n = ms.length;
			const lags = group.flatMap((s) => (s.lag === null ? [] : [s.lag]));
			return {
				_tag: "summary",
				piece: group[0]?.piece,
				hour: group[0]?.hour,
				count: n,
				errors: group.filter((s) => !s.ok).length,
				// Nearest rank, in integers so no float rounding moves a rank.
				ms: {p50: ms[Math.ceil(n / 2) - 1], p95: ms[Math.ceil((95 * n) / 100) - 1], max: ms[n - 1]},
				lag: lags.length === 0 ? null : Math.max(...lags),
			};
		})
		.sort(bySummary);
};
type Placed = {readonly piece: string | undefined; readonly hour: number | undefined};
const bySummary = (x: Placed, y: Placed) =>
	`${x.piece} ${String(x.hour).padStart(16, "0")}`.localeCompare(
		`${y.piece} ${String(y.hour).padStart(16, "0")}`,
	);

const PIECES = ["runner.step", "ledger.call", "door.envelope"] as const;

describe("p99, health in two levels", () => {
	it("each summary's count, errors, p50, p95, max and lag match the raw rows", async () => {
		const one = fc.record({
			piece: fc.constantFrom(...PIECES),
			gap: fc.integer({min: 0, max: 5 * H}),
			ms: fc.integer({min: 0, max: 900}),
			ok: fc.boolean(),
			lag: fc.option(fc.integer({min: 0, max: 500}), {nil: undefined}),
			doorLag: fc.option(fc.integer({min: 0, max: 500}), {nil: undefined}),
			decoy: fc.boolean(),
		});
		await fc.assert(
			fc.asyncProperty(fc.array(one, {minLength: 1, maxLength: 40}), (made) => {
				const {sql} = fresh();
				return Effect.runPromise(
					Effect.gen(function* () {
						const spans: Array<Raw & {lag: number | null}> = [];
						let t = D;
						for (const s of made) {
							let start = t + s.gap;
							// A span stays inside one hour, so its hour is plain.
							if (hourStart(start) !== hourStart(start + s.ms)) start = hourStart(start) + H;
							const attributes: Record<string, unknown> = {
								...(s.lag === undefined ? {} : {"fab.ledger.lag": s.lag}),
								...(s.doorLag === undefined ? {} : {"fab.door.lag": s.doorLag}),
								// Keys that are not `.lag`, or `.lag` with no number: never the lag.
								...(s.decoy
									? {"fab.ledger.flag": 9_999, "fab.lagging": 8_888, "fab.text.lag": "7777"}
									: {}),
							};
							yield* span(s.piece, start, s.ms, s.ok, attributes);
							const lags = [s.lag, s.doorLag].filter((x) => x !== undefined);
							spans.push({
								piece: s.piece,
								hour: hourStart(start),
								ms: s.ms,
								ok: s.ok,
								lag: lags.length ? Math.max(...lags) : null,
							});
							t = start + s.ms;
						}
						// A span in a later hour; its own hour stays open, so no summary has it.
						yield* span("closing", hourStart(t) + 2 * H + 1);
						expect([...(yield* summaries)].sort(bySummary)).toEqual(rollup(spans));
					}).pipe(Effect.provide(world(sql)), Effect.provide(TestClock.layer())),
				);
			}),
			{seed: SEED, numRuns: 30},
		);
	});

	it.effect(
		"an object that sleeps rolls up at its next span; summaries rolls up closed hours first, never the open one",
		() => {
			const {db, sql} = fresh();
			const at = (hour: number, minute: number) => D + hour * H + minute * 60_000;
			return Effect.gen(function* () {
				yield* span("runner.step", at(0, 10), 3);
				yield* span("runner.step", at(0, 20), 5);
				expect(count(db, "summary"), "hour 0 is open").toBe(0);
				// Asleep through hours 1 to 3: the first span of hour 4 rolls hour 0 up, in its own end.
				yield* span("runner.step", at(4, 1), 7);
				expect(count(db, "summary", `hour = ${at(0, 0)}`)).toBe(1);
				expect(count(db, "summarized", `hour = ${at(0, 0)}`)).toBe(1);
				yield* span("ledger.call", at(5, 1), 2);
				expect(count(db, "summary", `hour = ${at(5, 0)}`)).toBe(0);
				// No span in hour 9: summaries rolls up hour 5, now closed, before it answers.
				yield* TestClock.setTime(at(9, 10));
				const answered = yield* summaries;
				expect(answered.map((s) => [s.piece, s.hour, s.count]).sort()).toEqual(
					[
						["ledger.call", at(5, 0), 1],
						["runner.step", at(0, 0), 2],
						["runner.step", at(4, 0), 1],
					].sort(),
				);
				yield* span("runner.step", at(9, 11), 1);
				expect(
					(yield* summaries).some((s) => s.hour === at(9, 0)),
					"the open hour is never rolled up",
				).toBe(false);
				yield* span("runner.step", at(9, 40), 1);
				yield* span("runner.step", at(10, 1), 1);
				const nine = (yield* summaries).find((s) => s.hour === at(9, 0));
				expect(nine?.count, "hour 9 rolled up once it closed, with both its spans").toBe(2);
			}).pipe(Effect.provide(world(sql)));
		},
	);

	it.effect("a size row at most once an hour, only in a span's end, from Sql.size()", () => {
		const {db, sql: real} = fresh();
		const read: Array<number> = [];
		const sql: Sql = {
			...real,
			size: () => {
				const bytes = real.size();
				read.push(bytes);
				return bytes;
			},
		};
		return Effect.gen(function* () {
			for (let hour = 0; hour < 3; hour++) {
				for (let n = 0; n < 20; n++) yield* span("runner.step", D + hour * H + n * 60_000, 1);
			}
			const rows = db.prepare(`SELECT at, bytes FROM sizes`).all();
			const perHour = new Map<number, number>();
			for (const row of rows)
				perHour.set(
					hourStart(Number(row["at"])),
					(perHour.get(hourStart(Number(row["at"]))) ?? 0) + 1,
				);
			expect(
				[...perHour.values()].every((n) => n === 1),
				"never two in one hour",
			).toBe(true);
			expect(perHour.get(D + H)).toBe(1);
			expect(perHour.get(D + 2 * H)).toBe(1);
			for (const row of rows) expect(read).toContain(Number(row["bytes"]));
			const before = count(db, "sizes");
			yield* TestClock.setTime(D + 8 * H);
			yield* flush;
			yield* summaries;
			expect(count(db, "sizes"), "flush and summaries write no size row").toBe(before);
		}).pipe(Effect.provide(world(sql)));
	});
});

describe("p99, a size row per hour across processes", () => {
	it.effect(
		"a new process in the same hour writes no second size row; the next hour gets its own",
		() => {
			const {db, sql} = fresh();
			// The first span ends exactly on the hour's first ms, the edge of the hour's range.
			const first = span("runner.step", D + H - 1, 1).pipe(Effect.provide(world(sql)));
			const later = Effect.gen(function* () {
				yield* span("runner.step", D + H + 50 * 60_000, 1);
				yield* span("runner.step", D + 2 * H + 30 * 60_000, 1);
			}).pipe(Effect.provide(world(sql)));
			return Effect.gen(function* () {
				yield* first;
				expect(count(db, "sizes")).toBe(1);
				yield* later;
				const rows = db.prepare(`SELECT at FROM sizes ORDER BY at`).all();
				expect(rows.map((row) => Number(row["at"]))).toEqual([D + H, D + 2 * H + 30 * 60_000 + 1]);
			});
		},
	);
});

/** The plan's traced day: 8 spans on 2026-10-23, one on the next day that rolls them up, and the
 *  clock 337 hours past that day's end, where one more span ends. */
const oldDay = Effect.gen(function* () {
	for (let n = 0; n < 5; n++) yield* span("runner.step", D + 10 * H + n * 60_000, 3 + n, n !== 2);
	for (let n = 0; n < 3; n++) yield* span("ledger.call", D + 23 * H + n * 60_000, 1);
	yield* span("runner.step", D + DAY + H, 1);
	yield* span("runner.step", D + DAY + KEEP + H, 1);
});

describe("p99, no raw row is ever lost", () => {
	it.effect(
		"a day past 336 hours goes to R2 as one JSON-lines file, and its rows leave only after the hash matches",
		() => {
			const {db, sql} = fresh();
			const r2 = bucket();
			return Effect.gen(function* () {
				yield* oldDay;
				const summariesBefore = count(db, "summary");
				const sizesBefore = count(db, "sizes");
				expect(count(db, "health", inDay(D))).toBe(8);
				yield* flush;
				const key = fileKey("2026-10-23");
				expect([...r2.stored.keys()]).toEqual([key]);
				const lines = r2.lines(key);
				expect(lines).toHaveLength(8);
				for (const line of lines)
					expect(Object.keys(line).sort()).toEqual(["at", "error", "lag", "ms", "ok", "piece"]);
				expect(lines.map((line) => [line["piece"], line["ms"], line["ok"]]).sort()).toEqual(
					[
						["ledger.call", 1, true],
						["ledger.call", 1, true],
						["ledger.call", 1, true],
						["runner.step", 3, true],
						["runner.step", 4, true],
						["runner.step", 5, false],
						["runner.step", 6, true],
						["runner.step", 7, true],
					].sort(),
				);
				const archived = db.prepare(`SELECT day, key, sha256, rows FROM archived`).all();
				expect(archived).toEqual([
					{day: "2026-10-23", key, sha256: hex(r2.stored.get(key) ?? new Uint8Array()), rows: 8},
				]);
				expect(count(db, "health", inDay(D))).toBe(0);
				expect(count(db, "health"), "the younger days stay local").toBe(2);
				expect(count(db, "summary")).toBeGreaterThanOrEqual(summariesBefore);
				expect(count(db, "summary", `hour IN (${D + 10 * H}, ${D + 23 * H})`)).toBe(2);
				expect(count(db, "sizes")).toBeGreaterThanOrEqual(sizesBefore);
				yield* flush;
				yield* span("runner.step", D + DAY + KEEP + 2 * H, 1);
				yield* flush;
				expect(
					r2.puts.filter((k) => k === key),
					"a day is archived once",
				).toHaveLength(1);
			}).pipe(Effect.provide(world(sql, Archive.bucket(r2.calls))));
		},
	);

	it.effect("a day younger than 336 hours stays local", () => {
		const {db, sql} = fresh();
		const r2 = bucket();
		return Effect.gen(function* () {
			for (let n = 0; n < 3; n++) yield* span("runner.step", D + 10 * H + n, 1);
			yield* span("runner.step", D + DAY + H, 1);
			yield* span("runner.step", D + 300 * H, 1);
			yield* flush;
			expect(r2.puts).toEqual([]);
			expect(count(db, "health", inDay(D))).toBe(3);
			expect(count(db, "archived")).toBe(0);
		}).pipe(Effect.provide(world(sql, Archive.bucket(r2.calls))));
	});

	it.effect(
		"a day whose hours were never summarized never leaves, however old; the summary comes first",
		() => {
			const {db, sql} = fresh();
			const r2 = bucket();
			return Effect.gen(function* () {
				for (let n = 0; n < 3; n++) yield* span("runner.step", D + 10 * H + n, 1);
				// Asleep for 400 hours, then a flush with no span: nothing rolled hour 10 up.
				yield* TestClock.setTime(D + 400 * H);
				yield* flush;
				expect(r2.puts).toEqual([]);
				expect(count(db, "health", inDay(D))).toBe(3);
				yield* span("runner.step", D + 400 * H + 1, 1);
				yield* flush;
				expect(count(db, "summary", `hour = ${D + 10 * H}`)).toBe(1);
				expect([...r2.stored.keys()]).toEqual([fileKey("2026-10-23")]);
				expect(count(db, "health", inDay(D))).toBe(0);
			}).pipe(Effect.provide(world(sql, Archive.bucket(r2.calls))));
		},
	);

	it.effect(
		"an Archive that fails, answers a wrong hash, or a bucket whose copy does not match: every row stays",
		() => {
			const {db, sql} = fresh();
			const r2 = bucket();
			const failing = {put: () => Effect.fail(new SinkError({why: "unreachable", held: 0}))};
			const wrong = {put: () => Effect.succeed({sha256: "0".repeat(64)})};
			const liar = bucket(true);
			return Effect.gen(function* () {
				yield* oldDay;
				yield* Effect.exit(flush.pipe(Effect.provideService(Archive, failing)));
				yield* Effect.exit(flush.pipe(Effect.provideService(Archive, wrong)));
				yield* Effect.exit(flush.pipe(Effect.provide(Archive.bucket(liar.calls))));
				expect(count(db, "health", inDay(D)), "nothing deleted without a matching hash").toBe(8);
				expect(count(db, "archived")).toBe(0);
				// Tried again at the next flush, on a bucket that works.
				yield* flush;
				expect(count(db, "health", inDay(D))).toBe(0);
				expect(count(db, "archived")).toBe(1);
				expect(r2.lines(fileKey("2026-10-23"))).toHaveLength(8);
			}).pipe(Effect.provide(world(sql, Archive.bucket(r2.calls))));
		},
	);

	it("local rows plus every archived file's rows are every health row ever written, at every point", async () => {
		const one = fc.record({
			piece: fc.constantFrom(...PIECES),
			gap: fc.integer({min: 0, max: 30 * H}),
			ms: fc.integer({min: 0, max: 50}),
			ok: fc.boolean(),
			flush: fc.boolean(),
		});
		await fc.assert(
			fc.asyncProperty(fc.array(one, {minLength: 1, maxLength: 40}), (made) => {
				const {db, sql} = fresh();
				const r2 = bucket();
				return Effect.runPromise(
					Effect.gen(function* () {
						const written: Array<Raw> = [];
						let kept = {summary: 0, sizes: 0, archived: 0};
						const check = (now: number) => {
							const local = db.prepare(`SELECT piece, at, ms, ok FROM health`).all().map(raw);
							const archived = [...r2.stored.keys()].flatMap((k) => r2.lines(k).map(raw));
							expect([...local, ...archived].map(key).sort(), "none missing, none twice").toEqual(
								written.map(key).sort(),
							);
							const pairs = new Set(
								db
									.prepare(`SELECT piece, hour FROM summary`)
									.all()
									.map((row) => `${row["piece"]} ${row["hour"]}`),
							);
							for (const r of archived)
								expect(pairs, "summarized before it left").toContain(`${r.piece} ${r.hour}`);
							for (const k of r2.stored.keys()) {
								const day = Date.parse(`${k.slice(-16, -6)}T00:00:00Z`);
								expect(now - day, `${k} left before it was 336 hours old`).toBeGreaterThanOrEqual(
									KEEP,
								);
							}
							expect(new Set(r2.puts).size, "a day is archived once").toBe(r2.puts.length);
							const counts = {
								summary: count(db, "summary"),
								sizes: count(db, "sizes"),
								archived: count(db, "archived"),
							};
							expect(counts.summary).toBeGreaterThanOrEqual(kept.summary);
							expect(counts.sizes).toBeGreaterThanOrEqual(kept.sizes);
							expect(counts.archived).toBeGreaterThanOrEqual(kept.archived);
							kept = counts;
						};
						let t = D;
						const end = (piece: string, start: number, ms: number, ok: boolean) =>
							Effect.gen(function* () {
								yield* span(piece, start, ms, ok);
								written.push({piece, hour: hourStart(start), ms, ok});
								t = start + ms;
								check(t);
							});
						for (const s of made) {
							let start = t + s.gap;
							if (hourStart(start) !== hourStart(start + s.ms)) start = hourStart(start) + H;
							yield* end(s.piece, start, s.ms, s.ok);
							if (s.flush) {
								yield* flush;
								check(t);
							}
						}
						// Far past every day so far: each of them leaves, and only the last day stays.
						const last = hourStart(t) + KEEP + 2 * DAY;
						yield* end("closing", last, 1, true);
						yield* flush;
						check(t);
						const local = db.prepare(`SELECT at FROM health`).all();
						expect(local.every((row) => utcDay(Number(row["at"])) === utcDay(last))).toBe(true);
					}).pipe(
						Effect.provide(world(sql, Archive.bucket(r2.calls))),
						Effect.provide(TestClock.layer()),
					),
				);
			}),
			{seed: SEED, numRuns: 25},
		);
	});
});
