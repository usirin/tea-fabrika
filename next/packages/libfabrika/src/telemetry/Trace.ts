/**
 * The span sink's rows: what a span keeps, where its record lives, and the measurements and metrics
 * made from it. Plain shapes and pure helpers, the same on workerd and on Node.
 *
 * A row keeps OTLP's span field names, so a later export to any OTLP backend is a map, not a
 * rewrite. A tag holds a name, an id, a number or a boolean. A failed span's message is never a
 * tag, only its record part's `content`, the one thing a person may delete.
 *
 * @stability unstable
 */
import { Schema } from "effect";
import { ProcessId } from "../ProcessId.ts";

/**
 * Schema for where a span's record lives: `job`, its process's JobRecord, or `spans`, the span
 * record that holds every span outside a process.
 *
 * @stability unstable
 * @category schemas
 */
export const Chain = Schema.TaggedUnion({
  job: { process: ProcessId },
  spans: {},
});
/**
 * Where a span's record lives: a process's JobRecord, or the span record.
 *
 * @stability unstable
 * @category models
 */
export type Chain = typeof Chain.Type;

/**
 * Returns a chain's name: `job/<process>` or `spans`. Its parts are named `<name>/<part>`,
 * counting from 0.
 *
 * @stability unstable
 * @category getters
 */
export const chainName = (chain: Chain): string =>
  Chain.match(chain, { job: ({ process }) => `job/${process}`, spans: () => "spans" });

/**
 * Returns a record part's name, such as `job/<process>/0`: the name of the object that holds the
 * part.
 *
 * @stability unstable
 * @category getters
 */
export const partName = (chain: Chain, part: number): string => `${chainName(chain)}/${part}`;

/**
 * The span tag that names a span's process. A span without it takes its nearest ancestor's, and
 * that decides which record the span goes to: the process's JobRecord, or the span record when no
 * ancestor has one.
 *
 * @stability unstable
 * @category constants
 */
export const PROCESS = "fab.process";

/**
 * Schema for one span tag's value: a string, a number or a boolean.
 *
 * @stability unstable
 * @category schemas
 */
export const Tag = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
/**
 * One span tag's value.
 *
 * @stability unstable
 * @category models
 */
export type Tag = typeof Tag.Type;
const Tags = Schema.Record(Schema.String, Tag);

/**
 * The key that names the object that ended a span. It is the row's resource, never a span tag.
 *
 * @stability unstable
 * @category constants
 */
export const OBJECT = "fab.object";

/** A link to another span, in OTLP's shape. Its tags are kept as a span's are. */
const Link = Schema.Struct({ traceId: Schema.String, spanId: Schema.String, attributes: Tags });

/** OTLP's resource: what produced the span. Here, the object that ended it. */
const Resource = Schema.Struct({ attributes: Schema.Struct({ [OBJECT]: Schema.String }) });

/**
 * Schema for one ended span as its row keeps it, in OTLP's span field names.
 *
 * **Details**
 *
 * Times are nanoseconds since 1970, a bigint as text. `ok` is the exit. A failed span's error
 * class is its `error.type` tag; its message is never in the row, only in its part's content.
 *
 * @stability unstable
 * @category schemas
 */
export const SpanRow = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  name: Schema.String,
  kind: Schema.Literals(["internal", "server", "client", "producer", "consumer"]),
  /** Nanoseconds since the epoch, a bigint as text. */
  startTimeUnixNano: Schema.String,
  endTimeUnixNano: Schema.String,
  attributes: Tags,
  events: Schema.Array(Schema.Struct({ name: Schema.String, timeUnixNano: Schema.String, attributes: Tags })),
  links: Schema.Array(Link),
  resource: Resource,
  /** The exit. A failure's class is `attributes["error.type"]`; its message is content. */
  ok: Schema.Boolean,
});
/**
 * One ended span as its row keeps it.
 *
 * @stability unstable
 * @category models
 */
export type SpanRow = typeof SpanRow.Type;

/**
 * Schema for a failed span's content, one per failed span, in its record part: `kept`, with the
 * failure's text, or `deleted`, with who deleted it, when and why. Only `deleteContent` changes
 * it, and only once, from `kept` to `deleted`.
 *
 * @stability unstable
 * @category schemas
 */
export const Content = Schema.TaggedUnion({
  kept: { spanId: Schema.String, message: Schema.String },
  deleted: { spanId: Schema.String, by: Schema.String, at: Schema.Int, reason: Schema.String },
});
/**
 * A failed span's content: `kept` or `deleted`.
 *
 * @stability unstable
 * @category models
 */
export type Content = typeof Content.Type;

/**
 * Schema for a full part's last fact: the part's number, its size in bytes at that moment, and
 * the next part's name. A part has at most one, and a reader follows it to the next part.
 *
 * @stability unstable
 * @category schemas
 */
export const Rolled = Schema.TaggedStruct("rolled", {
  part: Schema.Int,
  next: Schema.String,
  bytes: Schema.Int,
});
/**
 * A full part's last fact, which names the next part.
 *
 * @stability unstable
 * @category models
 */
export type Rolled = typeof Rolled.Type;

/**
 * Schema for a measurement: one raw row per ended span, in the object that ended it. It stays
 * local about two weeks, then leaves for the archive, where it is kept for good.
 *
 * **Details**
 *
 * `piece` is the span's name, and `ms` how long the span took.
 *
 * @stability unstable
 * @category schemas
 */
