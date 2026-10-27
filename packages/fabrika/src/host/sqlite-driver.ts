// The node:sqlite driver of `rules.ts`: one connection, `BEGIN IMMEDIATE` for the write lock, inner
// transactions as savepoints. No Effect here: the worker threads of `./sqlite` load this file alone,
// and a throw inside a transaction is how SQLite rolls it back.
//
// Lifted from experiment 96 (experiments/96-ledger-mailbox/node-ledger.ts), unchanged but for the
// dispatch table, which now has `register` and the alarm's `runDue`.
import {DatabaseSync} from "node:sqlite";
import {pathToFileURL} from "node:url";
import * as L from "./rules.ts";

export const openDb = (path: string): {db: L.Db; close(): void} => {
	const raw = new DatabaseSync(path);
	// The wait first: switching to WAL takes a lock, and threads opening one file race for it.
	raw.exec("PRAGMA busy_timeout = 10000");
	raw.exec("PRAGMA journal_mode = WAL");
	let depth = 0;
	const db: L.Db = {
		all: (sql, ...bind) =>
			raw
				.prepare(sql)
				.all(...bind)
				.map((row) => {
					const r: L.SqlRow = {};
					for (const [k, v] of Object.entries(row))
						r[k] =
							typeof v === "bigint"
								? Number(v)
								: typeof v === "number" || typeof v === "string"
									? v
									: null;
					return r;
				}),
		tx: (fn) => {
			const name = `sp${depth}`;
			raw.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
			depth++;
			try {
				const res = fn();
				depth--;
				raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
				return res;
			} catch (e) {
				depth--;
				raw.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
				throw e;
			}
		},
	};
	L.migrate(db);
	return {db, close: () => raw.close()};
};

/**
 * A ledger file, read only, and as a file nobody else is changing: SQLite's `immutable` and `ro`,
 * no migration, no switch to WAL. A write through it fails in SQLite itself, and it makes no
 * `-wal` or `-shm` beside the file, as a plain read-only open of a WAL file does. For the move
 * (move.ts), which reads a laptop's file and must never change it: the file stays as the archive.
 * `immutable` does not read a `-wal`: the caller makes sure there is none with writes in it.
 */
export const readOnlyRows = (path: string, sql: string, ...bind: L.Value[]): L.SqlRow[] => {
	const url = pathToFileURL(path);
	url.searchParams.set("mode", "ro");
	url.searchParams.set("immutable", "1");
	const raw = new DatabaseSync(url, {readOnly: true});
	try {
		raw.exec("PRAGMA busy_timeout = 10000");
		return raw
			.prepare(sql)
			.all(...bind)
			.map((row) => {
				const r: L.SqlRow = {};
				for (const [k, v] of Object.entries(row))
					r[k] =
						typeof v === "bigint"
							? Number(v)
							: typeof v === "number" || typeof v === "string"
								? v
								: null;
				return r;
			});
	} finally {
		raw.close();
	}
};

const METHODS = [
	"register",
	"append",
	"claim",
	"renew",
	"cancel",
	"exit",
	"monitor",
	"demonitor",
	"link",
	"unlink",
	"trapExit",
	"startChild",
	"exitChild",
	"processInfo",
	"hold",
	"charge",
	"setLimits",
	"usage",
	"runDue",
	"read",
	"readStream",
	"readLast",
	"lease",
] as const;
export type Method = (typeof METHODS)[number];
export const isMethod = (m: string): m is Method => METHODS.some((x) => x === m);

const num = (v: unknown) => Number(v);
const str = (v: unknown) => String(v);
const orNull = (v: unknown) => (v === null || v === undefined ? null : v);

const isEvent = (v: unknown): v is L.Event =>
	typeof v === "object" && v !== null && "kind" in v && "writer" in v;

const isReason = (v: unknown): v is L.ExitReason =>
	v === "normal" || v === "shutdown" || v === "crash";

