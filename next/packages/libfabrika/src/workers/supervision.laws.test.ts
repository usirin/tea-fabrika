// P12, next/. Real box methods, execution adapters, runner, manager, receipts and SQLite.
import {Machine} from "@demlik/tea/effect";
import {Cause, Effect, Exit, Layer, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {expect, it, vi} from "vitest";
import {
	Alarm,
	CheckedWriter,
	Incoming,
	ProgramLoader,
	Recording,
	WatcherManager,
} from "../app/entry.ts";
import {workerExecution} from "../app/execution.ts";
import {ProgramRunner} from "../app/runner.ts";
import {Mailbox, ProcessStore, Writer} from "../coordination/index.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {
	A,
	B,
	brain,
	data,
	first,
	from,
	ids,
	PIDS,
	read,
	storage,
} from "../coordination/process.test-support.ts";
import {RecoveryStore} from "../coordination/recovery-store.ts";
import {InputId} from "../data/log.ts";
import {programBox} from "./box.ts";

// Only Cloudflare's base class is supplied. No execution or supervision method is replaced.
vi.mock("cloudflare:workers", () => ({WorkerEntrypoint: class {}}));
const NAME = "counter:1";
const BUILD = "build-a";
const owner = Writer.cases.person.make({key: "SHA256:fixture", for: from().for});
const Model = Schema.Struct({count: Schema.Int});
const Msg = Schema.Struct({type: Schema.Literal("add"), n: Schema.Int});
type Move = "rpc" | "decode" | "throw";

const thrown = fc.oneof(
	fc
		.tuple(
			fc.constantFrom("Error", "TypeError", "RangeError", "SyntaxError", "custom"),
			fc.string(),
		)
		.map(([kind, message]) => {
			class ProgramError extends Error {}
			return kind === "TypeError"
				? new TypeError(message)
				: kind === "RangeError"
					? new RangeError(message)
					: kind === "SyntaxError"
						? new SyntaxError(message)
						: kind === "custom"
							? new ProgramError(message)
							: new Error(message);
		}),
	fc.jsonValue(),
	fc.constant(undefined),
	fc.bigInt(),
	fc.constant(Symbol("made-up-throw")),
	fc.func(fc.jsonValue()),
);

const failureClass = (value: unknown) =>
	value instanceof Error ? value.constructor.name : value === null ? "null" : typeof value;

