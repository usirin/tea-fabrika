// P11, next/. All runner integration laws share one real SQLite world in this file.
// The plan leaves adapter signatures open. These tests use ProgramRunner.layer(descriptor),
// ProgramLoader.layer(programs, handlers), and entry.ts's CheckedWriter, WatcherManager,
// Alarm and Recording services. Watchers receive publish(client, whole-or-patch).
// A whole has {type:"whole", rev, view}; a patch has {type:"patch", base, rev, patch}.
// CheckedWriter.append(Incoming) saves delivery; commit(id, session, stream, fact) and
// own(id, stream, fact) are the checked door edges. The runner, not these adapters, signs.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Brand, Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {
	type Envelope,
	SessionManager,
	SignRequest,
	SigningRefused,
	Writer,
} from "../coordination/index.ts";
import {Mailbox, type From} from "../coordination/mailbox.ts";
import {Archive} from "../data/archive.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {type Entry, type InputId, lineFor} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {type Sql} from "../data/referee.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {type SpanRow} from "../data/trace.ts";

const SEED = 119120;
const PROCESS = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const REPLACEMENT = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
const DOOR = "process_01jc9q4w7z3m8n5r2t6v0xkb4f";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE = "0bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const BUILD = "p11-build-a";
const NAME = "queue:1";
const writer = (as: "person" | "agent" = "person") =>
	Writer.cases[as].make({key: `SHA256:${as}`, for: PERSON});
const owner = Writer.cases.agent.make({key: "SHA256:owner", for: PERSON});
const inputId = Brand.nominal<InputId>(); // Test is the trusted door, not a public decoder.
const from = (over: Partial<From> = {}): From => ({
	by: "SHA256:person",
	for: PERSON,
	sentAt: "2026-11-08T01:00:00Z",
	seen: 0,
	parent: null,
	traceId: TRACE,
	build: BUILD,
	...over,
});

const Request = Schema.Struct({
	token: Schema.String,
	parent: Schema.NullOr(Schema.String),
	tag: Schema.String,
});
type Request = typeof Request.Type;
const Model = Schema.Struct({
	count: Schema.Int,
	replies: Schema.Int,
	busy: Schema.Boolean,
	note: Schema.String,
	queue: Schema.Array(Request),
	failures: Schema.Array(Schema.String),
	wake: Schema.NullOr(Schema.Number),
});
type Model = typeof Model.Type;
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({
		type: Schema.Literal("request"),
		token: Schema.String,
		parent: Schema.NullOr(Schema.String),
		tag: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("work"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("throw")}),
	Schema.Struct({type: Schema.Literal("fire")}),
	Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number}),
	Schema.Struct({type: Schema.Literal("schedule"), at: Schema.Number}),
]);
const write = Cmd.make("write", {
	input: Schema.Struct({stream: Schema.String, write: Schema.Json}),
	ok: Schema.Json,
	err: ["not_delivered", "spent", "person_only", "ended", "not_granted", "bad_cmd"],
});
const work = Cmd.make("work", {
	input: Schema.Struct({n: Schema.Int}),
	ok: Schema.Int,
	err: ["disk"],
});
const fire = Cmd.make("fire", {input: Schema.Struct({}), ok: Schema.Null, err: ["bad_cmd"]});
const initial: Model = {
	count: 0,
	replies: 0,
	busy: false,
	queue: [],
	failures: [],
	wake: null,
	note: "private model body P11",
};
const command = (r: Request) =>
	write({
		stream: "facts",
		write:
			r.parent === null
				? {_tag: "own", fact: {_tag: r.tag, token: r.token}}
				: {_tag: "caused", parent: r.parent, fact: {_tag: r.tag, token: r.token}},
	});
const nextWrite = (s: Model): readonly [Model, ReadonlyArray<ReturnType<typeof write>>] => {
	const [next, ...queue] = s.queue;
	return next === undefined
		? [{...s, busy: false}, []]
		: [{...s, queue, busy: true}, [command(next)]];
};
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [write, work, fire],
	init: (loaded) => [loaded ?? initial, []],
	update: {
		add: (s, m) => [{...s, count: s.count + m.n}, []],
		request: (s, m) =>
			s.busy
				? [{...s, queue: [...s.queue, {token: m.token, parent: m.parent, tag: m.tag}]}, []]
				: [{...s, busy: true}, [command(m)]],
		work: (s, m) => [{...s, busy: true}, [work({n: m.n})]],
		throw: () => {
			throw new Error("private reducer detail");
		},
		fire: (s) => [s, [fire({})]],
		timer: (s, m) => [{...s, count: s.count + 1, wake: m.at + 10}, [work({n: m.at})]],
		schedule: (s, m) => [{...s, wake: m.at}, []],
		write_ok: (s) => nextWrite({...s, replies: s.replies + 1}),
		write_err: (s, m) =>
			nextWrite({...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag]}),
		work_ok: (s) => nextWrite({...s, replies: s.replies + 1}),
		work_err: (s, m) =>
			nextWrite({...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag]}),
		fire_ok: (s) => [{...s, replies: s.replies + 1}, []],
		fire_err: (s, m) => [
			{...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag]},
			[],
		],
	},
});
const SavedFact = Schema.TaggedStruct("saved", {token: Schema.String});
const Answered = Schema.TaggedStruct("answered", {token: Schema.String});
const Polled = Schema.TaggedStruct("polled", {token: Schema.String});
const program = (name = "queue") => ({
	name,
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (s: Model) => s},
	refuse: (s: Model, m: typeof Msg.Type) =>
		m.type === "add" && s.count + m.n > 1000 ? {why: "limit", now: s.count, most: 1000} : null,
	inputs: {
		add: {_tag: "write", schema: Msg, description: "Add", personOnly: false},
		approve: {_tag: "write", schema: Msg, description: "Approve", personOnly: true},
		comment: {_tag: "write", schema: Msg, description: "Comment", personOnly: false},
		count: {_tag: "read", schema: Schema.Null, description: "Read", answer: (v: Model) => v.count},
	},
	outputs: {},
	writes: {
		saved: {schema: SavedFact, personOnly: false},
		answered: {schema: Answered, personOnly: true},
		polled: {schema: Polled, personOnly: false},
	},
	wake: (s: Model) => s.wake,
});
type Incoming = {
	readonly id: string;
	readonly envelope: Envelope<unknown>;
	readonly sentAt: string;
	readonly seen: number;
	readonly span: {readonly traceId: string; readonly spanId: string};
};
type Failure = {readonly _tag: string; readonly why: string};
type Sent =
	| {readonly _tag: "accepted"; readonly rev: number; readonly pos: number}
	| {readonly _tag: "refused"; readonly why: string; readonly now?: number; readonly most?: number};