export const Measurements = Schema.Struct({
  piece: Schema.String,
  /** When the span ended, in ms on the object's clock. */
  at: Schema.Int,
  ms: Schema.Number,
  ok: Schema.Boolean,
  /** The error's class, never its message. */
  error: Schema.NullOr(Schema.String),
  lag: Schema.NullOr(Schema.Number),
  /** The span this row measured, so it joins its span row. Null when no span was current. */
  spanId: Schema.NullOr(Schema.String),
});
/**
 * One measurement: the raw row of one ended span.
 *
 * @stability unstable
 * @category models
 */
export type Measurements = typeof Measurements.Type;

/**
 * Schema for a metric point: one piece's closed hour, kept for good. `hour` is the ms at the
 * hour's start (UTC), `ms` holds the p50, the p95 and the largest of the hour's durations, and
 * `lag` is the worst lag any of its measurements had.
 *
 * @stability unstable
 * @category schemas
 */
export const MetricPoint = Schema.TaggedStruct("metric", {
  piece: Schema.String,
  hour: Schema.Int,
  count: Schema.Int,
  errors: Schema.Int,
  ms: Schema.Struct({ p50: Schema.Number, p95: Schema.Number, max: Schema.Number }),
  lag: Schema.NullOr(Schema.Number),
});
/**
 * One piece's closed hour.
 *
 * @stability unstable
 * @category models
 */
export type MetricPoint = typeof MetricPoint.Type;

/** A refusal counted instead of keeping the span or its measurement. */
export { REFUSED } from "../SpanTag.ts";

/**
 * Schema for the closed value a counted refusal is split by. The sink counts any other value of
 * the refusal tag as `other`, so the set of counts stays small.
 *
 * @stability unstable
 * @category schemas
 */
export const Refused = Schema.Literals(["reserved", "rate_limited", "other"]);
/**
 * The closed value a counted refusal is split by.
 *
 * @stability unstable
 * @category models
 */
export type Refused = typeof Refused.Type;

/**
 * Schema for a sum point: one piece's count of refused spans in one hour, split by a closed
 * refusal value. It is counted in place when the span ends, so there is no row per refusal.
 *
 * @stability unstable
 * @category schemas
 */
export const SumPoint = Schema.TaggedStruct("sum", {
  piece: Schema.String,
  hour: Schema.Int,
  refused: Refused,
  count: Schema.Int,
});
/**
 * One piece's hourly count of refusals of one kind.
 *
 * @stability unstable
 * @category models
 */
export type SumPoint = typeof SumPoint.Type;

/**
 * Schema for a size row: the object's own storage size in bytes, written at most once an hour
 * while the object is awake, and kept for good.
 *
 * @stability unstable
 * @category schemas
 */
export const Size = Schema.TaggedStruct("size", { at: Schema.Int, bytes: Schema.Int });

/**
 * Schema for an `archived` row: where one part of a day of measurements went in the archive, and
 * the hash it was checked by, kept for good. Part 1 is the day's own file; rows that land after it
 * leave as part 2, 3 and on.
 *
 * @stability unstable
 * @category schemas
 */
export const Archived = Schema.TaggedStruct("archived", {
  day: Schema.String,
  part: Schema.Int,
  key: Schema.String,
  sha256: Schema.String,
  rows: Schema.Int,
});

/**
 * Error for a sink, record or archive call that failed: the call never answered, a row or an
 * answer did not decode, or storage threw.
 *
 * @stability unstable
 * @category errors
 */
export class SinkError extends Schema.TaggedError<SinkError>()("SinkError", {
  /** `unreachable`: a record or archive call that never answered. `bad_row`: an answer or a row
   *  that does not decode. `storage`: SQLite threw, for example `SQLITE_FULL`. */
  reason: Schema.Literals(["unreachable", "bad_row", "storage"]),
  /** Spans in memory that met a full disk; 0 otherwise. */
  held: Schema.Int,
  message: Schema.optionalKey(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Converts a thrown value into a `SinkError`: a row that does not decode is `bad_row`, anything
 * else `storage`. The thrown value is kept as `cause`.
 *
 * @stability unstable
 * @category constructors
 */
export const sinkError = (error: unknown): SinkError =>
  new SinkError({ reason: Schema.isSchemaError(error) ? "bad_row" : "storage", held: 0, cause: error });

/**
 * Returns the class of a thrown or failed value, for the `error.type` tag: an `Error`'s name, else
 * the value's type. Never its message, which may hold input.
 *
 * @stability unstable
 * @category getters
 */
export const errorClass = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/** The most characters a span tag holds (p95, p99). Text past it is cut, its length kept beside. */
const MOST_CHARS = 128;

/** The first `MOST_CHARS` characters, one fewer when the cut would split a surrogate pair. */
const cut = (text: string): string => {
  const last = text.charCodeAt(MOST_CHARS - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MOST_CHARS - 1 : MOST_CHARS);
};

/**
 * Builds span tags from text a caller hands in, such as a stream, an id, a `_tag`, a `by` or a
 * reader: each value as it is when it fits in 128 characters, else cut to 128 with its full length
 * beside it as `<key>.length`.
 *
 * **Details**
 *
 * It keeps text from outside from growing a span row without bound. A cut never splits a surrogate
 * pair.
 *
 * @stability unstable
 * @category constructors
 */
export const short = (texts: Readonly<Record<string, string>>): Record<string, string | number> =>
  Object.fromEntries(
    Object.entries(texts).flatMap(([key, text]) =>
      text.length <= MOST_CHARS
        ? [[key, text]]
        : [
            [key, cut(text)],
            [`${key}.length`, text.length],
          ],
    ),
  );
