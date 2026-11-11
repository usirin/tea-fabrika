// Health in two levels, over an object's own SQLite: a raw row per ended span, and an hourly summary
// per piece, both kept forever. Raw rows stay local about two weeks, then leave for R2, one file per
// object per UTC day, deleted here only after the stored file's hash matches. A row of the day that
// lands after its file leaves later, as the day's part 2, 3 and on. Tier 1, P37 (law p101).
//
// Every step here is plain code over the synchronous `Sql`; the sink runs the row, the rollup and
// the size inside a span's `end`, and the archive inside `flush`. No alarm, no timer. Each archive
// try writes its own health row, `sink.archive`, good or failed, so a day that cannot leave is seen.
import { Clock, Effect, Option, Result, Schema } from "effect";
import type { Sql } from "../../Sql.ts";
import { Archive, sha256 } from "../Archive.ts";
import { type Measurements, type SinkError, MetricPoint, sinkError } from "../Trace.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long raw rows stay local: "about two weeks" (owner, 2026-11-07), read as 336 hours. */
const KEEP = 336 * HOUR;

/** @internal */
export const hourStart = (at: number): number => Math.floor(at / HOUR) * HOUR;

/** @internal */
export const HEALTH_TABLES = [
  `CREATE TABLE IF NOT EXISTS measurements (
		piece TEXT NOT NULL, at INTEGER NOT NULL, ms REAL NOT NULL, ok INTEGER NOT NULL, error TEXT,
		lag REAL, "spanId" TEXT)`,
  `CREATE INDEX IF NOT EXISTS measurements_by_at ON measurements (at)`,
  `CREATE TABLE IF NOT EXISTS aggregated (hour INTEGER PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS summary (
		piece TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, errors INTEGER NOT NULL,
		p50 REAL NOT NULL, p95 REAL NOT NULL, max REAL NOT NULL, lag REAL, PRIMARY KEY (piece, hour))`,
  `CREATE TABLE IF NOT EXISTS sizes (at INTEGER PRIMARY KEY, bytes INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS archived (
		day TEXT NOT NULL, part INTEGER NOT NULL, key TEXT NOT NULL, sha256 TEXT NOT NULL,
		rows INTEGER NOT NULL, PRIMARY KEY (day, part))`,
];

const HealthColumns = Schema.Struct({
  piece: Schema.String,
  at: Schema.Int,
  ms: Schema.Number,
  ok: Schema.Literals([0, 1]),
  error: Schema.NullOr(Schema.String),
  lag: Schema.NullOr(Schema.Number),
  spanId: Schema.NullOr(Schema.String),
});

const decodeHealth = Schema.decodeUnknownSync(HealthColumns);
const decodeHour = Schema.decodeUnknownSync(Schema.Struct({ hour: Schema.Int }));
const decodeDay = Schema.decodeUnknownSync(Schema.Struct({ day: Schema.Int }));
const decodeCount = Schema.decodeUnknownSync(Schema.Struct({ n: Schema.Int }));
const decodeSeq = Schema.decodeUnknownSync(Schema.Struct({ seq: Schema.Int }));

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

/** Reads `measurements` rows back as `Measurements`. */
const healthRows = (sql: Sql, query: string, ...params: ReadonlyArray<number>): Array<Measurements> =>
  sql.exec(query, ...params).map((row) => toHealth(row));

const toHealth = (row: unknown): Measurements => {
  const { ok, ...rest } = decodeHealth(row);
  return { ...rest, ok: ok === 1 };
};

/** @internal */
export const writeHealth = (sql: Sql, { piece, at, ms, ok, error, lag, spanId }: Measurements): void =>
  void sql.exec(
    `INSERT INTO measurements (piece, at, ms, ok, error, lag, "spanId") VALUES (?, ?, ?, ?, ?, ?, ?)`,
    piece,
    at,
    ms,
    ok ? 1 : 0,
    error,
    lag,
    spanId,
  );

/** Nearest rank: the smallest value with at least `percent` of the sorted values at or below it. */
const rank = (sorted: ReadonlyArray<number>, percent: number): number =>
  sorted[Math.max(0, Math.ceil((percent * sorted.length) / 100) - 1)] ?? 0;