type Opened = {readonly rev: number; readonly view: Model};
type Runner = {
	readonly open: (client: string) => Effect.Effect<Opened, Failure>;
	readonly msg: (i: Incoming) => Effect.Effect<Sent, Failure>;
	readonly due: (at: number) => Effect.Effect<void, Failure>;
};
type Update =
	| {readonly type: "whole"; readonly rev: number; readonly view: Model}
	| {
			readonly type: "patch";
			readonly rev: number;
			readonly base: number;
			readonly patch: ReadonlyArray<{
				readonly op: string;
				readonly path: string;
				readonly value?: unknown;
			}>;
	  };

const folder = mkdtempSync(join(tmpdir(), "p11-runner-"));
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
let files = 0;
const disk = () => {
	const path = join(folder, `${++files}.db`);
	let db = new DatabaseSync(path);
	databases.push(db);
	let inner = nodeSql(db);
	const fault = {query: (_q: string) => false, once: false};
	const sql: Sql = {
		exec: (q, ...values) => {
			if (fault.once && fault.query(q)) {
				fault.once = false;
				throw new Error("SQLITE_FULL");
			}
			return inner.exec(q, ...values);
		},
		transaction: (f) => inner.transaction(f),
		size: () => inner.size(),
	};
	return {
		sql,
		fault,
		db: () => db,
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			databases.push(db);
			inner = nodeSql(db);
		},
	};
};
const read = (stream: string) => Ledger.use((l) => Stream.runCollect(l.read(stream, 0)));
const body = (row: Entry) =>
	Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.body);
const inbox = read(`${NAME}/inbox`);
const facts = read("facts");
const steps = read(PROCESS).pipe(Effect.map((rows) => rows.filter((r) => r._tag === "stepped")));
const resultLetters = inbox.pipe(
	Effect.map((rows) =>
		rows.filter((r) => {
			const m = Schema.decodeUnknownOption(
				Schema.Struct({m: Schema.Struct({type: Schema.String})}),
			)(r.body);
			return Option.isSome(m) && /_(ok|err)$/.test(m.value.m.type);
		}),
	),
);
const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.exit,
		Effect.map((exit) => {
			expect(Exit.isFailure(exit)).toBe(true);
			return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
		}),
	);

