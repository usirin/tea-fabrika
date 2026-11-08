// The span sink's rows: what a span keeps, where its record lives, and the two levels of health.
// Plain shapes and pure helpers, the same on workerd and on Node. Tier 1, P37 (laws p96 to p100).
//
// A row keeps OTLP's span field names, so a later export to any OTLP backend is a map, not a
// rewrite. A tag holds a name, an id, a number or a boolean; a failed span's message is never a
// tag, only its record part's `content`, the one part a person may delete.
import {Schema} from "effect";

/** A process's id, P33's (proposed `process_<26 chars>`). A restart is a new process. */
export const ProcessId = Schema.NonEmptyString;

/** Where a span's record lives: its process's JobRecord, or `spans` for every span outside one. */
export const Chain = Schema.TaggedUnion({
	job: {process: ProcessId},
	spans: {},
});
export type Chain = typeof Chain.Type;

/** A chain's name: `job/<process>` or `spans`. Its parts are `<name>/<part>`, counting from 0. */
export const chainName = (chain: Chain): string =>
	Chain.match(chain, {job: ({process}) => `job/${process}`, spans: () => "spans"});

/** A record part's name, such as `job/<process>/0`: the object that holds it. */
export const partName = (chain: Chain, part: number): string => `${chainName(chain)}/${part}`;

/** The tag a process's spans carry, and that a child finds through its parent. */
export const PROCESS = "fab.process";

export const Tag = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export type Tag = typeof Tag.Type;
const Tags = Schema.Record(Schema.String, Tag);

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
	events: Schema.Array(
		Schema.Struct({name: Schema.String, timeUnixNano: Schema.String, attributes: Tags}),
	),
	/** The exit. A failure's class is `attributes["error.type"]`; its message is content. */
	ok: Schema.Boolean,
});
export type SpanRow = typeof SpanRow.Type;

/** One per failed span, in its record part. Only `deleteContent` changes it, and only once. */
export const Content = Schema.TaggedUnion({
	kept: {spanId: Schema.String, message: Schema.String},
	deleted: {spanId: Schema.String, by: Schema.String, at: Schema.Int, why: Schema.String},
});
export type Content = typeof Content.Type;

/** The last fact of a full part: its number, its size then, and the next part's name. */
export const Rolled = Schema.TaggedStruct("rolled", {
	part: Schema.Int,
	next: Schema.String,
	bytes: Schema.Int,
});
export type Rolled = typeof Rolled.Type;

/** A raw health row, one per ended span: local about two weeks, then R2, forever. */
export const Health = Schema.Struct({
	piece: Schema.String,
	/** When the span ended, in ms on the object's clock. */
	at: Schema.Int,
	ms: Schema.Number,
	ok: Schema.Boolean,
	/** The error's class, never its message. */
	error: Schema.NullOr(Schema.String),
	lag: Schema.NullOr(Schema.Number),
});
export type Health = typeof Health.Type;

/** One piece's closed hour, kept forever. `hour` is the ms at the hour's start (UTC). */
export const Summary = Schema.TaggedStruct("summary", {
	piece: Schema.String,
	hour: Schema.Int,
	count: Schema.Int,
	errors: Schema.Int,
	ms: Schema.Struct({p50: Schema.Number, p95: Schema.Number, max: Schema.Number}),
	lag: Schema.NullOr(Schema.Number),
});
export type Summary = typeof Summary.Type;

/** The object's own size, at most once an hour while it is awake, forever. */
export const Size = Schema.TaggedStruct("size", {at: Schema.Int, bytes: Schema.Int});

/** Where one day of raw health rows went, and the hash it was checked by, forever. */
export const Archived = Schema.TaggedStruct("archived", {
	day: Schema.String,
	key: Schema.String,
	sha256: Schema.String,
	rows: Schema.Int,
});

export class SinkError extends Schema.TaggedError<SinkError>()("SinkError", {
	/** `unreachable`: a record or archive call that never answered. `bad_row`: an answer or a row
	 *  that does not decode. `storage`: SQLite threw, for example `SQLITE_FULL`. */
	why: Schema.Literals(["unreachable", "bad_row", "storage"]),
	/** Spans in memory that met a full disk; 0 otherwise. */
	held: Schema.Int,
}) {}

/** A thrown error as a typed one: a row that does not decode is `bad_row`, the rest `storage`. */
export const sinkError = (error: unknown): SinkError =>
	new SinkError({why: Schema.isSchemaError(error) ? "bad_row" : "storage", held: 0});

/** The class of a thrown or failed value, for `error.type`. */
export const errorClass = (error: unknown): string =>
	error instanceof Error ? error.name : typeof error;

/** The most characters a span tag holds (p95, p97). Text past it is cut, its length kept beside. */
const MOST_CHARS = 128;

/** The first `MOST_CHARS` characters, one fewer when the cut would split a surrogate pair. */
const cut = (text: string): string => {
	const last = text.charCodeAt(MOST_CHARS - 1);
	return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MOST_CHARS - 1 : MOST_CHARS);
};

/** Span tags from text a caller hands in (a stream, id, `_tag`, `by`, reader): each as it is when it
 *  fits, else cut to 128 characters with its full length beside as `<key>.length`. */
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
