// P12, next/. Real runner, Worker reply adapter, mailbox and SQLite checkpoint.
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {Cause, Effect, Exit, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Mailbox, ProcessStore, Writer} from "../coordination/index.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Alarm, CheckedWriter, Incoming, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {workerExecution} from "./execution.ts";
import {ProgramRunner} from "./runner.ts";

const SEED = 119120;
const PID = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const NAME = "reply:1";
const owner = Writer.cases.person.make({key: "SHA256:fixture", for: "person-test"});
const Model = Schema.Struct({replies: Schema.Int, why: Schema.NullOr(Schema.String)});
const Msg = Schema.Struct({type: Schema.Literal("work"), n: Schema.Int});
const work = Cmd.make("work", {
	input: Schema.Struct({n: Schema.Int}),
	ok: Schema.Int,
	err: ["disk"],
});
const program = {
	name: "reply",
	machine: Machine.make({
		model: Model,
		msg: Msg,
		cmds: [work],
		init: (saved) => [saved ?? {replies: 0, why: null}, []],
		update: {
			work: (s, m) => [s, [work({n: m.n})]],
			work_ok: (s) => [{...s, replies: s.replies + 1}, []],
			work_err: (s, m) => [{replies: s.replies + 1, why: m.error._tag}, []],
		},
	}),
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (s: typeof Model.Type) => s},
	refuse: () => null,
	inputs: {work: {_tag: "write", schema: Msg, description: "Work", personOnly: false}},
	outputs: {},
	writes: {},
	wake: () => null,
} as const;
const input = fc.record({n: fc.integer(), letter: fc.uuid()});
// Final review's lost-reply probe, kept beside generated inputs.
const lostReply = {n: 7, letter: "00000000-0000-1000-8000-000000000007"};

