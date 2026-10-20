// The ledger's rules, in SQL, with no driver: the Durable Object (`durable-object.ts`) and
// node:sqlite (`sqlite-driver.ts`) both run this file. Lifted from experiment 97's one ledger
// (experiments/97-one-ledger/sql.ts), with one change of rule: deny by default.
//
//   - A name is registered before anything is written under it: `register(name)`, Kafka's
//     CreateTopics with `auto.create.topics.enable` off, OTP's `register/2`. Any write under a
//     name nobody registered (its streams, its inbox, a claim, a cancel) is `unknown`: Kafka's
//     UNKNOWN_TOPIC_OR_PARTITION, OTP's `noproc`. 97 let anything land until a first claim.
//   - A registered name is guarded from its registration on: only its lease's fence writes its
//     streams. 97 guarded it only from its first claim, which left a window.
//   - Its one open door is exactly `<name>/inbox`. 97 opened any stream whose last segment was
//     `inbox`, so `counter:1/x/inbox` was open too.
//   - Registering is idempotent: a second `register` of the same name answers `created: false`
//     and writes nothing. A name inside a registered name, around one, or an inbox is refused.
//
// Every check runs in one transaction with the write, as in 93 to 97. The order in `append`: the
// name (`unknown`), the fence or the guard (`fenced`, `denied`), the message id (`dup`), then the
// rev (`stale`). The alarm only writes the log line for a lease that ran out.
//
// Erasable TypeScript only: workerd gets this file with its types stripped, and no imports.

export type Value = string | number | null;
export type SqlRow = Record<string, Value>;

/** What a driver gives: run SQL, and run a function as one transaction (an inner one joins it). */
export interface Db {
	all(sql: string, ...bind: Value[]): SqlRow[];
	tx<T>(fn: () => T): T;
}

/** `id`: the message id. Unique per stream: a repeat is answered `dup`, not written. */
export type Event = {kind: string; writer: string; data?: unknown; id?: string | null};

/** The rev the stream must end at, or "any": at the end (EventStoreDB's `Any`). */
export type Expected = number | "any";

export type AppendResult =
	| {ok: true; pos: number; rev: number; dup: boolean}
	/** EventStoreDB's WrongExpectedVersion. */
	| {ok: false; why: "stale"; rev: number}
	/** Kafka's ProducerFenced: the fence names no live lease that may write here. */
	| {ok: false; why: "fenced"}
	/** EventStoreDB's AccessDenied: a registered name's stream, written with no fence. */
	| {ok: false; why: "denied"}
	/** Kafka's UNKNOWN_TOPIC_OR_PARTITION: under no registered name. */
	| {ok: false; why: "unknown"};
export type ClaimResult =
	| {ok: true; fence: number; rev: number; expiresAt: number}
	| {ok: false; why: "held"; holder: string; expiresAt: number}
	| {ok: false; why: "stale"; rev: number}
	| {ok: false; why: "denied"}
	| {ok: false; why: "unknown"};
export type RenewResult =
	| {ok: true; expiresAt: number}
	| {ok: false; why: "lost"}
	| {ok: false; why: "stop"};
export type RegisterResult =
	/** `created: false`: it was registered already; nothing was written. */
	{ok: true; created: boolean; pos: number; rev: number} | {ok: false; why: "denied"};
export type CancelResult = {ok: true; pos: number; rev: number} | {ok: false; why: "unknown"};

