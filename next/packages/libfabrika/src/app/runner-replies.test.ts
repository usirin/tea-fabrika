// P13, next/. A small program isolates runtime reply ordering without importing a program package.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Machine} from "@demlik/tea/effect";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {Mailbox} from "../coordination/mailbox.ts";
import {ProcessStore} from "../coordination/process-store.ts";
import {Writer} from "../coordination/session-manager.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as Id from "../id.ts";
import type {Incoming} from "./entry.ts";
import {Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {Input} from "./program.ts";
import {ProgramRunner} from "./runner.ts";

const PROCESS = Id.make("process").make("process_0000000000e008000000000001");
const NEXT = Id.make("process").make("process_0000000000e008000000000002");
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
const letters = fc.sample(inputIds, {seed: options.seed, numRuns: 80});
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
	const incoming = (n: number, base: number, body = "private-draft-marker") => ({
		id: letters[n - 1]!,
		envelope: {
			id: letters[n + 39]!,
			by,
			arrivedAt: n,
			input: {type: "save", value: {base, body}},
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
					rememberReply: (value: Reply) =>
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
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 1, max: 12}),
				fc.string({maxLength: 80}),
				async (target, body) => {
					const w = world(),
						future = w.incoming(1, target, body);
					const first = {_tag: "refused", why: "changed_elsewhere", now: 0};
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							expect(yield* r.msg(future)).toEqual(first);
							for (let n = 0; n < target; n++)
								expect((yield* r.msg(w.incoming(n + 2, n, body)))._tag).toBe("accepted");
							expect(yield* r.msg(future)).toEqual(first);
							expect(yield* inbox).toHaveLength(target);
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
								expect((yield* r.open("inspect")).view).toEqual({version: target});
								expect(yield* inbox).toHaveLength(target);
							}).pipe(Effect.provide(w.layer(process))),
						);
					}
				},
			),
			options,
		);
	});
	it("plant: answer a refusal before durable reply storage succeeds", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 1, max: 12}),
				fc.string({maxLength: 80}),
				async (base, suffix) => {
					const w = world();
					const body = `private-draft-marker-${suffix}`;
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							yield* r.open("watcher");
							const count = w.publications.length;
							w.fault.reply = true;
							expect(yield* Effect.flip(r.msg(w.incoming(1, base, body)))).toMatchObject({
								_tag: "LedgerError",
								why: "storage",
							});
							expect(w.replies).toHaveLength(1);
							expect(JSON.stringify(w.replies)).not.toContain("private-draft-marker");
							expect(yield* inbox).toHaveLength(0);
							expect(w.publications).toHaveLength(count);
							w.fault.reply = false;
							expect(yield* r.msg(w.incoming(1, base, body))).toEqual({
								_tag: "refused",
								why: "changed_elsewhere",
								now: 0,
							});
						}).pipe(Effect.provide(w.layer())),
					);
				},
			),
			options,
		);
	});
	it("Sent decoding plant: throw, ignore corruption, accept a wrong terminal case or erase its row", async () => {
		const invalid = fc.oneof(
			fc.string(),
			fc.constant(null),
			fc.constantFrom(
				{_tag: "accepted", rev: 1, pos: 1},
				{_tag: "refused", why: 42},
				{_tag: "refused", why: "too_long", most: "huge"},
				{_tag: "refused", why: "changed_elsewhere", now: "later"},
				{_tag: "unknown"},
				{},
			),
		);
		await fc.assert(
			fc.asyncProperty(invalid, async (answer) => {
				const w = world(),
					incoming = w.incoming(1, 1);
				// Coordination accepts JSON. Only the app knows that a terminal reply must be refused.
				await Effect.runPromise(
					Effect.gen(function* () {
						const store: Replies = yield* ProcessStore;
						yield* store.rememberReply({
							name: "reply:1",
							id: incoming.id,
							by: incoming.envelope.by,
							parent: incoming.envelope.id,
							answer,
						});
					}).pipe(Effect.provide(w.layer())),
				);
				w.reopen();
				for (const process of [PROCESS, NEXT])
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							const store: Replies = yield* ProcessStore;
							const before = yield* store.reply("reply:1", incoming.id);
							const error = yield* Effect.flip(r.msg(incoming));
							expect(error).toMatchObject({_tag: "LedgerError", why: "bad_row"});
							expect(JSON.stringify(error)).not.toContain("private-draft-marker");
							expect(yield* store.reply("reply:1", incoming.id)).toEqual(before);
							expect(yield* inbox).toHaveLength(0);
						}).pipe(Effect.provide(w.layer(process))),
					);
			}),
			options,
		);
	});
});
