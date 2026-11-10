import {Outcome} from "@demlik/tea";
// P34, next/. Real P11 runner, P33 manager and ledger with SQLite-backed state.
// Test wiring contract: layer(descriptor, {policy, recovery:{sql,name,capacity}}).
// restart({id, build}) is the trusted H3 operation. These are implementation choices the plan
// left unnamed, not a second runner. All stepping, counts and replacement are product code.
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Cause, type Context, Effect, Exit, type Layer as LayerType, Layer, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {
	Archive,
	Mailbox,
	ProcessStore,
	RecordManager,
	SessionManager,
	Writer,
} from "../coordination/index.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {
	A,
	B,
	W,
	again,
	brain,
	data,
	first,
	from,
	ids,
	PIDS,
	read,
	storage,
	watcher,
} from "../coordination/process.test-support.ts";
import {Activity, Down, ProcessFact, Recipient} from "../coordination/process.ts";
import {RecoveryStore} from "../coordination/recovery-store.ts";
import {Ledger, LedgerError} from "../data/ledger.ts";
import {InputId, lineFor, valueFor} from "../data/log.ts";
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

const NAME = "counter:1";
const BUILD = "build-a";

const policy = {
	maxDeliveries: 3,
	intensity: 5,
	periodMs: 5000,
	backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
};

const person = Writer.cases.person.make({key: "SHA256:person", for: from().for});
const Model = Schema.Struct({count: Schema.Int, replies: Schema.Int});
type Model = typeof Model.Type;

const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("save"), token: Schema.String}),
	Schema.Struct({type: Schema.Literal("poison"), key: Schema.String}),
	Schema.Struct({type: Schema.Literal("work")}),
	Schema.Struct({type: Schema.Literal("refuse")}),
	Schema.Struct({type: Schema.Literal("timer"), at: Schema.Int}),
	Schema.Struct({
		type: Schema.Literal("DOWN"),
		ref: Schema.String,
		process: Schema.String,
		why: Schema.String,
		to: Recipient,
	}),
]);

const work = Cmd.make("work", {input: Schema.Struct({}), ok: Schema.Null, err: ["failed"]});

const write = Cmd.make("write", {
	input: Schema.Struct({stream: Schema.String, write: Schema.Json}),
	ok: Schema.Json,
	err: ["failed"],
});

const Saved = Schema.TaggedStruct("saved", {token: Schema.String});
/** The wiring's policy. P34 amendment: its `maxDeliveries` may be absent (then 3). */
type WiringPolicy = Omit<typeof policy, "maxDeliveries"> & {readonly maxDeliveries?: number};
/** Limits a law sets: the program's own `maxDeliveries`, and the wiring's policy. */
type Limits = {readonly program?: number | undefined; readonly policy?: WiringPolicy};

type Wiring = {
	policy: WiringPolicy;
	recovery: {sql: Sql; name: string; capacity: number};
	fault: (cut: string) => Effect.Effect<void, LedgerError>;
};

const runnerLayer: (p: Descriptor, wiring: Wiring) => ReturnType<typeof ProgramRunner.layer> =
	ProgramRunner.layer;

const world = (
	personOnly = false,
	platformActivity = false,
	wakeAt: number | null = null,
	limits: Limits = {},
) => {
	const ledger = storage(),
		state = storage(),
		authority = storage();
	const next = ids(...PIDS);
	const controls = {
		throws: true,
		savedThrows: false,
		invalid: false,
		build: BUILD,
		loads: 0,
		init: [] as Array<{build: string; loaded: unknown}>,
		steps: [] as string[],
		cmds: 0,
		writes: [] as string[],
		loseWriteReply: false,
		flushOnce: false,
		flushFailures: 0,
		flushes: [] as string[][],
		adds: 0,
		crashAdd: 0,
		cut: "",
		wakeAt,
		hits: [] as string[],
		downs: [] as Array<typeof Down.Type>,
		timers: [] as number[],
	};

	// The platform has one activity key per object, shared by every selected process.
	// Back it with a SQLite file so reopening drops all runner memory but keeps the key.
	if (platformActivity) {
		state.sql.exec("CREATE TABLE p34_activity (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
	}

	const activityStorage = platformActivity
		? {
				put: (key: string, value: unknown) =>
					Effect.sync(() => {
						state.sql.exec(
							"INSERT INTO p34_activity (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
							key,
							JSON.stringify(value),
						);
					}),
				get: (key: string) =>
					Effect.sync(() => {
						const [row] = state.sql.exec("SELECT value FROM p34_activity WHERE key=?", key);
						return row === undefined ? undefined : JSON.parse(String(row.value));
					}),
				// SQLite has already committed each put when it returns.
				sync: () => Effect.void,
			}
		: undefined;
	const alarms: Array<number | null> = [];
	let alarm: number | null = null;
	const input = (id = "poison", m: unknown = {type: "poison", key: id}): Incoming => ({
		id,
		envelope: {
			id: Schema.decodeUnknownSync(InputId)(
				`input_0000000000e008${(controls.steps.length + 1).toString(16).padStart(12, "0")}`,
			),
			by: person,
			arrivedAt: 0,
			input: m,
		},
		sentAt: "2099-01-01T00:00:00Z",
		seen: 0,
		span: {traceId: from().traceId, spanId: "00f067aa0ba902b7"},
	});
	const makeProgram = () => {
		const machine = Machine.make({
			model: Model,
			msg: Msg,
			cmds: [work, write],
			init: (loaded) => {
				controls.init.push({build: controls.build, loaded});
				return [loaded ?? {count: 0, replies: 0}, []];
			},
			update: {
				add: (s, m) => {
					controls.adds++;

					if (controls.adds === controls.crashAdd) {
						throw new RangeError("private fold failure");
					}

					if (controls.savedThrows) {
						throw new RangeError("private saved failure");
					}

					return [{...s, count: s.count + m.n}, []];
				},
				poison: (s, m) => {
					controls.steps.push(m.key);

					if (controls.invalid) {
						return [{count: Number.NaN, replies: 0}, []];
					}

					if (controls.throws) {
						const n = controls.steps.filter((key) => key === m.key).length;

						if (n === 2) {
							throw new RangeError("private second failure");
						}

						throw new TypeError("private fresh failure");
					}

					return [{...s, count: s.count + 1}, []];
				},
				work: (s) => [s, [work({})]],
				save: (s, m) => [
					s,
					[write({stream: "facts", write: {_tag: "own", fact: Saved.make({token: m.token})}})],
				],
				refuse: (s) => [s, []],
				timer: (s, m) => {
					controls.timers.push(m.at);
					return [{...s, replies: s.replies + 1}, []];
				},
				DOWN: (s, m) => {
					controls.downs.push(Down.make({ref: m.ref, process: m.process, why: m.why, to: m.to}));
					return [{...s, replies: s.replies + 1}, []];
				},
				work_ok: (s) => [{...s, replies: s.replies + 1}, []],
				work_err: (s) => [{...s, replies: s.replies + 1}, []],
				write_ok: (s) => [{...s, replies: s.replies + 1}, []],
				write_err: (s) => [{...s, replies: s.replies + 1}, []],
			},
		});
		return {
			name: "counter",
			...(limits.program === undefined ? {} : {maxDeliveries: limits.program}),
			machine,
			state: {v: 1, schema: Model, upgrades: []},
			msg: Msg,
			view: {data: Model, select: (s: Model) => s},
			refuse: (_s: Model, m: typeof Msg.Type) => (m.type === "refuse" ? {why: "bad_msg"} : null),
			inputs: {
				add: {_tag: "write", schema: Msg, description: "Add", personOnly},
				poison: {_tag: "write", schema: Msg, description: "Poison", personOnly: false},
				work: {_tag: "write", schema: Msg, description: "Work", personOnly: false},
				save: {_tag: "write", schema: Msg, description: "Save", personOnly: false},
				refuse: {_tag: "write", schema: Msg, description: "Refuse", personOnly: false},
			},
			outputs: {},
			writes: {saved: {schema: Saved, personOnly: false}},
			wake: (s: Model) => (s.replies === 0 ? controls.wakeAt : null),
		};
	};
	const base = () =>
		Layer.mergeAll(
			data(ledger.sql),
			SessionManager.layer(authority.sql, () => Effect.succeed(person), {
				input: () => false,
				fact: () => false,
			}),
		);
	const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
	const layer = (
		recording: LayerType.Layer<Recording> = Layer.succeed(Recording, {flush: Effect.void}),
	) => {
		const loader = Layer.effect(
			ProgramLoader,
			Effect.gen(function* () {
				const real = yield* ProgramLoader;
				return {
					load: (name: string) =>
						Effect.sync(() => {
							controls.loads++;
						}).pipe(Effect.andThen(real.load(name))),
				};
			}),
		).pipe(
			Layer.provide(
				ProgramLoader.layer(
					{counter: makeProgram()},
					{
						work: () =>
							Effect.sync(() => {
								controls.cmds++;
								return Outcome.ok(null);
							}),
					},
				),
			),
		);
		const checked = Layer.effect(
			CheckedWriter,
			Effect.gen(function* () {
				const mailbox = yield* Mailbox;
				const ledger = yield* Ledger;
				return {
					append: (i: Incoming) =>
						mailbox.send(
							NAME,
							i.id,
							i.envelope.input,
							from({by: i.envelope.by.key, parent: i.envelope.id, sentAt: i.sentAt}),
						),
					commit: () => Effect.die("this program has no write Cmd"),
					own: (id, stream, fact) =>
						Effect.gen(function* () {
							controls.writes.push(id);
							const answer = yield* ledger.append(
								stream,
								id,
								lineFor(from({by: person.key, parent: null}), fact),
							);

							// Commit the real fact, then lose only its reply.
							if (controls.loseWriteReply) {
								controls.loseWriteReply = false;
								return yield* new LedgerError({why: "unreachable"});
							}

							return answer;
						}),
				};
			}),
		).pipe(Layer.provide(Mailbox.layer));
		return runnerLayer(
			{id: A, name: NAME, program: "counter", build: controls.build, owner: person},
			{
				policy: limits.policy ?? policy,
				recovery: {sql: state.sql, name: NAME, capacity: 1024 ** 3},
				fault: (cut) =>
					Effect.suspend(() => {
						if (controls.cut !== cut) {
							return Effect.void;
						}

						controls.cut = "";
						controls.hits.push(cut);
						return Effect.fail(new LedgerError({why: "unreachable"}));
					}),
			},
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					loader,
					ProcessStore.layer(state.sql, {process: A, storage: activityStorage}),
					checked,
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarm = at;
								alarms.push(at);
							}),
					}),
					Layer.effect(
						Recording,
						Effect.gen(function* () {
							const real = yield* Recording;
							return {
								flush: Effect.suspend(() => {
									controls.flushes.push([...controls.writes]);

									if (!controls.flushOnce) {
										return real.flush;
									}

									controls.flushOnce = false;
									controls.flushFailures++;
									return Effect.fail(new LedgerError({why: "storage"}));
								}),
							};
						}),
					).pipe(Layer.provideMerge(recording)),
					ProcessManager.layer(brain(), next.next),
					Mailbox.layer,
				).pipe(Layer.provideMerge(base())),
			),
		);
	};
	return {
		ledger,
		state,
		authority,
		controls,
		alarms,
		alarm: () => alarm,
		consumeAlarm: () => {
			alarm = null;
		},
		input,
		base,
		manager,
		layer,
		boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager())),
		reopen: () => {
			ledger.reopen();
			state.reopen();
			authority.reopen();
		},
	};
};

