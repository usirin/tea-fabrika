// P15a, next/. Test-owned P12/P34 edges, real programs, SQLite and real library services.
// No reload, migration, acceptance, rollback or retry policy lives in this file.
// Setup assumptions where the plan is silent: CodeInstaller.layer; descriptor `policy`/`restart`;
// canonical release bytes are JSON {program, worker, window, runtime, files}, files sorted by path.
import {mkdtempSync, rmSync} from "node:fs";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {
	Context,
	Deferred,
	Effect,
	Exit,
	Layer,
	Option,
	Result,
	Schema,
	Scope,
	Stream,
} from "effect";
import * as fc from "fast-check";
import {Mailbox} from "../coordination/mailbox.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {ProcessStore} from "../coordination/process-store.ts";
import {Owner, Recipient, Start} from "../coordination/process.ts";
import {disk, from, release, request, typeId} from "../coordination/reload.test-support.ts";
export {
	checks,
	code,
	disk,
	failure,
	from,
	release,
	request,
	typeId,
} from "../coordination/reload.test-support.ts";
import {Writer} from "../coordination/session-manager.ts";
import {Archive} from "../data/archive.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import type {Entry} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import type {Inspected, LoadedCode} from "./loader.ts";
import type {Step} from "./program.ts";
import {Program, ProgramDown, stepper} from "./program.ts";
import type {RestartRequest} from "./runner.ts";
import {Saved, type Upgraded} from "./state.ts";

export type Draw<A> = A extends fc.Arbitrary<infer T> ? T : never;
const PROCESS = "process_01j0000000e0080000000000002";
const TRACE = from.traceId;
const owner = Writer.cases.agent.make({key: "SHA256:owner", for: from.for});

/** The plan's answer-only P12 stand-in. Unexpected calls fail rather than recycle an answer. */
export const executionFixture = (answers: {
	readonly init: Step;
	readonly steps: ReadonlyArray<Step | ProgramDown>;
	readonly upgrade: Upgraded | ProgramDown;
	readonly inspect: Inspected | ProgramDown;
}) => {
	const calls: Array<{readonly method: string; readonly input: unknown}> = [];
	let next = 0;
	const answer = <A>(
		method: string,
		input: unknown,
		value: A | ProgramDown,
	): Effect.Effect<A, ProgramDown> =>
		Effect.suspend(() => {
			calls.push({method, input});
			return value instanceof ProgramDown ? Effect.fail(value) : Effect.succeed(value);
		});
	const step = (method: string, model: unknown, msg: unknown) =>
		Effect.suspend(() => {
			const value = answers.steps[next++];
			return answer(method, {model, msg}, value ?? new ProgramDown({why: "step"}));
		});
	const execution: LoadedCode["execution"] = {
		init: (saved) => answer("init", saved, answers.init),
		step: (model, msg) => step("step", model, msg),
		fold: (model, msg) => step("fold", model, msg),
		upgrade: (saved) => answer("upgrade", saved, answers.upgrade),
		inspect: (model) => answer("inspect", model, answers.inspect),
		reply: (cmd, outcome) => answer("reply", {cmd, outcome}, new ProgramDown({why: "step"})),
	};
	return {
		execution,
		calls: calls as ReadonlyArray<{readonly method: string; readonly input: unknown}>,
	};
};

/** The plan's P34 stand-in captures the request; successor creation remains P34's job. */
export const restartFixture = (answer: {readonly process: string}) => {
	const requests: Array<typeof RestartRequest.Type> = [];
	return {
		requests: requests as ReadonlyArray<typeof RestartRequest.Type>,
		restart: (req: typeof RestartRequest.Type) =>
			Effect.sync(() => {
				requests.push(req);
				return answer;
			}),
	};
};

