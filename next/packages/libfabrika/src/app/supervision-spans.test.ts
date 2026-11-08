// P34, next/. These are runner calls through P37's actual sink and JobRecords, not a span mock.
// Only this file owns content deletion and trace attribution; other laws inspect lifecycle facts.
import {Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Option, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import {
	Archive,
	Mailbox,
	ProcessManager,
	ProcessStore,
	RecordManager,
	Writer,
} from "../coordination/index.ts";
import {
	A,
	B,
	W,
	X,
	brain,
	data,
	first,
	from,
	ids,
	read,
	storage,
} from "../coordination/process.test-support.ts";
import {type Sql} from "../data/referee.ts";
import {SpanSink} from "../data/sink.ts";
import {
	Alarm,
	CheckedWriter,
	type Incoming,
	ProgramLoader,
	Recording,
	WatcherManager,
} from "./entry.ts";
import {type Descriptor, ProgramRunner} from "./runner.ts";

const policy = {
	maxDeliveries: 3,
	intensity: 5,
	periodMs: 5000,
	backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
};
const NAME = "counter:1";
const PRIVATE = "private failure text P34";
const owner = Writer.cases.person.make({key: "SHA256:caller", for: from().for});
const Model = Schema.Struct({count: Schema.Int});
type Model = typeof Model.Type;
const Msg = Schema.Struct({type: Schema.Literal("poison")});
const runnerLayer: (
	p: Descriptor,
	options: {policy: typeof policy; recovery: {sql: Sql; name: string; capacity: number}},
) => ReturnType<typeof ProgramRunner.layer> = ProgramRunner.layer;
const world = (thrown: unknown = new TypeError(PRIVATE)) => {
	const ledger = storage(),
		state = storage(),
		sink = storage();
	const next = ids(A, B, W, X);
	const parts = new Map<string, ReturnType<typeof storage>>();
	const records = RecordManager.sql((name) => {
		let part = parts.get(name);
		if (part === undefined) {
			part = storage();
			parts.set(name, part);
		}
		return part.sql;
	}, 1024 ** 3);
	const machine = Machine.make({
		model: Model,
		msg: Msg,
		cmds: [],
		init: (s) => [s ?? {count: 0}, []],
		update: {
			poison: () => {
				throw thrown;
			},
		},
	});
	const p = {
		name: "counter",
		machine,
		state: {v: 1, schema: Model, upgrades: []},
		msg: Msg,
		view: {data: Model, select: (s: Model) => s},
		refuse: () => null,
		inputs: {poison: {_tag: "write", schema: Msg, description: "Poison", personOnly: false}},
		outputs: {},
		writes: {},
		wake: () => null,
	};
	const alarms: Array<number | null> = [];
	const base = () =>
		Layer.mergeAll(
			data(ledger.sql),
			SpanSink.layer(sink.sql, {object: A}),
			records,
			Archive.memory,
		);
	const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
	const layer = () =>
		runnerLayer(
			{id: A, name: NAME, program: "counter", build: "build-a", owner},
			{policy, recovery: {sql: state.sql, name: NAME, capacity: 1024 ** 3}},
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					ProgramLoader.layer({counter: p}, {}),
					ProcessStore.layer(state.sql, {process: A}),
					ProcessManager.layer(brain(), next.next),
					Mailbox.layer,
					Layer.effect(
						CheckedWriter,
						Effect.gen(function* () {
							const m = yield* Mailbox;
							return {
								append: (i: Incoming) => m.send(NAME, i.id, i.envelope.input, from()),
								commit: () => Effect.die("no writes"),
								own: () => Effect.die("no writes"),
							};
						}),
					).pipe(Layer.provide(Mailbox.layer)),
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarms.push(at);
							}),
					}),
					Recording.layer,
				).pipe(Layer.provideMerge(base())),
			),
		);
	const input = {
		id: "poison",
		envelope: {id: `in-${X}-1`, by: owner, arrivedAt: 0, input: {type: "poison"}},
		sentAt: from().sentAt,
		seen: 0,
		span: {traceId: from().traceId, spanId: "00f067aa0ba902b7"},
	};
	return {
		ledger,
		sink,
		state,
		alarms,
		layer,
		manager,
		input,
		boot: ProcessManager.use((m) => m.start(first(), from())).pipe(Effect.provide(manager())),
		reopen: () => {
			ledger.reopen();
			state.reopen();
			sink.reopen();
			for (const p of parts.values()) p.reopen();
		},
	};
};
const recorded = (process: string) =>
	RecordManager.use((r) => Stream.runCollect(r.read({_tag: "job", process})));