const lives = read(`processes/${NAME}`);
const inbox = read(`${NAME}/inbox`);

const dead = Effect.forEach(PIDS, (p) => read(`${p}/dead`), {concurrency: 1}).pipe(
	Effect.map((rows) => rows.flat()),
);

const failed = <A, E, R>(e: Effect.Effect<A, E, R>) =>
	e.pipe(
		Effect.exit,
		Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit)).toBe(true))),
	);

/** A letter accepted before the saved model, as P11 marks one: sent and indexed as placed. */
const accepted = (
	id: string,
	m: unknown,
	saved: {saved: unknown; turn: unknown; cmds: ReadonlyArray<unknown>} | null,
) =>
	Effect.gen(function* () {
		const sent = yield* Mailbox.use((box) => box.send(NAME, id, m, from()));
		const checkpoint = saved ?? {
			saved: {v: 1, build: BUILD, model: {count: 0, replies: 0}, after: 0},
			turn: null,
			cmds: [],
		};

		if (sent._tag === "placed") {
			yield* ProcessStore.use((s) => s.save(checkpoint, [{id, rev: sent.rev, pos: sent.pos}]));
		}
	});

const recover = (w: ReturnType<typeof world>) =>
	Effect.gen(function* () {
		const deadline = w.alarms.at(-1);
		expect(deadline, "failed process must schedule its saved recovery").toBeTypeOf("number");
		yield* TestClock.setTime(deadline!);
		yield* ProgramRunner.use((r) => r.due(deadline!)).pipe(Effect.provide(w.layer()));
	});

