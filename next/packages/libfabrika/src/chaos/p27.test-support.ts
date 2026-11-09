// P27a, next/. Only storage and outside handles are controlled here.
// The runner, journal, live handler, checker and recovery always come from production.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import type {Context} from "effect";
import {Arbitrary, Effect, Layer, Schema, Stream, type FileSystem, type Path} from "effect";
import {
	Alarm,
	CheckedWriter,
	ProgramLoader,
	Recording,
	WatcherManager,
	type Fact,
	type Incoming,
} from "../app/entry.ts";
import {Program} from "../app/program.ts";
import {ProgramRunner, type Descriptor} from "../app/runner.ts";
import {Mailbox, type From} from "../coordination/mailbox.ts";
import {ProcessStore} from "../coordination/process-store.ts";
import {SessionManager, Writer, type Session} from "../coordination/session-manager.ts";
import {Archive} from "../data/archive.ts";
import {Id, IdGenerator, InputId, type IdSchema} from "../data/id.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {type Entry, lineFor} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {type Sql} from "../data/referee.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Chain, type SpanRow} from "../data/trace.ts";

export const SEED = 119120;
// At least 100 runs, strings/arrays up to 100. Large histories draw 257..1025 rows separately.
export const LAW = {arbitrary: {seed: SEED, runs: 100, size: 100}};
export const forSchema = Effect.fn("p27.test.forSchema")(function* <A, E, R>(
	schema: Schema.Schema<A>,
	property: (value: A) => Effect.Effect<unknown, E, R>,
) {
	const result = yield* Arbitrary.checkEffect(
		Arbitrary.schema(schema),
		(value) => property(value).pipe(Effect.as(true)),
		LAW.arbitrary,
	);
	const failure = Arbitrary.formatCheckFailure(result);
	if (failure !== undefined) return yield* Effect.die(new Error(failure));
});
export const Positive = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 100}));
export const TestProcessId = Id.make("process");
export const TestInstanceId = Id.make("instance");
type RunnerFailure = Effect.Error<ReturnType<(typeof ProgramRunner)["Service"]["msg"]>>;
export const FROM: From = {
	by: "SHA256:brain",
	for: "test-owner",
	sentAt: "2026-11-08T01:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "p27-test",
};
export class TestFailure extends Schema.TaggedError<TestFailure>()("P27TestFailure", {
	why: Schema.String,
}) {}

// Type-only contracts until P17b/P24 land. No replacement implementation lives here.
export type Target = {
	readonly program: "counter" | "notes";
	readonly name: string;
	readonly process: string;
	readonly client: string;
	readonly key: string;
};
export type Fault =
	| (Readonly<Record<"_tag", "drop_socket" | "drop_answer">> & {readonly client: string})
	| (Readonly<Record<"_tag", "delay">> & {readonly client: string; readonly ms: number})
	| (Readonly<Record<"_tag", "abort">> & {
			readonly target: "gateway" | "process" | "project";
			readonly name: string;
	  })
	| Readonly<Record<"_tag", "abort_all">>
	| (Readonly<Record<"_tag", "fail_step">> & {readonly pid: string; readonly times: 1 | 3})
	| (Readonly<Record<"_tag", "revoke_key">> & {readonly client: string; readonly key: string});
export type Request = {
	readonly id: string;
	readonly tick: InputId;
	readonly fault: Fault;
	readonly target: Target;
};
export type Hit =
	| (Readonly<Record<"_tag", "client">> & {
			readonly client: string;
			readonly session: string;
			readonly gateway: string;
			readonly key: string;
	  })
	| (Readonly<Record<"_tag", "object">> & {
			readonly target: "gateway" | "process" | "project";
			readonly name: string;
			readonly instance: string;
			readonly process: string | null;
	  })
	| (Readonly<Record<"_tag", "step">> & {
			readonly name: string;
			readonly process: string;
			readonly letter: InputId;
			readonly times: 1 | 3;
	  });
