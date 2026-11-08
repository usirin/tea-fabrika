// P12, next/. Catch-up retries valid saved mail after an actual execution RPC rejects.
import {DatabaseSync} from "node:sqlite";
import {Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Option, Schema} from "effect";
import {Mailbox, ProcessStore, Writer} from "../coordination/index.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {lineFor} from "../data/log.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {nodeExecution, workerExecution} from "./execution.ts";
import {stepper} from "./program.ts";
import {ProgramRunner} from "./runner.ts";
import {Saved} from "./state.ts";

const PID = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const model = Schema.Struct({count: Schema.Int});
const msg = Schema.Struct({type: Schema.Literal("inc")});
const program = {
	name: "counter",
	machine: Machine.make({
		model,
		msg,
		cmds: [],
		init: (saved) => [saved ?? {count: 0}, []],
		update: {inc: (s) => [{count: s.count + 1}, []]},
	}),
	state: {v: 1, schema: model, upgrades: []},
	msg,
	view: {data: model, select: (s: typeof model.Type) => s},
	refuse: () => null,
	inputs: {inc: {_tag: "write", schema: msg, description: "Increment", personOnly: false}},
	outputs: {},
	writes: {},
	wake: () => null,
};

describe("P12 saved mail retry contracts", () => {
	for (const failed of ["admit", "step"] as const)
		it.effect(`catch-up preserves its cursor until a valid letter's ${failed} RPC succeeds`, () =>
			Effect.gen(function* () {
				const db = new DatabaseSync(":memory:"),
					processDb = new DatabaseSync(":memory:");
				try {
					const sql = nodeSql(db),
						processSql = nodeSql(processDb);
					const pure = stepper(program),
						node = nodeExecution(program);
					let down = true,
						attempts = 0;
					const execution = workerExecution({
						init: async (saved) => pure.init(saved),
						admit: async (m) => {
							if (failed === "admit") {
								attempts++;
								if (down) return Promise.reject(new Error("temporary RPC failure"));
							}
							return Effect.runPromise(node.admit(m));
						},
						step: async (state, input) => {
							if (failed === "step") {
								attempts++;
								if (down) return Promise.reject(new Error("temporary RPC failure"));
							}
							return pure.step(state, input);
						},
						fold: async (state, input) => pure.fold(state, input),
						upgrade: async (saved) => Saved.upgrade(saved, program.state, "build-a"),
						reply: async () => null,
					});
					const ledger = Ledger.sql(sql, {reader: PID}).pipe(
						Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
					);
					const base = Layer.mergeAll(
						ledger,
						ProcessStore.layer(processSql, {process: PID}).pipe(Layer.provide(ledger)),
						Mailbox.layer.pipe(Layer.provide(ledger)),
					);
					const deps = Layer.mergeAll(
						base,
						Layer.succeed(ProgramLoader, {
							load: () =>
								Effect.succeed({
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
						Layer.succeed(CheckedWriter, {
							append: () => Effect.die("catch-up does not append new input"),
							commit: () => Effect.die("no writes"),
							own: () => Effect.die("no own writes"),
						}),
						Layer.succeed(WatcherManager, {publish: () => Effect.void}),
						Layer.succeed(Alarm, {set: () => Effect.void}),
						Layer.succeed(Recording, {flush: Effect.void}),
					);
					const runner = ProgramRunner.layer({
						id: PID,
						name: "counter:1",
						program: "counter",
						build: "build-a",
						owner: Writer.cases.person.make({key: "SHA256:owner", for: "person"}),
					}).pipe(Layer.provideMerge(deps));
					yield* Effect.gen(function* () {
						const ledger = yield* Ledger,
							store = yield* ProcessStore,
							r = yield* ProgramRunner;
						const placed = yield* ledger.append(
							"counter:1/inbox",
							"saved-letter",
							lineFor(
								{
									by: "SHA256:sender",
									for: "person",
									sentAt: "2026-11-08T00:00:00Z",
									seen: 0,
									parent: null,
									traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
									build: "build-a",
								},
								Schema.TaggedStruct("send", {m: Schema.Json}).make({m: {type: "inc"}}),
							),
						);
						expect(placed._tag).toBe("placed");
						const interrupted = yield* Effect.exit(r.open("reader"));
						expect
							.soft(Exit.isFailure(interrupted), "RPC failure is not a program refusal")
							.toBe(true);
						const checkpoint = yield* store.load;
						expect
							.soft(checkpoint?.saved.after ?? 0, "cursor must remain before the valid letter")
							.toBe(0);
						down = false;
						expect(yield* r.open("reader")).toMatchObject({rev: 1, view: {count: 1}});
						expect(attempts).toBe(2);
					}).pipe(Effect.provide(runner));
				} finally {
					db.close();
					processDb.close();
				}
			}),
		);
});