const world = async (
	options: {
		readonly name?: string;
		readonly process?: string;
		readonly build?: string;
		readonly unknownCmd?: boolean;
		readonly owner?: Writer;
	} = {},
) => {
	const {ProgramRunner} = await import("./runner.ts");
	const {ProgramLoader, CheckedWriter, WatcherManager, Alarm, Recording} =
		await import("./entry.ts");
	const {ProcessStore} = await import("../coordination/process-store.ts");
	const store = disk();
	const ledgerDisk = disk();
	const authority = disk();
	const sink = disk();
	const process = options.process ?? PROCESS;
	const checkedOwner = options.owner ?? owner;
	const normal = program(options.name ?? "queue");
	const ghost = Cmd.make("ghost", {input: Schema.Struct({}), ok: Schema.Null, err: []});
	const p = {
		...normal,
		machine: options.unknownCmd
			? {...machine, update: {...machine.update, fire: (s: Model) => [s, [ghost({})]] as const}}
			: machine,
	};
	const published = new Map<string, Update[]>();
	const alarms: Array<number | null> = [];
	const calls: Array<{kind: string; id: string; parent: string | null}> = [];
	const fault = {
		append: "" as "" | "before" | "after" | "refused",
		sign: false,
		commit: false,
		record: false,
		flush: false,
		work: "ok" as "ok" | "declared" | "throw" | "malformed",
		pause: false,
	};
	let fireCalls = 0;
	let workCalls = 0;
	const gate = await Effect.runPromise(Deferred.make<void>());
	const entered = await Effect.runPromise(Deferred.make<void>());
	const signCalls: Array<{id: string; parent: string; process: string; kind: string}> = [];
	const data = () =>
		Ledger.sql(ledgerDisk.sql, {reader: "p11-runner"}).pipe(
			Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
		);
	const sessions = () =>
		Layer.effect(
			SessionManager,
			Effect.gen(function* () {
				const actual = yield* SessionManager;
				return {
					...actual,
					signer: (parent: string, pid: string, kind: string) =>
						Effect.gen(function* () {
							const request = yield* SignRequest;
							signCalls.push({id: request.id, parent, process: pid, kind});
							const session = yield* actual.signer(parent, pid, kind);
							if (fault.sign) {
								fault.sign = false;
								return yield* new LedgerError({why: "unreachable"});
							}
							return session;
						}),
				};
			}),
		).pipe(
			Layer.provide(
				SessionManager.layer(
					authority.sql,
					(key: string) => Effect.succeed(key === "agent" ? writer("agent") : writer()),
					{
						input: (name: string) => name === "approve",
						fact: (tag: string) => p.writes[tag as keyof typeof p.writes]?.personOnly ?? false,
					},
				),
			),
		);
	const recordDisks = new Map<string, ReturnType<typeof disk>>();
	const records = RecordManager.sql(
		(name) => {
			const existing = recordDisks.get(name);
			if (existing !== undefined) return existing.sql;
			const made = disk();
			recordDisks.set(name, made);
			return made.sql;
		},
		1024 * 1024 * 1024,
	);
	const monitors = () =>
		Layer.mergeAll(SpanSink.layer(sink.sql, {object: process}), records, Archive.memory);
	const base = () => Layer.mergeAll(data(), sessions(), monitors());
	const processStore = () =>
		Layer.effect(
			ProcessStore,
			Effect.gen(function* () {
				const actual = yield* ProcessStore;
				return {
					...actual,
					record: (id: string, fact: unknown, who: From) =>
						actual.record(id, fact, who).pipe(
							Effect.flatMap((answer: unknown) => {
								if (fault.record) {
									fault.record = false;
									return Effect.fail(new LedgerError({why: "unreachable"}));
								}
								return Effect.succeed(answer);
							}),
						),
				};
			}),
		).pipe(Layer.provide(ProcessStore.layer(store.sql, {process})));
	const input = (n: number, m: unknown, as: "person" | "agent" = "person"): Incoming => ({
		id: `letter-${n}`,
		envelope: {
			id: inputId(`in-${DOOR}-${n}`),
			by: writer(as),
			arrivedAt: 1794099600000 + n,
			input: m,
		},
		sentAt: "2026-11-08T01:00:00Z",
		seen: 0,
		span: {traceId: TRACE, spanId: SPAN},
	});
	const deliver = (i: Incoming, name = "approve", to = process, personOnly = name === "approve") =>
		SessionManager.use((s) =>
			Effect.gen(function* () {
				yield* s.record({
					id: i.envelope.id,
					by: i.envelope.by,
					client: i.envelope.by._tag,
					process: to,
					name,
					personOnly,
					digest: JSON.stringify(i.envelope.input),
					traceId: i.span.traceId,
					span: i.span,
					arrivedAt: i.envelope.arrivedAt,
				});
				yield* s.delivered(i.envelope.id, to);
			}),
		);
	const wiring = () =>
		Layer.mergeAll(
			ProgramLoader.layer(
				{[p.name]: p},
				{
					work: (cmd: {readonly n: number}) =>
						Effect.gen(function* () {
							workCalls++;
							yield* Deferred.succeed(entered, undefined);
							const rows = yield* inbox;
							expect(
								rows.some(
									(row) =>
										JSON.stringify(row.body).includes(`"n":${cmd.n}`) ||
										JSON.stringify(row.body).includes(`"at":${cmd.n}`),
								),
							).toBe(true);
							if (fault.pause) yield* Deferred.await(gate);
							if (fault.work === "declared") return Outcome.err({_tag: "disk"});
							if (fault.work === "throw")
								return yield* Effect.die(new Error("private handler detail"));
							return Outcome.ok(fault.work === "malformed" ? "wrong" : cmd.n);
						}),
					fire: () =>
						Effect.sync(() => {
							fireCalls++;
							return Outcome.ok(null);
						}),
				},
			),
			Layer.succeed(WatcherManager, {
				publish: (client: string, update: Update) =>
					Effect.sync(() => {
						const updates = published.get(client) ?? [];
						updates.push(structuredClone(update));
						published.set(client, updates);
					}),
			}),
			Layer.succeed(Alarm, {
				set: (at: number | null) =>
					Effect.sync(() => {
						alarms.push(at);
					}),
			}),
			Layer.effect(
				Recording,
				Effect.gen(function* () {
					const spanSink = yield* SpanSink;
					return {
						flush: Effect.gen(function* () {
							if (fault.flush) return yield* new LedgerError({why: "storage"});
							return yield* spanSink.flush;
						}),
					};
				}),
			),
			Layer.effect(
				CheckedWriter,
				Effect.gen(function* () {
					const mailbox = yield* Mailbox;
					const ledger = yield* Ledger;
					const s = yield* SessionManager;
					return {
						append: (i: Incoming) =>
							Effect.gen(function* () {
								if (fault.append === "before") {
									fault.append = "";
									return yield* new LedgerError({why: "unreachable"});
								}
								if (fault.append === "refused") return {_tag: "refused", why: "seen_ahead"};
								const answer = yield* mailbox.send(
									NAME,
									i.id,
									i.envelope.input,
									from({
										by: i.envelope.by.key,
										for: i.envelope.by.for,
										parent: i.envelope.id,
										traceId: i.span.traceId,
										sentAt: i.sentAt,
										seen: i.seen,
									}),
								);
								if (fault.append === "after") {
									fault.append = "";
									return yield* new LedgerError({why: "unreachable"});
								}
								return answer;
							}),
						commit: (
							id: string,
							session: {readonly parent: string},
							stream: string,
							fact: {_tag: string},
						) =>
							Effect.gen(function* () {
								calls.push({kind: fact._tag, id, parent: session.parent});
								const checked = yield* s.receipt(id, session.parent, process, fact._tag);
								const answer = yield* ledger.append(
									stream,
									id,
									lineFor(
										from({
											by: checked.by.key,
											for: checked.by.for,
											parent: checked.parent,
											traceId: checked.traceId,
										}),
										fact,
									),
								);
								if (fault.commit) {
									fault.commit = false;
									return yield* new LedgerError({why: "unreachable"});
								}
								return answer;
							}),
						own: (id: string, stream: string, fact: {_tag: string}) =>
							Effect.gen(function* () {
								calls.push({kind: fact._tag, id, parent: null});
								if (p.writes[fact._tag as keyof typeof p.writes]?.personOnly)
									return yield* new SigningRefused({why: "person_only"});
								return yield* ledger.append(
									stream,
									id,
									lineFor(from({by: checkedOwner.key, for: checkedOwner.for}), fact),
								);
							}),
					};
				}),
			).pipe(Layer.provide(Mailbox.layer)),
		);
	// One built layer shares a runner/permit across concurrent inputs. Rebuilding it is a wake.
	const layer = () =>
		ProgramRunner.layer({
			id: process,
			name: NAME,
			program: p.name,
			build: options.build ?? BUILD,
			owner: checkedOwner,
		}).pipe(
			Layer.provideMerge(
				Layer.mergeAll(wiring(), processStore()).pipe(
					Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(base()))),
				),
			),
		);
	return {
		p,
		store,
		ledgerDisk,
		authority,
		sink,
		process,
		input,
		deliver,
		fault,
		calls,
		signCalls,
		published,
		alarms,
		gate,
		entered,
		layer,
		base,
		ProgramRunner,
		workCalls: () => workCalls,
		fireCalls: () => fireCalls,
		reopen: () => {
			store.reopen();
			ledgerDisk.reopen();
			authority.reopen();
			sink.reopen();
			for (const part of recordDisks.values()) part.reopen();
		},
	};
};

