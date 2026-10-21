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
// New in experiment 99: OTP's exits, monitors, links and the supervisor's start, as the ledger's
// own writes, each in one transaction (the Erlang VM does these in the runtime, not in a process):
//
//   - `exit`: the lease holder says its program ended (`normal`, `shutdown` or `crash`). The name
//     is down from then on: its lease is gone and no claim lands until it is restarted. An
//     incarnation (the run's number, OTP's pid: a restart starts a new one, a host takeover does
//     not) ends once.
//   - In the same transaction: every monitor of that incarnation gets one `DOWN` in its watcher's
//     inbox, and every linked name either gets an `EXIT` in its inbox (it traps exits) or exits
//     too, with the same reason (it does not; a `normal` exit does not spread).
//   - `startChild`: OTP's `supervisor:start_child` and restart. The caller becomes the child's
//     parent, the only name that may restart it, and is linked to it.
//   - A crash names the inbox message it suspects (the first one past the last saved state). A
//     message named by `maxDeliveries` crashes in a row goes to `<name>/dead`, and hosts feed past
//     it: SQS's redrive policy (`maxReceiveCount`), RabbitMQ's `delivery-limit`.
//   - A lease that runs out is not an exit: the name lives on, and any host takes it over.
//
// New in experiment 100: `exitChild`, OTP's `exit(Child, shutdown)` and `exit(Child, kill)`, which
// a supervisor uses to stop a child (its `shutdown` option). Only the child's parent may send one,
// and only to the incarnation it names. A `shutdown` to a child that traps exits is an EXIT in its
// inbox (it may clean up, then exit); to any other child it is its exit. A `kill` is the exit,
// trap or not, with the reason `killed`. Every EXIT now names the incarnation it is for (`to`): a
// program that starts again must not obey an EXIT its earlier run never read.
//
// New in experiment 102: limits, a container's `resources.limits` and the cgroup that enforces them.
// A name may carry limits: dollars, tokens (cgroup v2's `memory.max`, for spend), wall time
// (Kubernetes' `activeDeadlineSeconds`) and how many children run under it at once (cgroup's
// `pids.max`; OTP's `max_children` is its one-level case). The ledger is the referee, as the kernel
// is for a cgroup: a host only reports what its run spent.
//
//   - Spend is kept per name and counted up the tree (cgroup v2's hierarchical accounting): a charge
//     to a scout counts on the scout, its builder and its ticket. A restart or a takeover never
//     resets it. A charge id counts once.
//   - `hold` before a turn, `charge` after: a card's authorization hold and its capture. A hold
//     that does not fit under a limit, anywhere up the tree, is refused (admission, like a
//     ResourceQuota counting `requests`), and that limit's name ends. A charge always lands (the
//     money is spent), even from a host that lost its lease; past a limit, that name ends.
//   - Ending is `exited` with reason `limit:<kind>` (Kubernetes' `OOMKilled`, `DeadlineExceeded`),
//     a kill no trap stops, and one `limit` record in `<name>/dead`. Its links get `killed`, as
//     OTP's `exit(Pid, kill)` spreads, so a parent outside the limit is not blamed; its parent's
//     EXIT says `limit:<kind>`, so a supervisor knows not to restart it.
//   - A start past a `children` limit is refused, not ended: OTP's `{error, max_children}`.
//   - Wall time counts from the name's registration, across restarts, as a Job's deadline does.
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
	| {ok: true; fence: number; rev: number; expiresAt: number; incarnation: number}
	| {ok: false; why: "held"; holder: string; expiresAt: number}
	| {ok: false; why: "stale"; rev: number}
	| {ok: false; why: "denied"}
	| {ok: false; why: "unknown"}
	/** The name exited (at the `exited` event's `pos`) and waits for its parent to restart it. */
	| {ok: false; why: "down"; pos: number};
export type RenewResult =
	| {ok: true; expiresAt: number}
	| {ok: false; why: "lost"}
	| {ok: false; why: "stop"};
export type RegisterResult =
	/** `created: false`: it was registered already; nothing was written. */
	{ok: true; created: boolean; pos: number; rev: number} | {ok: false; why: "denied"};
export type CancelResult = {ok: true; pos: number; rev: number} | {ok: false; why: "unknown"};

/**
 * Why a program ended, in OTP's words: `normal` (it returned), `shutdown` (it was told to stop, or
 * its supervisor gave up) or `crash` (anything else: its update threw, an Effect died). A DOWN or an
 * EXIT may also say `noproc`: there was no such running name to watch or link.
 */
export type ExitReason = "normal" | "shutdown" | "crash";
/**
 * How a run ended, as its DOWN and EXIT say it: an `ExitReason`, or `killed` (100: its parent
 * killed it, OTP's `exit(Pid, kill)`, which no trap stops). A program never exits `killed` itself.
 */
export type EndReason = ExitReason | "killed" | LimitReason;
export type DownReason = EndReason | "noproc";

// ---------------------------------------------------------------- 102: limits

/** What a run spent, as it reports it: dollars and tokens. Each 0 or more. */
export type Cost = {usd?: number; tokens?: number};
/**
 * A name's limits, each left out for none. `usd` and `tokens`: spend over its whole subtree.
 * `wallMs`: from its registration. `children`: names running under it at once, at any depth.
 */
export type Limits = {usd?: number; tokens?: number; wallMs?: number; children?: number};
export type LimitKind = "usd" | "tokens" | "wall" | "children";
/** How a run its limit ended exits: Kubernetes' `OOMKilled` and `DeadlineExceeded`, one per kind. */
export type LimitReason = "limit:usd" | "limit:tokens" | "limit:wall";
export const isLimitReason = (r: string): r is LimitReason =>
	r === "limit:usd" || r === "limit:tokens" || r === "limit:wall";
/** A limit hit: which kind, whose (`at`), what was used (with what was asked, for a refusal) and its max. */
export type Over = {kind: LimitKind; at: string; used: number; max: number};

/** Why a set of limits cannot be kept, or null. */
export const limitsRefusal = (l: Limits): string | null => {
	const whole = (v: number | undefined) => v === undefined || (Number.isInteger(v) && v >= 0);
	if (l.usd !== undefined && !(Number.isFinite(l.usd) && l.usd >= 0))
		return "usd is a number, 0 or more";
	if (!whole(l.tokens)) return "tokens is a whole number, 0 or more";
	if (l.wallMs !== undefined && !(Number.isInteger(l.wallMs) && l.wallMs > 0))
		return "wallMs is a whole number, more than 0";
	if (!whole(l.children)) return "children is a whole number, 0 or more";
	return null;
};
const costOk = (c: Cost): boolean =>
	(c.usd === undefined || (Number.isFinite(c.usd) && c.usd >= 0)) &&
	(c.tokens === undefined || (Number.isInteger(c.tokens) && c.tokens >= 0));