export type HandlerContext = {
	readonly cmd: string;
	readonly process: string;
	readonly name: string;
	readonly build: string;
	readonly parent: string | null;
	readonly traceId: string;
};
export type Reply = {readonly process: string; readonly cmd: string; readonly outcome: Schema.Json};
export type FaultError = Readonly<Record<"_tag", string>> & {
	readonly why: "bad_input" | "bad_row" | "storage" | "unreachable" | "conflict";
};
export type Evidence = {
	readonly experiment: string;
	readonly through: number;
	readonly entries: ReadonlyArray<Entry>;
	readonly spans: ReadonlyArray<SpanRow>;
};
export type Report = Readonly<Record<"_tag", "complete" | "incomplete" | "broken">> & {
	readonly rows: ReadonlyArray<{
		readonly tick: string;
		readonly fault: Fault;
		readonly hits: ReadonlyArray<Hit>;
		readonly asked: {
			readonly stream: string;
			readonly id: string;
			readonly rev: number;
			readonly arrivedAt: number;
		};
		readonly did: unknown;
		readonly spans: ReadonlyArray<unknown>;
		readonly errors: ReadonlyArray<string>;
		readonly facts: ReadonlyArray<unknown>;
		readonly recovery: Readonly<Record<"_tag", string>> & {readonly until?: number};
	}>;
	readonly issues?: ReadonlyArray<{readonly tick: string; readonly why: string}>;
};
export type Observation = {
	readonly tick: InputId;
	readonly hit: Hit;
	readonly consumed: Schema.Json | null;
	readonly outcome: Schema.Json;
	readonly span: {readonly process: string; readonly traceId: string; readonly spanId: string};
};
export type Journal = {
	readonly begin: (request: Request, context: HandlerContext) => Effect.Effect<void, FaultError>;
	readonly read: (tick: InputId) => Effect.Effect<Schema.Json | null, FaultError>;
	readonly observe: (raw: unknown) => Effect.Effect<void, FaultError>;
	readonly resume: Effect.Effect<void, FaultError>;
};
export type TargetService = {
	readonly resolve: (request: Request) => Effect.Effect<ReadonlyArray<Hit>, FaultError>;
	readonly apply: (request: Request, context: HandlerContext) => Effect.Effect<void, FaultError>;
	readonly cancel: (tick: InputId) => Effect.Effect<void, FaultError>;
};
export type History = {
	readonly read: (request: {
		readonly experiment: string;
		readonly chaos: string;
		readonly through: number;
	}) => Effect.Effect<Evidence, FaultError | LedgerError>;
};
export type NemesisService = {
	readonly fire: (
		fault: Fault,
		tick: InputId,
		context: HandlerContext,
	) => Effect.Effect<unknown, unknown>;
	readonly offers: (
		target: Target,
	) => Effect.Effect<
		ReadonlyArray<
			Readonly<Record<"_tag", string>> & {readonly fault: string; readonly why?: string}
		>,
		unknown
	>;
};
export type NemesisModule = {
	readonly Nemesis: Context.Service<NemesisService, NemesisService>;
	readonly Fault: Schema.Schema<Fault>;
	readonly Target: Schema.Schema<Target>;
	readonly FaultRequest: Schema.Schema<Request>;
	readonly FaultHit: Schema.Schema<Hit>;
	readonly Fired: Schema.Schema<Schema.Json>;
};
export type JournalModule = {
	readonly FaultJournal: Context.Service<Journal, Journal> & {
		readonly layer: (
			sql: Sql,
			wiring: {by: string; build: string},
		) => Layer.Layer<Journal, never, Ledger | IdGenerator>;
	};
	readonly Observation: Schema.Schema<Observation>;
};
export type HistoryModule = {
	readonly FaultHistory: Context.Service<History, History> & {
		readonly layer: Layer.Layer<History, never, Ledger | RecordManager>;
	};
	readonly explainFaults: (raw: unknown) => Effect.Effect<Report, FaultError>;
	readonly FaultReport: Schema.Schema<Report>;
};
export type LiveModule = {
	readonly LiveNemesis: {
		readonly layer: (options: {
			chaos: unknown;
			stage: string;
			ledger: string;
			process: Descriptor;
		}) => Layer.Layer<NemesisService, never, Journal | TargetService | History | Recording>;
	};
};
export type TargetModule = {readonly FaultTarget: Context.Service<TargetService, TargetService>};
export type EntryModule = {
	readonly PendingHandler: Schema.Schema<Readonly<Record<"_tag", "pending">>> & {
		readonly make: (input: Readonly<Record<string, never>>) => Readonly<Record<"_tag", "pending">>;
	};
	readonly HandlerReply: Schema.Schema<Reply>;
};
export type CompletionModule = {
	readonly completeHandler: (raw: unknown) => Effect.Effect<void, RunnerFailure, ProgramRunner>;
};
export type StepHook = {
	readonly before: (input: {
		process: string;
		name: string;
		letter: string;
		phase: "fresh" | "fold";
	}) => Effect.Effect<void>;
};
export type StepModule = {readonly StepFault: Context.Service<StepHook, StepHook>};
// Test-facing contracts for the plan's plain library handlers. Handles only do I/O.
export type StepLiveModule = {
	readonly LiveStepFault: {readonly layer: Layer.Layer<StepHook, never, Journal>};
};
export type GatewayReply = {
	readonly session: string;
	readonly request: InputId;
	readonly placing: {readonly rev: number; readonly pos: number};
	readonly payload: Schema.Json;
};
export type GatewayRules = {
	readonly arm: (request: Request, hit: Hit) => Effect.Effect<void, FaultError>;
	readonly outgoing: (reply: GatewayReply) => Effect.Effect<void, FaultError>;
	readonly due: (at: number) => Effect.Effect<void, FaultError>;
	readonly stop: (tick: InputId) => Effect.Effect<void, FaultError>;
};
export type GatewayModule = {
	readonly GatewayFault: Context.Service<GatewayRules, GatewayRules> & {
		readonly layer: (
			sql: Sql,
			io: {
				readonly now: () => number;
				readonly send: (reply: GatewayReply) => Effect.Effect<void, FaultError>;
				readonly close: (session: string) => Effect.Effect<void, FaultError>;
				readonly alarm: (at: number | null) => Effect.Effect<void, FaultError>;
				readonly observe: (raw: unknown) => Effect.Effect<void, FaultError>;
			},
		) => Layer.Layer<GatewayRules>;
	};
};
export type BuildCompiler = {
	readonly compile: (source: unknown) => Effect.Effect<unknown, unknown>;
};
export type BuildModule = {
	readonly build: (spec: {
		readonly root: string;
		readonly out: string;
		readonly programs: ReadonlyArray<{name: string; package: string; export: string}>;
		readonly windows: ReadonlyArray<{route: string; entry: string}>;
		readonly chaos: unknown;
	}) => Effect.Effect<
		{readonly brain: string; readonly programs: ReadonlyArray<{name: string; hash: string}>},
		unknown,
		FileSystem.FileSystem | Path.Path | BuildCompiler
	>;
};
export type CompilerModule = {
	readonly BuildCompiler: Context.Service<BuildCompiler, BuildCompiler> & {
		readonly layer: Layer.Layer<BuildCompiler>;
	};
};

