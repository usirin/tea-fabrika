// The same ledger SQL (`sql.ts`) on a node:sqlite file: the "SQLite on disk" backend in one
// small driver. A pool of worker threads, each with its own connection to the one file,
// makes "50 at once" real: the threads race for SQLite's write lock.
import {DatabaseSync} from "node:sqlite";
import {isMainThread, parentPort, Worker, workerData} from "node:worker_threads";
import type {LedgerClient} from "./client.ts";
import * as L from "./sql.ts";

/** The node:sqlite driver. `BEGIN IMMEDIATE` takes the write lock up front; inner txs are savepoints. */
export const openNodeDb = (path: string): {db: L.Db; close(): void; raw: DatabaseSync} => {
	const raw = new DatabaseSync(path);
	raw.exec("PRAGMA journal_mode = WAL");
	raw.exec("PRAGMA busy_timeout = 10000");
	let depth = 0;
	const db: L.Db = {
		all: (sql, ...bind) => {
			const out: L.Row[] = [];
			for (const row of raw.prepare(sql).all(...bind)) {
				const r: L.Row = {};
				for (const [k, v] of Object.entries(row))
					r[k] = typeof v === "bigint" ? Number(v) : (v as L.Value);
				out.push(r);
			}
			return out;
		},
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
	return {db, raw, close: () => raw.close()};
};

type Call = {id: number; method: keyof LedgerClient; args: unknown[]};

/** One connection's answer to a client call. Same rules as the Durable Object's methods. */
const dispatch = (db: L.Db, raw: DatabaseSync, graceMs: number, c: Call): unknown => {
	const now = Date.now();
	const a = c.args;
	const s = String(a[0]);
	switch (c.method) {
		case "append":
			return L.append(
				db,
				now,
				s,
				Number(a[1]),
				a[2] as L.Event,
				a[3] === null || a[3] === undefined ? null : Number(a[3]),
			);
		case "claim":
			return L.claim(db, now, s, String(a[1]), Number(a[2]), Number(a[3]), graceMs);
		case "renew":
			return L.renew(db, now, s, Number(a[1]), Number(a[2]), graceMs);
		case "cancel":
			return L.cancel(db, now, s, String(a[1]));
		case "read":
			return L.read(db, Number(a[0]), Number(a[1]));
		case "readStream":
			return L.readStream(db, s);
		case "lease":
			return L.lease(db, s);
		case "openCriteria":
			return L.openCriteria(db, s);
		case "tryExec":
			try {
				return {ok: true, rows: raw.prepare(s).all()};
			} catch (e) {
				return {ok: false, error: e instanceof Error ? e.message : String(e)};
			}
	}
};

if (!isMainThread && parentPort && workerData?.ledgerPath) {
	const port = parentPort;
	const {db, raw} = openNodeDb(String(workerData.ledgerPath));
	const graceMs = Number(workerData.graceMs ?? 1000);
	port.on("message", (c: Call) => {
		try {
			port.postMessage({id: c.id, ok: dispatch(db, raw, graceMs, c)});
		} catch (e) {
			port.postMessage({id: c.id, error: e instanceof Error ? e.message : String(e)});
		}
	});
}

/** A LedgerClient over `threads` worker threads, each its own connection; calls go round-robin. */
export const nodePool = (path: string, threads: number, graceMs = 1000) => {
	// One connection first, so the threads do not race to run the migrations.
	openNodeDb(path).close();
	const workers = Array.from(
		{length: threads},
		() => new Worker(new URL(import.meta.url), {workerData: {ledgerPath: path, graceMs}}),
	);
	const waiting = new Map<number, {resolve(v: unknown): void; reject(e: Error): void}>();
	for (const w of workers) {
		w.on("message", (m: {id: number; ok?: unknown; error?: string}) => {
			const p = waiting.get(m.id);
			waiting.delete(m.id);
			if (m.error === undefined) p?.resolve(m.ok);
			else p?.reject(new Error(m.error));
		});
	}
	let next = 0;
	const call = <T>(method: keyof LedgerClient, ...args: unknown[]): Promise<T> => {
		const id = next++;
		const w = workers[id % workers.length];
		return new Promise<T>((resolve, reject) => {
			waiting.set(id, {resolve: (v) => resolve(v as T), reject});
			w?.postMessage({id, method, args});
		});
	};
	const client: LedgerClient = {
		append: (stream, expectedRev, event, fence) =>
			call("append", stream, expectedRev, event, fence ?? null),
		claim: (stream, holder, expectedRev, ttlMs) =>
			call("claim", stream, holder, expectedRev, ttlMs),
		renew: (stream, fence, ttlMs) => call("renew", stream, fence, ttlMs),
		cancel: (stream, writer) => call("cancel", stream, writer),
		read: (fromPos, limit) => call("read", fromPos, limit),
		readStream: (stream) => call("readStream", stream),
		lease: (stream) => call("lease", stream),
		openCriteria: (stream) => call("openCriteria", stream),
		tryExec: (sql) => call("tryExec", sql),
	};
	return {client, close: () => Promise.all(workers.map((w) => w.terminate()))};
};