/** Dollars are kept as whole micro-dollars, so sums never drift. */
export const micros = (usd: number | undefined): number => Math.round((usd ?? 0) * 1_000_000);

export type HoldResult =
	/** `dup`: a hold (or the charge) under this id is there already; nothing changed. */
	| {ok: true; dup: boolean; written: readonly Written[]}
	| {ok: false; why: "fenced"}
	/** A cost that is not one: a negative number, a fraction of a token. */
	| {ok: false; why: "denied"}
	/** It does not fit under `over.at`'s limit: nothing is held, and `over.at` has ended. */
	| {ok: false; why: "limit"; over: Over; written: readonly Written[]};
export type ChargeResult =
	/** `over`: the charge crossed this limit, and its name has ended. */
	| {ok: true; dup: boolean; over: Over | null; written: readonly Written[]}
	| {ok: false; why: "fenced"}
	| {ok: false; why: "denied"};
export type SetLimitsResult =
	| {ok: true; pos: number; rev: number; written: readonly Written[]}
	| {ok: false; why: "unknown"}
	| {ok: false; why: "denied"};
/** What a name has used and may use: `used.usd` in dollars, holds included. */
export type Usage = {
	name: string;
	limits: Limits;
	used: {usd: number; tokens: number};
	/** Names running under it now, at any depth. */
	children: number;
	/** When it was registered, and when its wall time ends (null: no wall limit). */
	since: number;
	deadline: number | null;
};
/** OTP's two exit signals a parent sends a child: `shutdown` (trappable) and `kill` (not). */
export type Signal = "shutdown" | "kill";

/** What the ledger wrote in one call: the caller wakes the watchers of these streams. */
export type Written = {stream: string; rev: number; pos: number};

export type ExitResult =
	/** `dup`: this fence's exit had landed already, and nothing was written. */
	| {ok: true; pos: number; incarnation: number; dup: boolean; written: readonly Written[]}
	| {ok: false; why: "fenced"};
export type MonitorResult =
	/** `incarnation: null`: the name was not running, and a DOWN `noproc` went to the inbox. */
	{ok: true; incarnation: number | null; written: readonly Written[]} | {ok: false; why: "fenced"};
export type LinkResult = {ok: true} | {ok: false; why: "fenced"} | {ok: false; why: "noproc"};
export type FlagResult = {ok: true} | {ok: false; why: "fenced"};
export type StartResult =
	/** `started: false`: it was up already (or is down past `after`, and its EXIT is on the way). */
	| {ok: true; incarnation: number; started: boolean; written: readonly Written[]}
	| {ok: false; why: "fenced"}
	/** Another name is its parent, or the name is not one a register may take, or bad limits. */
	| {ok: false; why: "denied"}
	/**
	 * 102: a limit says no. `children`: one more would be too many (OTP's `{error, max_children}`);
	 * nothing ended. Any other kind: the caller's tree is spent (and that name has ended now), or
	 * the child's own run was ended by a limit and its limits have not changed since.
	 */
	| {ok: false; why: "limit"; over: Over; written: readonly Written[]};

export type ExitChildResult =
	/**
	 * `signalled`: the child traps exits, and an EXIT is in its inbox. `exited`: it is down now.
	 * `noproc`: that incarnation had ended already; nothing was written.
	 */
	| {ok: true; how: "signalled" | "exited" | "noproc"; written: readonly Written[]}
	| {ok: false; why: "fenced"}
	/** The caller is not the child's parent, or nobody registered the child. */
	| {ok: false; why: "denied"};

/** A name's process, as `erlang:process_info` would say it. `down`: the exited event's pos, 0 if up. */
export type ProcessInfo = {
	name: string;
	parent: string | null;
	incarnation: number;
	down: number;
	trapExit: boolean;
};

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
	// 99: the process behind a name. `down` is the `exited` event's pos (0: up). `suspect` and
	// `strikes`: the inbox rev the last crashes in a row named, and how many did.
	[
		"ALTER TABLE names ADD COLUMN parent TEXT",
		"ALTER TABLE names ADD COLUMN incarnation INTEGER NOT NULL DEFAULT 1",
		"ALTER TABLE names ADD COLUMN down INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE names ADD COLUMN trap_exit INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE names ADD COLUMN suspect INTEGER",
		"ALTER TABLE names ADD COLUMN strikes INTEGER NOT NULL DEFAULT 0",
		`CREATE TABLE monitors (
			watcher TEXT NOT NULL,
			ref TEXT NOT NULL,
			target TEXT NOT NULL,
			incarnation INTEGER NOT NULL,
			PRIMARY KEY (watcher, ref)
		)`,
		"CREATE INDEX monitors_target ON monitors (target)",
		// Both ways: a link a-b is two rows.
		"CREATE TABLE links (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b))",
	],
	// 102: limits (null: none) and what the name's subtree has used. Dollars in micro-dollars.
	// `deadline`: when its wall time ends. `limited`: the kind of limit that last ended it.
	[
		"ALTER TABLE names ADD COLUMN max_usd INTEGER",
		"ALTER TABLE names ADD COLUMN max_tokens INTEGER",
		"ALTER TABLE names ADD COLUMN max_wall_ms INTEGER",
		"ALTER TABLE names ADD COLUMN max_children INTEGER",
		"ALTER TABLE names ADD COLUMN deadline INTEGER",
		"ALTER TABLE names ADD COLUMN used_usd INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE names ADD COLUMN used_tokens INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE names ADD COLUMN limited TEXT",
		"CREATE INDEX names_parent ON names (parent)",
	],
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
	/** 99: an exit lands only under the live lease of the name that exits. */
	readonly exitNeedsLease: boolean;
	/** 99: a lease that runs out is no exit. Off: its expiry tells the monitors DOWN (a takeover is a death). */
	readonly expiryIsAlive: boolean;
	/** 99: a name that traps exits gets an EXIT message instead of dying with its link. */
	readonly trapExit: boolean;
	/** 99: a `normal` exit does not spread over a link to a name that does not trap. */
	readonly normalStays: boolean;
	/** 99: no claim lands on a name that is down. */
	readonly downRefusesClaim: boolean;
	/** 99: only a child's parent restarts it. */
	readonly parentOnly: boolean;
	/** 99: a monitor of a name that is not running answers at once with a DOWN `noproc`. */
	readonly noprocAtOnce: boolean;
	/** 99: when a suspect goes to `dead`: after `maxDeliveries` crashes in a row, never, or at the first. */
	readonly deadLetter: "in-a-row" | "never" | "first";
	/** 99: no append carries a kind only the ledger writes (DOWN, EXIT, exited...) or its writer name. */
	readonly ledgerWordsReserved: boolean;
	/** 100: a `kill` takes the child down even when it traps exits. */
	readonly killUntrappable: boolean;
	/** 100: a `shutdown` to a child that traps exits is an EXIT message, not its exit. */
	readonly shutdownTrappable: boolean;
	/** 100: an exit signal acts only on the incarnation it names. */
	readonly signalNamesIncarnation: boolean;
	/** 102: a restart keeps the spend. Off: it starts the count again (a per-run budget). */
	readonly spendKept: boolean;
	/** 102: spend counts on every name up the tree (cgroup v2). Off: on its own name only. */
	readonly spendUpTheTree: boolean;
	/** 102: a charge id counts once. */
	readonly chargeOnce: boolean;
	/** 102: a hold that does not fit under a limit is refused. Off: only spend already over is. */
	readonly admission: boolean;
	/** 102: a charge lands under any fence its name ever had. Off: only under the live lease. */
	readonly lateChargeCounts: boolean;
	/** 102: a limit's end spreads over links as `killed`. Off: as the limit itself. */
	readonly limitSpreadsAsKilled: boolean;
	/** 102: a limit's end writes one record in `<name>/dead`. */
	readonly limitRecorded: boolean;
	/** 102: children count at every depth (cgroup's `pids.max`). Off: one level down only. */
	readonly childrenDeep: boolean;
	/** 102: wall time counts from registration. Off: from the last restart. */
	readonly wallFromStart: boolean;
	/** 102: a name a limit ended is not started again until its limits change. */
	readonly limitEndIsFinal: boolean;
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
	exitNeedsLease: true,
	expiryIsAlive: true,
	trapExit: true,
	normalStays: true,
	downRefusesClaim: true,
	parentOnly: true,
	noprocAtOnce: true,
	deadLetter: "in-a-row",
	ledgerWordsReserved: true,
	killUntrappable: true,
	shutdownTrappable: true,
	signalNamesIncarnation: true,
	spendKept: true,
	spendUpTheTree: true,
	chargeOnce: true,
	admission: true,
	lateChargeCounts: true,
	limitSpreadsAsKilled: true,
	limitRecorded: true,
	childrenDeep: true,
	wallFromStart: true,
	limitEndIsFinal: true,
};