describe("p14 turns and watcher revisions", () => {
	it("plant, remove the permit: concurrent bursts accept every input once with consecutive positions", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.open("a");
				yield* r.open("b");
				const messages = Array.from({length: 24}, (_, i) => w.input(i + 1, {type: "add", n: 1}));
				const answers = yield* Effect.forEach(messages, (m) => r.msg(m), {
					concurrency: "unbounded",
				});
				expect(answers.every((a) => a._tag === "accepted")).toBe(true);
				expect(
					answers.map((a) => (a._tag === "accepted" ? a.pos : -1)).sort((a, b) => a - b),
				).toEqual(Array.from({length: 24}, (_, i) => i + 1));
				expect(yield* inbox).toHaveLength(24);
				expect((yield* r.open("inspect")).view.count).toBe(24);
				for (const client of ["a", "b"])
					expect(w.published.get(client)?.map((u) => u.rev)).toEqual(
						Array.from({length: 25}, (_, i) => i),
					);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, confuse global rev with inbox pos: unrelated writes cause no watcher gaps", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const ledger = yield* Ledger;
				yield* r.open("a");
				yield* r.msg(w.input(1, {type: "add", n: 2}));
				yield* ledger.append("elsewhere", "noise", lineFor(from(), {_tag: "noise"}));
				yield* r.msg(w.input(2, {type: "add", n: 3}));
				expect(w.published.get("a")?.map((u) => u.rev)).toEqual([0, 1, 2]);
				expect((yield* r.open("inspect")).view.count).toBe(5);
			}).pipe(Effect.provide(w.layer())),
		);
	});
});

describe("p22 refusal and p25 thrown steps", () => {
	for (const [label, msg, answer] of [
		["bad fresh shape", {type: "add", n: "bad"}, {_tag: "refused", why: "bad_msg"}],
		[
			"program refusal",
			{type: "add", n: 1001},
			{_tag: "refused", why: "limit", now: 0, most: 1000},
		],
	] as const)
		it(`plant, append before refusal: ${label} changes no history, view or Cmd`, async () => {
			const w = await world();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					const before = yield* r.open("a");
					expect(yield* r.msg(w.input(1, msg))).toEqual(answer);
					expect(yield* inbox).toEqual([]);
					expect(yield* steps).toEqual([]);
					expect((yield* r.open("inspect")).view).toEqual(before.view);
					expect(w.published.get("a")).toHaveLength(1);
					expect(w.workCalls()).toBe(0);
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("plant, turn throw into refusal: a fresh throw leaves no accepted input, result or Cmd", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.open("a");
				expect(yield* failure(r.msg(w.input(1, {type: "throw"})))).toMatchObject({
					_tag: "ProgramDown",
					why: "step",
				});
				expect(yield* inbox).toEqual([]);
				expect(yield* steps).toEqual([]);
				expect(w.workCalls()).toBe(0);
				expect(w.published.get("a")).toHaveLength(1);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, skip a bad saved letter: recovery preserves all letters and accepts no later input", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const m = yield* Mailbox;
				yield* m.send(NAME, "good-a", {type: "add", n: 1}, from());
				yield* m.send(NAME, "bad", {type: "add", n: "bad"}, from());
				yield* m.send(NAME, "good-b", {type: "add", n: 2}, from());
			}).pipe(Effect.provide(Mailbox.layer.pipe(Layer.provide(w.base())))),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const before = yield* inbox;
				expect(yield* failure(r.open("a"))).toMatchObject({
					_tag: "ProgramDown",
					why: "saved_letter",
				});
				expect(yield* failure(r.msg(w.input(4, {type: "add", n: 3})))).toMatchObject({
					_tag: "ProgramDown",
				});
				expect(yield* inbox).toEqual(before);
				expect(w.published.size).toBe(0);
			}).pipe(Effect.provide(w.layer())),
		);
	});
});

