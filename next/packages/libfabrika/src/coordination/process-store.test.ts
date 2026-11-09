// P11 SQL adapter contract. One object stores {saved, turn, cmds}; load is null before its first save.
// layer(sql, {process}) needs Ledger only for record(id, RuntimeRecord, From).
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import type {LedgerError} from "../data/ledger.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {processId} from "../id.test-support.ts";
import {type From} from "./mailbox.ts";

const PROCESS = Effect.runSync(processId);
const folder = mkdtempSync(join(tmpdir(), "p11-store-"));
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
let files = 0;
const database = () => {
	const path = join(folder, `${++files}.db`);
	let db = new DatabaseSync(path);
	opened.push(db);
	let backend = nodeSql(db);
	let fail = false;
	const sql: Sql = {
		exec: (q, ...values) => backend.exec(q, ...values),
		transaction: (f) =>
			backend.transaction(() => {
				const answer = f();
				if (fail) throw new Error("SQLITE_FULL at commit");
				return answer;
			}),
		size: () => backend.size(),
	};
	return {
		sql,
		db: () => db,
		arm: (on: boolean) => {
			fail = on;
		},
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			opened.push(db);
			backend = nodeSql(db);
		},
	};
};
const data = (sql: Sql) =>
	Ledger.sql(sql, {reader: "p11-store"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
const from: From = {
	by: "SHA256:brain",
	for: "person",
	sentAt: "2026-11-08T01:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "build-a",
};
const checkpoint = {
	saved: {v: 1, build: "build-a", model: {count: 2}, after: 4},
	turn: null,
	cmds: [],
};
type Checkpoint = {
	readonly saved: {
		readonly v: number;
		readonly build: string;
		readonly model: unknown;
		readonly after: number;
	};
	readonly turn: unknown;
	readonly cmds: ReadonlyArray<unknown>;
};
type Store = {
	readonly load: Effect.Effect<Checkpoint | null, LedgerError>;
	readonly save: (value: Checkpoint) => Effect.Effect<void, LedgerError>;
	readonly record: (id: string, fact: unknown, from: From) => Effect.Effect<unknown, LedgerError>;
};

describe("P11 process storage", () => {
	it("malformed checkpoints fail as bad_row without replacing the saved state", async () => {
		const {ProcessStore} = await import("./process-store.ts");
		const disk = database();
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* ProcessStore;
				yield* store.save(checkpoint);
				expect(
					yield* Effect.flip(store.save({...checkpoint, saved: {...checkpoint.saved, v: "bad"}})),
				).toMatchObject({_tag: "LedgerError", why: "bad_row"});
				expect(yield* store.load).toEqual(checkpoint);
				disk
					.db()
					.prepare("UPDATE process_state SET checkpoint=? WHERE process=?")
					.run(JSON.stringify({...checkpoint, saved: {...checkpoint.saved, v: "bad"}}), PROCESS);
				expect(yield* Effect.flip(store.load)).toMatchObject({
					_tag: "LedgerError",
					why: "bad_row",
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			),
		);
	});
	it("plant, touch storage during Layer build: tables are created only by a call", async () => {
		const {ProcessStore} = await import("./process-store.ts");
		let calls = 0;
		const sql: Sql = {
			exec: () => {
				calls++;
				throw new Error("offline");
			},
			transaction: (f) => f(),
			size: () => 0,
		};
		await Effect.runPromise(
			Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				expect(calls).toBe(0);
				expect(yield* Effect.flip(store.load)).toMatchObject({_tag: "LedgerError", why: "storage"});
				expect(calls).toBeGreaterThan(0);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(sql, {process: PROCESS}).pipe(Layer.provide(data(database().sql))),
				),
			),
		);
	});
	it("plant, keep state in memory: reopen retains version, build, cursor, turn and Cmd dispatch", async () => {
		const {ProcessStore} = await import("./process-store.ts");
		const disk = database();
		const pending = {
			...checkpoint,
			turn: {
				_tag: "prepared",
				id: "letter-a",
				input: {type: "add", n: 3},
				parent: `in-${PROCESS}-2`,
				span: {traceId: from.traceId, spanId: "00f067aa0ba902b7"},
				sentAt: from.sentAt,
				seen: from.seen,
				next: {...checkpoint.saved, model: {count: 5}},
				cmds: [],
			},
			cmds: [{id: "stable-cmd", _tag: "dispatched", input: {type: "save", n: 2}, build: "build-a"}],
		};
		await Effect.runPromise(
			Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				expect(yield* store.load).toBeNull();
				yield* store.save(pending);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			),
		);
		disk.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				expect(yield* store.load).toEqual(pending);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			),
		);
	});
	it("plant, save partial checkpoint: a failed transaction retains all original state", async () => {
		const {ProcessStore} = await import("./process-store.ts");
		const disk = database();
		await Effect.runPromise(
			Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				yield* store.save(checkpoint);
				disk.arm(true);
				expect(
					yield* Effect.flip(
						store.save({...checkpoint, saved: {...checkpoint.saved, after: 9, model: {count: 9}}}),
					),
				).toMatchObject({why: "storage"});
				disk.arm(false);
				expect(yield* store.load).toEqual(checkpoint);
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provide(data(disk.sql))),
				),
			),
		);
	});
	it("plant, make runtime records arbitrary writes: only stepped and state.upgraded decode", async () => {
		const {RuntimeRecord} = await import("./process-store.ts");
		const decode = Schema.decodeUnknownSync(RuntimeRecord);
		expect(decode({_tag: "stepped", input: "a", pos: 2, build: "build-a"})).toMatchObject({
			_tag: "stepped",
		});
		expect(
			decode({
				_tag: "state.upgraded",
				program: "counter",
				from: 1,
				to: 3,
				ran: ["one", "two"],
				build: "build-b",
			}),
		).toMatchObject({ran: ["one", "two"]});
		for (const raw of [
			{_tag: "granted"},
			{_tag: "started"},
			{_tag: "stepped", input: "a", pos: -1, build: "build-a"},
		])
			expect(() => decode(raw)).toThrow();
	});
	it("plant, append stepped twice: runtime record retries have the first placing and build", async () => {
		const {ProcessStore} = await import("./process-store.ts");
		const disk = database();
		await Effect.runPromise(
			Effect.gen(function* () {
				const store: Store = yield* ProcessStore;
				const ledger = yield* Ledger;
				const fact = {_tag: "stepped", input: "letter-a", pos: 1, build: "build-a"};
				const placed = yield* store.record("step:letter-a", fact, from);
				expect(yield* store.record("step:letter-a", fact, from)).toEqual(placed);
				const rows = yield* Stream.runCollect(ledger.read(PROCESS, 0));
				expect(rows).toHaveLength(1);
				expect(rows[0]).toMatchObject({
					_tag: "stepped",
					body: {input: "letter-a", pos: 1},
					build: "build-a",
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(disk.sql, {process: PROCESS}).pipe(Layer.provideMerge(data(disk.sql))),
				),
			),
		);
	});
});