/** A message that crashed its program this many times in a row goes to `<name>/dead`. */
export const MAX_DELIVERIES = 3;

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
	"an exit lands under any fence (99)": {...RULES, exitNeedsLease: false},
	"a lease that runs out tells the monitors DOWN (99)": {...RULES, expiryIsAlive: false},
	"trap_exit is ignored: a link always kills (99)": {...RULES, trapExit: false},
	"a normal exit kills its links (99)": {...RULES, normalStays: false},
	"a down name can be claimed (99)": {...RULES, downRefusesClaim: false},
	"anyone may restart a child (99)": {...RULES, parentOnly: false},
	"a monitor of a down name waits for ever (99)": {...RULES, noprocAtOnce: false},
	"a poison message is never set aside (99)": {...RULES, deadLetter: "never"},
	"a message is set aside at its first crash (99)": {...RULES, deadLetter: "first"},
	"anyone may write a DOWN into an inbox (99)": {...RULES, ledgerWordsReserved: false},
	"a kill can be trapped (100)": {...RULES, killUntrappable: false},
	"a shutdown kills a child that traps exits (100)": {...RULES, shutdownTrappable: false},
	"an exit signal to an old incarnation takes down the new one (100)": {
		...RULES,
		signalNamesIncarnation: false,
	},
	"a restart starts the spend count again (102)": {...RULES, spendKept: false},
	"a charge counts on its own name only (102)": {...RULES, spendUpTheTree: false},
	"a repeated charge counts twice (102)": {...RULES, chargeOnce: false},
	"a hold over the limit is granted (102)": {...RULES, admission: false},
	"a charge from a host that lost its lease is refused (102)": {
		...RULES,
		lateChargeCounts: false,
	},
	"a limit's end spreads as itself (102)": {...RULES, limitSpreadsAsKilled: false},
	"a limit's end leaves no record (102)": {...RULES, limitRecorded: false},
	"children counted one level down only (102)": {...RULES, childrenDeep: false},
	"wall time counts from the last restart (102)": {...RULES, wallFromStart: false},
	"a name a limit ended can be restarted (102)": {...RULES, limitEndIsFinal: false},
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
			// 99: only the ledger says DOWN, EXIT or exited. An inbox is open to anyone, so a forged
			// DOWN would tell a watcher a live name died.
			if (rules.ledgerWordsReserved && isLedgerWord(event)) return {ok: false, why: "denied"};
			return write(db, now, stream, expected, event);
		});

export const append = appendWith(RULES);

/** The kinds only the ledger writes, and its own writer name. No `append` may carry them. */
export const LEDGER_KINDS: readonly string[] = [
	"registered",
	"claimed",
	"lease_expired",
	"cancel",
	"exited",
	"restarted",
	"DOWN",
	"EXIT",
	"dead_letter",
	// 102: a forged `charged` would end a name; a forged `limits` would lie about them.
	"held",
	"charged",
	"limits",
	"limit",
];
export const isLedgerWord = (e: Event): boolean =>
	e.writer === "ledger" || LEDGER_KINDS.includes(e.kind);

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
			const proc = registered ? processOf(db, name) : null;
			if (proc !== null && proc.down !== 0 && rules.downRefusesClaim)
				return {ok: false, why: "down", pos: proc.down};
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
			return {ok: true, fence, rev: res.rev, expiresAt, incarnation: proc?.incarnation ?? 1};
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

// ---------------------------------------------------------------- 99: exits, monitors, links

/** The process behind a registered name, or null: nobody registered it. */
export const processOf = (db: Db, name: string): ProcessInfo | null => {
	const row = db.all(
		"SELECT name, parent, incarnation, down, trap_exit FROM names WHERE name = ?",
		name,
	)[0];
	return row
		? {
				name: str(row.name),
				parent: row.parent === null || row.parent === undefined ? null : str(row.parent),
				incarnation: num(row.incarnation),
				down: num(row.down),
				trapExit: num(row.trap_exit) === 1,
			}
		: null;
};