const world = (adapter: "node" | "worker", limit: number, failure: unknown) => {
	const ledger = storage(),
		state = storage();
	const next = ids(...PIDS);
	let move: Move | "ok" = "ok",
		calls = 0,
		alarm: number | null = null;
	const program = {
		name: "counter",
		maxDeliveries: limit,
		machine: Machine.make({
			model: Model,
			msg: Msg,
			cmds: [],
			init: (saved) => [saved ?? {count: 0}, []],
			update: {
				add: (s, m) => {
					calls++;
					if (move === "throw") throw failure;
					return [{count: s.count + m.n}, []];
				},
			},
		}),
		state: {v: 1, schema: Model, upgrades: []},
		msg: Msg,
		view: {data: Model, select: (s: typeof Model.Type) => s},
		refuse: () => null,
		inputs: {add: {_tag: "write", schema: Msg, description: "Add", personOnly: false}},
		outputs: {},
		writes: {},
		wake: () => null,
	} as const;
	const manager = ProcessManager.layer(brain(), next.next).pipe(
		Layer.provideMerge(data(ledger.sql)),
	);
	const recovery = RecoveryStore.layer(state.sql, {name: NAME, capacity: 1024 ** 3});
	const layer = () => {
		const loader = Layer.effect(
			ProgramLoader,
			Effect.gen(function* () {
				const real = yield* ProgramLoader;
				const loaded = yield* real.load("counter", BUILD);
				const Box = programBox(program, BUILD);
				const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
				const execution =
					adapter === "node"
						? loaded.execution
						: workerExecution({
								init: (s) => box.init(s),
								step: async (s, m) => {
									if (move === "rpc")
										return Effect.runPromise(
											Effect.fail(new Error("transport failed before the program")),
										);
									if (move === "decode") return {unrecognized: true};
									return box.step(s, m);
								},
								fold: (s, m) => box.fold(s, m),
								upgrade: (s) => box.upgrade(s),
								reply: (c, o) => box.reply(c, o),
								check: (k, f) => box.check(k, f),
								admit: (m) => box.admit(m),
							});
				return {load: () => Effect.succeed({...loaded, execution})};
			}),
		).pipe(Layer.provide(ProgramLoader.layer({counter: program}, {})));
		const checked = Layer.effect(
			CheckedWriter,
			Effect.map(Mailbox, (mailbox) => ({
				append: (i: Incoming) =>
					mailbox.send(
						NAME,
						i.id,
						i.envelope.input,
						from({by: i.envelope.by.key, parent: i.envelope.id, sentAt: i.sentAt}),
					),
				commit: () => Effect.die("no write declared"),
				own: () => Effect.die("no write declared"),
			})),
		).pipe(Layer.provide(Mailbox.layer));
		return ProgramRunner.layer(
			{id: A, name: NAME, program: "counter", build: BUILD, owner},
			{
				policy: {
					maxDeliveries: limit,
					intensity: 32,
					periodMs: 100000,
					backoff: {minMs: 1, maxMs: 1, resetAfterMs: 100000},
				},
				recovery: {sql: state.sql, name: NAME, capacity: 1024 ** 3},
			},
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					loader,
					checked,
					ProcessStore.layer(state.sql, {process: A}),
					Layer.succeed(Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarm = at;
							}),
					}),
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Recording, {flush: Effect.void}),
					Mailbox.layer,
				).pipe(Layer.provideMerge(manager)),
			),
		);
	};
	return {
		ledger,
		state,
		layer,
		move: (value: Move | "ok") => {
			move = value;
		},
		calls: () => calls,
		boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager)),
		receipt: (letter: string) =>
			RecoveryStore.use((s) => s.receipt(letter)).pipe(Effect.provide(recovery)),
		snapshot: RecoveryStore.use((s) => s.load).pipe(Effect.provide(recovery)),
		recover: Effect.gen(function* () {
			const saved = yield* RecoveryStore.use((s) => s.load).pipe(Effect.provide(recovery));
			expect(saved).not.toBeNull();
			// P34 keeps the restart wait in starting until the restart brake trips.
			const until =
				saved?.recovery._tag === "down"
					? saved.recovery.until
					: saved?.recovery._tag === "starting" && saved.pending?.type === "start"
						? saved.pending.until
						: undefined;
			if (until !== undefined) {
				expect(alarm).toBe(until);
				yield* TestClock.setTime(until);
				yield* ProgramRunner.use((r) => r.due(until)).pipe(Effect.provide(layer()));
			}
		}),
		read: (stream: string) => read(stream).pipe(Effect.provide(data(ledger.sql))),
	};
};

const incoming = (letter: string, n: number): Incoming =>
	Incoming.make({
		id: letter,
		envelope: {
			id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
			by: owner,
			arrivedAt: 0,
			input: {type: "add", n},
		},
		sentAt: from().sentAt,
		seen: 0,
		span: {traceId: from().traceId, spanId: "00f067aa0ba902b7"},
	});

const sequence = fc.record({
	limit: fc.integer({min: 1, max: 4}),
	moves: fc.array(fc.constantFrom<Move>("rpc", "decode", "throw"), {minLength: 1, maxLength: 8}),
	n: fc.integer({min: -1000, max: 1000}),
	letter: fc.uuid(),
});

