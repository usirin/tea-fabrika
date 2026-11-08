// P13, next/. Replies belong to a registered name, so changing the process cannot lose one.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, type Schema} from "effect";
import {Doorbell, Ledger, type LedgerError} from "../data/ledger.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {ProcessStore} from "./process-store.ts";
import {Writer} from "./session-manager.ts";

const PROCESS = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const NEXT = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
const folder = mkdtempSync("/tmp/fh.");
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
type Reply = {
	name: string;
	id: string;
	by: Writer;
	parent: string;
	answer: Schema.Json;
};
type Replies = {
	reply: (name: string, id: string) => Effect.Effect<Reply | null, LedgerError>;
	rememberReply: (reply: Reply) => Effect.Effect<void, LedgerError>;
};
let serial = 0;
const disk = () => {
	const path = join(folder, `${++serial}.db`);
	let db = new DatabaseSync(path);
	databases.push(db);
	let backend = nodeSql(db);
	let failWrite = false;
	const sql: Sql = {
		exec: (query, ...args) => {
			if (failWrite && /^\s*(INSERT|UPDATE|REPLACE)/i.test(query)) throw new Error("SQLITE_FULL");
			return backend.exec(query, ...args);
		},
		transaction: (f) => backend.transaction(f),
		size: () => backend.size(),
	};
	return {
		sql,
		fail: (value: boolean) => {
			failWrite = value;
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
const reply = (over: Partial<Reply> = {}): Reply => ({
	name: "notes:1",
	id: "input_0000000000e008000000000001",
	by: Writer.cases.agent.make({key: "SHA256:agent", for: "person"}),
	parent: `in-${PROCESS}-1`,
	answer: {_tag: "refused", why: "changed_elsewhere", now: 1},
	...over,
});

describe("p53 durable terminal replies", () => {
	it("plant: overwrite an existing reply or keep replies only in memory", async () => {
		const d = disk(),
			first = reply();
		await Effect.runPromise(
			Effect.gen(function* () {
				const s: Replies = yield* ProcessStore;
				expect(typeof s.reply, "P13 adds ProcessStore.reply").toBe("function");
				expect(yield* s.reply(first.name, first.id)).toBeNull();
				yield* s.rememberReply(first);
				yield* s.rememberReply(first);
				yield* s.rememberReply(
					reply({answer: {_tag: "refused", why: "changed_elsewhere", now: 99}}),
				);
				expect(yield* s.reply(first.name, first.id)).toEqual(first);
			}).pipe(Effect.provide(layer(d.sql))),
		);
		d.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const s: Replies = yield* ProcessStore;
				expect(yield* s.reply(first.name, first.id)).toEqual(first);
			}).pipe(Effect.provide(layer(d.sql))),
		);
	});
	it("plant: key by process id or letter alone; replacements retain only the same name's reply", async () => {
		const d = disk(),
			first = reply(),
			other = reply({name: "notes:2", answer: {_tag: "refused", why: "too_long", most: 8}});
		await Effect.runPromise(
			Effect.gen(function* () {
				const s: Replies = yield* ProcessStore;
				expect(typeof s.rememberReply, "P13 adds ProcessStore.rememberReply").toBe("function");
				yield* s.rememberReply(first);
				yield* s.rememberReply(other);
			}).pipe(Effect.provide(layer(d.sql))),
		);
		d.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const s: Replies = yield* ProcessStore;
				expect(yield* s.reply(first.name, first.id)).toEqual(first);
				expect(yield* s.reply(other.name, other.id)).toEqual(other);
				expect(yield* s.reply("notes:3", first.id)).toBeNull();
				expect(yield* s.reply(first.name, "input_0000000000e008000000000002")).toBeNull();
			}).pipe(Effect.provide(layer(d.sql, NEXT))),
		);
	});
	it("plant: acknowledge a failed write or evict an older reply on storage failure", async () => {
		const d = disk(),
			first = reply(),
			second = reply({id: "input_0000000000e008000000000002"});
		await Effect.runPromise(
			Effect.gen(function* () {
				const s: Replies = yield* ProcessStore;
				expect(typeof s.rememberReply, "P13 adds ProcessStore.rememberReply").toBe("function");
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
				expect(yield* s.reply(second.name, second.id)).toEqual(second);
			}).pipe(Effect.provide(layer(d.sql))),
		);
	});
});