/** The name whose live lease this fence is, or null. Every call below is fenced this way. */
const fencedName = (db: Db, now: number, fence: number): string | null => {
	const row = db.all("SELECT stream FROM leases WHERE fence = ? AND expires_at > ?", fence, now)[0];
	return row ? str(row.stream) : null;
};

const pushed = (written: Written[], stream: string, r: AppendResult): void => {
	if (r.ok && !r.dup) written.push({stream, rev: r.rev, pos: r.pos});
};

const linkBoth = (db: Db, a: string, b: string): void => {
	db.all("INSERT OR IGNORE INTO links (a, b) VALUES (?1, ?2), (?2, ?1)", a, b);
};

/** One exit, as it lands: what ended, why, and what it names. */
type Ending = {
	reason: EndReason;
	why: string;
	/** The inbox rev the program was likely handling: the first one past its last saved state. */
	suspect: number | null;
	/** The name that took this one down over a link, or null: it ended by itself. */
	by: string | null;
	writer: string;
};

/**
 * Take `name` down, and everything its exit reaches, in this one transaction: its `exited` event,
 * its lease gone, a DOWN to each monitor of this incarnation, and each link either an EXIT (it
 * traps exits) or the same exit again (it does not). A worklist, not recursion: a chain of links
 * is followed to its end, each name once.
 */
const takeDown = (
	db: Db,
	rules: Rules,
	now: number,
	first: string,
	ending: Ending,
	maxDeliveries: number | null,
	written: Written[],
): number => {
	const work: {name: string; ending: Ending}[] = [{name: first, ending}];
	let firstPos = 0;
	while (work.length > 0) {
		const next = work.shift();
		if (next === undefined) break;
		const {name, ending: e} = next;
		const proc = processOf(db, name);
		if (proc === null || proc.down !== 0) continue;
		const lease = db.all("SELECT fence FROM leases WHERE stream = ?", name)[0];
		const data = {
			fence: lease ? num(lease.fence) : null,
			incarnation: proc.incarnation,
			reason: e.reason,
			why: e.why,
			suspect: e.suspect,
			by: e.by,
		};
		const res = write(db, now, name, "any", {
			kind: "exited",
			writer: e.writer,
			data,
			id: `exited:${proc.incarnation}`,
		});
		pushed(written, name, res);
		if (!res.ok) continue;
		if (firstPos === 0) firstPos = res.pos;
		db.all("DELETE FROM leases WHERE stream = ?", name);
		db.all("DELETE FROM jobs WHERE id = ?", `lease:${name}`);
		db.all("UPDATE names SET down = ? WHERE name = ?", res.pos, name);
		strike(db, rules, now, name, e, maxDeliveries, written);

		// Monitors of this incarnation: one DOWN each, then they are gone (OTP: a monitor fires once).
		const monitors = db.all(
			"SELECT watcher, ref, incarnation FROM monitors WHERE target = ? AND incarnation = ?",
			name,
			proc.incarnation,
		);
		for (const m of monitors) {
			const inbox = `${str(m.watcher)}/inbox`;
			const down = {
				ref: str(m.ref),
				target: name,
				incarnation: proc.incarnation,
				reason: e.reason,
				why: e.why,
				at: now,
			};
			pushed(
				written,
				inbox,
				write(db, now, inbox, "any", {
					kind: "DOWN",
					writer: "ledger",
					data: down,
					id: `DOWN:${str(m.ref)}`,
				}),
			);
		}
		db.all("DELETE FROM monitors WHERE target = ?", name);

		// Links: a dead process has none left (OTP).
		const linked = db.all("SELECT b FROM links WHERE a = ?", name).map((r) => str(r.b));
		db.all("DELETE FROM links WHERE a = ?1 OR b = ?1", name);
		for (const other of linked) {
			const o = processOf(db, other);
			if (o === null || o.down !== 0) continue;
			if (o.trapExit && rules.trapExit) {
				const inbox = `${other}/inbox`;
				const exit = {
					from: name,
					incarnation: proc.incarnation,
					reason: e.reason,
					why: e.why,
					at: now,
					to: o.incarnation,
				};
				pushed(
					written,
					inbox,
					write(db, now, inbox, "any", {
						kind: "EXIT",
						writer: "ledger",
						data: exit,
						id: `EXIT:${name}:${proc.incarnation}`,
					}),
				);
			} else if (e.reason !== "normal" || !rules.normalStays) {
				// 102: a limit is its own name's; what it takes down with it was `killed` (OTP's kill).
				const reason = isLimitReason(e.reason) && rules.limitSpreadsAsKilled ? "killed" : e.reason;
				work.push({
					name: other,
					ending: {reason, why: e.why, suspect: null, by: name, writer: "ledger"},
				});
			}
		}
	}
	return firstPos;
};

/**
 * Count a crash against the message it names. The same message named by `maxDeliveries` crashes
 * in a row (nothing else crashed in between, so nothing moved on) goes to `<name>/dead`, and the
 * count starts again. Any other exit, or a crash that names nothing, ends the row.
 */
const strike = (
	db: Db,
	rules: Rules,
	now: number,
	name: string,
	e: Ending,
	maxDeliveries: number | null,
	written: Written[],
): void => {
	if (e.reason !== "crash" || e.suspect === null || rules.deadLetter === "never") {
		db.all("UPDATE names SET suspect = NULL, strikes = 0 WHERE name = ?", name);
		return;
	}
	const row = db.all("SELECT suspect, strikes FROM names WHERE name = ?", name)[0];
	const same = row !== undefined && row.suspect !== null && num(row.suspect) === e.suspect;
	const strikes = (same ? num(row?.strikes) : 0) + 1;
	const limit = rules.deadLetter === "first" ? 1 : maxDeliveries;
	if (limit !== null && strikes >= limit) {
		const dead = `${name}/dead`;
		const data = {rev: e.suspect, strikes, why: e.why, at: now};
		pushed(
			written,
			dead,
			write(db, now, dead, "any", {
				kind: "dead_letter",
				writer: "ledger",
				data,
				id: `dead:${e.suspect}`,
			}),
		);
		db.all("UPDATE names SET suspect = NULL, strikes = 0 WHERE name = ?", name);
		return;
	}
	db.all("UPDATE names SET suspect = ?, strikes = ? WHERE name = ?", e.suspect, strikes, name);
};

/**
 * OTP's `exit/1`, from the holder of `name`'s lease: its program ended, for `reason`. Once per
 * incarnation; a repeat under the same fence after it landed answers `dup`.
 */
