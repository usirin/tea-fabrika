// Health in two levels, over an object's own SQLite: a raw row per ended span, and an hourly summary
// per piece, both kept forever. Raw rows stay local about two weeks, then leave for R2, one file per
// object per UTC day, deleted here only after the stored file's hash matches. Tier 1, P37 (law p99).
//
// Every step here is plain code over the synchronous `Sql`; the sink runs the row, the rollup and
// the size inside a span's `end`, and the archive inside `flush`. No alarm, no timer.
import {Effect, Option, Schema} from "effect";
import {Archive, sha256} from "./archive.ts";
import type {Sql} from "./referee.ts";
import type {SinkError} from "./trace.ts";
import {type Health, Summary, sinkError} from "./trace.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long raw rows stay local: "about two weeks" (owner, 2026-11-07), read as 336 hours. */
const KEEP = 336 * HOUR;

export const hourStart = (at: number): number => Math.floor(at / HOUR) * HOUR;

export const HEALTH_TABLES = [
	`CREATE TABLE IF NOT EXISTS health (
		piece TEXT NOT NULL, at INTEGER NOT NULL, ms REAL NOT NULL, ok INTEGER NOT NULL, error TEXT,
		lag REAL)`,
	`CREATE INDEX IF NOT EXISTS health_by_at ON health (at)`,
	`CREATE TABLE IF NOT EXISTS summarized (hour INTEGER PRIMARY KEY)`,
	`CREATE TABLE IF NOT EXISTS summary (
		piece TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, errors INTEGER NOT NULL,
		p50 REAL NOT NULL, p95 REAL NOT NULL, max REAL NOT NULL, lag REAL, PRIMARY KEY (piece, hour))`,
	`CREATE TABLE IF NOT EXISTS sizes (at INTEGER PRIMARY KEY, bytes INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS archived (
		day TEXT PRIMARY KEY, key TEXT NOT NULL, sha256 TEXT NOT NULL, rows INTEGER NOT NULL)`,
];

const HealthColumns = Schema.Struct({
	piece: Schema.String,
	at: Schema.Int,
	ms: Schema.Number,
	ok: Schema.Literals([0, 1]),
	error: Schema.NullOr(Schema.String),
	lag: Schema.NullOr(Schema.Number),
});
const decodeHealth = Schema.decodeUnknownSync(HealthColumns);
const decodeHour = Schema.decodeUnknownSync(Schema.Struct({hour: Schema.Int}));
const decodeDay = Schema.decodeUnknownSync(Schema.Struct({day: Schema.Int}));
const decodeCount = Schema.decodeUnknownSync(Schema.Struct({n: Schema.Int}));
const decodeSummary = Schema.decodeUnknownSync(
	Schema.Struct({
		piece: Schema.String,
		hour: Schema.Int,
		count: Schema.Int,
		errors: Schema.Int,
		p50: Schema.Number,
		p95: Schema.Number,
		max: Schema.Number,
		lag: Schema.NullOr(Schema.Number),
	}),
);

/** Reads `health` rows back as `Health`. */
const healthRows = (sql: Sql, query: string, ...params: ReadonlyArray<number>): Array<Health> =>
	sql.exec(query, ...params).map((row) => {
		const {ok, ...rest} = decodeHealth(row);
		return {...rest, ok: ok === 1};
	});

export const writeHealth = (sql: Sql, {piece, at, ms, ok, error, lag}: Health): void =>
	void sql.exec(
		`INSERT INTO health (piece, at, ms, ok, error, lag) VALUES (?, ?, ?, ?, ?, ?)`,
		piece,
		at,
		ms,
		ok ? 1 : 0,
		error,
		lag,
	);

/** Nearest rank: the smallest value with at least `percent` of the sorted values at or below it. */
const rank = (sorted: ReadonlyArray<number>, percent: number): number =>
	sorted[Math.max(0, Math.ceil((percent * sorted.length) / 100) - 1)] ?? 0;

/** One hour's rows as one summary per piece. */
const summarize = (hour: number, rows: ReadonlyArray<Health>): Array<Summary> => {
	const pieces = new Map<string, Array<Health>>();
	for (const row of rows) pieces.set(row.piece, [...(pieces.get(row.piece) ?? []), row]);
	return [...pieces].map(([piece, group]) => {
		const ms = group.map((row) => row.ms).sort((x, y) => x - y);
		const lags = group.flatMap((row) => (row.lag === null ? [] : [row.lag]));
		return Summary.make({
			piece,
			hour,
			count: group.length,
			errors: group.filter((row) => !row.ok).length,
			ms: {p50: rank(ms, 50), p95: rank(ms, 95), max: ms.at(-1) ?? 0},
			lag: lags.length === 0 ? null : Math.max(...lags),
		});
	});
};

