import {Schema} from "effect";

// The ledger's one log (D2, D3): SQLite inside one object, with named streams in it. The referee
// is the object itself, one call at a time, so numbering a line is one plain step (D1). The same
// SQL runs on workerd and, in the test, on node:sqlite.
//
//   append("build:7", "e-91", {...})   -> {rev: 412, pos: 3, fresh: true}
//   append("build:7", "e-91", {...})   -> {rev: 412, pos: 3, fresh: false}   a resend, saved once
//   read("build:7", 400)               -> every line of build:7 after rev 400, in order
//
// `rev` is the place in the whole log; `pos` is the place in its stream. Today's ledger uses the
// two words the other way round; this one follows D3.

/** One line of the log (D3). */
export const Entry = Schema.Struct({
	id: Schema.String,
	stream: Schema.String,
	pos: Schema.Int,
	rev: Schema.Int,
	at: Schema.String,
	by: Schema.String,
	said: Schema.String,
	kind: Schema.String,
	body: Schema.Unknown,
});
export type Entry = typeof Entry.Type;

/** What a writer hands in. `at` and the numbers are the referee's. */
export type Line = {
	readonly by: string;
	readonly said: string;
	readonly kind: string;
	readonly body: unknown;
};

export type Appended = {readonly rev: number; readonly pos: number; readonly fresh: boolean};

/** The part of SQLite the log uses: `ctx.storage.sql` has this shape. */
export type Sql = {
	exec(query: string, ...bindings: (string | number)[]): {toArray(): Record<string, unknown>[]};
};

const Row = Schema.Struct({
	id: Schema.String,
	stream: Schema.String,
	pos: Schema.Int,
	rev: Schema.Int,
	at: Schema.String,
	by: Schema.String,
	said: Schema.String,
	kind: Schema.String,
	body: Schema.String,
});
const decodeRow = Schema.decodeUnknownSync(Row);
const Place = Schema.Struct({rev: Schema.Int, pos: Schema.Int});
const decodePlace = Schema.decodeUnknownSync(Place);
const Last = Schema.Struct({last: Schema.NullOr(Schema.Int)});
const decodeLast = Schema.decodeUnknownSync(Last);

const entryFrom = (row: unknown): Entry => {
	const r = decodeRow(row);
	return {...r, body: JSON.parse(r.body)};
};

const lastIn = (sql: Sql, query: string, ...bindings: (string | number)[]): number =>
	decodeLast(sql.exec(query, ...bindings).toArray()[0]).last ?? 0;

export const createLog = (sql: Sql) => {
	sql.exec(`CREATE TABLE IF NOT EXISTS log (
		rev INTEGER PRIMARY KEY,
		id TEXT NOT NULL,
		stream TEXT NOT NULL,
		pos INTEGER NOT NULL,
		at TEXT NOT NULL,
		by TEXT NOT NULL,
		said TEXT NOT NULL,
		kind TEXT NOT NULL,
		body TEXT NOT NULL,
		UNIQUE (stream, id),
		UNIQUE (stream, pos)
	)`);

	const place = (stream: string, id: string): Appended | null => {
		const row = sql
			.exec("SELECT rev, pos FROM log WHERE stream = ? AND id = ?", stream, id)
			.toArray()[0];
		if (row === undefined) return null;
		return {...decodePlace(row), fresh: false};
	};

	return {
		/** Saved once, even if sent twice. `at` is the referee's clock. */
		append: (stream: string, id: string, line: Line, at: string): Appended => {
			const known = place(stream, id);
			if (known !== null) return known;
			const rev = lastIn(sql, "SELECT MAX(rev) AS last FROM log") + 1;
			const pos = lastIn(sql, "SELECT MAX(pos) AS last FROM log WHERE stream = ?", stream) + 1;
			sql.exec(
				"INSERT INTO log (rev, id, stream, pos, at, by, said, kind, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				rev,
				id,
				stream,
				pos,
				at,
				line.by,
				line.said,
				line.kind,
				JSON.stringify(line.body),
			);
			return {rev, pos, fresh: true};
		},

		/** Every line of a stream after a place in the whole log. */
		read: (stream: string, after: number): readonly Entry[] =>
			sql
				.exec("SELECT * FROM log WHERE stream = ? AND rev > ? ORDER BY rev", stream, after)
				.toArray()
				.map(entryFrom),

		/** The last rev of a stream; 0 if it has no lines. */
		head: (stream: string): number =>
			lastIn(sql, "SELECT MAX(rev) AS last FROM log WHERE stream = ?", stream),
	};
};