export const exitWith =
	(rules: Rules) =>
	(
		db: Db,
		now: number,
		name: string,
		fence: number,
		reason: ExitReason,
		why: string,
		suspect: number | null,
		writer: string,
		maxDeliveries: number | null = MAX_DELIVERIES,
	): ExitResult =>
		db.tx(() => {
			const proc = processOf(db, name);
			if (proc !== null && proc.down !== 0) {
				const at = db.all("SELECT data FROM events WHERE pos = ?", proc.down)[0];
				const landed = at ? (JSON.parse(str(at.data)) as {fence?: number | null}) : null;
				if (landed?.fence === fence)
					return {ok: true, pos: proc.down, incarnation: proc.incarnation, dup: true, written: []};
			}
			if (proc === null) return {ok: false, why: "fenced"};
			if (rules.exitNeedsLease && fencedName(db, now, fence) !== name)
				return {ok: false, why: "fenced"};
			const written: Written[] = [];
			const ending: Ending = {reason, why, suspect, by: null, writer};
			const pos = takeDown(db, rules, now, name, ending, maxDeliveries, written);
			if (pos === 0) return {ok: false, why: "fenced"};
			return {ok: true, pos, incarnation: proc.incarnation, dup: false, written};
		});

export const exit = exitWith(RULES);

/** OTP's `erlang:monitor(process, Name)`, by the holder of the watcher's lease, under its own `ref`. */
export const monitorWith =
	(rules: Rules) =>
	(db: Db, now: number, fence: number, ref: string, target: string): MonitorResult =>
		db.tx(() => {
			const watcher = fencedName(db, now, fence);
			if (watcher === null) return {ok: false, why: "fenced"};
			const held = db.all(
				"SELECT incarnation FROM monitors WHERE watcher = ? AND ref = ?",
				watcher,
				ref,
			)[0];
			if (held) return {ok: true, incarnation: num(held.incarnation), written: []};
			const inbox = `${watcher}/inbox`;
			if (seen(db, inbox, `DOWN:${ref}`)) return {ok: true, incarnation: null, written: []};
			const t = processOf(db, target);
			if (t === null || t.down !== 0) {
				const written: Written[] = [];
				if (rules.noprocAtOnce) {
					const down = {
						ref,
						target,
						incarnation: t?.incarnation ?? 0,
						reason: "noproc",
						why: t === null ? "not registered" : "down",
						at: now,
					};
					pushed(
						written,
						inbox,
						write(db, now, inbox, "any", {
							kind: "DOWN",
							writer: "ledger",
							data: down,
							id: `DOWN:${ref}`,
						}),
					);
					return {ok: true, incarnation: null, written};
				}
			}
			const incarnation = t?.incarnation ?? 0;
			db.all(
				"INSERT INTO monitors (watcher, ref, target, incarnation) VALUES (?, ?, ?, ?)",
				watcher,
				ref,
				target,
				incarnation,
			);
			return {ok: true, incarnation, written: []};
		});

export const monitor = monitorWith(RULES);

/** OTP's `erlang:demonitor/1`. Idempotent. */
export function demonitor(db: Db, now: number, fence: number, ref: string): FlagResult {
	return db.tx(() => {
		const watcher = fencedName(db, now, fence);
		if (watcher === null) return {ok: false, why: "fenced"};
		db.all("DELETE FROM monitors WHERE watcher = ? AND ref = ?", watcher, ref);
		return {ok: true};
	});
}