export const Model = Schema.Struct({count: Schema.Int, replies: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("work"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("crash"), n: Schema.Int}),
]);
type Variant = {
	readonly factor: number;
	readonly start: number;
	readonly crash: boolean;
	readonly v: number;
	readonly program: string;
};
export const variant = fc.record({
	factor: fc.integer({min: 1, max: 5}),
	start: fc.integer({min: -20, max: 20}),
	crash: fc.boolean(),
	v: fc.constant(1),
	program: fc.constant("counter"),
});
export const operations = fc.array(
	fc.oneof(
		fc.record({
			kind: fc.constant("message"),
			id: fc.nat({max: 10}),
			n: fc.integer({min: -9, max: 9}),
		}),
		fc.record({kind: fc.constant("reload"), build: fc.nat({max: 2})}),
		fc.record({kind: fc.constant("reopen")}),
	),
	{minLength: 1, maxLength: 24},
);

const makeProgram = (spec: Variant) => {
	const work = Cmd.make("work", {
		input: Schema.Struct({n: Schema.Int}),
		ok: Schema.Literal(spec.factor),
		err: ["bad"],
	});
	const machine = Machine.make({
		model: Model,
		msg: Msg,
		cmds: [work],
		init: (loaded) => [loaded ?? {count: spec.start, replies: []}, []],
		update: {
			add: (m, msg) => [{...m, count: m.count + msg.n * spec.factor}, []],
			work: (m, msg) => [m, [work({n: msg.n})]],
			crash: (m, msg) => {
				if (spec.crash) throw new TypeError("p15-private-step-detail");
				return [{...m, count: m.count + msg.n * spec.factor}, []];
			},
			work_ok: (m, msg) => [{...m, replies: [...m.replies, msg.value]}, []],
			work_err: (m) => [m, []],
		},
	});
	return Program.make({
		name: spec.program,
		machine,
		state: {
			v: spec.v,
			upgrades: Array.from({length: spec.v - 1}, (_, i) => ({
				name: `shape-${i + 1}`,
				from: i + 1,
				run: (raw: unknown) => raw,
			})),
		},
		view: (m) => m,
		refuse: () => null,
		inputs: {add: "Add", work: "Work", crash: "Crash"},
		outputs: {},
		writes: {},
		wake: () => null,
	});
};

export const body = (entry: Entry) =>
	Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(entry.body);

