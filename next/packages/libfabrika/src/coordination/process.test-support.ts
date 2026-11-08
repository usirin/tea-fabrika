// P33 uses layer(caller, nextId). Caller is trusted wiring, never From.
// The plan leaves Caller's fields unnamed; tests use {owner, recipient}, plus `by`, the brain's
// own writer key, which `manager()` adds to every caller.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {type Entry, Row} from "../data/log.ts";
import type {Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {type From, Mailbox} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {Owner, Recipient, Start} from "./process.ts";

export const A = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
export const B = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
export const W = "process_01jc9q4w7z3m8n5r2t6v0xkb4f";
export const X = "process_01jc9q4w7z3m8n5r2t6v0xkb4g";
export const CODE = {program: "counter", hash: "build-a"};
/** The brain's own writer key: the `by` on every process fact, and the only one the fold trusts. */
const BRAIN = "SHA256:brain";
export const from = (over: Partial<From> = {}): From => ({
	by: BRAIN,
	for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: `in-${A}-41`,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "writer-build",
	...over,
});
type Caller = {readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type};
export const brain = (): Caller & {readonly by: string} => ({
	owner: Owner.cases.brain.make({}),
	recipient: Recipient.cases.client.make({client: "window-a", session: X}),
	by: BRAIN,
});
export const watcher = (process: string): Caller => ({
	owner: Owner.cases.process.make({process}),
	recipient: Recipient.cases.process.make({process}),
});
export const first = (id = "start:counter:1", name = "counter:1", code = CODE) =>
	Start.cases.first.make({id, name, code});
export const again = (after: string, id = `restart:${after}`, code = CODE) =>
	Start.cases.again.make({id, name: "counter:1", after, why: "crashed", code});

const folder = mkdtempSync(join(tmpdir(), "p33-"));
const opened: Array<DatabaseSync> = [];
let files = 0;
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

// A real SQLite file, reopened without manager memory. Faults interrupt real INSERTs.
export const storage = () => {
	const path = join(folder, `${++files}.db`);
	const open = () => {
		const db = new DatabaseSync(path);
		opened.push(db);
		return db;
	};
	let db = open();
	let backend = nodeSql(db);
	const fault: {after: number | null; writes: number; error: Error | null} = {
		after: null,
		writes: 0,
		error: null,
	};
	const sql: Sql = {
		exec: (query, ...params) => {
			if (/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i.test(query)) {
				if (fault.after === 0)
					throw fault.error ?? new Error("SQLITE_FULL planted after an earlier write");
				if (fault.after !== null) fault.after--;
				const answer = backend.exec(query, ...params);
				fault.writes++;
				return answer;
			}
			return backend.exec(query, ...params);
		},
		transaction: (step) => backend.transaction(step),
		size: () => backend.size(),
	};
	const rows = (): ReadonlyArray<Entry> => {
		if (!db.prepare("SELECT name FROM sqlite_master WHERE name='entries'").get()) return [];
		return db
			.prepare("SELECT * FROM entries ORDER BY rev")
			.all()
			.map((row) => Schema.decodeUnknownSync(Row)(row));
	};
	return {
		sql,
		fault,
		rows,
		db: () => db,
		reopen: () => {
			db.close();
			db = open();
			backend = nodeSql(db);
		},
	};
};
export type Storage = ReturnType<typeof storage>;
export const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
export const data = (sql: Sql, bell = quiet) =>
	Layer.mergeAll(Ledger.sql(sql, {reader: "gateway:test"}), LedgerTransaction.layer(sql)).pipe(
		Layer.provide(bell),
	);
export const ids = (...values: ReadonlyArray<string>) => {
	let calls = 0;
	return {
		next: Effect.sync(() => {
			const value = values[calls++];
			if (value === undefined) throw new Error("test exhausted its process IDs");
			return value;
		}),
		calls: () => calls,
	};
};
export const manager = (
	store: Storage,
	caller: Caller = brain(),
	next = ids(A, B, W, X).next,
	bell = quiet,
) =>
	ProcessManager.layer({...caller, by: BRAIN}, next).pipe(
		Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data(store.sql, bell)))),
	);
export const read = (stream: string) =>
	Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0)));
export const receive = (process: string, after = 0) =>
	ProcessManager.use((processes) => Stream.runCollect(processes.receive(process, after)));