describe("P34 runner supervision", () => {
	for (const pending of ["fresh", "saved retry"] as const) {
		for (const path of ["open", "msg", "due", "restart"] as const) {
			it(`storage plant, gate dispatch or repeat answered jobs on flush failure: ${pending} write completes before one flush through ${path}`, async () => {
				await fc.assert(
					fc.asyncProperty(fc.uuid(), fc.integer({min: 1000, max: 60_000}), (id, time) =>
						Effect.runPromise(
							Effect.gen(function* () {
								const w = world(false, true);
								const sink = storage();
								const parts = new Map<string, ReturnType<typeof storage>>();
								const records = RecordManager.sql((name) => {
									let part = parts.get(name);

									if (part === undefined) {
										part = storage();
										parts.set(name, part);
									}

									return part.sql;
								}, 1024 ** 3);
								const recording = Recording.layer.pipe(
									Layer.provideMerge(
										Layer.mergeAll(SpanSink.layer(sink.sql, {object: A}), records, Archive.memory),
									),
								);
								const held = () => sink.sql.exec("SELECT spanId, row FROM unsent ORDER BY spanId");
								const shipped = () =>
									[...parts.values()].flatMap((part) =>
										part.sql.exec("SELECT spanId FROM spans").map((row) => row.spanId),
									);
								const process = path === "restart" ? B : A;
								const request = {id: `restart-${id}`, build: BUILD};
								const input = w.input(id, {type: "save", token: id});
								const checkpoint = ProcessStore.use((s) =>
									s.select(process).pipe(Effect.flatMap((selected) => selected.load)),
								);
								yield* w.boot;

								if (pending === "saved retry") {
									// Leave a real dispatched write behind before constructing the tested runner.
									yield* Effect.gen(function* () {
										const r = yield* ProgramRunner;

										if (path === "restart") {
											yield* r.restart(request);
										}

										w.controls.loseWriteReply = true;
										yield* failed(r.msg(input));
									}).pipe(Effect.provide(w.layer()));
								}

								expect(w.controls.loseWriteReply).toBe(false);
								expect(w.controls.writes).toHaveLength(pending === "saved retry" ? 1 : 0);
								// One runner owns the failed flush and every later call. No storage reopen.
								yield* Effect.gen(function* () {
									const r = yield* ProgramRunner;

									if (pending === "fresh" && path === "restart") {
										yield* r.restart(request);
									}

									const wake = Effect.gen(function* () {
										if (path === "open") {
											yield* r.open(id);
										} else if (path === "msg") {
											yield* r.msg(input);
										}
										// Repeat the completed request; replacing a process must not run its old Cmds.
										else if (path === "restart") {
											yield* r.restart(request);
										} else {
											w.consumeAlarm();
											yield* r.due(time);
										}
									});
									const before = [...w.controls.writes];
									const flushes = w.controls.flushes.length;
									w.controls.flushOnce = true;
									const exit = yield* failed(pending === "fresh" ? r.msg(input) : wake);

									if (Exit.isFailure(exit)) {
										expect(Cause.squash(exit.cause)).toMatchObject({why: "storage"});
									}

									expect(w.controls.flushFailures).toBe(1);
									expect(w.controls.flushOnce).toBe(false);
									expect(
										w.controls.flushes,
										"one flush after the call, even when it fails",
									).toHaveLength(flushes + 1);
									const job = w.controls.writes[before.length];
									expect(
										job,
										"the call dispatches its fresh or saved write before flushing",
									).toBeTypeOf("string");

									if (pending === "saved retry") {
										expect(job).toBe(before[0]);
									}

									expect(w.controls.writes, "the call dispatches each pending write once").toEqual([
										...before,
										job,
									]);
									expect(w.controls.flushes.at(-1), "flush follows dispatch").toEqual([
										...before,
										job,
									]);
									expect((yield* inbox).filter((row) => row.id === `${job}/answer`)).toMatchObject([
										{body: {m: {type: "write_ok"}}},
									]);
									expect(yield* checkpoint).toMatchObject({cmds: []});
									const spans = held();
									const call =
										pending === "fresh" || path === "msg"
											? "step"
											: path === "restart"
												? "restart.request"
												: path;
									expect(spans.map((row) => JSON.parse(String(row.row)))).toEqual(
										expect.arrayContaining([
											expect.objectContaining({name: `runner.${call}`}),
											expect.objectContaining({name: "runner.cmd"}),
											expect.objectContaining({name: "runner.write"}),
										]),
									);
									const sent = shipped();
									expect(spans.map((row) => row.spanId)).toEqual(
										sink.sql
											.exec("SELECT spanId FROM health ORDER BY spanId")
											.map((row) => row.spanId)
											.filter((id) => !sent.includes(id)),
									);
									const lifecycle = yield* lives;
									yield* wake;
									expect(w.controls.flushes).toHaveLength(flushes + 2);
									expect(held(), "the next call ships every retained span").toEqual([]);
									expect(shipped()).toEqual(expect.arrayContaining(spans.map((row) => row.spanId)));
									yield* wake;
									expect(w.controls.writes, "an answered write must not dispatch again").toEqual([
										...before,
										job,
									]);
									expect(yield* read("facts")).toMatchObject([{_tag: "saved", body: {token: id}}]);
									expect((yield* inbox).filter((row) => row.id === `${job}/answer`)).toHaveLength(
										1,
									);
									expect(yield* lives).toEqual(lifecycle);
									expect(w.controls.flushFailures).toBe(1);
								}).pipe(Effect.provide(w.layer(recording)));
							}).pipe(Effect.provide(TestClock.layer())),
						),
					),
					{
						seed: 119120,
						numRuns: 12,
						// Review 7 lost pending writes; round 12 keeps them without gating dispatch on flush.
						examples: [["00000000-0000-4000-8000-000000000271", 1000]],
					},
				);
			});
		}
	}

	for (const path of ["open", "msg", "due idle", "due early", "due ready", "restart"] as const) {
		it(`p35 plant, skip takeRetry in ${path}: a same-process wake retries and answers a saved write`, async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.uuid(),
					fc.integer({min: 1000, max: 60_000}),
					fc.integer({min: 1, max: 1000}),
					(id, time, delay) =>
						Effect.runPromise(
							Effect.gen(function* () {
								const wakeAt =
									path === "due ready" ? time : path === "due early" ? time + delay : null;
								const w = world(false, true, wakeAt);
								const process = path === "restart" ? B : A;
								const request = {id: `restart-${id}`, build: BUILD};
								const checkpoint = ProcessStore.use((s) =>
									s.select(process).pipe(Effect.flatMap((selected) => selected.load)),
								);
								yield* w.boot;
								yield* Effect.gen(function* () {
									const r = yield* ProgramRunner;

									// Repeat an already completed Restart to keep this process alive.
									// A fresh Restart must not execute its predecessor's Cmds.
									if (path === "restart") {
										yield* r.restart(request);
									}

									w.controls.loseWriteReply = true;
									yield* failed(r.msg(w.input(id, {type: "save", token: id})));
									expect(w.controls.loseWriteReply).toBe(false);
									expect(w.controls.writes).toHaveLength(1);
									expect(yield* read("facts")).toMatchObject([{_tag: "saved", body: {token: id}}]);
									expect(yield* inbox).toHaveLength(1);
									expect(yield* checkpoint).toMatchObject({
										cmds: [{id: w.controls.writes[0], state: "dispatched"}],
									});
								}).pipe(Effect.provide(w.layer()));
								const [writeId] = w.controls.writes;
								const before = yield* lives.pipe(Effect.provide(w.manager()));
								w.reopen();
								yield* Effect.gen(function* () {
									const r = yield* ProgramRunner;
									const wake = Effect.gen(function* () {
										if (path === "open") {
											yield* r.open(id);
										} else if (path === "msg") {
											yield* r.msg(w.input(`next-${id}`, {type: "add", n: delay}));
										} else if (path === "restart") {
											yield* r.restart(request);
										} else {
											w.consumeAlarm();
											yield* r.due(time);
										}
									});
									yield* wake;
									expect(w.controls.writes, "the wake must retry the original write ID").toEqual([
										writeId,
										writeId,
									]);
									const answers = (yield* inbox).filter((row) => row.id === `${writeId}/answer`);
									expect(answers).toMatchObject([{body: {m: {type: "write_ok"}}}]);
									expect(yield* checkpoint).toMatchObject({cmds: []});
									yield* wake;
									expect(
										w.controls.writes,
										"a second wake must not retry an answered write",
									).toEqual([writeId, writeId]);
									expect(yield* read("facts")).toHaveLength(1);
									expect(
										(yield* inbox).filter((row) => row.id === `${writeId}/answer`),
									).toHaveLength(1);
									expect(yield* lives).toEqual(before);
									expect(yield* ProcessManager.use((p) => p.isLive(process))).toBe(true);
								}).pipe(Effect.provide(w.layer()));
							}).pipe(Effect.provide(TestClock.layer())),
						),
				),
				{
					seed: 119120,
					numRuns: 12,
					// Review 6: an alarm-only wake lost main's saved-write retry.
					examples: [["00000000-0000-4000-8000-000000000271", 1000, 7]],
				},
			);
		});
	}

	// Cover every exit explicitly; generate the schedule and history inside each.
	// The alarm is one slot. Firing it clears the slot before calling due.
	for (const path of [
		"after_observation",
		"after_exit",
		"after_down",
		"after_start",
		"after_checkpoint",
		"due",
		"Restart live",
		"Restart down",
		"external adoption",
		"wake",
	] as const) {
		for (const history of [false, true]) {
			it(`p80 plant, rearm only some paths: ${path}, ${history ? "saved" : "empty"} inbox`, async () => {
				await fc.assert(
					fc.asyncProperty(
						fc.uuid(),
						fc.integer({min: 1001, max: 60_000}),
						fc.integer({min: 1, max: 1000}),
						(id, time, n) =>
							Effect.runPromise(
								Effect.gen(function* () {
									const restarting = path === "Restart live" || path === "Restart down";
									// A selected Restart build gets a timer even if the old build had none.
									// P34 amendment: after_down crashes until the brake trips, past 2300 ms, so its
									// program wake sits beyond every recovery deadline.
									const wakeAt = path === "after_down" ? time + 10_000 : time;
									const w = world(false, false, restarting ? null : wakeAt);
									yield* w.boot;

									if (history) {
										yield* ProgramRunner.use((r) => r.msg(w.input(id, {type: "add", n}))).pipe(
											Effect.provide(w.layer()),
										);
									}

									const before = yield* inbox.pipe(Effect.provide(w.manager()));
									let crashes = 1;
									// A platform alarm has fired before due enters the runner.
									const fire = (r: Context.Service.Shape<typeof ProgramRunner>, at: number) => {
										w.consumeAlarm();
										return r.due(at);
									};

									if (path === "wake") {
										w.reopen();
										yield* ProgramRunner.use((r) => r.open("wake")).pipe(Effect.provide(w.layer()));
									} else if (path === "Restart live") {
										w.controls.build = `build-${id}`;
										w.controls.wakeAt = time;
										yield* ProgramRunner.use((r) =>
											r.restart({id: `restart-${id}`, build: w.controls.build}),
										).pipe(Effect.provide(w.layer()));
									} else {
										const earlyCut = ["after_observation", "after_exit", "after_down"].includes(
											path,
										);

										if (earlyCut) {
											w.controls.cut = path;
										}

										yield* ProgramRunner.use((r) => failed(r.msg(w.input(`crash-${id}`)))).pipe(
											Effect.provide(w.layer()),
										);

										// P34 amendment: down is written only when the brake trips, so after_down
										// crashes a fresh letter after each recovery until the cut is reached.
										for (let n = 0; path === "after_down" && w.controls.hits.length === 0; n++) {
											expect(n, "the brake trips within the restart intensity").toBeLessThan(
												policy.intensity,
											);
											const at = w.alarm()!;
											w.reopen();
											yield* TestClock.setTime(at);
											yield* ProgramRunner.use((r) => fire(r, at)).pipe(Effect.provide(w.layer()));
											yield* ProgramRunner.use((r) =>
												failed(r.msg(w.input(`crash-${n}-${id}`))),
											).pipe(Effect.provide(w.layer()));
										}

										// The tripped brake's deadline is the down fact's own `until`.
										const tripped = (yield* lives.pipe(Effect.provide(w.manager()))).filter(
											(row) => row._tag === "down",
										);
										const deadline =
											path === "after_down"
												? Schema.decodeUnknownSync(Schema.Struct({until: Schema.Int}))(
														tripped.at(-1)?.body,
													).until
												: 100;
										// Each crash's successor takes the next ID; A was the first.
										crashes = path === "after_down" ? w.controls.steps.length : 1;
										w.reopen();

										if (earlyCut) {
											yield* ProgramRunner.use((r) => failed(r.open("resume-down"))).pipe(
												Effect.provide(w.layer()),
											);
										}

										expect(w.alarm(), "only recovery is eligible while down").toBe(deadline);

										if (earlyCut) {
											expect(w.controls.hits).toEqual([path]);
										}

										if (path === "Restart down") {
											w.controls.build = `build-${id}`;
											w.controls.wakeAt = time;
											yield* ProgramRunner.use((r) =>
												r.restart({id: `restart-${id}`, build: w.controls.build}),
											).pipe(Effect.provide(w.layer()));
										} else if (path === "external adoption") {
											yield* ProcessManager.use((p) =>
												p.start(again(A, `external-${id}`), from()),
											).pipe(Effect.provide(w.manager()));
											w.reopen();
											yield* ProgramRunner.use((r) => r.open("adopt")).pipe(
												Effect.provide(w.layer()),
											);
										} else {
											yield* TestClock.setTime(deadline!);
											const lateCut = path === "after_start" || path === "after_checkpoint";

											if (lateCut) {
												w.controls.cut = path;
											}

											yield* ProgramRunner.use((r) =>
												lateCut ? failed(fire(r, deadline!)) : fire(r, deadline!),
											).pipe(Effect.provide(w.layer()));

											if (lateCut) {
												expect(w.controls.hits).toEqual([path]);
												w.reopen();
												yield* ProgramRunner.use((r) => r.open("resume-live")).pipe(
													Effect.provide(w.layer()),
												);
											}
										}
									}

									const armed = w.alarm();
									const recovery = yield* RecoveryStore.use((s) => s.load).pipe(
										Effect.provide(
											RecoveryStore.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3}),
										),
									);
									// The program is live, so no recovery deadline remains. Earlier down
									// exits above checked the other side of the same earliest-deadline law.
									expect(recovery?.recovery._tag ?? "live").toBe("live");
									expect(
										yield* ProcessManager.use((p) =>
											p.isLive(path === "wake" ? A : PIDS[crashes]!),
										).pipe(Effect.provide(w.manager())),
									).toBe(true);
									expect(yield* inbox.pipe(Effect.provide(w.manager()))).toEqual(before);
									expect(w.controls.timers).toEqual([]);
									yield* Effect.gen(function* () {
										const r = yield* ProgramRunner;
										yield* TestClock.setTime(wakeAt);
										yield* fire(r, wakeAt);
										yield* fire(r, wakeAt);
										expect({
											armed,
											timers: w.controls.timers,
											view: (yield* r.open("timer")).view,
										}).toEqual({
											armed: wakeAt,
											timers: [wakeAt],
											view: {count: history ? n : 0, replies: 1},
										});
										expect(w.alarm()).toBeNull();
										const rows = yield* inbox;
										expect(rows).toHaveLength(before.length + 1);
										expect(rows.at(-1)?.id).toBe(
											`${path === "wake" ? A : PIDS[crashes]!}/due/${wakeAt}`,
										);
									}).pipe(Effect.provide(w.layer()));
								}).pipe(Effect.provide(TestClock.layer())),
							),
					),
					{
						seed: 119120,
						numRuns: 12,
						// Review 5: Restart with no old timer and no accepted inbox letter.
						examples: [["00000000-0000-4000-8000-000000000271", 1000, 7]],
					},
				);
			});
		}
	}

	it("p80 p55 plant, adopt without handoff: external successor folds unindexed person-only mail once across reopen", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.integer({min: 1, max: 1000}), (id, n) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world(true);
						yield* w.boot;
						w.controls.crashAdd = 2;
						const letter = w.input(id, {type: "add", n});
						const before = yield* Effect.gen(function* () {
							yield* ProgramRunner.use((r) => failed(r.msg(letter)));
							expect(w.controls.adds).toBe(2);
							expect(yield* ProcessStore.use((s) => s.load)).toMatchObject({
								turn: {_tag: "prepared", id},
								saved: {model: {count: 0}},
							});
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toBeNull();
							// P34 amendment: one crash inside the restart budget writes no down fact.
							expect((yield* lives).filter((row) => row._tag === "down")).toEqual([]);
							expect((yield* lives).at(-1)).toMatchObject({
								_tag: "exited",
								body: {process: A, why: "saved_letter"},
							});
							const rows = yield* inbox;
							expect(rows).toMatchObject([{id, body: {m: {type: "add", n}}}]);
							return rows;
						}).pipe(Effect.provide(w.layer()));
						// A trusted caller starts B outside the runner's recovery action.
						yield* ProcessManager.use((p) => p.start(again(A, `external-${id}`), from())).pipe(
							Effect.provide(w.manager()),
						);
						w.reopen();
						const adopted = yield* ProgramRunner.use((r) => r.open("adopt")).pipe(
							Effect.provide(w.layer()),
						);
						w.reopen();
						yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							const reopened = yield* runner.open("reopened");
							expect({
								adopted: adopted.view,
								reopened: reopened.view,
								adds: w.controls.adds,
							}).toEqual({
								adopted: {count: n, replies: 0},
								reopened: {count: n, replies: 0},
								adds: 3,
							});
							expect(yield* ProcessManager.use((p) => p.isLive(B))).toBe(true);
							expect(yield* inbox).toEqual(before);
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toMatchObject({
								id,
								rev: before[0]!.rev,
								pos: before[0]!.pos,
							});
							expect(yield* runner.msg(letter)).toMatchObject({_tag: "accepted"});
							expect((yield* runner.open("resend")).view).toMatchObject({count: n});
							expect(w.controls.adds).toBe(3);
							expect(yield* dead).toEqual([]);
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review 3: external adoption drops the only acceptance marker before indexing.
				examples: [["00000000-0000-4000-8000-000000000271", 7]],
			},
		);
	});

	it("p80 plant, never restore program wake: recovery rearms a future alarm without new mail and due runs its timer", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uuid(),
				fc.integer({min: 101, max: 60_000}),
				fc.integer({min: 1, max: 1000}),
				(id, time, n) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const w = world(false, false, time);
							yield* w.boot;
							const before = yield* Effect.gen(function* () {
								const runner = yield* ProgramRunner;
								yield* runner.msg(w.input(id, {type: "add", n}));
								expect(w.alarms.at(-1)).toBe(time);
								yield* failed(runner.msg(w.input(`crash-${id}`)));
								expect(w.alarms.at(-1)).toBe(policy.backoff.minMs);
								return yield* inbox;
							}).pipe(Effect.provide(w.layer()));
							w.reopen();
							yield* Effect.gen(function* () {
								const runner = yield* ProgramRunner;
								yield* TestClock.setTime(policy.backoff.minMs);
								yield* runner.due(policy.backoff.minMs);
								const restored = w.alarms.at(-1);
								expect(yield* ProcessManager.use((p) => p.isLive(B))).toBe(true);
								expect(yield* inbox).toEqual(before);
								expect(w.controls.timers).toEqual([]);
								yield* TestClock.setTime(time);
								yield* runner.due(time);
								yield* runner.due(time);
								expect({
									restored,
									timers: w.controls.timers,
									view: (yield* runner.open("timer")).view,
								}).toEqual({
									restored: time,
									timers: [time],
									view: {count: n, replies: 1},
								});
								expect(w.alarms.at(-1)).toBeNull();
							}).pipe(Effect.provide(w.layer()));
						}).pipe(Effect.provide(TestClock.layer())),
					),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review 3: recovery consumes the object's alarm while its saved program wake is future.
				examples: [["00000000-0000-4000-8000-000000000271", 1000, 7]],
			},
		);
	});

	it("p80 H3 plant, restart clears turn: explicit Restart keeps unindexed person-only acceptance after a failed fold", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.integer({min: 1, max: 1000}), (id, n) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world(true);
						yield* w.boot;
						w.controls.crashAdd = 2;
						const letter = w.input(id, {type: "add", n});
						const before = yield* Effect.gen(function* () {
							yield* ProgramRunner.use((r) => failed(r.msg(letter)));
							expect(w.controls.adds).toBe(2);
							expect(yield* ProcessStore.use((s) => s.load)).toMatchObject({
								turn: {_tag: "prepared", id},
								saved: {model: {count: 0}},
							});
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toBeNull();
							// P34 amendment: one crash inside the restart budget writes no down fact.
							expect((yield* lives).filter((row) => row._tag === "down")).toEqual([]);
							expect((yield* lives).at(-1)).toMatchObject({
								_tag: "exited",
								body: {process: A, why: "saved_letter"},
							});
							return yield* inbox;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						w.controls.build = "build-restart";
						yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							yield* runner.restart({id: `restart-${id}`, build: w.controls.build});
							expect(w.controls.init).toContainEqual({build: w.controls.build, loaded: null});
							expect((yield* runner.open("restarted")).view).toMatchObject({count: n});
							expect(yield* inbox).toEqual(before);
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toMatchObject({
								id,
								rev: before[0]!.rev,
								pos: before[0]!.pos,
							});
							expect(yield* runner.msg(letter)).toMatchObject({_tag: "accepted"});
							expect((yield* runner.open("resend")).view).toMatchObject({count: n});
							expect(yield* dead).toEqual([]);
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 re-review: Restart loses the only acceptance marker for person-only mail.
				examples: [["00000000-0000-4000-8000-000000000271", 7]],
			},
		);
	});

	it("wake probe plant, never clear marker on handoff: storage.get recovery survives a second wake with the same live successor", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), (id) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world(false, true);
						yield* w.boot;
						w.controls.cut = "after_observation";
						yield* ProgramRunner.use((r) => failed(r.msg(w.input(id)))).pipe(
							Effect.provide(w.layer()),
						);
						expect(w.controls.hits).toEqual(["after_observation"]);
						w.reopen();
						yield* Effect.gen(function* () {
							expect(yield* ProcessStore.use((s) => s.readActivity)).toMatchObject({
								_tag: "stepping",
								process: A,
								letter: id,
							});
							yield* ProgramRunner.use((r) => failed(r.open("recover")));
						}).pipe(Effect.provide(w.layer()));
						yield* recover(w);
						const before = yield* Effect.gen(function* () {
							expect(yield* ProcessManager.use((p) => p.isLive(B))).toBe(true);
							return yield* lives;
						}).pipe(Effect.provide(w.manager()));
						w.reopen();
						yield* Effect.gen(function* () {
							const opened = yield* Effect.exit(ProgramRunner.use((r) => r.open("wake-again")));
							const stillLive = yield* ProcessManager.use((p) => p.isLive(B));
							const after = yield* lives;
							expect({opened, stillLive, lives: after}).toMatchObject({
								opened: {_tag: "Success", value: {view: {count: 0}}},
								stillLive: true,
								lives: before,
							});
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 re-review: the object-wide stepping key outlives A's recovered failure.
				examples: [["00000000-0000-4000-8000-000000000271"]],
			},
		);
	});

	it("H6 p80 plant, keep old build: adopting an external successor uses its build in records and later recovery", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.integer({min: 1, max: 1000}), (id, n) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world();
						yield* w.boot;
						yield* ProgramRunner.use((r) => failed(r.msg(w.input()))).pipe(
							Effect.provide(w.layer()),
						);
						const build = `build-${id}`;
						yield* ProcessManager.use((p) =>
							p.start(again(A, `external-${id}`, {program: "counter", hash: build}), from()),
						).pipe(Effect.provide(w.manager()));
						w.controls.build = build;
						w.reopen();
						const records = yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							expect(yield* runner.msg(w.input(id, {type: "add", n}))).toMatchObject({
								_tag: "accepted",
							});
							const records = yield* read(B);
							expect(records).toHaveLength(1);
							yield* failed(runner.msg(w.input(`poison-${id}`)));
							return records;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						yield* recover(w);
						const status = yield* ProcessManager.use((p) => p.status(NAME)).pipe(
							Effect.provide(w.manager()),
						);
						const saved = yield* RecoveryStore.use((s) => s.load).pipe(
							Effect.provide(RecoveryStore.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3})),
						);
						expect({records, saved, state: status.state}).toMatchObject({
							records: [{build, body: {build, input: id}}],
							saved: {build},
							state: {_tag: "live", process: W, code: {hash: build}},
						});
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 re-review: an external replacement selects a different build from A's.
				examples: [["00000000-0000-4000-8000-000000000271", 7]],
			},
		);
	});

	it("p80 p55 plant, clear turn in handoff: person-only mail survives a successor's first failed fold", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.integer({min: 1, max: 1000}), (id, n) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world(true);
						yield* w.boot;
						yield* ProgramRunner.use((r) => failed(r.msg(w.input()))).pipe(
							Effect.provide(w.layer()),
						);
						yield* recover(w);
						// B is A's successor. Preparation succeeds; B's first accepted fold throws.
						w.controls.crashAdd = 2;
						const letter = w.input(id, {type: "add", n});
						const before = yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							yield* failed(runner.msg(letter));
							expect(w.controls.adds).toBe(2);
							// P34 amendment: both crashes are inside the restart budget, so no down fact.
							expect((yield* lives).filter((row) => row._tag === "down")).toEqual([]);
							expect((yield* lives).filter((row) => row._tag === "exited")).toMatchObject([
								{body: {process: A}},
								{body: {process: B, why: "saved_letter"}},
							]);
							const store = yield* ProcessStore;
							const successor = yield* store.select(B);
							expect(yield* successor.load).toMatchObject({
								turn: {_tag: "prepared", id},
								saved: {model: {count: 0}},
							});
							expect(yield* store.placedByAny(id)).toBeNull();
							const rows = yield* inbox;
							expect(rows).toMatchObject([{id, body: {m: {type: "add", n}}}]);
							return rows;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						yield* recover(w);
						w.reopen();
						yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							expect((yield* runner.open("recovered")).view).toMatchObject({count: n});
							expect(w.controls.adds).toBe(3);
							expect(yield* inbox).toEqual(before);
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toMatchObject({
								id,
								rev: before[0]!.rev,
								pos: before[0]!.pos,
							});
							expect(yield* runner.msg(letter)).toMatchObject({_tag: "accepted"});
							expect((yield* runner.open("resend")).view).toMatchObject({count: n});
							expect(yield* dead).toEqual([]);
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review: an appended person-only letter has a turn but no placing yet.
				examples: [["00000000-0000-4000-8000-000000000271", 7]],
			},
		);
	});

	it("P34 p79 plant, skip untyped mail: the watcher program steps on real monitor DOWN signals", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uniqueArray(fc.uuid(), {minLength: 1, maxLength: 3}),
				fc.constantFrom("normal", "crashed", "shutdown"),
				(refs, why) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const w = world();
							yield* w.boot;
							yield* ProcessManager.use((p) =>
								p.start(first("child:start", "child:1"), from()),
							).pipe(Effect.provide(w.manager()));
							const watching = ProcessManager.layer({...brain(), ...watcher(A)}, ids().next).pipe(
								Layer.provideMerge(w.base()),
							);

							for (const ref of refs) {
								yield* ProcessManager.use((p) => p.monitor(ref, B, from())).pipe(
									Effect.provide(watching),
								);
							}

							yield* ProcessManager.use((p) => p.exit(B, why, from())).pipe(
								Effect.provide(w.manager()),
							);
							const expected = refs.map((ref) =>
								Down.make({ref, process: B, why, to: Recipient.cases.process.make({process: A})}),
							);
							// Inspect the manager's actual untyped letters. The test does no translation.
							const before = yield* inbox.pipe(Effect.provide(w.manager()));
							expect(before.map((row) => row.body)).toEqual(
								expected.map((m) => expect.objectContaining({m})),
							);
							w.reopen();

							for (let wake = 0; wake < 2; wake++) {
								yield* Effect.gen(function* () {
									const runner = yield* ProgramRunner;
									expect((yield* runner.open("watcher")).view).toMatchObject({
										count: 0,
										replies: refs.length,
									});
									expect(w.controls.downs).toEqual(expected);
									expect(yield* inbox).toEqual(before);
								}).pipe(Effect.provide(w.layer()));
								w.reopen();
							}
						}),
					),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review: the manager writes _tag: DOWN, with no tea Msg type.
				examples: [[["00000000-0000-4000-8000-000000000271"], "crashed"]],
			},
		);
	});

	it.effect(
		"p80 bounded objects plant, keep every input in one row: a good step writes flat supervision bytes after 1 or 50 good letters without losing receipts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				// Identify P11's tables before supervision creates any. Audit all other tables,
				// whether recovery uses one JSON row or separate rows for letters and observations.
				yield* ProcessStore.use((s) => s.load).pipe(Effect.provide(w.layer()));
				const tables = () =>
					w.state.sql.exec(
						"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
					);
				const processTables = new Set(tables().map((row) => String(row.name)));
				const poison = w.input();
				yield* ProgramRunner.use((r) => failed(r.msg(poison))).pipe(Effect.provide(w.layer()));
				w.reopen();
				yield* recover(w);
				const goodId = (n: number) => `good-${String(n).padStart(3, "0")}`;
				const good = (n: number) =>
					ProgramRunner.use((r) => r.msg(w.input(goodId(n), {type: "add", n: 1}))).pipe(
						Effect.tap((answer) =>
							Effect.sync(() => expect(answer).toMatchObject({_tag: "accepted", pos: n})),
						),
						Effect.provide(w.layer()),
					);
				yield* good(1);
				const recoveryTables = tables().filter((row) => !processTables.has(String(row.name)));
				expect(recoveryTables.length, "audit must cover real supervision storage").toBeGreaterThan(
					0,
				);
				const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
				w.state.sql.exec("CREATE TEMP TABLE p34_supervision_writes (bytes INTEGER NOT NULL)");

				for (const [index, {name}] of recoveryTables.entries()) {
					const table = quote(String(name));
					const columns = w.state.sql.exec(`PRAGMA table_info(${table})`);

					for (const event of ["INSERT", "UPDATE", "DELETE"]) {
						const record = event === "DELETE" ? "OLD" : "NEW";
						const bytes = columns
							.map(({name}) => `coalesce(length(CAST(${record}.${quote(String(name))} AS BLOB)),0)`)
							.join(" + ");
						w.state.sql.exec(
							`CREATE TEMP TRIGGER ${quote(`p34_write_${index}_${event}`)} AFTER ${event} ON ${table}
							BEGIN INSERT INTO p34_supervision_writes (bytes) VALUES (${bytes}); END`,
						);
					}
				}

				const measure = (n: number) =>
					Effect.gen(function* () {
						w.state.sql.exec("DELETE FROM p34_supervision_writes");
						yield* good(n);
						const [row] = w.state.sql.exec(
							"SELECT coalesce(sum(bytes),0) AS bytes FROM p34_supervision_writes",
						);
						return Number(row?.bytes);
					});
				// Sum full row images written by SQL, not the difference in database size.
				// A growing JSON row adds a constant size but rewrites all the older inputs.
				const afterOne = yield* measure(2);

				for (let n = 3; n <= 50; n++) {
					yield* good(n);
				}

				const afterFifty = yield* measure(51);

				const recovery = () => RecoveryStore.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3});
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(w.input(goodId(1), {type: "add", n: 2}))).toMatchObject({
						_tag: "refused",
						why: "id_reused",
					});
					expect(yield* r.msg(w.input(goodId(1), {type: "add", n: 1}))).toMatchObject({
						_tag: "accepted",
						pos: 1,
					});
				}).pipe(Effect.provide(w.layer()));
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({tries: 1, errors: ["TypeError"], result: null});
				yield* ProgramRunner.use((r) => failed(r.msg(poison))).pipe(Effect.provide(w.layer()));
				w.reopen();
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({tries: 2, errors: ["TypeError", "RangeError"], result: null});
				yield* recover(w);
				expect(
					yield* ProgramRunner.use((r) => r.msg(poison)).pipe(Effect.provide(w.layer())),
				).toMatchObject({_tag: "refused", why: "dead"});
				w.reopen();
				expect(
					yield* RecoveryStore.use((s) => s.input(poison.id)).pipe(Effect.provide(recovery())),
				).toEqual(poison);
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({
					tries: 3,
					errors: ["TypeError", "RangeError", "TypeError"],
					result: {_tag: "refused", why: "dead"},
				});
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(poison)).toMatchObject({_tag: "refused", why: "dead"});
					expect(
						yield* r.msg({
							...poison,
							envelope: {...poison.envelope, input: {type: "poison", key: "changed"}},
						}),
					).toMatchObject({_tag: "refused", why: "id_reused"});
					expect(w.controls.steps).toEqual(["poison", "poison", "poison"]);
					expect((yield* inbox).map((row) => row.id)).toEqual(
						Array.from({length: 51}, (_, n) => goodId(n + 1)),
					);
					expect((yield* dead).map((row) => row.body)).toMatchObject([{m: poison.id, tries: 3}]);
				}).pipe(Effect.provide(w.layer()));
				// Fixed-width IDs and identical good bodies. Allow 256 bytes for decimal
				// metadata gaining digits across all writes; never an allowance per old letter.
				expect(
					Math.abs(afterFifty - afterOne),
					`supervision bytes per good step: after 1=${afterOne}, after 50=${afterFifty}`,
				).toBeLessThanOrEqual(256);
			}),
	);

	it.effect(
		"P33 authority plant, trust forged dead row: foreign ledger data cannot manufacture a terminal answer",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				w.controls.throws = false;
				yield* Effect.gen(function* () {
					yield* Ledger.use((l) =>
						l.append(
							`${A}/dead`,
							"foreign-dead",
							lineFor(from({by: "SHA256:foreign"}), {
								_tag: "dead",
								process: A,
								program: "counter",
								name: NAME,
								tries: 3,
								limit: 3,
								m: "poison",
								build: BUILD,
								errors: ["TypeError", "TypeError", "TypeError"],
							}),
						),
					);
					expect(yield* ProgramRunner.use((r) => r.msg(w.input()))).toMatchObject({
						_tag: "accepted",
					});
					expect(w.controls.steps).toEqual(["poison", "poison"]);
					expect((yield* inbox).map((row) => row.id)).toEqual(["poison"]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);
	it.effect(
		"p25 p80 plant, append before preparation or return refusal: first two throws stay unaccepted",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;

				for (let n = 0; n < 2; n++) {
					yield* Effect.gen(function* () {
						const r = yield* ProgramRunner;
						yield* failed(r.msg(w.input()));
						expect(yield* inbox).toEqual([]);
						expect(yield* ProcessStore.use((s) => s.load)).toBeNull();
						expect(w.controls.cmds).toBe(0);
						expect((yield* lives).filter((row) => row._tag === "exited")).toHaveLength(n + 1);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();
					yield* recover(w);
				}
			}),
	);

	it.effect(
		"p80 plant, reset by process or allow try four: third throw records ordered original classes once",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;

				for (let n = 1; n <= 3; n++) {
					yield* Effect.gen(function* () {
						const r = yield* ProgramRunner;
						const answer = yield* Effect.exit(r.msg(w.input()));
						expect(answer).toMatchObject(
							n < 3
								? {_tag: "Failure"}
								: {
										_tag: "Success",
										value: {_tag: "refused", why: "dead"},
									},
						);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();

					if (n < 3) {
						yield* recover(w);
					}
				}

				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* dead).toMatchObject([
						{
							stream: `${W}/dead`,
							body: {
								tries: 3,
								limit: 3,
								m: "poison",
								build: BUILD,
								errors: ["TypeError", "RangeError", "TypeError"],
							},
						},
					]);
					expect(yield* r.msg(w.input())).toMatchObject({_tag: "refused", why: "dead"});
					expect(w.controls.steps).toEqual(["poison", "poison", "poison"]);
					expect(yield* inbox).toEqual([]);
					// The sender has stopped retrying. Read the original body through the real durable store.
					const path = "../coordination/recovery-store.ts";
					type Store = {input: (letter: string) => Effect.Effect<unknown, LedgerError>};
					const {
						RecoveryStore: S,
					}: {
						RecoveryStore: Context.Service<Store, Store> & {
							layer: (sql: Sql, who: {name: string; capacity: number}) => LayerType.Layer<Store>;
						};
					} = yield* Effect.promise(() => import(path));
					expect(
						yield* Effect.gen(function* () {
							return yield* (yield* S).input("poison");
						}).pipe(Effect.provide(S.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3}))),
					).toMatchObject({id: "poison", envelope: {input: {type: "poison", key: "poison"}}});
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, global count or reset on unrelated mail: interleaved IDs keep independent counts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;

				for (const id of ["a", "b", "a"]) {
					yield* ProgramRunner.use((r) => failed(r.msg(w.input(id)))).pipe(
						Effect.provide(w.layer()),
					);
					w.reopen();
					yield* recover(w);
					yield* ProgramRunner.use((r) =>
						r.msg(w.input(`good-${id}-${w.controls.steps.length}`, {type: "add", n: 1})),
					).pipe(Effect.provide(w.layer()));
				}

				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(w.input("a"))).toMatchObject({_tag: "refused", why: "dead"});
					expect((yield* dead).map((row) => row.body)).toMatchObject([{m: "a", tries: 3}]);
					expect(w.controls.steps.filter((id) => id === "b")).toHaveLength(1);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, early or duplicate alarm: exactly one successor starts when the saved deadline arrives",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					yield* failed(r.msg(w.input()));
					expect(w.alarms.at(-1)).toBe(100);
					const loads = w.controls.loads;
					yield* TestClock.setTime(99);
					yield* r.due(99);
					expect(w.controls.loads).toBe(loads);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toEqual([]);
					yield* TestClock.setTime(100);
					yield* r.due(100);
					yield* r.due(100);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toMatchObject([
						{body: {after: A, process: B}},
					]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, ignore invalid step output: malformed fresh data consumes the same three-attempt allowance",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				w.controls.invalid = true;

				for (let n = 0; n < 3; n++) {
					yield* Effect.gen(function* () {
						const answer = yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input())));

						if (n < 2) {
							expect(Exit.isFailure(answer)).toBe(true);
						} else {
							expect(answer).toMatchObject({
								_tag: "Success",
								value: {_tag: "refused", why: "dead"},
							});
						}

						expect(yield* inbox).toEqual([]);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();

					if (n < 2) {
						yield* recover(w);
					}
				}
			}),
	);

	it.effect(
		"p80 plant, count refusal or a failed Cmd as poison: only fresh preparation failures consume attempts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;

					for (let n = 0; n < 4; n++) {
						expect(yield* r.msg(w.input("refusal", {type: "refuse"}))).toMatchObject({
							_tag: "refused",
							why: "bad_msg",
						});
					}

					yield* r.msg(w.input("work", {type: "work"}));
					expect(yield* dead).toEqual([]);
					expect((yield* lives).filter((row) => row._tag === "exited")).toEqual([]);
					expect(w.controls.cmds).toBe(1);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 p55 plant, skip or dead-letter saved input: failure preserves the inbox and checkpoint",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProgramRunner.use((r) => r.msg(w.input("good", {type: "add", n: 7}))).pipe(
					Effect.provide(w.layer()),
				);
				let before: unknown;
				yield* Effect.gen(function* () {
					const saved = yield* ProcessStore.use((s) => s.load);
					before = saved;
					yield* accepted("saved-bad", {type: "add", n: 9}, saved);
				}).pipe(Effect.provide(w.layer()));
				w.controls.savedThrows = true;
				w.reopen();
				yield* Effect.gen(function* () {
					yield* failed(ProgramRunner.use((r) => r.open("wake")));
					// P34 amendment: inside the restart budget the wake exits, waits and writes no down.
					expect((yield* lives).filter((row) => row._tag === "down")).toEqual([]);
					expect((yield* lives).filter((row) => row._tag === "exited")).toMatchObject([
						{body: {process: A, why: "saved_letter"}},
					]);
					expect(w.alarms.at(-1)).toBe(policy.backoff.minMs);
					expect((yield* inbox).map((row) => row.id)).toEqual(["good", "saved-bad"]);
					expect(yield* ProcessStore.use((s) => s.load)).toEqual(before);
					expect(yield* dead).toEqual([]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, resend wakes down or moves until: no load, step or start before saved deadline",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProcessStore.use((s) => s.load).pipe(
					Effect.flatMap((saved) => accepted("saved", {type: "add", n: 1}, saved)),
					Effect.provide(w.layer()),
				);
				w.controls.savedThrows = true;
				yield* ProgramRunner.use((r) => failed(r.open("wake"))).pipe(Effect.provide(w.layer()));
				const loads = w.controls.loads;
				const rows = yield* lives.pipe(Effect.provide(w.manager()));
				// P34 amendment: one saved failure is inside the restart budget, so it writes no down;
				// the saved wait is the backoff's.
				expect(rows.filter((row) => row._tag === "down")).toEqual([]);
				const until = w.alarms.at(-1);
				expect(until).toBe(policy.backoff.minMs);
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;

					for (let n = 0; n < 3; n++) {
						yield* Effect.exit(r.msg(w.input()));
					}

					expect(w.controls.loads).toBe(loads);
					expect(w.controls.steps).toEqual([]);
					expect(yield* lives).toEqual(rows);
					expect(w.alarms.at(-1)).toBe(until);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"wake probe plant, constructor means crash: idle or absent marker keeps the live ID",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;

				for (const mark of [false, true]) {
					if (mark) {
						yield* ProcessStore.use((s) => s.activity(Activity.cases.idle.make({process: A}))).pipe(
							Effect.provide(w.layer()),
						);
					}

					w.reopen();
					yield* Effect.gen(function* () {
						yield* ProgramRunner.use((r) => r.open("wake"));
						expect(yield* ProcessManager.use((p) => p.info)).toMatchObject([{process: A}]);
						expect(
							(yield* lives).filter((row) => ["exited", "restarted"].includes(row._tag)),
						).toEqual([]);
					}).pipe(Effect.provide(w.layer()));
				}
			}),
	);

	it.effect(
		"wake probe plant, startup-only handler: caught throw exits before runner reconstruction",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					yield* failed(r.msg(w.input()));
					expect(yield* ProcessManager.use((p) => p.isLive(A))).toBe(false);
					expect((yield* lives).filter((row) => row._tag === "exited")).toHaveLength(1);
					expect(w.alarms.at(-1)).toBe(100);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 H3 plant, reuse rejected model or old build: explicit restart calls new init and folds without old Cmds",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProgramRunner.use((r) => r.msg(w.input("accepted", {type: "add", n: 7}))).pipe(
					Effect.provide(w.layer()),
				);
				yield* ProcessStore.use((s) =>
					s.save({
						saved: {v: 999, build: BUILD, after: 0, model: {rejected: true}},
						turn: null,
						cmds: [
							{
								id: `${A}/1/0`,
								cmd: work({}),
								state: "dispatched",
								parent: null,
								traceId: from().traceId,
								build: BUILD,
							},
						],
					}),
				).pipe(Effect.provide(w.layer()));
				w.controls.build = "build-b";
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(r.restart, "P34 trusted Restart operation is missing").toBeTypeOf("function");
					yield* r.restart({id: "restart-explicit", build: "build-b"});
					expect(w.controls.init).toContainEqual({build: "build-b", loaded: null});
					expect((yield* r.open("new")).view).toEqual({count: 7, replies: 0});
					expect(w.controls.cmds).toBe(0);
					expect((yield* inbox).map((row) => row.id)).toEqual(["accepted"]);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toMatchObject([
						{body: {after: A, build: "build-b"}},
					]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);
});