/** 102: an object of numbers under these keys only, as limits or a cost are; the rules judge the numbers. */
const numbersOf = (v: unknown, keys: readonly string[]): Record<string, number> => {
	if (typeof v !== "object" || v === null) throw new Error("not an object of numbers");
	const out: Record<string, number> = {};
	for (const [k, x] of Object.entries(v)) {
		if (!keys.includes(k) || typeof x !== "number") throw new Error(`bad ${k}`);
		out[k] = x;
	}
	return out;
};
const asLimits = (v: unknown): L.Limits => numbersOf(v, ["usd", "tokens", "wallMs", "children"]);
const asCost = (v: unknown): L.Cost => numbersOf(v, ["usd", "tokens"]);

/**
 * One call on one connection, under `rules`, at the time `now`: what the Durable Object's methods
 * do. The caller reads the clock, so one ledger has one clock however many threads it runs on.
 * `maxDeliveries`: crashes in a row on one message before it is set aside; null: never.
 */
export const dispatch = (
	db: L.Db,
	rules: L.Rules,
	graceMs: number,
	now: number,
	method: Method,
	a: readonly unknown[],
	maxDeliveries: number | null = L.MAX_DELIVERIES,
): unknown => {
	switch (method) {
		case "register":
			return L.registerWith(rules)(db, now, str(a[0]), str(a[1]));
		case "append": {
			const event = a[2];
			if (!isEvent(event)) throw new Error("append: not an event");
			const fence = orNull(a[3]);
			return L.appendWith(rules)(
				db,
				now,
				str(a[0]),
				a[1] === "any" ? "any" : num(a[1]),
				event,
				fence === null ? null : num(fence),
			);
		}
		case "claim":
			return L.claimWith(rules)(db, now, str(a[0]), str(a[1]), num(a[2]), num(a[3]), graceMs);
		case "renew":
			return L.renew(db, now, str(a[0]), num(a[1]), num(a[2]), graceMs);
		case "cancel":
			return L.cancel(db, now, str(a[0]), str(a[1]));
		case "exit": {
			if (!isReason(a[2])) throw new Error("exit: not a reason");
			const suspect = orNull(a[4]);
			return L.exitWith(rules)(
				db,
				now,
				str(a[0]),
				num(a[1]),
				a[2],
				str(a[3]),
				suspect === null ? null : num(suspect),
				str(a[5]),
				maxDeliveries,
			);
		}
		case "monitor":
			return L.monitorWith(rules)(db, now, num(a[0]), str(a[1]), str(a[2]));
		case "demonitor":
			return L.demonitor(db, num(a[0]), str(a[1]));
		case "link":
			return L.link(db, num(a[0]), str(a[1]));
		case "unlink":
			return L.unlink(db, num(a[0]), str(a[1]));
		case "trapExit":
			return L.trapExit(db, num(a[0]), a[1] === true);
		case "startChild": {
			const after = orNull(a[2]);
			const limits = orNull(a[3]);
			return L.startChildWith(rules)(
				db,
				now,
				num(a[0]),
				str(a[1]),
				after === null ? null : num(after),
				limits === null ? null : asLimits(limits),
			);
		}
		case "hold":
			return L.holdWith(rules)(db, now, num(a[0]), str(a[1]), asCost(a[2]));
		case "charge":
			return L.chargeWith(rules)(db, now, num(a[0]), str(a[1]), asCost(a[2]));
		case "setLimits":
			return L.setLimitsWith(rules)(db, now, str(a[0]), asLimits(a[1]), str(a[2]));
		case "usage":
			return L.usageWith(rules)(db, str(a[0]));
		case "exitChild": {
			const signal = a[3];
			if (signal !== "shutdown" && signal !== "kill") throw new Error("exitChild: not a signal");
			return L.exitChildWith(rules)(
				db,
				now,
				num(a[0]),
				str(a[1]),
				num(a[2]),
				signal,
				str(a[4]),
				maxDeliveries,
			);
		}
		case "processInfo":
			return L.processOf(db, str(a[0]));
		case "runDue":
			return L.runDueWith(rules)(db, now);
		case "read": {
			const prefix = orNull(a[2]);
			return L.read(db, num(a[0]), num(a[1]), prefix === null ? null : str(prefix));
		}
		case "readStream":
			return L.readStream(db, str(a[0]), num(a[1] ?? 0), num(a[2] ?? -1));
		case "readLast":
			return L.readLast(db, str(a[0]), num(a[1]));
		case "lease":
			return L.lease(db, str(a[0]));
	}
};