/** One hour's rows as one summary per piece. */
const summarize = (hour: number, rows: ReadonlyArray<Measurements>): Array<MetricPoint> => {
  const pieces = new Map<string, Array<Measurements>>();

  for (const row of rows) {
    pieces.set(row.piece, [...(pieces.get(row.piece) ?? []), row]);
  }

  return [...pieces].map(([piece, group]) => {
    const ms = group.map((row) => row.ms).sort((x, y) => x - y);
    const lags = group.flatMap((row) => (row.lag === null ? [] : [row.lag]));
    return MetricPoint.make({
      piece,
      hour,
      count: group.length,
      errors: group.filter((row) => !row.ok).length,
      ms: { p50: rank(ms, 50), p95: rank(ms, 95), max: ms.at(-1) ?? 0 },
      lag: lags.length === 0 ? null : Math.max(...lags),
    });
  });
};

/** Rolls up every closed hour before `now` that has health rows and no summary yet. */
/** @internal */
export const rollup = (sql: Sql, now: number): void => {
  const hours = sql
    .exec(
      `SELECT DISTINCT (at / ${HOUR}) * ${HOUR} AS hour FROM measurements
			WHERE at < ? AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM aggregated)
			ORDER BY hour`,
      hourStart(now),
    )
    .map((row) => decodeHour(row).hour);

  for (const hour of hours) {
    const rows = healthRows(sql, `SELECT * FROM measurements WHERE at >= ? AND at < ?`, hour, hour + HOUR);

    for (const { piece, count, errors, ms, lag } of summarize(hour, rows)) {
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
    }

    sql.exec(`INSERT INTO aggregated (hour) VALUES (?)`, hour);
  }
};

/** A size row from `Sql.size()`, unless this hour already has one. */
/** @internal */
export const writeSize = (sql: Sql, now: number): void => {
  const start = hourStart(now);
  const [had] = sql.exec(`SELECT count(*) AS n FROM sizes WHERE at >= ? AND at < ?`, start, start + HOUR);

  if (had !== undefined && decodeCount(had).n > 0) {
    return;
  }

  sql.exec(`INSERT INTO sizes (at, bytes) VALUES (?, ?)`, now, sql.size());
};

/** The summaries whose hour is in `[from, to)`, oldest first. */
/** @internal */
export const readSummaries = (sql: Sql, from: number, to: number): Array<MetricPoint> =>
  sql.exec(`SELECT * FROM summary WHERE hour >= ? AND hour < ? ORDER BY hour, piece`, from, to).map((row) => {
    const { p50, p95, max, ...rest } = decodeSummary(row);
    return MetricPoint.make({ ...rest, ms: { p50, p95, max } });
  });

const encoder = new TextEncoder();

/** The piece of the health row each archive try writes. */
const ARCHIVE = "sink.archive";

/** Why an archive try failed: the store never answered, or nothing proves the copy holds the rows. */
type Failed = "unreachable" | "mismatch";

/** One file to put: a day's rows not yet in a file, read up to rowid `last`. */
type Part = {
  readonly start: number;
  readonly day: string;
  readonly part: number;
  readonly key: string;
  readonly body: Uint8Array;
  readonly rows: number;
  readonly last: number;
};

/** Part 1 is the day's own file; a later part says its number. */
const partKey = (object: string, day: string, part: number): string =>
  `measurements/${object}/${day}${part === 1 ? "" : `.${part}`}.jsonl`;

/** Each day ready to leave, as its next part: old enough, every hour with rows summarized, and with
 *  rows still local. */
