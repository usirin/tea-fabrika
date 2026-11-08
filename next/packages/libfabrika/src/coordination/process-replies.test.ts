// P13, next/. Durable insert-only terminal replies, checked against real SQLite files.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, type Schema} from "effect";
import * as fc from "fast-check";
import {Doorbell, Ledger, type LedgerError} from "../data/ledger.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as Id from "../id.ts";
import {ProcessStore} from "./process-store.ts";
import {Writer} from "./session-manager.ts";

const options = {seed: 119120, numRuns: 12};
const InputId = Id.make("input");
const inputIds = fc.uuid({version: 7}).map((uuid) => {
	let bits = BigInt(`0x${uuid.replaceAll("-", "")}`),
		text = "";
	for (let n = 0; n < 26; n++) {
		text = "0123456789abcdefghjkmnpqrstvwxyz"[Number(bits & 31n)] + text;
		bits >>= 5n;
	}
	return InputId.make(`input_${text}`);
});
const PROCESS = Id.make("process").make("process_0000000000e008000000000001"),
	NEXT = Id.make("process").make("process_0000000000e008000000000002");
const folder = mkdtempSync("/tmp/fh.");
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
type Reply = {
	name: string;
	id: typeof InputId.Type;
	by: Writer;
	parent: typeof InputId.Type;
	answer: Schema.Json;
};
type Replies = {
	reply: (name: string, id: string) => Effect.Effect<Reply | null, LedgerError>;
	rememberReply: (reply: Reply) => Effect.Effect<void, LedgerError>;
};
const replies = fc
	.record({id: inputIds, parent: inputIds, now: fc.nat({max: 100}), agent: fc.boolean()})
	.map(({id, parent, now, agent}): Reply => ({
		name: "notes:1",
		id,
		parent,
		by: Writer.cases[agent ? "agent" : "person"].make({key: "SHA256:writer", for: "person"}),
		answer: {_tag: "refused", why: "changed_elsewhere", now},
	}));
