// Copied from experiments/93-ledger/sql.ts. What changed, for the three gaps experiment 94 found:
//
//   1. A lease guards its stream AND every stream under it (`counter:1` guards `counter:1/*`).
//      A fenced append to `counter:1/state` is checked against the lease on `counter:1`. This is
//      etcd's lease on a key prefix, checked the way Kleppmann's fencing token is: the fence (the
//      claim's `pos`) names exactly one lease, so no longest-prefix search is needed.
//   2. `readStream` reads one stream from a rev (EventStoreDB: read a stream forwards from a
//      revision), `readLast` its last few events (EventStoreDB: read backwards from the end), and
//      `read` takes an optional prefix filter (EventStoreDB: read `$all` with a stream-prefix
//      filter). The live tail itself is in `ledger.ts` (a wake-up per append).
//   3. `append` takes `expectedRev: "any"` (EventStoreDB's `ExpectedRevision.Any`): the event goes
//      at the stream's end, whatever it is. An event may carry an `id` (EventStoreDB's event id,
//      Kafka's idempotent producer): a second append of the same id to the same stream writes
//      nothing and answers with the first one's place, `dup: true`. Claims and fenced state keep
//      the compare-and-set. A fenced append checks its fence before its id, so a writer that
//      lost its lease never hears `dup` (Kafka checks the epoch before the sequence too).
//
// The rest is 93's: correctness only from SQL inside one transaction; the alarm only writes the
// log line for a lease that ran out. Two drivers run this file: the Durable Object (`ledger.ts`)
// and node:sqlite (`node-ledger.ts`).

export type Value = string | number | null;
export type Row = Record<string, Value>;

/**
 * The one thing a driver gives: run SQL, and run a function as one transaction. `tx` may
 * nest (`cancel` calls `append`); an inner one joins the outer.
 */
export interface Db {
	all(sql: string, ...bind: Value[]): Row[];
	tx<T>(fn: () => T): T;
}

/** `id`: the message id. Unique per stream: a repeat is answered, not written. */
export type Event = {kind: string; writer: string; data?: unknown; id?: string | null};

/** The rev the stream must end at, or "any": append at the end (EventStoreDB's `Any`). */
export type Expected = number | "any";

export type AppendResult =
	| {ok: true; pos: number; rev: number; dup: boolean}
	| {ok: false; why: "stale"; rev: number}
	| {ok: false; why: "fenced"};
export type ClaimResult =
	| {ok: true; fence: number; rev: number; expiresAt: number}
	| {ok: false; why: "held"; holder: string; expiresAt: number}
	| {ok: false; why: "stale"; rev: number};
export type RenewResult =
	| {ok: true; expiresAt: number}
	| {ok: false; why: "lost"}
	| {ok: false; why: "stop"};

/** Numbered migrations; each is a list of statements. The last id run is kept in `migrations`. */
export const migrations: ReadonlyArray<ReadonlyArray<string>> = [
	[
		`CREATE TABLE events (
			pos INTEGER PRIMARY KEY,
			stream TEXT NOT NULL,
			rev INTEGER NOT NULL,
			writer TEXT NOT NULL,
			kind TEXT NOT NULL,
			at INTEGER NOT NULL,
			data TEXT NOT NULL,
			UNIQUE (stream, rev)
		)`,
		`CREATE TABLE leases (
			stream TEXT PRIMARY KEY,
			holder TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			fence INTEGER NOT NULL,
			stop INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE jobs (
			id TEXT PRIMARY KEY,
			due_at INTEGER NOT NULL,
			kind TEXT NOT NULL,
			stream TEXT NOT NULL
		)`,
		"CREATE INDEX jobs_due ON jobs (due_at)",
	],
	[
		`CREATE VIEW open_criteria AS
		SELECT a.stream, a.data ->> '$.id' AS id, a.data ->> '$.text' AS text, a.pos
		FROM events a
		WHERE a.kind = 'criterion_added'
		AND NOT EXISTS (
			SELECT 1 FROM events m
			WHERE m.stream = a.stream AND m.kind = 'criterion_met' AND m.data ->> '$.id' = a.data ->> '$.id'
		)`,
	],
	// New in 96: the message id. Unique per stream when given; the index backs up the check in
	// `append` if a driver ever ran two appends at once.
	[
		"ALTER TABLE events ADD COLUMN id TEXT",
		"CREATE UNIQUE INDEX events_stream_id ON events (stream, id) WHERE id IS NOT NULL",
		"CREATE INDEX leases_fence ON leases (fence)",
	],
];

/** Runs every migration newer than the last one kept, all in one transaction. */
export function migrate(db: Db): number {
	return db.tx(() => {
		db.all("CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)");
		const last = num(db.all("SELECT coalesce(max(id), 0) AS id FROM migrations")[0]?.id);
		for (let id = last + 1; id <= migrations.length; id++) {
			for (const stmt of migrations[id - 1] ?? []) db.all(stmt);
			db.all("INSERT INTO migrations (id, at) VALUES (?, ?)", id, Date.now());
		}
		return migrations.length;
	});
}