describe("p35 Cmd order, replay and recorded failures", () => {
	it("plant, fire before append: a real handler sees its saved input before it runs", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect(yield* r.msg(w.input(1, {type: "work", n: 17}))).toMatchObject({_tag: "accepted"});
				expect(w.workCalls()).toBe(1);
				expect(yield* resultLetters).toHaveLength(1);
				expect((yield* r.open("a")).view.replies).toBe(1);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	for (const at of ["before", "refused"] as const)
		it(`plant, dispatch after ${at} append: no handler, patch or alarm escapes`, async () => {
			const w = await world();
			w.fault.append = at;
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					yield* r.open("a");
					const alarmCount = w.alarms.length;
					const result = yield* Effect.exit(r.msg(w.input(1, {type: "work", n: 19})));
					expect(
						Exit.isFailure(result) || (Exit.isSuccess(result) && result.value._tag === "refused"),
					).toBe(true);
					expect(w.workCalls()).toBe(0);
					expect(yield* inbox).toEqual([]);
					expect(w.published.get("a")).toHaveLength(1);
					expect(w.alarms).toHaveLength(alarmCount);
				}).pipe(Effect.provide(w.layer())),
			);
		});
	for (const [mode, why] of [
		["declared", "disk"],
		["throw", "handler_failed"],
		["malformed", "bad_cmd"],
	] as const)
		it(`plant, drop ${mode} result: one saved failure with why reaches update once`, async () => {
			const w = await world();
			w.fault.work = mode;
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					yield* r.msg(w.input(1, {type: "work", n: 23}));
					const answers = yield* resultLetters;
					expect(answers).toHaveLength(1);
					expect(answers[0]?.body).toMatchObject({m: {type: "work_err", why}});
					expect((yield* r.open("inspect")).view.replies).toBe(1);
				}).pipe(Effect.provide(w.layer())),
			);
			w.reopen();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					expect((yield* r.open("after-wake")).view.replies).toBe(1);
					expect(yield* resultLetters).toHaveLength(1);
					expect(w.workCalls()).toBe(1);
				}).pipe(Effect.provide(w.layer())),
			);
		});
	for (const name of ["queue", "chaos"])
		it(`plant, dispatch fire by name alone: fire in ${name} respects its owning program`, async () => {
			const w = await world({name});
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					yield* r.msg(w.input(1, {type: "fire"}));
					expect(w.fireCalls()).toBe(name === "chaos" ? 1 : 0);
					expect(yield* resultLetters).toHaveLength(1);
					expect((yield* resultLetters)[0]?.body).toMatchObject({
						m: {
							type: name === "chaos" ? "fire_ok" : "fire_err",
							...(name === "chaos" ? {} : {why: "bad_cmd"}),
						},
					});
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("plant, execute folded Cmds: wake rebuilds state from inbox without calling handlers", async () => {
		const w = await world();
		await Effect.runPromise(
			Mailbox.use((m) => m.send(NAME, "prior-work", {type: "work", n: 27}, from())).pipe(
				Effect.provide(Mailbox.layer.pipe(Layer.provide(w.base()))),
			),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.open("a");
				expect(w.workCalls()).toBe(0);
				expect(yield* resultLetters).toHaveLength(0);
				expect(yield* inbox).toHaveLength(1);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, mint a new timer id: a repeated due time saves and fires exactly once", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.msg(w.input(1, {type: "schedule", at: 40}));
				yield* r.due(40);
				yield* r.due(40);
				expect(w.workCalls()).toBe(1);
				expect((yield* r.open("a")).view).toMatchObject({count: 1, replies: 1, wake: 50});
				expect(
					(yield* inbox).filter((row) => JSON.stringify(row.body).includes('"type":"timer"')),
				).toHaveLength(1);
				expect(w.alarms.at(-1)).toBe(50);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.due(40);
				expect(w.workCalls()).toBe(1);
				expect((yield* r.open("wake")).view.count).toBe(1);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, re-fire an unanswered dispatch: an interrupted handler remains visible after wake", async () => {
		const w = await world();
		w.fault.pause = true;
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const running = yield* r.msg(w.input(1, {type: "work", n: 31})).pipe(Effect.forkChild);
				yield* Deferred.await(w.entered);
				yield* Fiber.interrupt(running);
				expect(w.workCalls()).toBe(1);
				expect(yield* resultLetters).toHaveLength(0);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		w.fault.pause = false;
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.open("a");
				expect(w.workCalls()).toBe(1);
				expect(yield* resultLetters).toHaveLength(0);
				const tables = w.store
					.db()
					.prepare("SELECT name FROM sqlite_master WHERE type='table'")
					.all();
				const saved = tables.map(({name}) =>
					w.store
						.db()
						.prepare(`SELECT * FROM "${String(name)}"`)
						.all(),
				);
				expect(JSON.stringify(saved)).toContain("dispatched");
				expect(JSON.stringify(saved)).toContain("31");
			}).pipe(Effect.provide(w.layer())),
		);
	});
});

