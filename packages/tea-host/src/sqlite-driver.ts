// The node:sqlite driver of `rules.ts`: one connection, `BEGIN IMMEDIATE` for the write lock, inner
// transactions as savepoints. No Effect here: the worker threads of `./sqlite` load this file alone,
// and a throw inside a transaction is how SQLite rolls it back.
//
// Lifted from experiment 96 (experiments/96-ledger-mailbox/node-ledger.ts), unchanged but for the
// dispatch table, which now has `register` and the alarm's `runDue`.
// biome-ignore lint/plugin: the ledger's own SQLite driver (the solo ledger), not a fake of D1.
import {DatabaseSync} from "node:sqlite";
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

const METHODS = [
	"register",
	"append",
	"claim",
	"renew",
	"cancel",
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

/** One call on one connection, under `rules`: what the Durable Object's methods do. */
export const dispatch = (
	db: L.Db,
	rules: L.Rules,
	graceMs: number,
	method: Method,
	a: readonly unknown[],
): unknown => {
	const now = Date.now();
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
		case "runDue":
			return L.runDue(db, now);
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