let serial = 0;
const disk = () => {
	const path = join(folder, `${++serial}.db`);
	let db = new DatabaseSync(path);
	databases.push(db);
	let backend = nodeSql(db),
		fail = false;
	const sql: Sql = {
		exec: (q, ...args) => {
			if (fail && /^\s*(INSERT|UPDATE|REPLACE)/i.test(q)) throw new Error("SQLITE_FULL");
			return backend.exec(q, ...args);
		},
		transaction: (f) => backend.transaction(f),
		size: () => backend.size(),
	};
	return {
		sql,
		db: () => db,
		fail: (on: boolean) => {
			fail = on;
		},
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			databases.push(db);
			backend = nodeSql(db);
		},
	};
};
const layer = (sql: Sql, process = PROCESS) =>
	ProcessStore.layer(sql, {process}).pipe(
		Layer.provide(
			Ledger.sql(sql, {reader: "notes-replies"}).pipe(
				Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
			),
		),
	);
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
// Discover the stored JSON column instead of prescribing the builder's table/column names.
const corrupt = (db: DatabaseSync, first: Reply, text: string) => {
	for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
		const table = quote(String(row.name));
		for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
			const field = quote(String(column.name));
			for (const value of db.prepare(`SELECT ${field} AS value FROM ${table}`).all()) {
				if (
					typeof value.value !== "string" ||
					!value.value.includes(first.id) ||
					!value.value.includes('"answer"')
				)
					continue;
				const original = value.value;
				db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${field}=?`).run(text, original);
				return () =>
					db.prepare(`SELECT ${field} AS value FROM ${table} WHERE ${field}=?`).get(text)?.value;
			}
		}
	}
	throw new Error("rememberReply did not retain a JSON reply row");
};

describe("p53 durable terminal replies", () => {
	it("plant: overwrite, keep only in memory, key only by letter or lose replies on process replacement", async () => {
		await fc.assert(
			fc.asyncProperty(replies, async (first) => {
				const d = disk();
				const other = {
					...first,
					name: "notes:2",
					answer: {_tag: "refused", why: "too_long", most: 8},
				};
				await Effect.runPromise(
					Effect.gen(function* () {
						const s: Replies = yield* ProcessStore;
						expect(typeof s.reply, "P13 adds reply").toBe("function");
						expect(yield* s.reply(first.name, first.id)).toBeNull();
						yield* s.rememberReply(first);
						yield* s.rememberReply(first);
						yield* s.rememberReply({
							...first,
							answer: {_tag: "refused", why: "changed_elsewhere", now: 999},
						});
						yield* s.rememberReply(other);
						expect(yield* s.reply(first.name, first.id)).toEqual(first);
					}).pipe(Effect.provide(layer(d.sql))),
				);
				d.reopen();
				await Effect.runPromise(
					Effect.gen(function* () {
						const s: Replies = yield* ProcessStore;
						expect(yield* s.reply(first.name, first.id)).toEqual(first);
						expect(yield* s.reply(other.name, other.id)).toEqual(other);
						expect(yield* s.reply("notes:3", first.id)).toBeNull();
					}).pipe(Effect.provide(layer(d.sql, NEXT))),
				);
			}),
			options,
		);
	});
	it("plant: acknowledge failed writes or evict an older reply on storage failure", async () => {
		await fc.assert(
			fc.asyncProperty(replies, replies, async (first, second) => {
				fc.pre(first.id !== second.id);
				const d = disk();
				await Effect.runPromise(
					Effect.gen(function* () {
						const s: Replies = yield* ProcessStore;
						expect(typeof s.rememberReply, "P13 adds rememberReply").toBe("function");
						yield* s.rememberReply(first);
						d.fail(true);
						expect(yield* Effect.flip(s.rememberReply(second))).toMatchObject({
							_tag: "LedgerError",
							why: "storage",
						});
						d.fail(false);
						expect(yield* s.reply(first.name, first.id)).toEqual(first);
						expect(yield* s.reply(second.name, second.id)).toBeNull();
					}).pipe(Effect.provide(layer(d.sql))),
				);
				d.reopen();
				await Effect.runPromise(
					Effect.gen(function* () {
						const s: Replies = yield* ProcessStore;
						expect(yield* s.reply(first.name, first.id)).toEqual(first);
						expect(yield* s.reply(second.name, second.id)).toBeNull();
						yield* s.rememberReply(second);
					}).pipe(Effect.provide(layer(d.sql))),
				);
			}),
			options,
		);
	});
	it("reply decoding plant: throw, erase, ignore malformed JSON or turn a corrupt Reply into missing", async () => {
		await fc.assert(
			fc.asyncProperty(
				replies,
				fc.constantFrom("json", "id", "by", "parent", "answer", "name"),
				async (first, field) => {
					const d = disk();
					await Effect.runPromise(
						ProcessStore.use((actual) => {
							const s: Replies = actual;
							return s.rememberReply(first);
						}).pipe(Effect.provide(layer(d.sql))),
					);
					const bad: Record<string, unknown> = {...first};
					if (field === "answer") delete bad.answer;
					else bad[field] = field === "name" ? "" : 42;
					const text = field === "json" ? '{"answer":' : JSON.stringify(bad);
					corrupt(d.db(), first, text);
					for (let attempt = 0; attempt < 2; attempt++) {
						d.reopen();
						await Effect.runPromise(
							Effect.gen(function* () {
								const s: Replies = yield* ProcessStore;
								const error = yield* Effect.flip(s.reply(first.name, first.id));
								expect(error).toMatchObject({_tag: "LedgerError", why: "bad_row"});
								expect(JSON.stringify(error)).not.toContain(text);
							}).pipe(Effect.provide(layer(d.sql))),
						);
						expect(
							d
								.db()
								.prepare("SELECT name FROM sqlite_master WHERE type='table'")
								.all()
								.some(({name}) =>
									d
										.db()
										.prepare(`SELECT * FROM ${quote(String(name))}`)
										.all()
										.some((row) => Object.values(row).includes(text)),
								),
						).toBe(true);
					}
				},
			),
			options,
		);
	});
});