const recoverySpans = (w: ReturnType<typeof world>, process: string) =>
	Effect.gen(function* () {
		const until = w.alarms.at(-1);
		expect(until).toBeTypeOf("number");
		w.reopen();
		yield* TestClock.setTime(until!);
		yield* Effect.gen(function* () {
			yield* ProgramRunner.use((r) => r.due(until!));
			const rows = yield* recorded(process);
			for (const name of ["runner.recover", "runner.restart"]) {
				const row = rows.find((r) => r.name === name);
				expect(row, name).toBeDefined();
				expect(row!.attributes).toMatchObject({
					"fab.process": process,
					"fab.runner.until": until,
					"fab.runner.lag": 0,
				});
			}
		}).pipe(Effect.provide(w.layer()));
	});

describe("P34 supervision recording", () => {
	for (const [value, name] of [
		[new TypeError(PRIVATE), "TypeError"],
		[new RangeError(PRIVATE), "RangeError"],
		[PRIVATE, "string"],
		[17, "number"],
		[null, "null"],
	] as const)
		it.effect(
			`recording plant, wrapper-only class: observed ${name} reaches its process JobRecord before failure returns`,
			() =>
				Effect.gen(function* () {
					const w = world(value);
					yield* w.boot;
					yield* Effect.gen(function* () {
						yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
						const throws = (yield* recorded(A)).filter((row) => row.name === "runner.throw");
						expect(throws).toHaveLength(1);
						expect(throws[0]!.attributes).toMatchObject({
							"fab.process": A,
							"error.type": name,
							"fab.runner.letter": "poison",
							"fab.runner.build": "build-a",
							"fab.runner.phase": "fresh",
							"fab.runner.attempt": 1,
						});
						expect(BigInt(throws[0]!.endTimeUnixNano)).toBeGreaterThanOrEqual(
							BigInt(throws[0]!.startTimeUnixNano),
						);
						expect(w.sink.sql.exec("SELECT count(*) n FROM unsent")[0]?.n).toBe(0);
					}).pipe(Effect.provide(w.layer()));
				}),
		);

	it.effect(
		"content plant, message in errors/why/health: only deletable content holds failure text and stack",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
					const rows = yield* recorded(A);
					const r = yield* RecordManager;
					const contents = yield* Effect.forEach(
						rows,
						(row) => r.content({_tag: "job", process: A}, row.spanId),
						{concurrency: 1},
					);
					const at = contents.findIndex((content) => JSON.stringify(content).includes(PRIVATE));
					expect(
						at,
						"the original throw must reach deletable content before guards erase it",
					).toBeGreaterThanOrEqual(0);
					expect(JSON.stringify(rows)).not.toContain(PRIVATE);
					expect(JSON.stringify(w.sink.sql.exec("SELECT * FROM health"))).not.toContain(PRIVATE);
					expect(JSON.stringify(yield* read(`processes/${NAME}`))).not.toContain(PRIVATE);
					expect(JSON.stringify(yield* read(`${A}/dead`))).not.toContain(PRIVATE);
					const span = rows[at]!;
					yield* r.deleteContent({_tag: "job", process: A}, span.spanId, {
						by: owner.key,
						why: "test deletion",
					});
					expect(
						Option.getOrNull(yield* r.content({_tag: "job", process: A}, span.spanId)),
					).toMatchObject({_tag: "deleted"});
					expect((yield* recorded(A)).find((row) => row.spanId === span.spanId)).toEqual(span);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"recording plant, successor spans in predecessor record or flush before span end: every recovery is attributed",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (const [n, process] of [A, B, W].entries()) {
					yield* Effect.gen(function* () {
						yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
						const rows = yield* recorded(process);
						expect(rows.filter((row) => row.name === "runner.throw")).toHaveLength(1);
						if (n === 2) expect(rows.some((row) => row.name === "runner.dead")).toBe(true);
					}).pipe(Effect.provide(w.layer()));
					if (n < 2) yield* recoverySpans(w, process);
				}
			}),
	);
});