/** Rolls up every closed hour before `now` that has health rows and no summary yet. */
export const rollup = (sql: Sql, now: number): void => {
	const hours = sql
		.exec(
			`SELECT DISTINCT (at / ${HOUR}) * ${HOUR} AS hour FROM health
			WHERE at < ? AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM summarized)
			ORDER BY hour`,
			hourStart(now),
		)
		.map((row) => decodeHour(row).hour);
	for (const hour of hours) {
		const rows = healthRows(
			sql,
			`SELECT * FROM health WHERE at >= ? AND at < ?`,
			hour,
			hour + HOUR,
		);
		for (const {piece, count, errors, ms, lag} of summarize(hour, rows))
			sql.exec(
				`INSERT INTO summary (piece, hour, count, errors, p50, p95, max, lag)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				piece,
				hour,
				count,
				errors,
				ms.p50,
				ms.p95,
				ms.max,
				lag,
			);
		sql.exec(`INSERT INTO summarized (hour) VALUES (?)`, hour);
	}
};

/** A size row from `Sql.size()`, unless this hour already has one. */
export const writeSize = (sql: Sql, now: number): void => {
	const start = hourStart(now);
	const [had] = sql.exec(
		`SELECT count(*) AS n FROM sizes WHERE at >= ? AND at < ?`,
		start,
		start + HOUR,
	);
	if (had !== undefined && decodeCount(had).n > 0) return;
	sql.exec(`INSERT INTO sizes (at, bytes) VALUES (?, ?)`, now, sql.size());
};

/** The summaries whose hour is in `[from, to)`, oldest first. */
export const readSummaries = (sql: Sql, from: number, to: number): Array<Summary> =>
	sql
		.exec(`SELECT * FROM summary WHERE hour >= ? AND hour < ? ORDER BY hour, piece`, from, to)
		.map((row) => {
			const {p50, p95, max, ...rest} = decodeSummary(row);
			return Summary.make({...rest, ms: {p50, p95, max}});
		});

const encoder = new TextEncoder();

/** A day ready to leave: old enough, every hour with rows summarized, and not archived yet. */
const due = (sql: Sql, object: string, now: number) => {
	const cutoff = Math.floor((now - KEEP) / DAY) * DAY;
	return sql
		.exec(
			`SELECT DISTINCT (at / ${DAY}) * ${DAY} AS day FROM health WHERE at < ? ORDER BY day`,
			cutoff,
		)
		.map((row) => decodeDay(row).day)
		.flatMap((start) => {
			const day = new Date(start).toISOString().slice(0, 10);
			const [open] = sql.exec(
				`SELECT count(*) AS n FROM health WHERE at >= ? AND at < ?
				AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM summarized)`,
				start,
				start + DAY,
			);
			const unsummarized = open === undefined ? 0 : decodeCount(open).n;
			const archived = sql.exec(`SELECT 1 FROM archived WHERE day = ?`, day).length > 0;
			if (unsummarized > 0 || archived) return [];
			const rows = healthRows(
				sql,
				`SELECT * FROM health WHERE at >= ? AND at < ? ORDER BY at, rowid`,
				start,
				start + DAY,
			);
			const body = encoder.encode(
				`${rows
					.map(({piece, at, ms, ok, error, lag}) => JSON.stringify({piece, at, ms, ok, error, lag}))
					.join("\n")}\n`,
			);
			return [{start, day, key: `health/${object}/${day}.jsonl`, body, rows: rows.length}];
		});
};

/** Archives each due day: one file through `Archive.put`; on a matching hash, `archived` and the
 *  day's local rows deleted in one step. A failed put or a mismatch deletes nothing and is tried
 *  again at the next flush, so a day here never fails the step: nothing is lost. */
export const archiveDays = (
	sql: Sql,
	object: string,
	now: number,
): Effect.Effect<void, never, Archive> =>
	Effect.gen(function* () {
		const archive = yield* Archive;
		const days = yield* Effect.try({
			try: () => sql.transaction(() => due(sql, object, now)),
			catch: sinkError,
		});
		yield* Effect.forEach(
			days,
			({start, day, key, body, rows}) =>
				Effect.gen(function* () {
					const hash = yield* sha256(body);
					const stored = yield* archive.put(key, body);
					if (stored.sha256 !== hash) return Option.none();
					yield* Effect.try({
						try: () =>
							sql.transaction(() => {
								sql.exec(
									`INSERT INTO archived (day, key, sha256, rows) VALUES (?, ?, ?, ?)`,
									day,
									key,
									hash,
									rows,
								);
								sql.exec(`DELETE FROM health WHERE at >= ? AND at < ?`, start, start + DAY);
							}),
						catch: sinkError,
					});
					return Option.some(day);
				}).pipe(Effect.catch((_: SinkError) => Effect.succeedNone)),
			{concurrency: 1, discard: true},
		);
	}).pipe(Effect.catch((_: SinkError) => Effect.void));
