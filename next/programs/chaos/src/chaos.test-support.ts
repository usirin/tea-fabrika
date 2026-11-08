// P17b, next/. Only platforms and outside fault answers are controlled here.
// Scheduling, loading, checking, stepping and persistence are the real library code.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import type * as App from "@kampus/libfabrika";
import {
	Mailbox,
	Owner,
	Recipient,
	ProcessManager,
	ProcessStore,
	Start as ProcessStart,
	Writer,
	type History,
} from "@kampus/libfabrika/coordination";
import {
	Doorbell,
	Archive,
	Chain,
	Ledger,
	LedgerTransaction,
	RecordManager,
	SpanSink,
	type LedgerError,
	type Sql,
} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Option, Schema, Stream} from "effect";
import * as fc from "fast-check";

export const SEED = 119120;
export const LAW = {seed: SEED, numRuns: 60};
const LIBRARY = "@kampus/libfabrika";
const PROGRAM = "./program.ts";
const COUNTER = "@kampus/counter";
const NOTES = "@kampus/notes";

// P13 type-only contract. There is no notes reducer or audit encoder here.
export type NotesSave = {
	readonly type: "save";
	readonly value: {
		readonly note: string;
		readonly base: number;
		readonly body: string;
		readonly how?: "pause" | "leave" | "done" | "kept";
		readonly from?: {readonly note: string; readonly version: number};
	};
};

// UUIDv7 fixtures, not an ID generator for the product. Every fixture is decoded by its schema.
export const fixtureId = (prefix: string, n: number): string => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	let bits = (1_800_000_000_000n << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n);
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = alphabet[Number(bits & 31n)] + suffix;
		bits >>= 5n;
	}
	return `${prefix}_${suffix}`;
};
export const CHAOS_PROCESS = fixtureId("process", 1);
export const TARGET_PROCESS = fixtureId("process", 2);
export const target = fc.record({
	program: fc.constantFrom("counter" as const, "notes" as const),
	name: fc.integer({min: 1, max: 100}).map((n) => `target:${n}`),
	process: fc.integer({min: 2, max: 100}).map((n) => fixtureId("process", n)),
	client: fc.integer({min: 1, max: 100}).map((n) => `client:${n}`),
	key: fc.integer({min: 1, max: 100}).map((n) => `SHA256:public-${n}`),
});
export const start = fc.record({
	id: fc.integer({min: 1, max: 100}).map((n) => fixtureId("chaos", n)),
	seed: fc.integer({min: 1, max: 0xffffffff}),
	target,
	most: fc.integer({min: 1, max: 8}),
	gap: fc.integer({min: 1, max: 1000}),
});
export const timing = fc.record({
	from: fc.integer({min: 0, max: 1_000_000}),
	late: fc.array(fc.integer({min: 0, max: 10_000}), {minLength: 8, maxLength: 8}),
});

// These imports are deferred so missing exports fail a collected law, never its collection.
export const library = Effect.fn("chaos.test.library")(function* () {
	// oxlint-disable-next-line fabrika/no-promises -- edge: ESM exposes dynamic loading as a Promise
	return yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: ESM import itself returns a Promise
		try: (): Promise<typeof App> => import(LIBRARY),
		catch: (e) => e,
	});
});
export const program = Effect.fn("chaos.test.program")(function* () {
	// oxlint-disable-next-line fabrika/no-promises -- edge: ESM exposes dynamic loading as a Promise
	return yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: ESM import itself returns a Promise
		try: (): Promise<typeof import("./program.ts")> => import(PROGRAM),
		catch: (e) => e,
	});
});

/** Find typed saved records without requiring the builder to choose test-owned state field names. */
export const records = <A>(schema: Schema.Decoder<A>, value: unknown): ReadonlyArray<A> => {
	const found = Schema.decodeUnknownOption(schema)(value);
	if (Option.isSome(found)) return [found.value];
	if (typeof value !== "object" || value === null) return [];
	return Object.values(value).flatMap((child) => records(schema, child));
};