/** OTP's `link/1`: both ways. A name that is not running answers `noproc`. */
export function link(db: Db, now: number, fence: number, other: string): LinkResult {
	return db.tx(() => {
		const me = fencedName(db, now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		if (other === me) return {ok: true};
		const o = processOf(db, other);
		if (o === null || o.down !== 0) return {ok: false, why: "noproc"};
		linkBoth(db, me, other);
		return {ok: true};
	});
}

/** OTP's `unlink/1`. Idempotent. */
export function unlink(db: Db, now: number, fence: number, other: string): FlagResult {
	return db.tx(() => {
		const me = fencedName(db, now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		db.all("DELETE FROM links WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)", me, other);
		return {ok: true};
	});
}

/** OTP's `process_flag(trap_exit, on)`. It lasts this incarnation: a restart clears it. */
export function trapExit(db: Db, now: number, fence: number, on: boolean): FlagResult {
	return db.tx(() => {
		const me = fencedName(db, now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		db.all("UPDATE names SET trap_exit = ? WHERE name = ?", on ? 1 : 0, me);
		return {ok: true};
	});
}

/**
 * OTP's `supervisor:start_child` and restart, by the holder of the parent's lease. A new name is
 * registered with the caller as its parent; a down child is started again as a new incarnation,
 * but only if it is down at `after` (the incarnation whose EXIT the parent handled), or `after` is
 * null (the parent does not know: it has just started). Either way the two are linked.
 */
export const startChildWith =
	(rules: Rules) =>
	(
		db: Db,
		now: number,
		fence: number,
		child: string,
		after: number | null,
		limits: Limits | null = null,
	): StartResult =>
		db.tx(() => {
			const me = fencedName(db, now, fence);
			if (me === null) return {ok: false, why: "fenced"};
			if (limits !== null && limitsRefusal(limits) !== null) return {ok: false, why: "denied"};
			const written: Written[] = [];
			// 102: a tree that is spent starts nothing more, and ends (the alarm may not have run yet).
			const chain = chainOf(db, me);
			const spent = overOf(chain, now, NOTHING);
			if (spent !== null) {
				endFor(db, rules, now, chain, spent, written);
				return {ok: false, why: "limit", over: spent, written};
			}
			const c = processOf(db, child);
			if (c === null) {
				if (!isNameShape(child) || nested(db, child)) return {ok: false, why: "denied"};
				const full = childrenOver(db, rules, chain);
				if (full !== null) return {ok: false, why: "limit", over: full, written};
				const res = write(db, now, child, "any", {
					kind: "registered",
					writer: me,
					data: limits === null ? {parent: me} : {parent: me, limits},
				});
				if (!res.ok) return {ok: false, why: "denied"};
				pushed(written, child, res);
				db.all(
					"INSERT INTO names (name, pos, at, parent) VALUES (?, ?, ?, ?)",
					child,
					res.pos,
					now,
					me,
				);
				if (limits !== null) keepLimits(db, child, limits, now);
				linkBoth(db, me, child);
				return {ok: true, incarnation: 1, started: true, written};
			}
			if (rules.parentOnly && c.parent !== me) return {ok: false, why: "denied"};
			if (c.down !== 0 && (after === null || after === c.incarnation)) {
				const caps = capsOf(db, child);
				if (caps !== null && caps.limited !== null && rules.limitEndIsFinal)
					return {ok: false, why: "limit", over: standing(caps, caps.limited, now), written};
				const own = caps === null ? null : overOf([caps], now, NOTHING);
				if (own !== null) return {ok: false, why: "limit", over: own, written};
				const full = childrenOver(db, rules, chain);
				if (full !== null) return {ok: false, why: "limit", over: full, written};
				if (caps !== null && !rules.spendKept) addUsed(db, [caps], -caps.usedUsd, -caps.usedTokens);
				if (caps !== null && caps.wallMs !== null && !rules.wallFromStart)
					keepDeadline(db, child, now + caps.wallMs);
				const incarnation = c.incarnation + 1;
				const res = write(db, now, child, "any", {
					kind: "restarted",
					writer: me,
					data: {incarnation, after: c.incarnation},
					id: `restarted:${incarnation}`,
				});
				pushed(written, child, res);
				db.all(
					"UPDATE names SET incarnation = ?, down = 0, trap_exit = 0 WHERE name = ?",
					incarnation,
					child,
				);
				linkBoth(db, me, child);
				return {ok: true, incarnation, started: true, written};
			}
			if (c.down === 0) linkBoth(db, me, child);
			return {ok: true, incarnation: c.incarnation, started: false, written};
		});

export const startChild = startChildWith(RULES);

/**
 * 100: OTP's `exit(Child, shutdown | kill)`, by the holder of the parent's lease, to the child's
 * incarnation `incarnation`. A `shutdown` to a child that traps exits lands as one EXIT in its inbox
 * (id `SIGNAL:<parent>:<incarnation>`, so a resend lands once); any other `shutdown` is the child's
 * exit, reason `shutdown`. A `kill` is its exit, reason `killed`, trap or not. An incarnation that
 * has ended already answers `noproc` and writes nothing: the signal was for a run that is gone.
 */
export const exitChildWith =
	(rules: Rules) =>
	(
		db: Db,
		now: number,
		fence: number,
		child: string,
		incarnation: number,
		signal: Signal,
		why: string,
		maxDeliveries: number | null = MAX_DELIVERIES,
	): ExitChildResult =>
		db.tx(() => {
			const me = fencedName(db, now, fence);
			if (me === null) return {ok: false, why: "fenced"};
			const c = processOf(db, child);
			if (c === null) return {ok: false, why: "denied"};
			if (rules.parentOnly && c.parent !== me) return {ok: false, why: "denied"};
			const stale = rules.signalNamesIncarnation && c.incarnation !== incarnation;
			if (c.down !== 0 || stale) return {ok: true, how: "noproc", written: []};
			const written: Written[] = [];
			const trapped =
				c.trapExit && (signal === "shutdown" ? rules.shutdownTrappable : !rules.killUntrappable);
			if (trapped) {
				const parent = processOf(db, me);
				const inbox = `${child}/inbox`;
				const data = {
					from: me,
					incarnation: parent?.incarnation ?? 0,
					reason: signal === "kill" ? "killed" : "shutdown",
					why,
					at: now,
					to: c.incarnation,
				};
				pushed(
					written,
					inbox,
					write(db, now, inbox, "any", {
						kind: "EXIT",
						writer: "ledger",
						data,
						id: `SIGNAL:${me}:${c.incarnation}`,
					}),
				);
				return {ok: true, how: "signalled", written};
			}
			const ending: Ending = {
				reason: signal === "kill" ? "killed" : "shutdown",
				why,
				suspect: null,
				by: me,
				writer: "ledger",
			};
			takeDown(db, rules, now, child, ending, maxDeliveries, written);
			return {ok: true, how: "exited", written};
		});

export const exitChild = exitChildWith(RULES);

// ---------------------------------------------------------------- 102: limits

/** A name's limits and use, as the names table keeps them. Dollars in micro-dollars. */
type Caps = {
	name: string;
	parent: string | null;
	up: boolean;
	incarnation: number;
	usd: number | null;
	tokens: number | null;
	wallMs: number | null;
	children: number | null;
	deadline: number | null;
	usedUsd: number;
	usedTokens: number;
	limited: LimitKind | null;
};
const NOTHING = {usd: 0, tokens: 0};
const orNull = (v: Value | undefined): number | null =>
	v === null || v === undefined ? null : num(v);
const isLimitKind = (v: string): v is LimitKind =>
	v === "usd" || v === "tokens" || v === "wall" || v === "children";

const capsOf = (db: Db, name: string): Caps | null => {
	const r = db.all(
		`SELECT name, parent, incarnation, down, max_usd, max_tokens, max_wall_ms, max_children,
			deadline, used_usd, used_tokens, limited FROM names WHERE name = ?`,
		name,
	)[0];
	if (r === undefined) return null;
	const limited = r.limited === null || r.limited === undefined ? null : str(r.limited);
	return {
		name: str(r.name),
		parent: r.parent === null || r.parent === undefined ? null : str(r.parent),
		up: num(r.down) === 0,
		incarnation: num(r.incarnation),
		usd: orNull(r.max_usd),
		tokens: orNull(r.max_tokens),
		wallMs: orNull(r.max_wall_ms),
		children: orNull(r.max_children),
		deadline: orNull(r.deadline),
		usedUsd: num(r.used_usd),
		usedTokens: num(r.used_tokens),
		limited: limited !== null && isLimitKind(limited) ? limited : null,
	};
};

/** The name, its parent, and on up to the top: the cgroups a process sits in. */
const chainOf = (db: Db, name: string): Caps[] => {
	const out: Caps[] = [];
	const seen = new Set<string>();
	let at: string | null = name;
	while (at !== null && !seen.has(at)) {
		seen.add(at);
		const c = capsOf(db, at);
		if (c === null) break;
		out.push(c);
		at = c.parent;
	}
	return out;
};

/** Where `kind` stands on `c` now, for an answer that names it. */
const standing = (c: Caps, kind: LimitKind, now: number): Over => {
	if (kind === "usd") return {kind, at: c.name, used: c.usedUsd / 1e6, max: (c.usd ?? 0) / 1e6};
	if (kind === "tokens") return {kind, at: c.name, used: c.usedTokens, max: c.tokens ?? 0};
	if (kind === "wall") {
		const wall = c.wallMs ?? 0;
		return {kind, at: c.name, used: now - ((c.deadline ?? now) - wall), max: wall};
	}
	return {kind, at: c.name, used: 0, max: c.children ?? 0};
};

/**
 * The outermost limit in `chain` that `ask` more would cross, or that is crossed already: a wall
 * time that has run out, or spend past its max. The outermost, because ending it ends the rest.
 */
const overOf = (
	chain: readonly Caps[],
	now: number,
	ask: {usd: number; tokens: number},
): Over | null => {
	for (let i = chain.length - 1; i >= 0; i--) {
		const a = chain[i];
		if (a === undefined) continue;
		if (a.deadline !== null && a.deadline <= now) return standing(a, "wall", now);
		if (a.usd !== null && a.usedUsd + ask.usd > a.usd)
			return {kind: "usd", at: a.name, used: (a.usedUsd + ask.usd) / 1e6, max: a.usd / 1e6};
		if (a.tokens !== null && a.usedTokens + ask.tokens > a.tokens)
			return {kind: "tokens", at: a.name, used: a.usedTokens + ask.tokens, max: a.tokens};
	}
	return null;
};

/** Names running under `name` now: at every depth (`pids.max`), or one level down (the plant). */
const liveUnder = (db: Db, rules: Rules, name: string): number =>
	num(
		db.all(
			rules.childrenDeep
				? `WITH RECURSIVE sub(name) AS (
						SELECT name FROM names WHERE parent = ?1
						UNION SELECT n.name FROM names n JOIN sub ON n.parent = sub.name)
					SELECT count(*) AS n FROM names WHERE down = 0 AND name IN (SELECT name FROM sub)`
				: "SELECT count(*) AS n FROM names WHERE parent = ?1 AND down = 0",
			name,
		)[0]?.n,
	);

/** Would one more child anywhere in `chain` be too many? The outermost such limit, or null. */
const childrenOver = (db: Db, rules: Rules, chain: readonly Caps[]): Over | null => {
	for (let i = chain.length - 1; i >= 0; i--) {
		const a = chain[i];
		if (a === undefined || a.children === null) continue;
		const used = liveUnder(db, rules, a.name) + 1;
		if (used > a.children) return {kind: "children", at: a.name, used, max: a.children};
	}
	return null;
};

/** Add to what each name in `chain` has used. */
const addUsed = (db: Db, chain: readonly Caps[], usd: number, tokens: number): void => {
	for (const a of chain)
		db.all(
			"UPDATE names SET used_usd = used_usd + ?, used_tokens = used_tokens + ? WHERE name = ?",
			usd,
			tokens,
			a.name,
		);
};

const keepDeadline = (db: Db, name: string, deadline: number | null): void => {
	db.all("UPDATE names SET deadline = ? WHERE name = ?", deadline, name);
	if (deadline === null) db.all("DELETE FROM jobs WHERE id = ?", `deadline:${name}`);
	else
		db.all(
			`INSERT INTO jobs (id, due_at, kind, stream) VALUES (?1, ?2, 'deadline', ?3)
			ON CONFLICT (id) DO UPDATE SET due_at = ?2`,
			`deadline:${name}`,
			deadline,
			name,
		);
};

/** Keep `limits` as the name's own; its wall time counts from its registration (`at`). */
const keepLimits = (db: Db, name: string, l: Limits, now: number): void => {
	const at = num(db.all("SELECT at FROM names WHERE name = ?", name)[0]?.at ?? now);
	db.all(
		`UPDATE names SET max_usd = ?, max_tokens = ?, max_wall_ms = ?, max_children = ?, limited = NULL
		WHERE name = ?`,
		l.usd === undefined ? null : micros(l.usd),
		l.tokens ?? null,
		l.wallMs ?? null,
		l.children ?? null,
		name,
	);
	keepDeadline(db, name, l.wallMs === undefined ? null : at + l.wallMs);
};

/**
 * End the run `over` names: the outermost name still up at or under `over.at` in `chain`, with
 * reason `limit:<kind>` (a kill: no trap stops it), and one `limit` record in its `/dead`. No
 * crash is in it, so no message strikes (`MAX_DELIVERIES` is never reached here).
 */
const endFor = (
	db: Db,
	rules: Rules,
	now: number,
	chain: readonly Caps[],
	over: Over,
	written: Written[],
): void => {
	if (over.kind === "children") return;
	const i = chain.findIndex((c) => c.name === over.at);
	const inside = i < 0 ? chain : chain.slice(0, i + 1);
	const target = [...inside].reverse().find((c) => c.up);
	if (target === undefined) return;
	const reason: LimitReason = `limit:${over.kind}`;
	const why =
		over.kind === "wall"
			? `${over.at}'s wall time: ${over.used} ms of ${over.max}`
			: `${over.at}'s ${over.kind}: ${over.used} of ${over.max}`;
	const ending: Ending = {reason, why, suspect: null, by: null, writer: "ledger"};
	takeDown(db, rules, now, target.name, ending, MAX_DELIVERIES, written);
	db.all("UPDATE names SET limited = ? WHERE name = ?", over.kind, target.name);
	if (!rules.limitRecorded) return;
	const dead = `${target.name}/dead`;
	const data = {
		limit: over.kind,
		of: over.at,
		used: over.used,
		max: over.max,
		why,
		incarnation: target.incarnation,
		at: now,
	};
	pushed(
		written,
		dead,
		write(db, now, dead, "any", {
			kind: "limit",
			writer: "ledger",
			data,
			id: `limit:${target.incarnation}`,
		}),
	);
};

/** The name a fence was ever the claim of: a charge from a host that lost it still names it. */
const claimedBy = (db: Db, fence: number): string | null => {
	const row = db.all("SELECT stream FROM events WHERE pos = ? AND kind = 'claimed'", fence)[0];
	return row ? str(row.stream) : null;
};

/**
 * Admission, before a turn: hold `cost` (an upper bound on what it will spend) against every limit
 * up the tree, under the live lease. It fits, and is counted; or it does not, nothing is held, and
 * the limit's name ends. One hold per `(fence, id)`: a resend answers `dup`.
 */
export const holdWith =
	(rules: Rules) =>
	(db: Db, now: number, fence: number, id: string, cost: Cost): HoldResult =>
		db.tx(() => {
			const me = fencedName(db, now, fence);
			if (me === null) return {ok: false, why: "fenced"};
			if (!costOk(cost)) return {ok: false, why: "denied"};
			const spend = `${me}/spend`;
			if (seen(db, spend, `hold:${fence}:${id}`) || seen(db, spend, `charge:${fence}:${id}`))
				return {ok: true, dup: true, written: []};
			const chain = chainOf(db, me);
			const ask = {usd: micros(cost.usd), tokens: cost.tokens ?? 0};
			const over = overOf(chain, now, rules.admission ? ask : NOTHING);
			const written: Written[] = [];
			if (over !== null) {
				endFor(db, rules, now, chain, over, written);
				return {ok: false, why: "limit", over, written};
			}
			const res = write(db, now, spend, "any", {
				kind: "held",
				writer: "ledger",
				data: {fence, turn: id, usd: ask.usd, tokens: ask.tokens},
				id: `hold:${fence}:${id}`,
			});
			pushed(written, spend, res);
			addUsed(db, rules.spendUpTheTree ? chain : chain.slice(0, 1), ask.usd, ask.tokens);
			return {ok: true, dup: false, written};
		});

export const hold = holdWith(RULES);

/**
 * After a turn: what it spent. It takes the place of the hold under the same `(fence, id)`, if
 * any. It lands under any fence the name ever had, live or not, and on a name that is down: the
 * money is spent either way (experiment 101: an abort is no refund). Past a limit, that limit's
 * name ends. One charge per `(fence, id)`.
 */
export const chargeWith =
	(rules: Rules) =>
	(db: Db, now: number, fence: number, id: string, cost: Cost): ChargeResult =>
		db.tx(() => {
			const me = rules.lateChargeCounts ? claimedBy(db, fence) : fencedName(db, now, fence);
			if (me === null) return {ok: false, why: "fenced"};
			if (!costOk(cost)) return {ok: false, why: "denied"};
			const spend = `${me}/spend`;
			const key = `charge:${fence}:${id}`;
			if (rules.chargeOnce && seen(db, spend, key))
				return {ok: true, dup: true, over: null, written: []};
			const held = db.all(
				"SELECT data FROM events WHERE stream = ? AND id = ?",
				spend,
				`hold:${fence}:${id}`,
			)[0];
			const h = held ? (JSON.parse(str(held.data)) as {usd?: number; tokens?: number}) : {};
			const paid = {usd: micros(cost.usd), tokens: cost.tokens ?? 0};
			const written: Written[] = [];
			const res = write(db, now, spend, "any", {
				kind: "charged",
				writer: "ledger",
				data: {fence, turn: id, usd: paid.usd, tokens: paid.tokens},
				id: rules.chargeOnce ? key : null,
			});
			pushed(written, spend, res);
			const chain = chainOf(db, me);
			addUsed(
				db,
				rules.spendUpTheTree ? chain : chain.slice(0, 1),
				paid.usd - (h.usd ?? 0),
				paid.tokens - (h.tokens ?? 0),
			);
			const after = chainOf(db, me);
			const over = overOf(after, now, NOTHING);
			if (over !== null) endFor(db, rules, now, after, over, written);
			return {ok: true, dup: false, over, written};
		});

export const charge = chargeWith(RULES);

/**
 * The desk's call: set a name's limits (a raise, or limits for a top name nobody started). It
 * clears a limit's end, so the name's parent may start it again. Lowered under what is used, it
 * ends the name now, as a cgroup's `memory.max` written under its usage does.
 */
export const setLimitsWith =
	(rules: Rules) =>
	(db: Db, now: number, name: string, limits: Limits, writer: string): SetLimitsResult =>
		db.tx(() => {
			if (limitsRefusal(limits) !== null) return {ok: false, why: "denied"};
			if (!db.all("SELECT 1 FROM names WHERE name = ?", name)[0])
				return {ok: false, why: "unknown"};
			const res = write(db, now, name, "any", {kind: "limits", writer, data: limits});
			if (!res.ok) return {ok: false, why: "unknown"};
			const written: Written[] = [];
			pushed(written, name, res);
			keepLimits(db, name, limits, now);
			const chain = chainOf(db, name);
			const over = overOf(chain, now, NOTHING);
			if (over !== null) endFor(db, rules, now, chain, over, written);
			return {ok: true, pos: res.pos, rev: res.rev, written};
		});

export const setLimits = setLimitsWith(RULES);

/** What a name has used, its limits, and the names running under it. */
export const usageWith =
	(rules: Rules) =>
	(db: Db, name: string): Usage | null => {
		const c = capsOf(db, name);
		if (c === null) return null;
		const at = num(db.all("SELECT at FROM names WHERE name = ?", name)[0]?.at);
		const limits: Limits = {};
		if (c.usd !== null) limits.usd = c.usd / 1e6;
		if (c.tokens !== null) limits.tokens = c.tokens;
		if (c.wallMs !== null) limits.wallMs = c.wallMs;
		if (c.children !== null) limits.children = c.children;
		return {
			name,
			limits,
			used: {usd: c.usedUsd / 1e6, tokens: c.usedTokens},
			children: liveUnder(db, rules, name),
			since: at,
			deadline: c.deadline,
		};
	};

export const usage = usageWith(RULES);

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

/** Runs every due job. Each one is its own transaction, and checks again before it writes. */
export const runDueWith =
	(rules: Rules) =>
	(db: Db, now: number): Written[] => {
		const written: Written[] = [];
		const due = db.all("SELECT id, kind, stream FROM jobs WHERE due_at <= ? ORDER BY due_at", now);
		for (const job of due) {
			db.tx(() => {
				const stream = str(job.stream);
				// 102: a wall time that ran out ends its name (Kubernetes' `DeadlineExceeded`).
				if (str(job.kind) === "deadline") {
					const caps = capsOf(db, stream);
					const over = caps === null ? null : overOf([caps], now, NOTHING);
					if (caps !== null && over !== null && over.kind === "wall")
						endFor(db, rules, now, [caps], over, written);
					db.all("DELETE FROM jobs WHERE id = ? AND due_at <= ?", str(job.id), now);
					return;
				}
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
					pushed(written, stream, res);
					// The planted mistake: a lease that ran out as a death. The name lives on (any host
					// takes it over), so the real rules write nothing more here.
					if (!rules.expiryIsAlive)
						for (const m of db.all("SELECT watcher, ref FROM monitors WHERE target = ?", stream)) {
							const inbox = `${str(m.watcher)}/inbox`;
							const down = {ref: str(m.ref), target: stream, reason: "noproc", why: "expired"};
							pushed(
								written,
								inbox,
								write(db, now, inbox, "any", {
									kind: "DOWN",
									writer: "ledger",
									data: down,
									id: `DOWN:${str(m.ref)}`,
								}),
							);
						}
				}
				// Delete the job only if a renew or a new claim did not move it on meanwhile.
				db.all("DELETE FROM jobs WHERE id = ? AND due_at <= ?", str(job.id), now);
			});
		}
		return written;
	};

export const runDue = runDueWith(RULES);

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