/** A deferred production import fails a collected law with the missing export's name. */
export const production = Effect.fn("p27.test.production")(function* <A>(
	path: string,
	name: string,
) {
	const url = new URL(path, import.meta.url).href;
	// oxlint-disable-next-line fabrika/no-promises -- edge: ESM loading returns a Promise
	const module: A = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: ESM loading returns a Promise
		try: () => import(/* @vite-ignore */ url),
		catch: () => new TestFailure({why: `red: missing export ${name}`}),
	});
	if (!Reflect.has(Object(module), name))
		return yield* new TestFailure({why: `red: missing export ${name}`});
	return module;
});

export const request = Effect.fn("p27.test.request")(function* (fault: Fault, target: Target) {
	const {FaultRequest} = yield* production<NemesisModule>("../app/nemesis.ts", "FaultRequest");
	const {ChaosId}: {ChaosId: IdSchema<"chaos">} = yield* production("../app/nemesis.ts", "ChaosId");
	const ids = yield* IdGenerator;
	// Schema generation does not manufacture TypeID strings. Use the installed shared generator.
	const id = yield* ids.next(ChaosId);
	const tick = yield* ids.next(InputId);
	return yield* Schema.decodeUnknownEffect(FaultRequest)({id, tick, fault, target});
});

/** Real SQLite with cuts before/after a chosen write, and real close/open. */
export const disk = Effect.fn("p27.test.disk")(function* (home: string, name: string) {
	let db = new DatabaseSync(join(home, name));
	let backend = nodeSql(db);
	const cut = {at: -1, after: false, writes: 0};
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			if (db.isOpen) db.close();
		}),
	);
	const sql: Sql = {
		exec: (query, ...args) => {
			const write = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query);
			const fail = write && cut.writes++ === cut.at;
			// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- The synchronous Sql edge throws; the real storage service must type it.
			if (fail && !cut.after) throw new Error("SQLITE_FULL planted before write");
			const answer = backend.exec(query, ...args);
			// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- The synchronous Sql edge throws after saving to model a lost reply.
			if (fail && cut.after) throw new Error("SQLITE_FULL planted after write");
			return answer;
		},
		transaction: (f) => backend.transaction(f),
		size: () => backend.size(),
	};
	return {
		sql,
		cut,
		db: () => db,
		reopen: Effect.sync(() => {
			db.close();
			db = new DatabaseSync(join(home, name));
			backend = nodeSql(db);
		}),
	};
});