/** Numbered migrations; the last id run is kept in `migrations`. */
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
			id TEXT,
			UNIQUE (stream, rev)
		)`,
		"CREATE UNIQUE INDEX events_stream_id ON events (stream, id) WHERE id IS NOT NULL",
		`CREATE TABLE leases (
			stream TEXT PRIMARY KEY,
			holder TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			fence INTEGER NOT NULL,
			stop INTEGER NOT NULL DEFAULT 0
		)`,
		"CREATE INDEX leases_fence ON leases (fence)",
		`CREATE TABLE jobs (
			id TEXT PRIMARY KEY,
			due_at INTEGER NOT NULL,
			kind TEXT NOT NULL,
			stream TEXT NOT NULL
		)`,
		"CREATE INDEX jobs_due ON jobs (due_at)",
	],
	// The registered names: `pos` is the `registered` event's place in the log.
	["CREATE TABLE names (name TEXT PRIMARY KEY, pos INTEGER NOT NULL, at INTEGER NOT NULL)"],
];

/** Runs every migration newer than the last one kept, in one transaction. */
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
 * Is `stream` the prefix's own stream or under it? `'/'` sorts just before `'0'`, so the streams
 * under `p` are exactly those `>= 'p/'` and `< 'p0'`: `counter:10` is not under `counter:1`.
 */
const under = (stream: string, prefix: string) =>
	`(${stream} = ${prefix} OR (${stream} >= ${prefix} || '/' AND ${stream} < ${prefix} || '0'))`;

/** `a/b/c` sits under `a`, `a/b` and itself. */
export const namesOver = (stream: string): string[] => {
	const parts = stream.split("/");
	return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** A stream whose last segment is `inbox`. Whether it is an open door depends on the rules. */
export const isInbox = (stream: string): boolean => stream.endsWith("/inbox");

/** A name a `register` may take: no empty segment, and not an inbox. */
export const isNameShape = (name: string): boolean =>
	name.length > 0 && !name.split("/").includes("") && !isInbox(name) && name !== "inbox";

/**
 * The rules, in one place. `RULES` is the ledger. Each planted mistake below changes one, so the
 * laws can be seen to fail on it (the laws' harness only; nothing else runs them).
 */
export type Rules = {
	/** "required": deny by default. "first-claim": 97's ledger, where a first claim registers. */
	readonly registration: "required" | "first-claim";
	/** A claim of a name nobody registered registers it (Kafka's `auto.create.topics.enable`). */
	readonly claimRegisters: boolean;
	/** An inbox is open only under a registered name. */
	readonly inboxNeedsName: boolean;
	/** No name inside a registered name, around one, or on an inbox. */
	readonly nestGuard: boolean;
	/** A second `register` writes nothing. */
	readonly registerOnce: boolean;
	/** "ever": a registered name stays guarded. "live": only while a lease is live. "off": 95, 96. */
	readonly guard: "ever" | "live" | "off";
	/** The inbox takes unfenced appends. */
	readonly inboxOpen: boolean;
	/** Where a fence writes: its name's streams and every inbox; its name only; or an inbox ignores it. */
	readonly reach: "name-and-inboxes" | "name-only" | "inbox-ignores-fence";
	/** The fence is checked before the message id. */
	readonly fenceFirst: boolean;
};

export const RULES: Rules = {
	registration: "required",
	claimRegisters: false,
	inboxNeedsName: true,
	nestGuard: true,
	registerOnce: true,
	guard: "ever",
	inboxOpen: true,
	reach: "name-and-inboxes",
	fenceFirst: true,
};

/** One wrong rule each: what the laws must catch. The first five are new in 98. */
export const PLANTED = {
	"no registration (97: anything lands until a first claim)": {
		...RULES,
		registration: "first-claim",
	},
	"a claim registers its name (Kafka's auto-create)": {...RULES, claimRegisters: true},
	"an inbox of a name nobody registered is open": {...RULES, inboxNeedsName: false},
	"a name inside or around a registered name is allowed": {...RULES, nestGuard: false},
	"a second register writes a second event": {...RULES, registerOnce: false},
	"no guard (95 and 96: an unfenced write under a name lands)": {...RULES, guard: "off"},
	"guard only while a lease is live": {...RULES, guard: "live"},
	"the inbox closed too": {...RULES, inboxOpen: false},
	"a fence reaches only its own name (96's prefix lease)": {...RULES, reach: "name-only"},
	"an inbox ignores the fence it is given": {...RULES, reach: "inbox-ignores-fence"},
	"the id checked before the fence (96's first run)": {...RULES, fenceFirst: false},
} as const satisfies Record<string, Rules>;
export type Planted = keyof typeof PLANTED;

const marks = (xs: readonly string[]) => xs.map(() => "?").join(", ");

/** The registered name `stream` sits under (or is), or null. */
const ownerOf = (db: Db, stream: string): string | null => {
	const over = namesOver(stream);
	const row = db.all(
		`SELECT name FROM names WHERE name IN (${marks(over)}) ORDER BY length(name) LIMIT 1`,
		...over,
	)[0];
	return row ? str(row.name) : null;
};

/** Is `stream` an open door: exactly a registered name's inbox (or, without names, any inbox)? */
const isOpenInbox = (db: Db, rules: Rules, stream: string): boolean => {
	if (!isInbox(stream)) return false;
	if (rules.registration === "first-claim" || !rules.inboxNeedsName) return true;
	return ownerOf(db, stream) === stream.slice(0, -"/inbox".length);
};

/** Would `name` sit inside a registered name, around one, or on an inbox? */
const nested = (db: Db, name: string): boolean => {
	const outer = namesOver(name).slice(0, -1);
	const inside =
		outer.length > 0 &&
		!!db.all(`SELECT 1 FROM names WHERE name IN (${marks(outer)})`, ...outer)[0];
	const around = !!db.all(
		"SELECT 1 FROM names WHERE name >= ?1 || '/' AND name < ?1 || '0'",
		name,
	)[0];
	return inside || around || isInbox(name);
};

/** May the lease this fence names write `stream`, now? */
const fenceHolds = (db: Db, rules: Rules, now: number, stream: string, fence: number): boolean => {
	if (rules.reach === "inbox-ignores-fence" && isOpenInbox(db, rules, stream)) return true;
	const lease = db.all(
		"SELECT stream FROM leases WHERE fence = ? AND expires_at > ?",
		fence,
		now,
	)[0];
	if (!lease) return false;
	const name = str(lease.stream);
	const own = stream === name || stream.startsWith(`${name}/`);
	return own || (rules.reach === "name-and-inboxes" && isOpenInbox(db, rules, stream));
};

/** With no fence: is `stream` written only by its owner's lease? */
const guarded = (db: Db, rules: Rules, now: number, stream: string, owner: string | null) => {
	if (rules.guard === "off" || owner === null) return false;
	if (rules.inboxOpen && isOpenInbox(db, rules, stream)) return false;
	if (rules.guard === "live")
		return !!db.all("SELECT 1 FROM leases WHERE stream = ? AND expires_at > ?", owner, now)[0];
	return true;
};

// The write itself: with `?2` a number, 93's compare-and-set; with `?2` NULL, at the end.
const insert = `INSERT INTO events (stream, rev, writer, kind, at, data, id)
	SELECT ?1, coalesce((SELECT max(rev) FROM events WHERE stream = ?1), 0) + 1, ?3, ?4, ?5, ?6, ?7
	WHERE (?2 IS NULL OR (SELECT coalesce(max(rev), 0) FROM events WHERE stream = ?1) = ?2)
	RETURNING pos, rev`;

const seen = (db: Db, stream: string, id: string | null) =>
	id === null
		? null
		: (db.all("SELECT pos, rev FROM events WHERE stream = ? AND id = ?", stream, id)[0] ?? null);

/** The ledger's own writes (registrations, claims, cancels, expiries): no name check, no fence. */
const write = (
	db: Db,
	now: number,
	stream: string,
	expected: Expected,
	event: Event,
): AppendResult => {
	const id = event.id ?? null;
	const repeat = seen(db, stream, id);
	if (repeat) return {ok: true, pos: num(repeat.pos), rev: num(repeat.rev), dup: true};
	const data = JSON.stringify(event.data ?? {});
	const row = db.all(
		insert,
		stream,
		expected === "any" ? null : expected,
		event.writer,
		event.kind,
		now,
		data,
		id,
	)[0];
	if (row) return {ok: true, pos: num(row.pos), rev: num(row.rev), dup: false};
	return {ok: false, why: "stale", rev: revOf(db, stream)};
};

export const registerWith =
	(rules: Rules) =>
	(db: Db, now: number, name: string, writer: string): RegisterResult =>
		db.tx(() => {
			if (!isNameShape(name)) return {ok: false, why: "denied"};
			const known = db.all("SELECT pos FROM names WHERE name = ?", name)[0];
			if (known && rules.registerOnce) {
				const pos = num(known.pos);
				const rev = num(db.all("SELECT rev FROM events WHERE pos = ?", pos)[0]?.rev);
				return {ok: true, created: false, pos, rev};
			}
			if (!known && rules.nestGuard && nested(db, name)) return {ok: false, why: "denied"};
			const res = write(db, now, name, "any", {kind: "registered", writer});
			if (!res.ok) return {ok: false, why: "denied"};
			db.all("INSERT OR IGNORE INTO names (name, pos, at) VALUES (?, ?, ?)", name, res.pos, now);
			return {ok: true, created: true, pos: res.pos, rev: res.rev};
		});

export const register = registerWith(RULES);

export const appendWith =
	(rules: Rules) =>
	(
		db: Db,
		now: number,
		stream: string,
		expected: Expected,
		event: Event,
		fence: number | null = null,
	): AppendResult =>
		db.tx(() => {
			if (!rules.fenceFirst) {
				const repeat = seen(db, stream, event.id ?? null);
				if (repeat) return {ok: true, pos: num(repeat.pos), rev: num(repeat.rev), dup: true};
			}
			const owner = ownerOf(db, stream);
			// Deny by default: nothing lands under a name nobody registered.
			if (owner === null && rules.registration === "required" && !isOpenInbox(db, rules, stream))
				return {ok: false, why: "unknown"};
			// Who may write: a fence that names a live lease allowed here, or, with no fence, a stream
			// no registered name guards. A writer that lost its lease hears `fenced` even for a repeat
			// of a write that landed while it held it.
			if (fence !== null && !fenceHolds(db, rules, now, stream, fence))
				return {ok: false, why: "fenced"};
			if (fence === null && guarded(db, rules, now, stream, owner))
				return {ok: false, why: "denied"};
			return write(db, now, stream, expected, event);
		});

export const append = appendWith(RULES);

export const claimWith =
	(rules: Rules) =>
	(
		db: Db,
		now: number,
		name: string,
		holder: string,
		expectedRev: number,
		ttlMs: number,
		graceMs: number,
	): ClaimResult =>
		db.tx(() => {
			const registered = !!db.all("SELECT 1 FROM names WHERE name = ?", name)[0];
			if (!registered) {
				// A lease's fence writes everything under its name: no lease inside or around another name.
				if (rules.nestGuard && nested(db, name)) return {ok: false, why: "denied"};
				if (rules.registration === "required" && !rules.claimRegisters)
					return {ok: false, why: "unknown"};
			}
			const live = db.all(
				"SELECT holder, expires_at FROM leases WHERE stream = ? AND expires_at > ?",
				name,
				now,
			)[0];
			if (live)
				return {ok: false, why: "held", holder: str(live.holder), expiresAt: num(live.expires_at)};
			const old = db.all("SELECT fence FROM leases WHERE stream = ?", name)[0];
			const expiresAt = now + ttlMs;
			const data = {holder, ttlMs, expiresAt, replaces: old ? num(old.fence) : null};
			const res = write(db, now, name, expectedRev, {kind: "claimed", writer: holder, data});
			if (!res.ok) return {ok: false, why: "stale", rev: revOf(db, name)};
			const fence = res.pos;
			// Replaces a lease row only if it has run out (lazy expiry, no alarm needed).
			db.all(
				`INSERT INTO leases (stream, holder, expires_at, fence, stop) VALUES (?1, ?2, ?3, ?4, 0)
				ON CONFLICT (stream) DO UPDATE SET holder = ?2, expires_at = ?3, fence = ?4, stop = 0
				WHERE leases.expires_at <= ?5`,
				name,
				holder,
				expiresAt,
				fence,
				now,
			);
			if (!registered)
				db.all("INSERT OR IGNORE INTO names (name, pos, at) VALUES (?, ?, ?)", name, fence, now);
			scheduleExpiry(db, name, expiresAt + graceMs);
			return {ok: true, fence, rev: res.rev, expiresAt};
		});

export const claim = claimWith(RULES);

export function renew(
	db: Db,
	now: number,
	name: string,
	fence: number,
	ttlMs: number,
	graceMs: number,
): RenewResult {
	return db.tx(() => {
		const lease = db.all(
			"SELECT expires_at, stop FROM leases WHERE stream = ? AND fence = ?",
			name,
			fence,
		)[0];
		if (!lease || num(lease.expires_at) <= now) return {ok: false, why: "lost"};
		if (num(lease.stop) === 1) return {ok: false, why: "stop"};
		const expiresAt = now + ttlMs;
		db.all(
			"UPDATE leases SET expires_at = ? WHERE stream = ? AND fence = ?",
			expiresAt,
			name,
			fence,
		);
		scheduleExpiry(db, name, expiresAt + graceMs);
		return {ok: true, expiresAt};
	});
}

/** A person's cancel of a registered name: lands at its end, and tells the holder to stop. */
export function cancel(db: Db, now: number, name: string, writer: string): CancelResult {
	return db.tx(() => {
		if (!db.all("SELECT 1 FROM names WHERE name = ?", name)[0]) return {ok: false, why: "unknown"};
		const res = write(db, now, name, "any", {kind: "cancel", writer});
		db.all("UPDATE leases SET stop = 1 WHERE stream = ?", name);
		return res.ok ? {ok: true, pos: res.pos, rev: res.rev} : {ok: false, why: "unknown"};
	});
}

const scheduleExpiry = (db: Db, name: string, dueAt: number): void => {
	db.all(
		`INSERT INTO jobs (id, due_at, kind, stream) VALUES (?1, ?2, 'lease_expiry', ?3)
		ON CONFLICT (id) DO UPDATE SET due_at = ?2`,
		`lease:${name}`,
		dueAt,
		name,
	);
};

/** The earliest job, or null: the one alarm is always set to this. */
export const nextDue = (db: Db): number | null => {
	const v = db.all("SELECT min(due_at) AS due FROM jobs")[0]?.due;
	return v === null || v === undefined ? null : num(v);
};

/** What the alarm wrote: the caller wakes the watchers of these streams. */
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
				const res = write(db, now, stream, "any", {
					kind: "lease_expired",
					writer: "ledger",
					data: {fence, holder: str(lease.holder)},
				});
				db.all("DELETE FROM leases WHERE stream = ? AND fence = ?", stream, fence);
				if (res.ok) written.push({stream, rev: res.rev, pos: res.pos});
			}
			// Delete the job only if a renew or a new claim did not move it on meanwhile.
			db.all("DELETE FROM jobs WHERE id = ? AND due_at <= ?", str(job.id), now);
		});
	}
	return written;
}

/** The log after `fromPos`; with a prefix, only that stream and the streams under it. */
export const read = (db: Db, fromPos: number, limit: number, prefix: string | null = null) =>
	prefix === null
		? db.all("SELECT * FROM events WHERE pos > ? ORDER BY pos LIMIT ?", fromPos, limit)
		: db.all(
				`SELECT * FROM events WHERE pos > ?1 AND ${under("stream", "?3")} ORDER BY pos LIMIT ?2`,
				fromPos,
				limit,
				prefix,
			);

/** One stream after `fromRev`, in rev order. `limit` -1: all of it. */
export const readStream = (db: Db, stream: string, fromRev = 0, limit = -1) =>
	db.all(
		"SELECT * FROM events WHERE stream = ? AND rev > ? ORDER BY rev LIMIT ?",
		stream,
		fromRev,
		limit,
	);

/** The last `count` events of one stream, in rev order: EventStoreDB's read backwards. */
export const readLast = (db: Db, stream: string, count: number) =>
	db.all(
		"SELECT * FROM (SELECT * FROM events WHERE stream = ? ORDER BY rev DESC LIMIT ?) ORDER BY rev",
		stream,
		count,
	);

export const lease = (db: Db, name: string): SqlRow | null =>
	db.all("SELECT * FROM leases WHERE stream = ?", name)[0] ?? null;

/**
 * The tags whose watchers hear of a write to `stream`: the stream itself, and every prefix it
 * sits under (`a/b/c` wakes `a/b/c`, prefix `a/b`, prefix `a`).
 */
export const wakeTags = (stream: string): string[] => {
	const parts = stream.split("/");
	const prefixes = parts.slice(0, -1).map((_, i) => `p:${parts.slice(0, i + 1).join("/")}`);
	return [`s:${stream}`, `p:${stream}`, ...prefixes];
};