/** Creates no reload policy. Every turn, journal, fact and placement is the real library's. */
export const world = async (
	specs: ReadonlyArray<Variant>,
	options: {
		readonly process?: string;
		readonly name?: string;
		readonly policy?: unknown;
		readonly executions?: ReadonlyMap<number, Parameters<typeof executionFixture>[0]>;
		readonly restart?: Parameters<typeof restartFixture>[0];
		readonly shared?: {
			readonly ledgerDisk: ReturnType<typeof disk>;
			readonly codeDisk: ReturnType<typeof disk>;
		};
	} = {},
) => {
	const {CodeRegistry} = await import("../coordination/code-registry.ts");
	const {CodeLoader, CodeInstaller} = await import("./loader.ts");
	const {ProgramRunner} = await import("./runner.ts");
	const folder = mkdtempSync("/tmp/p15.");
	const processDisk = disk(folder, "process");
	const ledgerDisk = options.shared?.ledgerDisk ?? disk(folder, "ledger");
	const codeDisk = options.shared?.codeDisk ?? disk(folder, "code");
	const sinkDisk = disk(folder, "sink");
	const recordDisk = disk(folder, "record");
	const process = options.process ?? PROCESS;
	const name = options.name ?? `${specs[0]!.program}:1`;
	const bundles = await Promise.all(
		specs.map((s, i) => release(s.program, JSON.stringify({...s, i}))),
	);
	const calls: Array<{method: string; build: string; input: unknown}> = [];
	const updates: Array<unknown> = [];
	const handlerGate = await Effect.runPromise(Deferred.make<void>());
	const handlerEntered = await Effect.runPromise(Deferred.make<void>());
	const stepGate = await Effect.runPromise(Deferred.make<void>());
	const stepEntered = await Effect.runPromise(Deferred.make<void>());
	const fault = {load: -1, pauseHandler: false, pauseStep: false, cut: "", flush: false};
	const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const ledger = Ledger.sql(ledgerDisk.sql, {reader: "p15-tests"}).pipe(Layer.provide(quiet));
	const transaction = LedgerTransaction.layer(ledgerDisk.sql).pipe(Layer.provide(quiet));
	let allocated = 0;
	const manager = ProcessManager.layer(
		{
			by: from.by,
			owner: Owner.cases.brain.make({}),
			recipient: Recipient.cases.process.make({process}),
		},
		Effect.sync(() => (allocated++ === 0 ? process : typeId("process", allocated + 1000))),
	).pipe(Layer.provide(transaction));
	const registry = Layer.effect(
		CodeRegistry,
		Effect.gen(function* () {
			const actual = yield* CodeRegistry;
			return {
				...actual,
				record: (...args) =>
					Effect.suspend(() => {
						if (fault.cut === "before:append") {
							fault.cut = "";
							return Effect.fail(new LedgerError({why: "unreachable"}));
						}
						return actual.record(...args).pipe(
							Effect.flatMap((value) => {
								if (fault.cut === "after:append") {
									fault.cut = "";
									return Effect.fail(new LedgerError({why: "unreachable"}));
								}
								return Effect.succeed(value);
							}),
						);
					}),
			};
		}),
	).pipe(
		Layer.provide(
			CodeRegistry.layer(codeDisk.sql, {brain: "SHA256:brain"}).pipe(Layer.provide(transaction)),
		),
	);
	const recordDisks = new Map<string, ReturnType<typeof disk>>();
	const records = RecordManager.sql(
		(name) => {
			const present = recordDisks.get(name);
			if (present !== undefined) return present.sql;
			const made = recordDisks.size === 0 ? recordDisk : disk(folder, `record-${recordDisks.size}`);
			recordDisks.set(name, made);
			return made.sql;
		},
		1024 * 1024 * 1024,
	);
	const openedDisks = () => [
		...new Set([
			processDisk,
			...(options.shared === undefined ? [ledgerDisk, codeDisk] : []),
			sinkDisk,
			recordDisk,
			...recordDisks.values(),
		]),
	];
	const monitors = Layer.mergeAll(
		SpanSink.layer(sinkDisk.sql, {object: process}),
		records,
		Archive.memory,
	);
	const base = Layer.mergeAll(ledger, registry, monitors, manager);
	const declarations = specs.map(makeProgram);
	const loaded = declarations.map((p) => Result.getOrThrow(stepper(p)));
	const fixtures = new Map<number, ReturnType<typeof executionFixture>>();
	const p34 = options.restart === undefined ? null : restartFixture(options.restart);
	const nodeCode = (i: number): LoadedCode => {
		const p = declarations[i]!;
		const pure = loaded[i]!;
		const bundle = bundles[i]!;
		const answers = options.executions?.get(i);
		const scripted = answers === undefined ? null : executionFixture(answers);
		if (scripted !== null) fixtures.set(i, scripted);
		const invoke = <A>(method: string, input: unknown, f: () => A) =>
			Effect.try({
				try: () => {
					calls.push({method, build: bundle.hash, input: structuredClone(input)});
					return f();
				},
				catch: (e) => (e instanceof ProgramDown ? e : new ProgramDown({why: "step"})),
			});
		return {
			program: p.name,
			code: {hash: bundle.hash, window: bundle.window},
			v: p.state.v,
			execution: scripted?.execution ?? {
				init: (saved) => invoke("init", saved, () => pure.init(saved)),
				step: (model, msg) =>
					Effect.gen(function* () {
						yield* Deferred.succeed(stepEntered, undefined);
						if (fault.pauseStep) yield* Deferred.await(stepGate);
						return yield* invoke("step", {model, msg}, () => pure.step(model, msg));
					}),
				fold: (model, msg) => invoke("fold", {model, msg}, () => pure.fold(model, msg)),
				upgrade: (saved) => Saved.upgradeEffect(saved, p.state, bundle.hash),
				inspect: (model) =>
					invoke("inspect", model, () => {
						const checked = Schema.decodeUnknownSync(p.machine.model)(model);
						return {model: checked, view: p.view.select(checked), wake: p.wake(checked)};
					}),
				reply: (cmd, outcome) =>
					invoke("reply", {cmd, outcome}, () => {
						const value = Schema.decodeUnknownSync(Schema.Literal(specs[i]!.factor))(
							Schema.decodeUnknownSync(Schema.Struct({value: Schema.Unknown}))(outcome).value,
						);
						return {type: "work_ok", cmd, value, at: 1794099600000};
					}),
			},
			handler: () =>
				Option.some((cmd) =>
					Effect.gen(function* () {
						calls.push({method: "handler", build: bundle.hash, input: cmd});
						yield* Deferred.succeed(handlerEntered, undefined);
						if (fault.pauseHandler) yield* Deferred.await(handlerGate);
						return Outcome.ok(specs[i]!.factor);
					}),
				),
		};
	};
	const wired = Layer.mergeAll(
		ProgramLoader.layer(Object.fromEntries(declarations.toReversed().map((p) => [p.name, p])), {}),
		Layer.succeed(CodeLoader, {
			load: (program, hash) =>
				Effect.suspend(() => {
					const i = bundles.findIndex((b) => b.hash === hash && b.program === program);
					return i < 0 || i === fault.load
						? Effect.fail(new ProgramDown({why: "load"}))
						: Effect.succeed(nodeCode(i));
				}),
		}),
		Layer.succeed(WatcherManager, {
			publish: (_client, update) =>
				Effect.sync(() => {
					updates.push(structuredClone(update));
				}),
		}),
		Layer.succeed(Alarm, {set: () => Effect.void}),
		Layer.effect(
			Recording,
			Effect.gen(function* () {
				const actual = yield* Recording;
				return {
					flush: Effect.suspend(() =>
						fault.flush ? Effect.fail(new LedgerError({why: "storage"})) : actual.flush,
					),
				};
			}),
		).pipe(Layer.provide(Recording.layer)),
		Layer.effect(
			CheckedWriter,
			Effect.gen(function* () {
				const mailbox = yield* Mailbox;
				return {
					append: (input) =>
						mailbox.send(name, input.id, input.envelope.input, {
							...from,
							parent: input.envelope.id,
						}),
					own: () => Effect.fail(new LedgerError({why: "refused"})),
					commit: () => Effect.fail(new LedgerError({why: "refused"})),
				};
			}),
		).pipe(Layer.provide(Mailbox.layer)),
		Layer.effect(
			ProcessStore,
			Effect.gen(function* () {
				const actual = yield* ProcessStore;
				const cut = <A, E>(point: string, work: Effect.Effect<A, E>) =>
					Effect.suspend(() => {
						if (fault.cut === `before:${point}`) {
							fault.cut = "";
							return Effect.fail(new LedgerError({why: "storage"}));
						}
						return work.pipe(
							Effect.flatMap((value) => {
								if (fault.cut === `after:${point}`) {
									fault.cut = "";
									return Effect.fail(new LedgerError({why: "unreachable"}));
								}
								return Effect.succeed(value);
							}),
						);
					});
				return {
					...actual,
					saveReload: (...args) => cut("prepare", actual.saveReload(...args)),
					commitReload: (...args) => cut("commit", actual.commitReload(...args)),
				};
			}),
		).pipe(Layer.provide(ProcessStore.layer(processDisk.sql, {process}))),
	).pipe(
		Layer.provideMerge(
			Layer.effect(
				Mailbox,
				Effect.gen(function* () {
					const actual = yield* Mailbox;
					return {
						...actual,
						send: (...args) =>
							Effect.suspend(() => {
								const answer = args[1].endsWith("/answer");
								if (answer && fault.cut === "before:answer") {
									fault.cut = "";
									return Effect.fail(new LedgerError({why: "unreachable"}));
								}
								return actual.send(...args).pipe(
									Effect.flatMap((value) => {
										if (answer && fault.cut === "after:answer") {
											fault.cut = "";
											return Effect.fail(new LedgerError({why: "unreachable"}));
										}
										return Effect.succeed(value);
									}),
								);
							}),
					};
				}),
			).pipe(Layer.provide(Mailbox.layer), Layer.provide(base)),
		),
		Layer.provideMerge(base),
	);
	const descriptor = {
		id: process,
		name,
		program: specs[0]!.program,
		build: bundles[0]!.hash,
		owner,
		policy: options.policy,
		...(p34 === null ? {} : {restart: p34.restart}),
	};
	let scope = await Effect.runPromise(Scope.make());
	const buildContext = () =>
		Effect.runPromise(
			Layer.build(
				Layer.mergeAll(ProgramRunner.layer(descriptor), CodeInstaller.layer).pipe(
					Layer.provideMerge(wired),
				),
			).pipe(Effect.provideService(Scope.Scope, scope)),
		);
	let context = await buildContext();
	type Services = typeof context extends Context.Context<infer R> ? R : never;
	const run = <A, E>(work: Effect.Effect<A, E, Services>) =>
		Effect.runPromise(work.pipe(Effect.provideContext(context)));
	const use = <A, E>(work: Effect.Effect<A, E, Services>) =>
		work.pipe(Effect.provideContext(context));
	const rows = async (stream: string): Promise<ReadonlyArray<Entry>> => {
		// `code` is a test query over all control facts; the plan fixes no stream name.
		if (stream !== "code") return run(Ledger.use((l) => Stream.runCollect(l.read(stream, 0))));
		const names = ledgerDisk.sql.exec(
			"SELECT DISTINCT stream FROM entries WHERE \"_tag\" LIKE 'code.%' OR \"_tag\" = 'step.crashed'",
		);
		const all: Entry[] = [];
		for (const name of names)
			all.push(...(await rows(Schema.decodeUnknownSync(Schema.String)(name.stream))));
		return all
			.filter((r) => r._tag.startsWith("code.") || r._tag === "step.crashed")
			.sort((a, b) => a.rev - b.rev);
	};
	const close = async () => {
		await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
		for (const d of openedDisks()) d.close();
		rmSync(folder, {recursive: true, force: true});
	};
	await run(
		ProcessManager.use((p) =>
			p.start(
				Start.cases.first.make({
					id: `boot:${process}`,
					name,
					code: {program: specs[0]!.program, hash: bundles[0]!.hash},
				}),
				from,
			),
		),
	);
	return {
		bundles,
		fixtures,
		p34,
		specs,
		process,
		name,
		calls,
		updates,
		fault,
		processDisk,
		ledgerDisk,
		codeDisk,
		sinkDisk,
		recordDisk,
		run,
		use,
		rows,
		context: () => context,
		handlerGate,
		handlerEntered,
		stepGate,
		stepEntered,
		runner: () => Context.get(context, ProgramRunner),
		registry: () => Context.get(context, CodeRegistry),
		store: () => Context.get(context, ProcessStore),
		installer: () => Context.get(context, CodeInstaller),
		install: async (i: number, n = i) => {
			const req = await request(bundles[i]!, n);
			await run(Context.get(context, CodeInstaller).install(req, bundles[i]!));
			return req;
		},
		input: (n: number, message: unknown) => ({
			id: typeId("letter", n),
			envelope: {id: typeId("input", n), by: owner, arrivedAt: 1794099600000 + n, input: message},
			sentAt: from.sentAt,
			seen: 0,
			span: {traceId: TRACE, spanId: "00f067aa0ba902b7"},
		}),
		checkpoint: () => run(Context.get(context, ProcessStore).load),
		reopen: async () => {
			await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
			for (const d of openedDisks()) d.reopen();
			scope = await Effect.runPromise(Scope.make());
			context = await buildContext();
		},
		close,
	};
};