describe("p69 sender survives queued work and Cmd replies", () => {
	it("plant, pair Cmd with latest Msg: a person's completion releases an agent's queued write", async () => {
		const w = await world();
		w.fault.pause = true;
		const a = w.input(1, {type: "work", n: 37});
		const b = w.input(
			2,
			{type: "request", token: "b", parent: `in-${DOOR}-2`, tag: "saved"},
			"agent",
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* w.deliver(a);
				yield* w.deliver(b, "comment");
				const running = yield* r.msg(a).pipe(Effect.forkChild);
				yield* Deferred.await(w.entered);
				yield* r.msg(b);
				expect((yield* r.open("queued")).view.queue).toEqual([
					{token: "b", parent: b.envelope.id, tag: "saved"},
				]);
				yield* Deferred.succeed(w.gate, undefined);
				yield* Fiber.join(running);
				const rows = yield* facts;
				expect(
					rows.map((row) => ({token: body(row).token, by: row.by, parent: row.parent})),
				).toEqual([{token: "b", by: writer("agent").key, parent: b.envelope.id}]);
				expect((yield* r.open("done")).view).toMatchObject({queue: [], replies: 2});
				expect(w.signCalls).toMatchObject([
					{parent: b.envelope.id, process: PROCESS, kind: "saved"},
				]);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, read expected writers from returned parents: generated inputs keep an independent sender table", async () => {
		const generated = fc.sample(fc.array(fc.boolean(), {minLength: 8, maxLength: 16}), {
			seed: SEED,
			numRuns: 1,
		})[0]!;
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const expected: Array<{token: string; by: string; parent: string | null}> = [];
				for (const [index, asPerson] of generated.entries()) {
					const token = `request-${index}`;
					const as = asPerson ? "person" : "agent";
					const m = w.input(
						index + 1,
						{type: "request", token, parent: `in-${DOOR}-${index + 1}`, tag: "saved"},
						as,
					);
					expected.push({token, by: writer(as).key, parent: m.envelope.id});
					yield* w.deliver(m, "comment");
					yield* r.msg(m);
				}
				const own = w.input(99, {type: "request", token: "own", parent: null, tag: "polled"});
				yield* r.msg(own);
				expected.push({token: "own", by: owner.key, parent: null});
				expect(
					(yield* facts).map((row) => ({token: body(row).token, by: row.by, parent: row.parent})),
				).toEqual(expected);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	for (const [scenario, why, as, inputName, parentProcess] of [
		["undelivered", "not_delivered", "person", "approve", PROCESS],
		["another process", "not_delivered", "person", "approve", REPLACEMENT],
		["person comment", "person_only", "person", "comment", PROCESS],
		["agent comment", "person_only", "agent", "comment", PROCESS],
		["agent approval", "person_only", "agent", "approve", PROCESS],
		["ended process", "ended", "person", "approve", PROCESS],
	] as const)
		it(`plant, fall back to owner: ${scenario} writes nothing and records ${why}`, async () => {
			const w = await world();
			const i = w.input(
				1,
				{type: "request", token: "refused", parent: `in-${DOOR}-1`, tag: "answered"},
				as,
			);
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					const s = yield* SessionManager;
					if (scenario !== "undelivered") yield* w.deliver(i, inputName, parentProcess);
					if (scenario === "ended process") yield* s.end(PROCESS);
					yield* r.msg(i);
					expect(yield* facts).toEqual([]);
					expect(w.calls.filter((c) => c.parent === null)).toEqual([]);
					expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {type: "write_err", why}});
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("plant, spend by Cmd position: a second answered with the same parent is refused", async () => {
		const w = await world();
		const parent = `in-${DOOR}-1`;
		const first = w.input(1, {type: "request", token: "first", parent, tag: "answered"});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* w.deliver(first);
				yield* r.msg(first);
				yield* r.msg(w.input(2, {type: "request", token: "second", parent, tag: "answered"}));
				expect((yield* facts).map((row) => body(row).token)).toEqual(["first"]);
				expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "spent"}});
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, own bypasses personOnly: even a person-owned process needs a qualifying parent", async () => {
		const w = await world({owner: writer("person")});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.msg(
					w.input(1, {type: "request", token: "own-approval", parent: null, tag: "answered"}),
				);
				expect(yield* facts).toEqual([]);
				expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "person_only"}});
			}).pipe(Effect.provide(w.layer())),
		);
	});
	for (const lost of ["sign", "commit"] as const)
		it(`plant, new write id after lost ${lost} reply: retry uses the saved receipt and places once`, async () => {
			const w = await world();
			w.fault[lost] = true;
			const i = w.input(
				1,
				{type: "request", token: "retry", parent: `in-${DOOR}-1`, tag: "saved"},
				"agent",
			);
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					yield* w.deliver(i, "comment");
					yield* Effect.exit(r.msg(i));
				}).pipe(Effect.provide(w.layer())),
			);
			w.reopen();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					expect(yield* r.msg(i)).toMatchObject({_tag: "accepted"});
					expect((yield* facts).map((row) => ({by: row.by, parent: row.parent}))).toEqual([
						{by: writer("agent").key, parent: i.envelope.id},
					]);
					expect(w.signCalls.length).toBeGreaterThanOrEqual(2);
					expect(new Set(w.signCalls.map((call) => call.id)).size).toBe(1);
					expect(
						(yield* resultLetters).filter((row) => JSON.stringify(row.body).includes("write_ok")),
					).toHaveLength(1);
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("plant, sender table in runner memory: a queued parent survives a same-process storage wake", async () => {
		const w = await world();
		w.fault.pause = true;
		const a = w.input(1, {type: "work", n: 41});
		const b = w.input(
			2,
			{type: "request", token: "queued-after-wake", parent: `in-${DOOR}-2`, tag: "saved"},
			"agent",
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* w.deliver(a);
				yield* w.deliver(b, "comment");
				const running = yield* r.msg(a).pipe(Effect.forkChild);
				yield* Deferred.await(w.entered);
				yield* r.msg(b);
				yield* Fiber.interrupt(running);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		w.fault.pause = false;
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect((yield* r.open("wake")).view.queue).toEqual([
					{token: "queued-after-wake", parent: b.envelope.id, tag: "saved"},
				]);
				// A late, trusted handler answer, built by tea. It is a new result delivery after wake.
				yield* r.msg(w.input(3, work.ok(work({n: 41}), 41, 1794099600003)));
				expect((yield* facts).map((row) => ({by: row.by, parent: row.parent}))).toEqual([
					{by: writer("agent").key, parent: b.envelope.id},
				]);
				expect(w.workCalls()).toBe(1);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, reuse old authority after replacement: old parent cannot sign for a new process id", async () => {
		const w = await world({process: REPLACEMENT});
		const i = w.input(
			1,
			{type: "request", token: "old-queue", parent: `in-${DOOR}-1`, tag: "saved"},
			"agent",
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const s = yield* SessionManager;
				yield* w.deliver(i, "comment", PROCESS);
				yield* s.end(PROCESS);
				yield* r.msg(i);
				expect(yield* facts).toEqual([]);
				expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "not_delivered"}});
				expect(w.signCalls).toMatchObject([{process: REPLACEMENT, parent: i.envelope.id}]);
			}).pipe(Effect.provide(w.layer())),
		);
	});
});