const due = (sql: Sql, object: string, now: number): Array<Part> => {
  const cutoff = Math.floor((now - KEEP) / DAY) * DAY;
  return sql
    .exec(`SELECT DISTINCT (at / ${DAY}) * ${DAY} AS day FROM measurements WHERE at < ? ORDER BY day`, cutoff)
    .map((row) => decodeDay(row).day)
    .flatMap((start) => {
      const day = new Date(start).toISOString().slice(0, 10);
      const [open] = sql.exec(
        `SELECT count(*) AS n FROM measurements WHERE at >= ? AND at < ?
				AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM aggregated)`,
        start,
        start + DAY,
      );

      if (open !== undefined && decodeCount(open).n > 0) {
        return [];
      }

      const read = sql.exec(
        `SELECT rowid AS seq, * FROM measurements WHERE at >= ? AND at < ? ORDER BY at, rowid`,
        start,
        start + DAY,
      );
      const last = read.reduce((max, row) => Math.max(max, decodeSeq(row).seq), -Infinity);
      const [had] = sql.exec(`SELECT coalesce(max(part), 0) AS n FROM archived WHERE day = ?`, day);
      const part = (had === undefined ? 0 : decodeCount(had).n) + 1;
      const body = encoder.encode(
        `${read
          .map(toHealth)
          .map(({ piece, at, ms, ok, error, lag, spanId }) => JSON.stringify({ piece, at, ms, ok, error, lag, spanId }))
          .join("\n")}\n`,
      );
      return [{ start, day, part, key: partKey(object, day, part), body, rows: read.length, last }];
    });
};

/** Whether the day still holds exactly the rows read for `part`: none of them gone since. */
const unchanged = (sql: Sql, { start, rows, last }: Part): boolean => {
  const [now] = sql.exec(
    `SELECT count(*) AS n FROM measurements WHERE at >= ? AND at < ? AND rowid <= ?`,
    start,
    start + DAY,
    last,
  );
  return now !== undefined && decodeCount(now).n === rows;
};

/** One try at one part: the put, then, in one step, its `sink.archive` row and, on a matching hash,
 *  its `archived` row and the deletion of only the rows it read. */
const archivePart = Effect.fnUntraced(function* (sql: Sql, archive: (typeof Archive)["Service"], part: Part) {
  const hash = yield* sha256(part.body);
  const began = yield* Clock.currentTimeMillis;
  const stored = yield* Effect.result(archive.put(part.key, part.body));
  const ended = yield* Clock.currentTimeMillis;
  const span = yield* Effect.option(Effect.currentSpan);
  const failed: Failed | null = Result.match(stored, {
    onFailure: (error) => (error.reason === "unreachable" ? "unreachable" : "mismatch"),
    onSuccess: ({ sha256: held }) => (held === hash ? null : "mismatch"),
  });
  yield* Effect.try({
    try: () =>
      sql.transaction(() => {
        const error: Failed | null = failed ?? (unchanged(sql, part) ? null : "mismatch");

        if (error === null) {
          sql.exec(
            `INSERT INTO archived (day, part, key, sha256, rows) VALUES (?, ?, ?, ?, ?)`,
            part.day,
            part.part,
            part.key,
            hash,
            part.rows,
          );
          sql.exec(
            `DELETE FROM measurements WHERE at >= ? AND at < ? AND rowid <= ?`,
            part.start,
            part.start + DAY,
            part.last,
          );
        }

        writeHealth(sql, {
          piece: ARCHIVE,
          at: ended,
          ms: ended - began,
          ok: error === null,
          error,
          lag: null,
          spanId: Option.getOrNull(Option.map(span, ({ spanId }) => spanId)),
        });
      }),
    catch: sinkError,
  });
});

/** Archives each due day's next part. A failed put or a mismatch deletes nothing, writes its
 *  `sink.archive` row and is tried again at the next flush, so a day here never fails the step:
 *  nothing is lost. An unnamed `Effect.fn`: the sink's own work ends no span. */
/** @internal */
export const archiveDays = Effect.fn(
  function* (sql: Sql, object: string, now: number) {
    const archive = yield* Archive;
    const parts = yield* Effect.try({
      try: () => sql.transaction(() => due(sql, object, now)),
      catch: sinkError,
    });
    yield* Effect.forEach(
      parts,
      (part) => archivePart(sql, archive, part).pipe(Effect.catch((_: SinkError) => Effect.void)),
      { concurrency: 1, discard: true },
    );
  },
  Effect.catch((_: SinkError) => Effect.void),
);
