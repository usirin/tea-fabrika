// The ledger's SQL and its rules, written once. Two drivers run it: the Durable Object
// (`ledger.ts`, inside workerd) and node:sqlite (`node-ledger.ts`, a file on disk).
// Correctness comes only from SQL inside one transaction. The alarm only writes the log
// line for a lease that ran out; a claim after `expires_at` works without it.

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

export type Event = {kind: string; writer: string; data?: unknown};

export type AppendResult =
	| {ok: true; pos: number; rev: number}
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

// The compare-and-set itself: one INSERT that lands only if the stream still ends at
// `expectedRev` and, when a fence is given, that fence holds a live lease. UNIQUE(stream, rev)
// backs it up if a driver ever ran two of these at once.
const casInsert = `INSERT INTO events (stream, rev, writer, kind, at, data)
	SELECT ?1, ?2 + 1, ?3, ?4, ?5, ?6
	WHERE (SELECT coalesce(max(rev), 0) FROM events WHERE stream = ?1) = ?2
	AND (?7 IS NULL OR EXISTS (
		SELECT 1 FROM leases WHERE stream = ?1 AND fence = ?7 AND expires_at > ?5
	))
	RETURNING pos, rev`;

export function append(
	db: Db,
	now: number,
	stream: string,
	expectedRev: number,
	event: Event,
	fence: number | null = null,
): AppendResult {
	return db.tx(() => {
		const data = JSON.stringify(event.data ?? {});
		const row = db.all(
			casInsert,
			stream,
			expectedRev,
			event.writer,
			event.kind,
			now,
			data,
			fence,
		)[0];
		if (row) return {ok: true, pos: num(row.pos), rev: num(row.rev)};
		const rev = revOf(db, stream);
		if (rev !== expectedRev) return {ok: false, why: "stale", rev};
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
		const row = db.all(casInsert, stream, expectedRev, holder, "claimed", now, data, null)[0];
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
		const rev = revOf(db, stream);
		const res = append(db, now, stream, rev, {kind: "cancel", writer});
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

/** Runs every due job. Each one is its own transaction, and checks again before it writes. */
export function runDue(db: Db, now: number): number {
	let expired = 0;
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
				append(db, now, stream, revOf(db, stream), {
					kind: "lease_expired",
					writer: "ledger",
					data: {fence, holder: str(lease.holder)},
				});
				db.all("DELETE FROM leases WHERE stream = ? AND fence = ?", stream, fence);
				expired++;
			}
			// Delete the job only if it was not moved on by a renew or a new claim meanwhile.
			db.all("DELETE FROM jobs WHERE id = ? AND due_at <= ?", str(job.id), now);
		});
	}
	return expired;
}

export const read = (db: Db, fromPos: number, limit: number): Row[] =>
	db.all("SELECT * FROM events WHERE pos > ? ORDER BY pos LIMIT ?", fromPos, limit);

export const readStream = (db: Db, stream: string): Row[] =>
	db.all("SELECT * FROM events WHERE stream = ? ORDER BY rev", stream);

export const lease = (db: Db, stream: string): Row | null =>
	db.all("SELECT * FROM leases WHERE stream = ?", stream)[0] ?? null;

export const openCriteria = (db: Db, stream: string): Row[] =>
	db.all("SELECT id, text, pos FROM open_criteria WHERE stream = ? ORDER BY pos", stream);