describe("P11 recovery gaps and durable installation", () => {
	for (const cut of [
		"before append",
		"after append",
		"after stepped",
		"before checkpoint",
	] as const)
		it(`plant, trust a prepared model: recovery ${cut} saves one accepted input at its original placing`, async () => {
			const w = await world();
			const i = w.input(1, {type: "add", n: 7});
			if (cut === "before append") w.fault.append = "before";
			if (cut === "after append") w.fault.append = "after";
			if (cut === "after stepped") w.fault.record = true;
			if (cut === "before checkpoint") {
				w.store.fault.once = true;
				w.store.fault.query = (q) =>
					/^\s*(INSERT|UPDATE|REPLACE)/i.test(q) &&
					Boolean(
						w.ledgerDisk.db().prepare("SELECT name FROM sqlite_master WHERE name='entries'").get(),
					) &&
					Number(
						w.ledgerDisk
							.db()
							.prepare("SELECT count(*) AS n FROM entries WHERE _tag='stepped'")
							.get()?.n,
					) > 0;
			}
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					expect(yield* failure(r.msg(i))).toMatchObject({_tag: "LedgerError"});
				}).pipe(Effect.provide(w.layer())),
			);
			w.reopen();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					const answer = yield* r.msg(i);
					const letters = yield* inbox;
					expect(letters).toHaveLength(1);
					expect(answer).toEqual({_tag: "accepted", rev: letters[0]!.rev, pos: letters[0]!.pos});
					expect((yield* r.open("a")).view.count).toBe(7);
					expect(yield* steps).toHaveLength(1);
					expect((yield* steps)[0]).toMatchObject({body: {input: i.id, pos: 1}, build: BUILD});
					expect(w.workCalls()).toBe(0);
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("plant, check refusal before duplicate id: resend returns the original placing despite later state", async () => {
		const w = await world();
		const i = w.input(1, {type: "add", n: 800});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				const answer = yield* r.msg(i);
				yield* r.msg(w.input(2, {type: "add", n: 100}));
				expect(yield* r.msg({...i, seen: 999999, sentAt: "retry clock"})).toEqual(answer);
				expect((yield* r.open("a")).view.count).toBe(900);
				expect(yield* inbox).toHaveLength(2);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("S3 plant, replace without recording: a successful upgrade records ran and the new build", async () => {
		const w = await world({build: "new-build"});
		w.p.state.v = 3;
		const Legacy = Schema.Struct({n: Schema.Int});
		const Middle = Schema.Struct({count: Schema.Int});
		const upgrades = [
			{
				name: "n_to_count",
				from: 1,
				run: (raw: unknown) => ({count: Schema.decodeUnknownSync(Legacy)(raw).n}),
			},
			{
				name: "add_runtime",
				from: 2,
				run: (raw: unknown) => ({...initial, count: Schema.decodeUnknownSync(Middle)(raw).count}),
			},
		];
		Object.assign(w.p.state, {upgrades});
		const {ProcessStore} = await import("../coordination/process-store.ts");
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* ProcessStore;
				yield* store.save({
					saved: {v: 1, build: "old-build", after: 0, model: {n: 9}},
					turn: null,
					cmds: [],
				});
			}).pipe(
				Effect.provide(
					ProcessStore.layer(w.store.sql, {process: PROCESS}).pipe(Layer.provide(w.base())),
				),
			),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect((yield* r.open("a")).view.count).toBe(9);
				const rows = yield* read(PROCESS);
				expect(rows.filter((row) => row._tag === "state.upgraded")).toMatchObject([
					{
						build: "new-build",
						body: {program: "queue", from: 1, to: 3, ran: ["n_to_count", "add_runtime"]},
					},
				]);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect((yield* r.open("b")).view.count).toBe(9);
				expect((yield* read(PROCESS)).filter((row) => row._tag === "state.upgraded")).toHaveLength(
					1,
				);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, accept an undeclared fact: caller-supplied personOnly cannot authorize a write", async () => {
		const w = await world();
		const i = w.input(1, {
			type: "request",
			token: "undeclared",
			parent: `in-${DOOR}-1`,
			tag: "granted",
			personOnly: false,
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* w.deliver(i, "comment");
				yield* r.msg(i);
				expect(yield* facts).toEqual([]);
				expect(w.signCalls).toEqual([]);
				expect(w.calls).toEqual([]);
				expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "bad_cmd"}});
			}).pipe(Effect.provide(w.layer())),
		);
	});
	for (const tag of ["granted", "started", "stepped", "state.upgraded"])
		it(`plant, trust a forbidden declaration: programs cannot emit ${tag} even if declared`, async () => {
			const w = await world();
			Object.assign(w.p.writes, {
				[tag]: {schema: Schema.TaggedStruct(tag, {token: Schema.String}), personOnly: false},
			});
			const i = w.input(1, {type: "request", token: "reserved", parent: `in-${DOOR}-1`, tag});
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					yield* w.deliver(i);
					yield* r.msg(i);
					expect(yield* facts).toEqual([]);
					expect(w.signCalls).toEqual([]);
					expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "bad_cmd"}});
				}).pipe(Effect.provide(w.layer())),
			);
		});
	it("S3 plant, overwrite before decoding: a rejected saved model keeps its old SQL value", async () => {
		const w = await world();
		const {ProcessStore} = await import("../coordination/process-store.ts");
		const saved = {
			saved: {v: 999, model: {n: 3}, after: 0, build: "future-build"},
			turn: null,
			cmds: [],
		};
		const storeLayer = () =>
			ProcessStore.layer(w.store.sql, {process: PROCESS}).pipe(Layer.provide(w.base()));
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* ProcessStore;
				yield* store.save(saved);
			}).pipe(Effect.provide(storeLayer())),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect(yield* failure(r.open("a"))).toMatchObject({
					_tag: "ProgramDown",
					why: "saved_state",
				});
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* ProcessStore;
				expect(yield* store.load).toEqual(saved);
			}).pipe(Effect.provide(storeLayer())),
		);
	});
	it("plant, let unknown Cmd disappear: it produces a saved bad_cmd answer", async () => {
		const w = await world({unknownCmd: true});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.msg(w.input(1, {type: "fire"}));
				expect(w.fireCalls()).toBe(0);
				expect((yield* resultLetters).at(-1)?.body).toMatchObject({m: {why: "bad_cmd"}});
			}).pipe(Effect.provide(w.layer())),
		);
	});
});