describe("P34 amendment, 2026-11-08: down only at the brake; a program's own maxDeliveries", () => {
	const decodeUntil = Schema.decodeUnknownSync(Schema.Struct({until: Schema.Int}));
	const restartedRows = lives.pipe(
		Effect.map((rows) => rows.filter((row) => row._tag === "restarted").length),
	);

	it("p80 plant, down after one crash: the runner writes down only on the crash that trips the brake, and no successor starts before its wait", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: policy.intensity + 1}), fc.uuid(), (crashes, id) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world();
						yield* w.boot;
						let now = 0;

						for (let n = 1; n <= crashes; n++) {
							// A different letter each time: each crash is one fresh throw, never a dead letter.
							yield* ProgramRunner.use((r) => failed(r.msg(w.input(`poison-${n}-${id}`)))).pipe(
								Effect.provide(w.layer()),
							);
							const rows = yield* lives.pipe(Effect.provide(w.manager()));
							const downs = rows.filter((row) => row._tag === "down");
							const deadline = w.alarms.at(-1);
							expect(deadline, `crash ${n} schedules its successor`).toBeTypeOf("number");

							if (n <= policy.intensity) {
								expect(downs, `crash ${n} is inside the restart budget`).toEqual([]);
								const wait = Math.min(policy.backoff.minMs * 2 ** (n - 1), policy.backoff.maxMs);
								expect(deadline, "the saved wait is the backoff").toBe(now + wait);
							} else {
								expect(downs, `crash ${n} trips the brake`).toHaveLength(1);
								expect(deadline).toBe(decodeUntil(downs[0]!.body).until);
							}

							const before = yield* restartedRows.pipe(Effect.provide(w.manager()));
							w.reopen();
							yield* TestClock.setTime(deadline! - 1);
							yield* ProgramRunner.use((r) => Effect.exit(r.due(deadline! - 1))).pipe(
								Effect.provide(w.layer()),
							);
							expect(
								yield* restartedRows.pipe(Effect.provide(w.manager())),
								"no successor before the wait",
							).toBe(before);
							w.reopen();
							yield* TestClock.setTime(deadline!);
							yield* ProgramRunner.use((r) => r.due(deadline!)).pipe(Effect.provide(w.layer()));
							expect(
								yield* restartedRows.pipe(Effect.provide(w.manager())),
								"one successor when the wait is due",
							).toBe(before + 1);
							now = deadline!;
						}

						const downs = (yield* lives.pipe(Effect.provide(w.manager()))).filter(
							(row) => row._tag === "down",
						);
						expect(downs).toHaveLength(crashes > policy.intensity ? 1 : 0);
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 decision check: one crash inside the budget wrote a down fact.
				examples: [
					[1, "00000000-0000-4000-8000-000000000271"],
					[policy.intensity + 1, "00000000-0000-4000-8000-000000000271"],
				],
			},
		);
	});

	it("p80 T319 plant, ignore the program's limit or use successor identity: a letter moves to dead at its limit with its process's started identity", async () => {
		const limit = fc.option(fc.integer({min: 1, max: 32}), {nil: undefined});
		const {maxDeliveries: _default, ...rest} = policy;
		await fc.assert(
			fc.asyncProperty(limit, limit, fc.uuid(), (program, wiring, id) =>
				Effect.runPromise(
					Effect.gen(function* () {
						// A wide budget, so every generated limit fits under the restart intensity.
						const wide: WiringPolicy = {
							...rest,
							intensity: 32,
							periodMs: 30_000,
							...(wiring === undefined ? {} : {maxDeliveries: wiring}),
						};
						const expected = program ?? wiring ?? 3;
						const w = world(false, false, null, {program, policy: wide});
						yield* w.boot;
						const letter = w.input(id);

						for (let n = 1; n < expected; n++) {
							yield* ProgramRunner.use((r) => failed(r.msg(letter))).pipe(
								Effect.provide(w.layer()),
							);
							w.reopen();
							yield* recover(w);
						}

						yield* Effect.gen(function* () {
							const r = yield* ProgramRunner;
							expect(yield* r.msg(letter), `throw ${expected} is the last`).toMatchObject({
								_tag: "refused",
								why: "dead",
							});
							expect(yield* r.msg(letter)).toMatchObject({_tag: "refused", why: "dead"});
							expect(w.controls.steps).toEqual(Array.from({length: expected}, () => id));
							const errors = Array.from({length: expected}, (_, n) =>
								n === 1 ? "RangeError" : "TypeError",
							);
							const rows = yield* dead;
							expect(rows.map((row) => row.body)).toMatchObject([
								{m: id, tries: expected, limit: expected, errors},
							]);
							const process = PIDS[expected - 1]!;
							const started = (yield* lives)
								.filter((row) => row._tag === "started" && row.by === brain().by)
								.map((row) => Schema.decodeUnknownSync(ProcessFact.cases.started)(valueFor(row)))
								.find((fact) => fact.process === process);
							expect(started).toBeDefined();
							expect(rows[0]!.stream).toBe(`${process}/dead`);
							expect(rows[0]!.body).toMatchObject({
								process: started!.process,
								program: started!.program,
								name: started!.name,
							});
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// Each order case once: neither, program only, wiring only, both.
				examples: [
					[undefined, undefined, "00000000-0000-4000-8000-000000000271"],
					[5, undefined, "00000000-0000-4000-8000-000000000271"],
					[undefined, 7, "00000000-0000-4000-8000-000000000271"],
					[2, 9, "00000000-0000-4000-8000-000000000271"],
				],
			},
		);
	});
});