const num = (v: Value | undefined): number => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: Value | undefined): string => (typeof v === "string" ? v : String(v ?? ""));

const revOf = (db: Db, stream: string): number =>
	num(db.all("SELECT coalesce(max(rev), 0) AS rev FROM events WHERE stream = ?", stream)[0]?.rev);

/**
 * Is `stream` the lease's own stream or under it? `'/'` sorts just before `'0'`, so the streams
 * under `p` are exactly those `>= 'p/'` and `< 'p0'`: a range the (stream, rev) index can use, and
 * `counter:10` is not under `counter:1`. Used by the append and by the prefix read.
 */
const under = (stream: string, prefix: string) =>
	`(${stream} = ${prefix} OR (${stream} >= ${prefix} || '/' AND ${stream} < ${prefix} || '0'))`;

// The append itself: one INSERT. With `?2` a number it is 93's compare-and-set (lands only if the
// stream still ends at `?2`); with `?2` NULL it goes at the end. With a fence `?7`, it lands only
// while that fence holds a live lease on this stream or on a prefix of it. UNIQUE(stream, rev)
// backs it up if a driver ever ran two of these at once.
const insert = `INSERT INTO events (stream, rev, writer, kind, at, data, id)
	SELECT ?1, coalesce((SELECT max(rev) FROM events WHERE stream = ?1), 0) + 1, ?3, ?4, ?5, ?6, ?8
	WHERE (?2 IS NULL OR (SELECT coalesce(max(rev), 0) FROM events WHERE stream = ?1) = ?2)
	AND (?7 IS NULL OR EXISTS (
		SELECT 1 FROM leases WHERE fence = ?7 AND expires_at > ?5 AND ${under("?1", "leases.stream")}
	))
	RETURNING pos, rev`;

const fenceHolds = `SELECT 1 FROM leases
	WHERE fence = ?2 AND expires_at > ?3 AND ${under("?1", "leases.stream")}`;

export function append(
	db: Db,
	now: number,
	stream: string,
	expected: Expected,
	event: Event,
	fence: number | null = null,
): AppendResult {
	return db.tx(() => {
		const id = event.id ?? null;
		// The fence first, as Kafka checks a producer's epoch before its sequence: a writer that
		// lost its lease hears `fenced` for every write, even a repeat of one that landed while it
		// held the lease. Found in this experiment's first run: answered `dup` (ok), a frozen
		// owner's final save looked accepted, and it did not learn it had lost.
		if (fence !== null && !db.all(fenceHolds, stream, fence, now)[0])
			return {ok: false, why: "fenced"};
		if (id !== null) {
			// A repeat of a message id: answered with the first one's place, nothing written.
			const seen = db.all("SELECT pos, rev FROM events WHERE stream = ? AND id = ?", stream, id)[0];
			if (seen) return {ok: true, pos: num(seen.pos), rev: num(seen.rev), dup: true};
		}
		const data = JSON.stringify(event.data ?? {});
		const row = db.all(
			insert,
			stream,
			expected === "any" ? null : expected,
			event.writer,
			event.kind,
			now,
			data,
			fence,
			id,
		)[0];
		if (row) return {ok: true, pos: num(row.pos), rev: num(row.rev), dup: false};
		const rev = revOf(db, stream);
		if (expected !== "any" && rev !== expected) return {ok: false, why: "stale", rev};
		return {ok: false, why: "fenced"};
	});
}

export function claim(
	db: Db,
	now: number,
	stream: string,
	holder: string,
	expectedRev: number,
	ttlMs: number,
	graceMs: number,
): ClaimResult {
	return db.tx(() => {
		const live = db.all(
			"SELECT holder, expires_at, fence FROM leases WHERE stream = ? AND expires_at > ?",
			stream,
			now,
		)[0];
		if (live)
			return {ok: false, why: "held", holder: str(live.holder), expiresAt: num(live.expires_at)};
		const old = db.all("SELECT fence FROM leases WHERE stream = ?", stream)[0];
		const expiresAt = now + ttlMs;
		const data = JSON.stringify({holder, ttlMs, expiresAt, replaces: old ? num(old.fence) : null});
		const row = db.all(insert, stream, expectedRev, holder, "claimed", now, data, null, null)[0];
		if (!row) return {ok: false, why: "stale", rev: revOf(db, stream)};
		const fence = num(row.pos);
		// Guarded: replaces a lease row only if it has run out (lazy expiry, no alarm needed).
		db.all(
			`INSERT INTO leases (stream, holder, expires_at, fence, stop) VALUES (?1, ?2, ?3, ?4, 0)
			ON CONFLICT (stream) DO UPDATE SET holder = ?2, expires_at = ?3, fence = ?4, stop = 0
			WHERE leases.expires_at <= ?5`,
			stream,
			holder,
			expiresAt,
			fence,
			now,
		);
		scheduleExpiry(db, stream, expiresAt + graceMs);
		return {ok: true, fence, rev: num(row.rev), expiresAt};
	});
}