for (const source of ["rpc", "decode"] as const)
	it(`supervised ${source} failures never change deliveries, receipt failures or dead events`, async () => {
		await fc.assert(
			fc.asyncProperty(sequence, (sample) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world("worker", sample.limit, new TypeError("program failed"));
						yield* w.boot;
						const input = incoming(sample.letter, sample.n);
						let crashes = 0;
						for (const move of [source, ...sample.moves]) {
							if (crashes === sample.limit) break;
							w.move(move);
							const beforeCalls = w.calls();
							const exit = yield* ProgramRunner.use((r) => r.msg(input)).pipe(
								Effect.provide(w.layer()),
								Effect.exit,
							);
							if (move === "throw") crashes++;
							const receipt = yield* w.receipt(input.id);
							// First assert the durable record, even when the caller was also given a false dead answer.
							expect(receipt).toMatchObject({
								tries: crashes,
								errors: Array.from({length: crashes}, () => "TypeError"),
								result: crashes === sample.limit ? {_tag: "refused", why: "dead"} : null,
							});
							if (move !== "throw") {
								expect(w.calls()).toBe(beforeCalls);
								expect(Exit.isFailure(exit)).toBe(true);
								const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
								expect(Cause.hasDies(cause)).toBe(false);
								expect(Cause.findErrorOption(cause)).toMatchObject({
									_tag: "Some",
									value: {_tag: "ProgramDown", source: move},
								});
								const saved = yield* w.snapshot;
								expect(saved?.attempt).toBeNull();
								expect(saved?.observations).toHaveLength(crashes);
							}
							const dead = (yield* Effect.forEach(PIDS, (p) => w.read(`${p}/dead`), {
								concurrency: 1,
							})).flat();
							expect(dead).toHaveLength(crashes === sample.limit ? 1 : 0);
							expect(yield* w.read(`${NAME}/inbox`)).toEqual([]);
							if (crashes < sample.limit) {
								w.move("ok");
								yield* w.recover;
							}
						}
						if (crashes < sample.limit) {
							w.move("ok");
							expect(
								yield* ProgramRunner.use((r) => r.msg(input)).pipe(Effect.provide(w.layer())),
							).toMatchObject({_tag: "accepted", pos: 1});
							expect(yield* w.read(`${NAME}/inbox`)).toHaveLength(1);
						}
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 25,
				// Review 6: one rejected or malformed RPC must not exhaust the allowed limit of one.
				examples: [
					[{limit: 1, moves: ["rpc"], n: 1, letter: "rpc-limit-one"}],
					[{limit: 1, moves: ["decode"], n: 1, letter: "decode-limit-one"}],
					[{limit: 3, moves: ["rpc", "decode", "throw", "rpc", "throw"], n: 1, letter: "mixed"}],
				],
			},
		);
	});

it("Node records the actual class for generated Error and non-Error throws", async () => {
	await fc.assert(
		fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const w = world("node", 1, failure);
					yield* w.boot;
					w.move("throw");
					expect(
						yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(
							Effect.provide(w.layer()),
						),
					).toMatchObject({_tag: "refused", why: "dead"});
					expect(yield* w.receipt(letter)).toMatchObject({
						tries: 1,
						errors: [failureClass(failure)],
					});
				}).pipe(Effect.provide(TestClock.layer())),
			),
		),
		{
			seed: 119120,
			numRuns: 25,
			examples: [
				[undefined, "undefined-throw"],
				[null, "null-throw"],
				[Symbol("made-up"), "symbol-throw"],
			],
		},
	);
});

it("the real Worker box records the same thrown class as Node under supervision", async () => {
	await fc.assert(
		fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const receipts = [],
						dead = [];
					for (const adapter of ["node", "worker"] as const) {
						const w = world(adapter, 1, failure);
						yield* w.boot;
						w.move("throw");
						const exit = yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(
							Effect.provide(w.layer()),
							Effect.exit,
						);
						expect(exit).toMatchObject({_tag: "Success", value: {_tag: "refused", why: "dead"}});
						receipts.push(yield* w.receipt(letter));
						dead.push(
							(yield* Effect.forEach([A, B], (p) => w.read(`${p}/dead`), {concurrency: 1}))
								.flat()
								.map((r) => r.body),
						);
					}
					const expected = failureClass(failure);
					expect(receipts[0]).toMatchObject({errors: [expected], tries: 1});
					expect(dead[0]).toMatchObject([{errors: [expected], tries: 1}]);
					expect(receipts[1]).toMatchObject({errors: [expected], tries: 1});
					expect(dead[1]).toMatchObject([{errors: [expected], tries: 1}]);
				}).pipe(Effect.provide(TestClock.layer())),
			),
		),
		{
			seed: 119120,
			numRuns: 25,
			// Review 6: the box used to record ProgramDown in place of this TypeError.
			examples: [[new TypeError("private program text"), "worker-class"]],
		},
	);
});