export type FireMode = "fired" | "refused" | "off" | "failed" | "interrupted";
type SeenFire = {
	readonly tick: string;
	readonly fault: App.Fault;
	readonly model: unknown;
	readonly view: unknown;
};
const FROM = {
	by: "SHA256:test-client",
	for: "person",
	sentAt: "writer clock",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "chaos-test",
};

export const makeWorld = Effect.fn("chaos.test.makeWorld")(function* (
	options: {
		readonly target?: "counter" | "notes";
		readonly mode?: FireMode;
		readonly checkMode?: "off" | "failed";
		readonly from?: number;
		readonly before?: (typeof App.StepFault)["Service"]["before"];
		readonly successors?: ReadonlyArray<string>;
	} = {},
) {
	const A = yield* library();
	const {chaos} = yield* program();
	// oxlint-disable-next-line fabrika/no-promises -- edge: ESM exposes dynamic loading as a Promise
	const {counter}: {counter: App.Program} = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: ESM import itself returns a Promise
		try: () => import(COUNTER),
		catch: (e) => e,
	});
	let notes: App.Program | undefined;
	if (options.target === "notes") {
		// oxlint-disable-next-line fabrika/no-promises -- edge: P13's actual ESM module must exist at runtime
		const loaded: {notes: App.Program} = yield* Effect.tryPromise({
			// oxlint-disable-next-line fabrika/no-promises -- edge: P13's actual ESM module must load
			try: () => import(NOTES),
			catch: (e) => e,
		});
		notes = loaded.notes;
	}
	const home = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
		(path) => Effect.sync(() => rmSync(path, {recursive: true, force: true})),
	);
	const databases: DatabaseSync[] = [];
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const db of databases) if (db.isOpen) db.close();
		}),
	);
	const open = (name: string) => {
		const db = new DatabaseSync(join(home, name));
		databases.push(db);
		return db;
	};
	let ledgerDb = open("ledger.db");
	let chaosDb = open("chaos.db");
	let targetDb = open("target.db");
	let traceDb = open("trace.db");
	let clock = options.from ?? 1000;
	let deadline: number | null = null;
	let targetDeadline: number | null = null;
	let count = 0;
	let processCount = 0;
	const fired: SeenFire[] = [];
	const builds = {chaos, counter, ...(notes === undefined ? {} : {notes})};
	const targetProgram = options.target ?? "counter";
	const targetName = `${targetProgram}:1`;
	const build = Effect.fn("chaos.test.buildWorld")(function* () {
		const partSql = new Map<string, Sql>();
		const recording = Layer.mergeAll(
			SpanSink.layer(nodeSql(traceDb), {object: CHAOS_PROCESS}),
			RecordManager.sql((name) => {
				let sql = partSql.get(name);
				if (sql === undefined) {
					sql = nodeSql(open(`record-${name.replaceAll("/", "_")}.db`));
					partSql.set(name, sql);
				}
				return sql;
			}, 1024 ** 3),
			Archive.memory,
		);
		const recorded = yield* Layer.build(recording);
		const recordManager = yield* RecordManager.pipe(Effect.provideContext(recorded));
		const ledger = Layer.mergeAll(
			Ledger.sql(nodeSql(ledgerDb), {reader: "chaos-laws"}),
			LedgerTransaction.layer(nodeSql(ledgerDb)),
		).pipe(Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})));
		const data = Mailbox.layer.pipe(Layer.provideMerge(ledger));
		const manager = ProcessManager.layer(
			{
				owner: Owner.cases.brain.make({}),
				recipient: Recipient.cases.process.make({process: fixtureId("process", 500)}),
				by: "SHA256:brain",
			},
			Effect.sync(() => {
				processCount++;
				return options.successors?.[processCount - 3] ?? fixtureId("process", processCount);
			}),
		).pipe(Layer.provide(ledger));
		const common = yield* Layer.build(data);
		const realLedger = yield* Ledger.pipe(Effect.provideContext(common));
		const managed = yield* Layer.build(manager);
		const processes = yield* ProcessManager.pipe(Effect.provideContext(managed));
		if (processCount === 0) {
			yield* processes.start(
				ProcessStart.cases.first.make({
					id: "start:chaos",
					name: "chaos:1",
					code: {program: "chaos", hash: "chaos-test"},
				}),
				FROM,
			);
			yield* processes.start(
				ProcessStart.cases.first.make({
					id: "start:target",
					name: targetName,
					code: {program: targetProgram, hash: "chaos-test"},
				}),
				FROM,
			);
		}
		const mail = yield* Mailbox.pipe(Effect.provideContext(common));
		const checked = (name: string) =>
			Layer.succeed(A.CheckedWriter, {
				append: (input: App.Incoming) => mail.send(name, input.id, input.envelope.input, FROM),
				commit: () => Effect.die("these programs have no fact writes"),
				own: () => Effect.die("these programs have no fact writes"),
			});
		const chaosStore = ProcessStore.layer(nodeSql(chaosDb), {process: CHAOS_PROCESS}).pipe(
			Layer.provide(data),
		);
		const stored = yield* Layer.build(chaosStore);
		const store = yield* ProcessStore.pipe(Effect.provideContext(stored));
		let chaosRunner: (typeof App.ProgramRunner)["Service"];
		const handler = Effect.fn("chaos.test.fire")(function* (fault: App.Fault, tick: string) {
			yield* Effect.annotateCurrentSpan({
				"fab.nemesis.tick": tick,
				"fab.nemesis.fault": fault._tag,
			});
			const saved = yield* store.load;
			const shown = yield* chaosRunner
				.open("fire-observer")
				.pipe(Effect.provideContext(chaosContext));
			fired.push({tick, fault, model: saved?.saved.model, view: shown.view});
			if (options.mode === "interrupted") return yield* Effect.interrupt;
			if (options.mode === "failed") return yield* Effect.die(new Error("planted handler failure"));
			if (options.mode === "off") return yield* new A.NemesisError({why: "off"});
			return options.mode === "refused"
				? A.Fired.cases.refused.make({why: "not_granted"})
				: A.Fired.cases.fired.make({});
		});
		const nemesis = Layer.effect(
			A.Nemesis,
			Effect.gen(function* () {
				const real = yield* A.Nemesis;
				return {...real, fire: handler};
			}),
		).pipe(Layer.provide(A.Nemesis.layer), Layer.provide(data));
		const loader = A.ProgramLoader.layer(builds, {
			now: () => Effect.succeed(Outcome.ok(clock)),
			fire: (raw) =>
				Effect.gen(function* () {
					const cmd = yield* Schema.decodeUnknownEffect(
						Schema.Struct({tick: A.Asked.fields.tick, fault: A.Fault}),
					)(raw);
					return yield* A.Nemesis.use((n) => n.fire(cmd.fault, cmd.tick)).pipe(
						Effect.map(Outcome.ok),
						Effect.catch((error) =>
							Effect.succeed(Outcome.err(Schema.TaggedStruct(error.why, {}).make({}))),
						),
					);
				}),
			check: (raw) =>
				Effect.gen(function* () {
					if (options.checkMode === "off")
						return Outcome.err(Schema.TaggedStruct("off", {}).make({}));
					if (options.checkMode === "failed")
						return yield* Effect.die(new Error("planted check failure"));
					const cmd = yield* Schema.decodeUnknownEffect(Schema.Struct({target: A.Target}))(raw);
					return Outcome.ok(yield* A.Nemesis.use((n) => n.check(cmd.target)));
				}),
		}).pipe(Layer.provide(nemesis), Layer.provide(recording));
		// P34's options are a type-only stand-in until its declaration lands. The function is real.
		type Supervised = (
			descriptor: App.Descriptor,
			options: {
				readonly recovery: {readonly sql: Sql; readonly name: string; readonly capacity: number};
			},
		) => ReturnType<typeof App.ProgramRunner.layer>;
		const supervised: Supervised = A.ProgramRunner.layer;
		const runner = (name: string, process: string, which: string, storage: DatabaseSync) =>
			supervised(
				{
					id: process,
					name,
					program: which,
					build: "chaos-test",
					owner: Writer.cases.person.make({key: FROM.by, for: FROM.for}),
				},
				{recovery: {sql: nodeSql(storage), name, capacity: 1024 ** 3}},
			).pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						loader,
						ProcessStore.layer(nodeSql(storage), {process}),
						checked(name),
						Layer.succeed(A.WatcherManager, {publish: () => Effect.void}),
						Layer.succeed(A.Alarm, {
							set: (at) =>
								Effect.sync(() => {
									if (which === "chaos") deadline = at;
									else targetDeadline = at;
								}),
						}),
						A.Recording.layer.pipe(Layer.provideMerge(recording)),
						manager,
						Layer.succeed(A.StepFault, {before: options.before ?? (() => Effect.void)}),
					).pipe(Layer.provideMerge(data)),
				),
			);
		const chaosContext = yield* Layer.build(runner("chaos:1", CHAOS_PROCESS, "chaos", chaosDb));
		chaosRunner = yield* A.ProgramRunner.pipe(Effect.provideContext(chaosContext));
		const targetContext = yield* Layer.build(
			runner(targetName, TARGET_PROCESS, targetProgram, targetDb),
		);
		const targetRunner = yield* A.ProgramRunner.pipe(Effect.provideContext(targetContext));
		return {
			chaosRunner,
			targetRunner,
			chaosContext,
			targetContext,
			mail,
			store,
			processes,
			ledger: realLedger,
			recordManager,
		};
	});
	let live = yield* build();
	const deliver = Effect.fn("chaos.test.deliver")(function* (
		runner: (typeof App.ProgramRunner)["Service"],
		input: unknown,
		id = fixtureId("input", ++count),
	) {
		return yield* runner.msg({
			id,
			envelope: {
				id,
				by: Writer.cases.person.make({key: FROM.by, for: FROM.for}),
				arrivedAt: clock,
				input,
			},
			sentAt: FROM.sentAt,
			seen: 0,
			span: {traceId: FROM.traceId, spanId: "00f067aa0ba902b7"},
		});
	});
	return {
		home,
		targetName,
		fired,
		start: (value: unknown) =>
			deliver(live.chaosRunner, {type: "start", value}).pipe(
				Effect.provideContext(live.chaosContext),
			),
		stop: () =>
			deliver(live.chaosRunner, {type: "stop"}).pipe(Effect.provideContext(live.chaosContext)),
		send: (_program: "counter" | "notes", input: unknown, id?: string) =>
			deliver(live.targetRunner, input, id).pipe(Effect.provideContext(live.targetContext)),
		due: Effect.fn("chaos.test.due")(function* (at: number) {
			clock = at;
			yield* live.chaosRunner.due(at).pipe(Effect.provideContext(live.chaosContext));
		}),
		wake: () => deadline,
		targetWake: () => targetDeadline,
		model: Effect.suspend(() => Effect.map(live.store.load, (saved) => saved?.saved.model)),
		view: Effect.suspend(() =>
			live.chaosRunner.open("inspect").pipe(Effect.provideContext(live.chaosContext)),
		),
		targetView: Effect.suspend(() =>
			live.targetRunner.open("inspect").pipe(Effect.provideContext(live.targetContext)),
		),
		targetDue: (at: number) =>
			live.targetRunner.due(at).pipe(Effect.provideContext(live.targetContext)),
		processes: Effect.suspend(() => live.processes.info),
		jobRows: Effect.suspend(() =>
			Stream.runCollect(live.recordManager.read(Chain.cases.job.make({process: CHAOS_PROCESS}))),
		),
		entries: (name: string) => Stream.runCollect(live.ledger.read(name, 0)),
		letters: (name: string): Effect.Effect<ReadonlyArray<History>, LedgerError> =>
			Stream.runCollect(live.mail.read(name, 0)),
		reopen: Effect.suspend(() =>
			Effect.gen(function* () {
				for (const db of databases) if (db.isOpen) db.close();
				ledgerDb = open("ledger.db");
				chaosDb = open("chaos.db");
				targetDb = open("target.db");
				traceDb = open("trace.db");
				live = yield* build();
				yield* live.chaosRunner.open("reopened").pipe(Effect.provideContext(live.chaosContext));
			}),
		),
	};
});