const replyCase = (mode: "rpc" | "decode" | "checked" | "refused", n: number, letter: string) =>
	Effect.gen(function* () {
		const db = new DatabaseSync(":memory:");
		try {
			const sql = nodeSql(db);
			const checkpoint = () =>
				db.prepare("SELECT checkpoint FROM process_state WHERE process=?").get(PID)?.checkpoint;
			let before: unknown;
			let handlerCalls = 0;
			let replyCalls = 0;
			const loaded = yield* ProgramLoader.use((loader) => loader.load(program.name)).pipe(
				Effect.provide(
					ProgramLoader.layer(
						{reply: program},
						{
							work: (cmd: unknown) =>
								Effect.sync(() => {
									handlerCalls++;
									expect(cmd).toEqual(work({n}));
									return mode === "refused"
										? Outcome.err({_tag: "disk"})
										: Outcome.ok(mode === "checked" ? "not an integer" : n);
								}),
						},
					),
				),
			);
			const node = loaded.execution;
			const remote = workerExecution({
				init: (saved) => Effect.runPromise(node.init(saved)),
				step: (model, msg) => Effect.runPromise(node.step(model, msg)),
				fold: (model, msg) => Effect.runPromise(node.fold(model, msg)),
				upgrade: (saved) => Effect.runPromise(node.upgrade(saved)),
				admit: (msg) => Effect.runPromise(node.admit(msg)),
				reply: async (cmd, outcome) => {
					before = checkpoint();
					replyCalls++;
					if (mode === "rpc" && replyCalls === 1)
						return Effect.runPromise(Effect.fail(new Error("reply RPC lost")));
					if (mode === "decode" && replyCalls === 1) return undefined;
					return Effect.runPromise(node.reply(cmd, outcome));
				},
			});
			const execution =
				mode === "checked"
					? {
							...remote,
							reply: (cmd: unknown, outcome: unknown) =>
								Effect.suspend(() => {
									before = checkpoint();
									replyCalls++;
									return node.reply(cmd, outcome);
								}),
						}
					: remote;
			const ledger = Ledger.sql(sql, {reader: PID}).pipe(
				Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
			);
			const mail = Mailbox.layer.pipe(Layer.provideMerge(ledger));
			const dependencies = Layer.mergeAll(
				ProcessStore.layer(sql, {process: PID}),
				Layer.succeed(Alarm, {set: () => Effect.void}),
				Layer.succeed(WatcherManager, {publish: () => Effect.void}),
				Layer.succeed(Recording, {flush: Effect.void}),
				Layer.effect(
					CheckedWriter,
					Effect.map(Mailbox, (mailbox) => ({
						append: (i: Incoming) =>
							mailbox.send(NAME, i.id, i.envelope.input, {
								by: i.envelope.by.key,
								for: i.envelope.by.for,
								sentAt: i.sentAt,
								seen: i.seen,
								parent: i.envelope.id,
								traceId: i.span.traceId,
								build: "test",
							}),
						commit: () => Effect.die("no write declared"),
						own: () => Effect.die("no write declared"),
					})),
				),
			).pipe(Layer.provideMerge(mail));
			const layer = ProgramRunner.withLoader(
				{id: PID, name: NAME, program: program.name, build: "test", owner},
				{load: () => Effect.succeed({...loaded, execution})},
			).pipe(Layer.provideMerge(dependencies));
			yield* Effect.gen(function* () {
				const runner = yield* ProgramRunner;
				const store = yield* ProcessStore;
				const ledger = yield* Ledger;
				const incoming = Schema.decodeUnknownSync(Incoming)({
					id: letter,
					envelope: {
						id: `in-${PID}-1`,
						by: owner,
						arrivedAt: 1794099600000,
						input: {type: "work", n},
					},
					sentAt: "2026-11-08T00:00:00Z",
					seen: 0,
					span: {traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7"},
				});
				const result = yield* Effect.exit(runner.msg(incoming));
				const rows = yield* Stream.runCollect(ledger.read(`${NAME}/inbox`, 0));
				if (mode === "rpc" || mode === "decode") {
					// Review 3's lost-reply bug: never invent work_err/bad_cmd for transport failure.
					expect({exit: result._tag, rows: rows.length, checkpoint: checkpoint()}).toEqual({
						exit: "Failure",
						rows: 1,
						checkpoint: before,
					});
					if (Exit.isFailure(result))
						expect(Cause.squash(result.cause)).toMatchObject({
							_tag: "ProgramDown",
							why: "step",
							source: mode,
						});
					expect(yield* store.load).toMatchObject({
						saved: {model: {replies: 0, why: null}},
						cmds: [{id: `${PID}/1/0`, state: "dispatched", cmd: work({n})}],
					});
					// Resending the accepted input must not repeat its uncertain outside action.
					expect(yield* runner.msg(incoming)).toMatchObject({_tag: "accepted", pos: 1});
					expect(yield* runner.open("audit")).toMatchObject({
						rev: 1,
						view: {replies: 0, why: null},
					});
					expect(checkpoint()).toBe(before);
				} else {
					const why = mode === "checked" ? "bad_cmd" : "disk";
					expect(result).toMatchObject({_tag: "Success", value: {_tag: "accepted", pos: 1}});
					expect(rows).toHaveLength(2);
					expect(rows[1]).toMatchObject({
						id: `${PID}/1/0/answer`,
						body: {m: {type: "work_err", cmd: work({n}), why, error: {_tag: why}}},
					});
					expect(yield* store.load).toMatchObject({
						saved: {after: rows[1]!.rev, model: {replies: 1, why}},
						cmds: [],
					});
					expect(yield* runner.msg(incoming)).toMatchObject({_tag: "accepted", pos: 1});
					expect(yield* Stream.runCollect(ledger.read(`${NAME}/inbox`, 0))).toHaveLength(2);
				}
				expect(handlerCalls).toBe(1);
				expect(replyCalls).toBe(1);
			}).pipe(Effect.provide(layer));
		} finally {
			db.close();
		}
	});

describe("P12 Cmd reply failure versus refusal", () => {
	for (const source of ["rpc", "decode"] as const)
		it(`workerExecution.reply ${source} failure leaves the Cmd dispatched and checkpoint unchanged`, async () => {
			await fc.assert(
				fc.asyncProperty(input, ({n, letter}) => Effect.runPromise(replyCase(source, n, letter))),
				{seed: SEED, examples: [[lostReply]]},
			);
		});
	for (const mode of ["checked", "refused"] as const)
		it(`${mode} program refusal saves its answer and completes the Cmd once`, async () => {
			await fc.assert(
				fc.asyncProperty(input, ({n, letter}) => Effect.runPromise(replyCase(mode, n, letter))),
				{seed: SEED},
			);
		});
});
