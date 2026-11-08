// P13, next/. A small program isolates runtime reply ordering without importing a program package.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Machine} from "@demlik/tea/effect";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import {Mailbox} from "../coordination/mailbox.ts";
import {ProcessStore} from "../coordination/process-store.ts";
import {Writer} from "../coordination/session-manager.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Alarm, CheckedWriter, Incoming, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {Input} from "./program.ts";
import {ProgramRunner} from "./runner.ts";

const PROCESS = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const NEXT = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
const folder = mkdtempSync("/tmp/fh.");
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
const Model = Schema.Struct({version: Schema.Int});
const Msg = Schema.Struct({
	type: Schema.Literal("save"),
	value: Schema.Struct({base: Schema.Int, body: Schema.String}),
});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (loaded) => [loaded ?? {version: 0}, []],
	update: {save: (s) => [{version: s.version + 1}, []]},
});
const program = {
	name: "reply-test",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (m: typeof Model.Type) => m},
	refuse: (m: typeof Model.Type, msg: typeof Msg.Type) =>
		msg.value.base === m.version ? null : {why: "changed_elsewhere", now: m.version},
	inputs: {save: Input.cases.write.make({schema: Msg, personOnly: false, description: "Save"})},
	outputs: {},
	writes: {},
	wake: () => null,
};
let serial = 0;
const world = () => {
	const path = join(folder, `${++serial}.db`);
	let db = new DatabaseSync(path);
	databases.push(db);
	const publications: unknown[] = [],
		replies: unknown[] = [];
	const fault = {reply: false};
	const sql = () => nodeSql(db);
	const data = () =>
		Ledger.sql(sql(), {reader: "p13-reply-runner"}).pipe(
			Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
		);
	const by = Writer.cases.agent.make({key: "SHA256:agent", for: "person"});
	const incoming = (n: number, base: number) =>
		Schema.decodeUnknownSync(Incoming)({
			id: `input_0000000000e00800000000000${n}`,
			envelope: {
				id: `in-${PROCESS}-${n}`,
				by,
				arrivedAt: n,
				input: {type: "save", value: {base, body: "private-draft-marker"}},
			},
			sentAt: "writer-clock",
			seen: 0,
			span: {traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7"},
		});
	const layer = (process = PROCESS) => {
		const store = Layer.effect(
			ProcessStore,
			Effect.gen(function* () {
				const actual = yield* ProcessStore;
				return {
					...actual,
					rememberReply: (value: unknown) =>
						Effect.suspend(() => {
							replies.push(value);
							if (fault.reply) return Effect.fail(new LedgerError({why: "storage"}));
							return actual.rememberReply(value);
						}),
				};
			}),
		).pipe(Layer.provide(ProcessStore.layer(sql(), {process})));
		const checked = Layer.effect(
			CheckedWriter,
			Effect.gen(function* () {
				const mailbox = yield* Mailbox;
				return {
					append: (i: typeof Incoming.Type) =>
						mailbox.send("reply:1", i.id, i.envelope.input, {
							by: i.envelope.by.key,
							for: i.envelope.by.for,
							sentAt: i.sentAt,
							seen: i.seen,
							parent: i.envelope.id,
							traceId: i.span.traceId,
							build: "reply-build",
						}),
					commit: () => Effect.die("no Cmds"),
					own: () => Effect.die("no Cmds"),
				};
			}),
		);
		return ProgramRunner.layer({
			id: process,
			name: "reply:1",
			program: program.name,
			build: "reply-build",
			owner: by,
		}).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					ProgramLoader.layer({[program.name]: program}, {}),
					store,
					checked,
					Layer.succeed(WatcherManager, {
						publish: (_client, update) =>
							Effect.sync(() => {
								publications.push(update);
							}),
					}),
					Layer.succeed(Alarm, {set: () => Effect.void}),
					Layer.succeed(Recording, {flush: Effect.void}),
				).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data())))),
			),
		);
	};
	return {
		layer,
		incoming,
		publications,
		replies,
		fault,
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			databases.push(db);
		},
	};
};
const inbox = Ledger.use((l) => Stream.runCollect(l.read("reply:1/inbox", 0)));

describe("p53 refused replies in the runner", () => {
	it("plant: recheck a future base after it becomes current; refuse before and after reopen/replacement", async () => {
		const w = world(),
			future = w.incoming(2, 2);
		const first = {_tag: "refused", why: "changed_elsewhere", now: 1};
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				expect((yield* r.msg(w.incoming(1, 0)))._tag).toBe("accepted");
				expect(yield* r.msg(future)).toEqual(first);
				expect((yield* r.msg(w.incoming(3, 1)))._tag).toBe("accepted");
				expect(yield* r.msg(future)).toEqual(first);
				expect(yield* inbox).toHaveLength(2);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		for (const process of [PROCESS, NEXT]) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const r = yield* ProgramRunner;
					yield* r.open("watcher");
					const count = w.publications.length;
					expect(yield* r.msg(future)).toEqual(first);
					expect(w.publications).toHaveLength(count);
					expect((yield* r.open("inspect")).view).toEqual({version: 2});
					expect(yield* inbox).toHaveLength(2);
				}).pipe(Effect.provide(w.layer(process))),
			);
		}
	});
	it("plant: answer a refusal before durable reply storage succeeds", async () => {
		const w = world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				yield* r.open("watcher");
				const count = w.publications.length;
				w.fault.reply = true;
				expect(yield* Effect.flip(r.msg(w.incoming(1, 1)))).toMatchObject({
					_tag: "LedgerError",
					why: "storage",
				});
				expect(w.replies).toHaveLength(1);
				expect(JSON.stringify(w.replies)).not.toContain("private-draft-marker");
				expect(yield* inbox).toHaveLength(0);
				expect(w.publications).toHaveLength(count);
				w.fault.reply = false;
				expect(yield* r.msg(w.incoming(1, 1))).toEqual({
					_tag: "refused",
					why: "changed_elsewhere",
					now: 0,
				});
			}).pipe(Effect.provide(w.layer())),
		);
	});
});