describe("P11 monitoring, content and storage failures", () => {
	const recorded = (process = PROCESS) =>
		RecordManager.use((r) => Stream.runCollect(r.read({_tag: "job", process})));
	it("plant, flush before spans end: step, Cmd, write, due and open reach the process JobRecord", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.open("a");
				const i = w.input(
					1,
					{type: "request", token: "linked", parent: `in-${DOOR}-1`, tag: "saved"},
					"agent",
				);
				yield* w.deliver(i, "comment");
				yield* r.msg(i);
				yield* r.due(50);
				const rows: ReadonlyArray<SpanRow> = yield* recorded();
				for (const name of [
					"runner.open",
					"runner.step",
					"runner.cmd",
					"runner.write",
					"runner.due",
				])
					expect(rows.some((row) => row.name === name)).toBe(true);
				const linked = rows.filter((row) => row.name === "runner.write");
				expect(
					linked.some((row) =>
						row.links.some((link) => link.traceId === TRACE && link.spanId === SPAN),
					),
				).toBe(true);
				expect(
					linked.some((row) => Object.values(row.attributes).includes(w.signCalls[0]!.id)),
				).toBe(true);
				expect(w.sink.db().prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, use traceId as authority: changed trace context cannot replace the direct parent sender", async () => {
		const w = await world();
		const agent = w.input(
			1,
			{type: "request", token: "trace", parent: `in-${DOOR}-1`, tag: "saved"},
			"agent",
		);
		const person = w.input(2, {type: "add", n: 1});
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* w.deliver(agent, "comment");
				yield* w.deliver({...person, span: {traceId: OTHER_TRACE, spanId: SPAN}});
				yield* r.msg({...agent, span: {traceId: OTHER_TRACE, spanId: SPAN}});
				expect((yield* facts)[0]).toMatchObject({
					by: writer("agent").key,
					parent: agent.envelope.id,
					traceId: TRACE,
				});
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, tag bodies or error messages: failures keep class, with content deletable separately", async () => {
		const w = await world();
		w.fault.work = "throw";
		const marker = "private handler detail";
		const signature = "made-up signature bytes P11";
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				yield* r.msg(w.input(1, {type: "work", n: 59, signature, body: "private model body P11"}));
				const rows: ReadonlyArray<SpanRow> = yield* recorded();
				const tags = JSON.stringify(
					rows.map((row) => ({attributes: row.attributes, events: row.events, links: row.links})),
				);
				const health = JSON.stringify(w.sink.db().prepare("SELECT * FROM health").all());
				for (const secret of [marker, signature, "private model body P11"]) {
					expect(tags).not.toContain(secret);
					expect(health).not.toContain(secret);
				}
				const failed = rows.filter((row) => !row.ok);
				expect(failed.length).toBeGreaterThan(0);
				expect(failed.some((row) => typeof row.attributes["error.type"] === "string")).toBe(true);
				const records = yield* RecordManager;
				const content = yield* Effect.forEach(
					failed,
					(row) => records.content({_tag: "job", process: PROCESS}, row.spanId),
					{concurrency: 1},
				);
				expect(JSON.stringify(content)).toContain(marker);
				const contentSpan =
					failed[content.findIndex((value) => JSON.stringify(value).includes(marker))]!;
				yield* records.deleteContent({_tag: "job", process: PROCESS}, contentSpan.spanId, {
					by: "SHA256:person",
					why: "test deletion",
				});
				expect(
					Option.getOrNull(
						yield* records.content({_tag: "job", process: PROCESS}, contentSpan.spanId),
					),
				).toMatchObject({_tag: "deleted", why: "test deletion"});
				expect((yield* recorded()).some((row) => row.spanId === contentSpan.spanId)).toBe(true);
				expect(JSON.stringify(yield* resultLetters)).not.toContain(marker);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("plant, flush success only: a thrown fresh step reaches JobRecord before returning failure", async () => {
		const w = await world();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* w.ProgramRunner;
				expect(yield* failure(r.msg(w.input(1, {type: "throw"})))).toMatchObject({
					_tag: "ProgramDown",
				});
				expect((yield* recorded()).some((row) => row.name === "runner.step" && !row.ok)).toBe(true);
				expect(w.sink.db().prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	for (const piece of ["process store", "sink"] as const)
		it(`plant, swallow ${piece} storage failure: no success or later handler dispatch`, async () => {
			const w = await world();
			if (piece === "sink") {
				w.sink.fault.once = true;
				w.sink.fault.query = (q) => /^\s*(INSERT|UPDATE|REPLACE)/i.test(q);
			} else {
				w.store.fault.once = true;
				w.store.fault.query = (q) => /^\s*(INSERT|UPDATE|REPLACE)/i.test(q);
			}
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					expect(yield* failure(r.msg(w.input(1, {type: "work", n: 61})))).toMatchObject({
						why: "storage",
					});
					expect(piece === "sink" || w.workCalls() === 0).toBe(true);
				}).pipe(Effect.provide(w.layer())),
			);
			w.fault.flush = false;
			w.reopen();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r: Runner = yield* w.ProgramRunner;
					const rows = yield* inbox;
					yield* r.open("recovered");
					expect(yield* inbox).toEqual(rows);
				}).pipe(Effect.provide(w.layer())),
			);
		});
});