export function renew(
	db: Db,
	now: number,
	stream: string,
	fence: number,
	ttlMs: number,
	graceMs: number,
): RenewResult {
	return db.tx(() => {
		const lease = db.all(
			"SELECT expires_at, stop FROM leases WHERE stream = ? AND fence = ?",
			stream,
			fence,
		)[0];
		if (!lease || num(lease.expires_at) <= now) return {ok: false, why: "lost"};
		if (num(lease.stop) === 1) return {ok: false, why: "stop"};
		const expiresAt = now + ttlMs;
		db.all(
			"UPDATE leases SET expires_at = ? WHERE stream = ? AND fence = ?",
			expiresAt,
			stream,
			fence,
		);
		scheduleExpiry(db, stream, expiresAt + graceMs);
		return {ok: true, expiresAt};
	});
}

/** A person's cancel: always lands (at the stream's end), and tells the holder to stop. */
export function cancel(db: Db, now: number, stream: string, writer: string): AppendResult {
	return db.tx(() => {
		const res = append(db, now, stream, "any", {kind: "cancel", writer});
		db.all("UPDATE leases SET stop = 1 WHERE stream = ?", stream);
		return res;
	});
}

const scheduleExpiry = (db: Db, stream: string, dueAt: number): void => {
	db.all(
		`INSERT INTO jobs (id, due_at, kind, stream) VALUES (?1, ?2, 'lease_expiry', ?3)
		ON CONFLICT (id) DO UPDATE SET due_at = ?2`,
		`lease:${stream}`,
		dueAt,
		stream,
	);
};

/** The earliest job, or null: the one alarm is always set to this. */
export const nextDue = (db: Db): number | null => {
	const v = db.all("SELECT min(due_at) AS due FROM jobs")[0]?.due;
	return v === null || v === undefined ? null : num(v);
};

/** What the alarm wrote: the caller wakes the tails of these streams. */
export type Written = {stream: string; rev: number; pos: number};

/** Runs every due job. Each one is its own transaction, and checks again before it writes. */
export function runDue(db: Db, now: number): Written[] {
	const written: Written[] = [];
	const due = db.all("SELECT id, stream FROM jobs WHERE due_at <= ? ORDER BY due_at", now);
	for (const job of due) {
		db.tx(() => {
			const stream = str(job.stream);
			const lease = db.all(
				"SELECT fence, holder FROM leases WHERE stream = ? AND expires_at <= ?",
				stream,
				now,
			)[0];
			if (lease) {
				const fence = num(lease.fence);
				const res = append(db, now, stream, "any", {
					kind: "lease_expired",
					writer: "ledger",
					data: {fence, holder: str(lease.holder)},
				});
				db.all("DELETE FROM leases WHERE stream = ? AND fence = ?", stream, fence);
				if (res.ok) written.push({stream, rev: res.rev, pos: res.pos});
			}
			// Delete the job only if it was not moved on by a renew or a new claim meanwhile.
			db.all("DELETE FROM jobs WHERE id = ? AND due_at <= ?", str(job.id), now);
		});
	}
	return written;
}

/** The log after `fromPos`; with a prefix, only that stream and the streams under it. */
export const read = (db: Db, fromPos: number, limit: number, prefix: string | null = null): Row[] =>
	prefix === null
		? db.all("SELECT * FROM events WHERE pos > ? ORDER BY pos LIMIT ?", fromPos, limit)
		: db.all(
				`SELECT * FROM events WHERE pos > ?1 AND ${under("stream", "?3")} ORDER BY pos LIMIT ?2`,
				fromPos,
				limit,
				prefix,
			);

/** One stream after `fromRev`, in rev order. `limit` -1: all of it. */
export const readStream = (db: Db, stream: string, fromRev = 0, limit = -1): Row[] =>
	db.all(
		"SELECT * FROM events WHERE stream = ? AND rev > ? ORDER BY rev LIMIT ?",
		stream,
		fromRev,
		limit,
	);

/**
 * The last `count` events of one stream, in rev order: EventStoreDB's read backwards from the
 * end. A replay needs only the last saved state, not every state before it.
 */
export const readLast = (db: Db, stream: string, count: number): Row[] =>
	db.all(
		"SELECT * FROM (SELECT * FROM events WHERE stream = ? ORDER BY rev DESC LIMIT ?) ORDER BY rev",
		stream,
		count,
	);

export const lease = (db: Db, stream: string): Row | null =>
	db.all("SELECT * FROM leases WHERE stream = ?", stream)[0] ?? null;

export const openCriteria = (db: Db, stream: string): Row[] =>
	db.all("SELECT id, text, pos FROM open_criteria WHERE stream = ? ORDER BY pos", stream);

/**
 * The streams whose tails hear of an append to `stream`: the stream itself, and every prefix it
 * sits under (`a/b/c` wakes `a/b/c`, prefix `a/b`, prefix `a`). Driver-free, so both drivers and
 * the laws share it.
 */
export const wakeTags = (stream: string): string[] => {
	const parts = stream.split("/");
	const prefixes = parts.slice(0, -1).map((_, i) => `p:${parts.slice(0, i + 1).join("/")}`);
	return [`s:${stream}`, `p:${stream}`, ...prefixes];
};
