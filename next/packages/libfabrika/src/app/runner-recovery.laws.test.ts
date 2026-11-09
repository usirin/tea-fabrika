// P12, next/. Real runner, mailbox, checkpoint and SQLite. Only Worker RPC can fail.
import {DatabaseSync} from "node:sqlite";
import {Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Option, Schema} from "effect";
import * as fc from "fast-check";
import {Mailbox, ProcessStore, Writer} from "../coordination/index.ts";
import {Archive, Doorbell, Ledger, RecordManager, SpanSink} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";
import {processId} from "../id.test-support.ts";
import {Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {workerExecution} from "./execution.ts";
import {stepper} from "./program.ts";
import {ProgramRunner} from "./runner.ts";

const PID = Effect.runSync(processId);
const Model = Schema.Struct({count: Schema.Int});
const Msg = Schema.Struct({type: Schema.Literal("inc")});
const program = {
	name: "counter",
	machine: Machine.make({
		model: Model,
		msg: Msg,
		cmds: [],
		init: (saved) => [saved ?? {count: 0}, []],
		update: {inc: (s) => [{count: s.count + 1}, []]},
	}),
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (s: typeof Model.Type) => s},
	refuse: () => null,
	inputs: {inc: {_tag: "write", schema: Msg, description: "Increment", personOnly: false}},
	outputs: {},
	writes: {},
	wake: () => null,
} as const;

describe("P12 saved mail recovery", () => {
	for (const point of ["admit", "step"] as const) {
		it(`a temporary ${point} RPC failure preserves the cursor and retries saved mail`, async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({min: 1, max: 8}), fc.string(), (total, letter) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const db = new DatabaseSync(":memory:");
							try {
								const sql = nodeSql(db),
									pure = yield* Effect.fromResult(stepper(program));
								let down = false;
								const execution = workerExecution({
									init: async (saved) => pure.init(saved),
									admit: async () => {
										if (down && point === "admit")
											return Promise.reject(new Error("temporary RPC loss"));
										return true;
									},
									step: async (model, msg) => {
										if (down && point === "step")
											return Promise.reject(new Error("temporary RPC loss"));
										return pure.step(model, msg);
									},
									fold: async (model, msg) => pure.fold(model, msg),
									upgrade: async (saved) => ({saved, ran: []}),
									reply: async () => null,
								});
								const base = Layer.mergeAll(
									Ledger.sql(sql, {reader: PID}).pipe(
										Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
									),
									RecordManager.memory(1_000_000_000),
									Archive.memory,
									SpanSink.layer(sql, {object: PID}),
								);
								const dependencies = Layer.mergeAll(
									Mailbox.layer,
									ProcessStore.layer(sql, {process: PID}),
									Layer.succeed(ProgramLoader, {
										load: () =>
											Effect.succeed({
												stepper: pure,
												execution,
												declaration: {
													name: "counter",
													v: 1,
													inputs: {inc: {write: true, personOnly: false}},
													writes: {},
													cmds: [],
												},
												handler: () => Option.none(),
											}),
									}),
									Layer.succeed(Alarm, {set: () => Effect.void}),
									Layer.succeed(WatcherManager, {publish: () => Effect.void}),
									Layer.succeed(Recording, {flush: Effect.void}),
									Layer.succeed(CheckedWriter, {
										sign: () => Effect.die("no write declared"),
										append: () => Effect.die("no fresh input"),
										commit: () => Effect.die("no write declared"),
										own: () => Effect.die("no write declared"),
									}),
								).pipe(Layer.provideMerge(base));
								const layer = ProgramRunner.layer({
									id: PID,
									name: "counter:1",
									program: "counter",
									build: "test",
									owner: Writer.cases.person.make({key: "SHA256:fixture", for: "person-test"}),
								}).pipe(Layer.provideMerge(dependencies));
								yield* Effect.gen(function* () {
									const runner = yield* ProgramRunner,
										mailbox = yield* Mailbox,
										store = yield* ProcessStore;
									expect(yield* runner.open("before")).toMatchObject({rev: 0, view: {count: 0}});
									for (let n = 0; n < total; n++)
										yield* mailbox.send(
											"counter:1",
											`${letter}-${n}`,
											{type: "inc"},
											{
												by: "SHA256:fixture",
												for: "person-test",
												sentAt: "2026-11-08T00:00:00Z",
												seen: 0,
												parent: null,
												traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
												build: "test",
											},
										);
									down = true;
									const failed = yield* Effect.exit(runner.open("during-loss"));
									expect.soft(Exit.isFailure(failed), "RPC loss must fail this attempt").toBe(true);
									expect.soft((yield* store.load)?.saved.after).toBe(0);
									down = false;
									expect(yield* runner.open("recovered")).toMatchObject({
										rev: total,
										view: {count: total},
									});
									expect((yield* store.load)?.saved.after).toBe(total);
									expect(yield* runner.open("again")).toMatchObject({
										rev: total,
										view: {count: total},
									});
								}).pipe(Effect.provide(layer));
							} finally {
								db.close();
							}
						}),
					),
				),
				{seed: 119120, numRuns: 25, examples: [[1, "saved-letter"]]},
			);
		});
	}
});