export const faultWorld = Effect.fn("p27.test.faultWorld")(function* (
	options: {
		readonly pending?: boolean;
		readonly program?: string;
		readonly resolve?: ReadonlyArray<Hit>;
		readonly apply?: TargetService["apply"];
		readonly chaos?: unknown;
	} = {},
) {
	const N = yield* production<NemesisModule>("../app/nemesis.ts", "Nemesis");
	const J = yield* production<JournalModule>("../coordination/fault-journal.ts", "FaultJournal");
	const H = yield* production<HistoryModule>("./history.ts", "FaultHistory");
	const L = yield* production<LiveModule>("./live.ts", "LiveNemesis");
	const T = yield* production<TargetModule>("../workers/faults.ts", "FaultTarget");
	const E = yield* production<EntryModule>("../app/entry.ts", "PendingHandler");
	const C = yield* production<CompletionModule>("../app/runner.ts", "completeHandler");
	const home = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
		(path) => Effect.sync(() => rmSync(path, {recursive: true, force: true})),
	);
	const stores = {
		ledger: yield* disk(home, "ledger.db"),
		runner: yield* disk(home, "runner.db"),
		journal: yield* disk(home, "journal.db"),
		sessions: yield* disk(home, "sessions.db"),
		sink: yield* disk(home, "sink.db"),
	};
	const ids = yield* IdGenerator;
	const process = yield* ids.next(TestProcessId);
	const owner = Writer.cases.agent.make({key: "SHA256:owner", for: "test-owner"});
	const descriptor = {
		id: process,
		name: "chaos:1",
		program: options.program ?? "chaos",
		build: "p27-test",
		owner,
	};
	const calls: Array<{request: Request; context: HandlerContext; entries: ReadonlyArray<Entry>}> =
		[];
	const contexts: HandlerContext[] = [];
	const alarms: Array<number | null> = [];
	const cancelled: InputId[] = [];
	let experiment = "";
	const control = {flushFails: false};
	const recordDisks = new Map<string, Sql>();
	const recordDbs: DatabaseSync[] = [];
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const db of recordDbs) if (db.isOpen) db.close();
		}),
	);
	// Each record name has its own actual database. Rebuild opens the same files.
	const records = RecordManager.sql((name) => {
		const existing = recordDisks.get(name);
		if (existing !== undefined) return existing;
		const db = new DatabaseSync(join(home, `record-${name.replaceAll("/", "_")}.db`));
		recordDbs.push(db);
		const sql = nodeSql(db);
		recordDisks.set(name, sql);
		return sql;
	}, 64 * 1024);
	const data = () =>
		Ledger.sql(stores.ledger.sql, {reader: "p27"}).pipe(
			Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
		);
	const base = () =>
		Layer.mergeAll(
			data(),
			IdGenerator.layer,
			records,
			Archive.memory,
			SpanSink.layer(stores.sink.sql, {object: process}),
		);
	const faults = () =>
		Layer.mergeAll(
			J.FaultJournal.layer(stores.journal.sql, {by: FROM.by, build: FROM.build}),
			H.FaultHistory.layer,
			Layer.succeed(T.FaultTarget, {
				resolve: () => Effect.succeed(options.resolve ?? []),
				apply: (r, context) =>
					Effect.gen(function* () {
						const ledger = yield* Ledger;
						const entries = yield* Stream.runCollect(ledger.read(`${descriptor.name}/inbox`, 0));
						calls.push({request: r, context, entries});
						if (options.apply !== undefined) yield* options.apply(r, context);
					}).pipe(Effect.provide(data())),
				cancel: (tick) =>
					Effect.sync(() => {
						cancelled.push(tick);
					}),
			}),
			Layer.effect(
				Recording,
				Effect.gen(function* () {
					const real = yield* Recording;
					return {
						flush: Effect.suspend(() =>
							control.flushFails ? Effect.fail(new LedgerError({why: "storage"})) : real.flush,
						),
					};
				}),
			).pipe(Layer.provide(Recording.layer)),
		).pipe(Layer.provideMerge(base()));
	const {
		chaosFrom,
	}: {
		chaosFrom: (input: {
			flag: string;
			stage: string;
			ledger: string;
		}) => Effect.Effect<unknown, unknown>;
	} = yield* production("../build/chaos.ts", "chaosFrom");
	const chaos =
		options.chaos ??
		(yield* chaosFrom({flag: "throwaway", stage: "local", ledger: "throwaway-p27"}));
	const live = () =>
		L.LiveNemesis.layer({chaos, stage: "local", ledger: "throwaway-p27", process: descriptor}).pipe(
			Layer.provideMerge(faults()),
		);
	const Model = Schema.Struct({answers: Schema.Int});
	const fire = Cmd.make("fire", {
		input: Schema.Struct({fault: N.Fault, tick: InputId}),
		ok: N.Fired,
		err: ["NemesisError"],
	});
	const machine = Machine.make({
		model: Model,
		msg: Schema.Struct({type: Schema.Literal("ask"), fault: N.Fault, tick: InputId}),
		cmds: [fire],
		init: (saved) => [saved ?? {answers: 0}, []],
		update: {
			ask: (s, m) => [s, [fire({fault: m.fault, tick: m.tick})]],
			fire_ok: (s) => [{answers: s.answers + 1}, []],
			fire_err: (s) => [{answers: s.answers + 1}, []],
		},
	});
	const program = Program.make({
		name: descriptor.program,
		machine,
		state: {v: 1, upgrades: []},
		view: (s) => s,
		refuse: () => null,
		inputs: {ask: "Ask for a fault"},
		outputs: {},
		writes: {},
		wake: () => null,
	});
	const layer = (current: Descriptor = descriptor) =>
		ProgramRunner.layer(current).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					ProcessStore.layer(stores.runner.sql, {process: current.id}),
					Mailbox.layer,
					SessionManager.layer(stores.sessions.sql, () => Effect.succeed(owner), {
						input: () => false,
						fact: () => false,
					}),
					ProgramLoader.layer(
						{[program.name]: program},
						{
							fire: (cmd: {fault: Fault; tick: InputId}, context: HandlerContext) =>
								Effect.gen(function* () {
									contexts.push(context);
									if (options.pending) return E.PendingHandler.make({});
									const nemesis = yield* N.Nemesis;
									const answer = yield* nemesis.fire(cmd.fault, cmd.tick, context);
									return Schema.is(E.PendingHandler)(answer) ? answer : Outcome.ok(answer);
								}).pipe(Effect.provide(live())),
						},
					),
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarms.push(at);
							}),
					}),
					Layer.effect(
						CheckedWriter,
						Effect.gen(function* () {
							const ledger = yield* Ledger;
							const mail = yield* Mailbox;
							return {
								append: (i: Incoming) =>
									mail.send(descriptor.name, i.id, i.envelope.input, {
										...FROM,
										parent: i.envelope.id,
									}),
								commit: (id: string, _session: Session, stream: string, fact: Fact) =>
									ledger.append(stream, id, lineFor(FROM, fact)),
								own: (id: string, stream: string, fact: Fact) =>
									ledger.append(stream, id, lineFor(FROM, fact)),
							};
						}),
					),
				),
			).pipe(Layer.provideMerge(live())),
		);
	const read = (stream: string) =>
		Ledger.use((l) => Stream.runCollect(l.read(stream, 0))).pipe(Effect.provide(data()));
	const send = Effect.fn("p27.test.send")(function* (r: Request) {
		const runner = yield* ProgramRunner;
		const sessions = yield* SessionManager;
		yield* sessions.record({
			id: r.tick,
			by: owner,
			client: "test-client",
			process,
			name: "ask",
			personOnly: false,
			digest: JSON.stringify({type: "ask", fault: r.fault, tick: r.tick}),
			traceId: FROM.traceId,
			span: {traceId: FROM.traceId, spanId: "00f067aa0ba902b7"},
			arrivedAt: 1000,
		});
		yield* sessions.delivered(r.tick, process);
		return yield* runner.msg({
			id: r.tick,
			envelope: {
				id: r.tick,
				by: owner,
				arrivedAt: 1000,
				input: {type: "ask", fault: r.fault, tick: r.tick},
			},
			sentAt: FROM.sentAt,
			seen: 0,
			span: {traceId: FROM.traceId, spanId: "00f067aa0ba902b7"},
		});
	});
	return {
		home,
		descriptor,
		stores,
		calls,
		contexts,
		cancelled,
		alarms,
		control,
		layer,
		base,
		faults,
		live,
		send,
		read,
		fire: (r: Request) =>
			Effect.sync(() => {
				experiment = r.id;
			}).pipe(Effect.andThen(send(r)), Effect.provide(layer())),
		complete: (reply: unknown) => C.completeHandler(reply).pipe(Effect.provide(layer())),
		completeIn: (reply: unknown, current: Descriptor) =>
			C.completeHandler(reply).pipe(Effect.provide(layer(current))),
		journal: <A, E2>(f: (j: Journal) => Effect.Effect<A, E2>) =>
			J.FaultJournal.use(f).pipe(Effect.provide(faults())),
		reopen: Effect.forEach(Object.values(stores), (s) => s.reopen, {discard: true, concurrency: 1}),
		evidence: Effect.suspend(() =>
			H.FaultHistory.use((h) =>
				h.read({experiment, chaos: descriptor.name, through: Number.MAX_SAFE_INTEGER}),
			),
		).pipe(Effect.provide(faults())),
		permanent: RecordManager.use((r) =>
			Stream.runCollect(r.read(Chain.cases.job.make({process}))),
		).pipe(Effect.provide(records)),
		H,
		J,
		N,
		T,
		C,
		E,
	};
});

export const withIds = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.provide(IdGenerator.layer));
