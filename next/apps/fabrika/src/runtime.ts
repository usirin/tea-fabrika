import type {Descriptor, Sent} from "@kampus/libfabrika";
import {
	Alarm,
	CheckedWriter,
	ProgramLoader,
	ProgramRunner,
	Recording,
	WatcherManager,
	type Incoming,
} from "@kampus/libfabrika";
import {
	admitted,
	ClientManager,
	GatewayManager,
	Mailbox,
	ProcessIdGenerator,
	ProcessManager,
	ProcessStore,
	recoverActivity,
	Owner,
	Recipient,
	Writer,
	type From,
	Start,
} from "@kampus/libfabrika/coordination";
import type {Appended} from "@kampus/libfabrika/data";
import {
	Archive,
	Doorbell,
	Ledger,
	LedgerError,
	LedgerTransaction,
	lineFor,
	fromHere,
	RecordManager,
	Referee,
	SpanSink,
	type BucketCalls,
	type Sql,
} from "@kampus/libfabrika/data";
import {workerLoader, workerSql} from "@kampus/libfabrika/workers";
import {
	Context,
	Effect,
	Exit,
	Layer,
	ManagedRuntime,
	Option,
	Result,
	Schema,
	Semaphore,
	Tracer,
} from "effect";
import {Base64, Base64Url} from "effect/encoding";
import type {GatewayBinding, ProcessBinding, ProjectBinding, RecordBinding} from "./bindings.ts";
import {Door, type ConnectionId} from "./door.ts";
import type {BrainFact} from "./local-stage.ts";
import {Settings} from "./settings.ts";
import {programs} from "./table.ts";
const Fact = Schema.declare<Parameters<typeof lineFor>[1]>(
	(value): value is Parameters<typeof lineFor>[1] =>
		Schema.is(Schema.JsonObject)(value) && typeof value._tag === "string",
);

export interface Env {
	readonly PROJECT: DurableObjectNamespace<ProjectBinding>;
	readonly PROCESS: DurableObjectNamespace<ProcessBinding>;
	readonly GATEWAY: DurableObjectNamespace<GatewayBinding>;
	readonly RECORD: DurableObjectNamespace<RecordBinding>;
	readonly LOADER: WorkerLoader;
	readonly HEALTH: R2Bucket;
	readonly STAGE: string;
}
export const settings = (env: Env) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(Settings))(env.STAGE);
export const projectStub = (env: Env, name: string) => env.PROJECT.getByName(name);
export const processStub = (env: Env, project: string, pid: string) =>
	env.PROCESS.getByName(JSON.stringify([project, pid]));
export const recordStub = (env: Env, project: string, name: string) =>
	env.RECORD.getByName(JSON.stringify([project, name]));

// Only binding calls are Promises. All decisions stay inside Effects.
export const recordCall = Effect.fn(function* <A>(send: () => Promise<A>) {
	// oxlint-disable-next-line fabrika/no-promises -- edge: one Durable Object call enters Effect
	return yield* Effect.tryPromise({try: send, catch: () => new LedgerError({why: "unreachable"})});
});
export const rpc = Effect.fn("runtime.rpc")(function* <A>(send: () => Promise<A>) {
	return yield* recordCall(send);
});

export const configureProcess = Effect.fn("process.configure")(function* (
	ctx: DurableObjectState,
	descriptor: Descriptor,
) {
	yield* rpc(() => ctx.storage.put("descriptor", descriptor));
});
export const savedAlarm = Effect.fn("process.savedAlarm")(function* (ctx: DurableObjectState) {
	return yield* rpc(() => ctx.storage.get<number>("wake"));
});
export const processDescriptor = Effect.fn("process.descriptor")(function* (
	ctx: DurableObjectState,
) {
	const descriptor = yield* rpc(() => ctx.storage.get<Descriptor>("descriptor"));
	if (descriptor === undefined) return yield* new LedgerError({why: "bad_row"});
	return descriptor;
});

const hex = (bytes: ArrayBuffer) =>
	Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
// R2 refuses a body whose SHA-256 differs from the one sent. The local bucket does not check,
// so the adapter checks first and both places fail the same way.
const checkedPut = Effect.fnUntraced(function* (
	bucket: R2Bucket,
	key: string,
	body: Uint8Array,
	sha256: string,
) {
	const copy = new Uint8Array(body);
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
	const digest = yield* Effect.tryPromise({
		try: () => crypto.subtle.digest("SHA-256", copy),
		catch: () => new LedgerError({why: "bad_row"}),
	});
	if (hex(digest) !== sha256.toLowerCase()) return yield* new LedgerError({why: "bad_row"});
	yield* recordCall(() => bucket.put(key, copy, {sha256}));
});
const bucketHead = Effect.fn(function* (bucket: R2Bucket, key: string) {
	const row = yield* recordCall(() => bucket.head(key));
	return row?.checksums.sha256 === undefined ? null : {sha256: hex(row.checksums.sha256)};
});

export const bucketCalls = (bucket: R2Bucket): BucketCalls => ({
	put: (key, body, sha256) =>
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
		Effect.runPromise(checkedPut(bucket, key, body, sha256)),
	head: (key) =>
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
		Effect.runPromise(bucketHead(bucket, key)),
});
const recordLayer = (env: Env, project: string) =>
	RecordManager.remote((name) => recordStub(env, project, name));
const archiveLayer = (env: Env) => Archive.bucket(bucketCalls(env.HEALTH));
const flushed = SpanSink.use((sink) => sink.flush);
export const complete = Effect.fn(function* <A, E, R>(work: Effect.Effect<A, E, R>) {
	return yield* work.pipe(
		Effect.exit,
		Effect.flatMap((exit) =>
			flushed.pipe(
				Effect.flatMap(() => exit),
				Effect.catch((error) => (Exit.isFailure(exit) ? exit : Effect.fail(error))),
			),
		),
	);
});
export const recordingLayer = (sql: Sql, env: Env, project: string, object: string) =>
	Layer.mergeAll(recordLayer(env, project), archiveLayer(env), SpanSink.layer(sql, {object}));

const fingerprint = Effect.fnUntraced(function* (value: string) {
	const ssh = value.startsWith("ssh-");
	const blob = ssh ? Base64.decode(value.trim().split(/\s+/)[1] ?? "") : Base64Url.decode(value);
	if (Result.isFailure(blob)) return yield* new LedgerError({why: "bad_row"});
	// SSH Ed25519 blobs end with the 32 public bytes. P10 uses this same key fingerprint.
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
	const hash = yield* Effect.tryPromise({
		try: () => crypto.subtle.digest("SHA-256", blob.success.slice(-32)),
		catch: () => new LedgerError({why: "bad_row"}),
	});
	return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});
const projectLogic = Effect.fnUntraced(function* (ctx: DurableObjectState, env: Env) {
	const config = settings(env),
		name = ctx.id.name ?? config.name,
		sql = workerSql(ctx.storage);
	const turn = yield* Semaphore.make(1);
	const notifications = Context.Reference<Array<Effect.Effect<void, LedgerError>> | null>(
		"fabrika/WriteNotifications",
		{defaultValue: () => null},
	);
	const write = Effect.fnUntraced(function* <A, E, R>(work: Effect.Effect<A, E, R>) {
		const pending: Array<Effect.Effect<void, LedgerError>> = [];
		return yield* work.pipe(
			Effect.provideService(notifications, pending),
			turn.withPermit,
			Effect.onExit(() =>
				Effect.forEach(pending, (send) => send.pipe(Effect.ignoreCause), {
					discard: true,
					concurrency: 1,
				}),
			),
		);
	});
	const by = `brain:${name}`;
	const ids = yield* ProcessIdGenerator;
	const founder = {
		name,
		person: config.person,
		keys: [config.founder],
		window: config.window,
		by: yield* fingerprint(config.founder),
		build: config.build,
	};
	const ring = Effect.fn("project.ring")(function* (to: string, stream: string, rev: number) {
		yield* rpc(() => env.GATEWAY.getByName(to).ring(stream, rev));
	});
	const bell = Layer.succeed(Doorbell, {
		ring: Effect.fnUntraced(function* (to, stream, rev) {
			const send = ring(to, stream, rev);
			const pending = yield* notifications;
			if (pending === null) return yield* send;
			const context = yield* Effect.context<never>();
			pending.push(send.pipe(Effect.provideContext(context)));
		}),
	});
	const ledgerLayer = Layer.mergeAll(
		Ledger.sql(sql, {reader: `project:${name}`}),
		LedgerTransaction.layer(sql),
		Referee.layer(sql),
	).pipe(Layer.provide(bell));
	const base = Layer.mergeAll(ledgerLayer, recordingLayer(sql, env, name, `project:${name}`));
	const managers = Layer.mergeAll(
		ClientManager.layer(founder),
		ProcessManager.layer(
			{
				by,
				owner: Owner.cases.brain.make({}),
				recipient: Recipient.cases.client.make({client: "brain", session: yield* ids.next}),
			},
			ids.next,
		),
	).pipe(Layer.provideMerge(base));
	const services = yield* Layer.build(managers);
	const ledger = Context.get(services, Ledger),
		referee = Context.get(services, Referee),
		members = Context.get(services, ClientManager),
		processes = Context.get(services, ProcessManager);
	const loader = workerLoader(env.LOADER, programs);
	const loaded = yield* loader.load("counter", `project:${name}`);
	sql.exec(
		"CREATE TABLE IF NOT EXISTS stage_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL)",
	);
	const policies = new Map<string, {inputs: Array<string>; facts: Array<string>}>();
	const remember = (pid: string, declaration: typeof loaded.declaration) =>
		policies.set(pid, {
			inputs: Object.entries(declaration.inputs)
				.filter(([, p]) => p.personOnly)
				.map(([name]) => name),
			facts: Object.entries(declaration.writes)
				.filter(([, p]) => p.personOnly)
				.map(([name]) => name),
		});
	for (const process of yield* processes.info) {
		const program = yield* loader.load(process.program, process.process);
		remember(process.process, program.declaration);
		if (
			sql.exec("SELECT process FROM stage_descriptors WHERE process=?", process.process).length ===
			0
		) {
			const descriptor = yield* rpc(() => processStub(env, name, process.process).descriptor());
			sql.exec(
				"INSERT INTO stage_descriptors VALUES (?,?)",
				process.process,
				JSON.stringify(descriptor),
			);
		}
	}
	const policy = Effect.fnUntraced(function* (pid: string) {
		const process = (yield* processes.info).find((row) => row.process === pid);
		if (process === undefined) return yield* new LedgerError({why: "refused"});
		const policy = policies.get(pid);
		if (policy === undefined) return yield* new LedgerError({why: "bad_row"});
		return policy;
	});
	const notify = Effect.fnUntraced(function* (client: string, news: unknown) {
		const [row] = sql.exec("SELECT gateway FROM stage_clients WHERE client=?", client);
		if (row !== undefined)
			yield* rpc(() => env.GATEWAY.getByName(String(row.gateway)).notify(client, news));
	});
	sql.exec(
		"CREATE TABLE IF NOT EXISTS stage_clients (client TEXT PRIMARY KEY, gateway TEXT NOT NULL, session TEXT NOT NULL)",
	);
	const door = yield* Door.pipe(
		Effect.provide(
			Door.layer({
				sql,
				founder,
				name,
				url: `http://127.0.0.1:${config.port}`,
				origins: [`http://127.0.0.1:${config.port}`],
				location: "local",
				build: config.build,
				versions: [1],
				waiting: {most: 64, ttl: 600_000},
				ping: {min: 30_000, max: 75_000},
				inputCap: 1_000_000,
				spentCap: 100_000,
				turn,
				write,
				policy,
				isLive: processes.isLive,
				nextProcess: () => ids.next,
				notify,
				deliver: (pid, _envelope, _span, incoming) =>
					rpc<Sent>(() => processStub(env, name, pid).msg(incoming)),
				open: (pid, client) =>
					rpc(() => processStub(env, name, pid).open(client)).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
					),
				wait: referee.wait,
				inputs: {
					schema: Schema.Json,
					log: Schema.Json,
					raw: [],
					personOnly: [],
					name: (m) =>
						typeof m === "object" && m !== null && "type" in m && typeof m.type === "string"
							? m.type
							: undefined,
				},
				facts: {
					personOnly: [],
				},
			}),
		),
		Effect.provideContext(services),
	);
	const gateways = yield* GatewayManager.pipe(
		Effect.provide(
			GatewayManager.layer(sql, {
				probe: (gateway, session) => rpc(() => env.GATEWAY.getByName(gateway).probe(session)),
				admitted: (key) =>
					members.members.pipe(
						Effect.flatMap((m) =>
							Effect.forEach(
								[...m.keys.keys()],
								(raw) =>
									Effect.gen(function* () {
										if ("why" in admitted(m, raw)) return false;
										return raw === key || (yield* fingerprint(raw)) === key;
									}),
								{concurrency: 1},
							),
						),
						Effect.map((values) => values.some(Boolean)),
					),
			}),
		),
		Effect.provideContext(services),
	);
	const from = (parent: string | null = null): From => ({
		by,
		for: config.person,
		sentAt: new Date().toISOString(),
		seen: 0,
		parent,
		traceId: "00000000000000000000000000000001",
		build: config.build,
	});
	const start = Effect.fnUntraced(function* (request: Start, origin: From) {
		if (!Object.hasOwn(programs, request.code.program))
			return yield* new LedgerError({why: "refused"});
		const program = yield* loader.load(request.code.program, `project:${name}/${request.name}`);
		const {result, descriptor} = yield* write(
			Effect.gen(function* () {
				const result = yield* processes.start(request, origin);
				remember(result.process, program.declaration);
				const descriptor = {
					id: result.process,
					name: request.name,
					program: request.code.program,
					build: request.code.hash,
					owner: Writer.cases.person.make({key: founder.by, for: config.person}),
				};
				sql.exec(
					"INSERT OR IGNORE INTO stage_descriptors VALUES (?,?)",
					result.process,
					JSON.stringify(descriptor),
				);
				return {result, descriptor};
			}),
		);
		yield* rpc(() => processStub(env, name, result.process).configure(descriptor));
		return result;
	});
	const registered = (yield* processes.info).find((row) => row.name === "counter:1");
	const [original] = sql.exec(
		"SELECT body,rev FROM entries WHERE stream=? AND id=?",
		"processes/counter:1",
		"counter:1",
	);
	const boot =
		registered !== undefined
			? {process: registered.process, rev: Number(original?.rev)}
			: original !== undefined
				? {process: String(JSON.parse(String(original.body)).process), rev: Number(original.rev)}
				: yield* start(
						Start.cases.first.make({
							id: "counter:1",
							name: "counter:1",
							code: {program: "counter", hash: loaded.hash},
						}),
						from(),
					);
	const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
		complete(effect).pipe(Effect.provideContext(services));
	const own = Effect.fn("project.own")(function* (
		pid: string,
		id: string,
		stream: string,
		fact: unknown,
	) {
		if (!(yield* processes.isLive(pid))) return yield* new LedgerError({why: "refused"});
		if (stream.startsWith("door/") || stream.startsWith("processes"))
			return yield* new LedgerError({why: "refused"});
		const body = Schema.decodeUnknownSync(Fact)(fact);
		const [saved] = sql.exec("SELECT value FROM stage_descriptors WHERE process=?", pid);
		if (saved === undefined) return yield* new LedgerError({why: "bad_row"});
		const descriptor = Schema.decodeUnknownSync(
			Schema.fromJsonString(Schema.Struct({owner: Writer, build: Schema.String})),
		)(saved.value);
		const origin = yield* fromHere({
			by: descriptor.owner.key,
			for: descriptor.owner.for,
			seen: 0,
			parent: null,
			build: descriptor.build,
		});
		return yield* ledger.append(stream, id, lineFor(origin, body));
	});
	const brain = Effect.fn("project.brain")(function* (fact: typeof BrainFact.Type) {
		return yield* ledger.append("door/brain", fact.id, lineFor(from(), fact));
	});
	yield* flushed.pipe(Effect.provideContext(services));
	return {
		target: door.target,
		register: (client: string, gateway: string, session: string) =>
			Effect.sync(() => {
				sql.exec(
					"INSERT INTO stage_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET gateway=excluded.gateway,session=excluded.session",
					client,
					gateway,
					session,
				);
			}),
		publish: (client: string, update: unknown) =>
			notify(
				client,
				typeof update === "object" && update !== null && "type" in update
					? {method: update.type === "whole" ? "view.whole" : "view.patch", params: update}
					: update,
			),
		connect: () => wrapped(door.connect()),
		challenge: (client: ConnectionId) => wrapped(door.challenge(client)),
		initialize: (
			client: ConnectionId,
			input: unknown,
			trusted: {url: string; tab: string; name: string},
		) => wrapped(door.initialize(client, input, trusted)),
		route: (client: ConnectionId, method: string, params: unknown, reader?: string) =>
			wrapped(door.route(client, method, params, reader)),
		knock: (client: ConnectionId, input: {label: string}) => wrapped(door.knock(client, input)),
		grant: (input: unknown) => wrapped(door.grant(input)),
		disconnect: (client: ConnectionId) => wrapped(door.disconnect(client)),
		join: Effect.fnUntraced(function* (row: Parameters<typeof gateways.join>[0]) {
			sql.exec(
				"INSERT INTO stage_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET gateway=excluded.gateway,session=excluded.session",
				row.client,
				row.gateway,
				row.session,
			);
			yield* wrapped(gateways.join(row));
		}),
		leave: Effect.fnUntraced(function* (client: string, session: string) {
			sql.exec("DELETE FROM stage_clients WHERE client=? AND session=?", client, session);
			yield* wrapped(gateways.leave(client, session));
		}),
		online: (key: string) => wrapped(gateways.online(key)),
		info: wrapped(processes.info),
		start: (request: Start, origin: From) => wrapped(start(request, origin)),
		exit: (pid: string, why: string, origin: From) =>
			wrapped(
				Effect.gen(function* () {
					yield* processes.exit(pid, why, origin);
					yield* door.retire(pid);
				}).pipe(write),
			),
		read: referee.read,
		wait: referee.wait,
		append: referee.append,
		sign: (pid: string, id: string, parent: string, kind: string) =>
			wrapped(door.sign(pid, id, parent, kind)),
		commit: (pid: string, input: Omit<Parameters<typeof door.append>[0], "process">) =>
			wrapped(door.append({...input, process: pid})),
		inbox: (pid: string, input: Incoming) =>
			wrapped(
				Effect.gen(function* () {
					if (!(yield* processes.isLive(pid))) return yield* new LedgerError({why: "refused"});
					yield* door.checkDelivery(pid, input);
					const row = (yield* processes.info).find((r) => r.process === pid);
					if (row === undefined) return yield* new LedgerError({why: "refused"});
					return yield* ledger.append(
						`${row.name}/inbox`,
						input.id,
						lineFor(
							{
								by: input.envelope.by.key,
								for: input.envelope.by.for,
								sentAt: input.sentAt,
								seen: input.seen,
								parent: input.envelope.id,
								traceId: input.span.traceId,
								build: config.build,
							},
							Schema.TaggedStruct("send", {m: Schema.Json}).make({
								m: Schema.decodeUnknownSync(Schema.Json)(input.envelope.input),
							}),
						),
					);
				}).pipe(write),
			),
		own: (
			pid: string,
			id: string,
			stream: string,
			fact: unknown,
			trace?: {traceId: string; spanId: string},
		) => {
			const work = own(pid, id, stream, fact);
			return wrapped(
				write(
					trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace))),
				),
			);
		},
		brain: (fact: typeof BrainFact.Type) => wrapped(brain(fact)),
		boot,
	};
});

export class ProjectService extends Context.Service<
	ProjectService,
	Effect.Success<ReturnType<typeof projectLogic>>
>()("fabrika/Project") {}
export const projectRuntime = (ctx: DurableObjectState, env: Env) =>
	ManagedRuntime.make(
		Layer.effect(ProjectService, projectLogic(ctx, env)).pipe(
			Layer.provide(ProcessIdGenerator.layer),
		),
	);

// The trace a delivered letter carries from the door, as P11's Incoming names it.
const Delivered = Schema.Struct({
	span: Schema.Struct({traceId: Schema.String, spanId: Schema.String}),
});
const processLogic = Effect.fnUntraced(function* (ctx: DurableObjectState, env: Env) {
	const [project, pid] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(
		JSON.parse(Schema.decodeUnknownSync(Schema.String)(ctx.id.name)),
	);
	const p = projectStub(env, project),
		sql = workerSql(ctx.storage),
		loader = workerLoader(env.LOADER, programs);
	const ledger = Ledger.remote(p, {reader: pid});
	const base = Layer.mergeAll(ledger, recordingLayer(sql, env, project, pid));
	const storage = {
		put: (key: string, value: unknown) => rpc(() => ctx.storage.put(key, value)),
		sync: () => rpc(() => ctx.storage.sync()),
	};
	const all = Layer.mergeAll(ProcessStore.layer(sql, {process: pid, storage}), Mailbox.layer).pipe(
		Layer.provideMerge(base),
	);
	const services = yield* Layer.build(all);
	const store = Context.get(services, ProcessStore),
		sink = Context.get(services, SpanSink);
	const saved = yield* rpc(() =>
		ctx.storage.get<import("@kampus/libfabrika").Descriptor>("descriptor"),
	);
	if (saved === undefined) return yield* new LedgerError({why: "bad_row"});
	const publish = Effect.fn("process.publish")(function* (client: string, update: unknown) {
		yield* rpc(() => p.publish(client, update));
	});
	const dependencies = Layer.mergeAll(
		Layer.succeed(ProgramLoader, {load: (name) => loader.load(name, pid)}),
		Layer.succeed(CheckedWriter, {
			sign: (id, parent, kind) => rpc(() => p.sign(pid, id, parent, kind)),
			append: (input) => rpc<Appended>(() => p.inbox(pid, input)),
			commit: (id, session, stream, fact) =>
				rpc<Appended>(() =>
					p.commit(pid, {id, parent: session.parent, kind: fact._tag, stream, fact}),
				),
			own: Effect.fn("process.own")(function* (id: string, stream: string, fact: unknown) {
				const span = yield* Effect.currentSpan.pipe(Effect.orDie);
				return yield* rpc<Appended>(() =>
					p.own(pid, id, stream, fact, {traceId: span.traceId, spanId: span.spanId}),
				);
			}),
		}),
		Layer.succeed(WatcherManager, {
			publish: (client, update) => publish(client, update).pipe(Effect.ignore),
		}),
		Layer.succeed(Alarm, {
			// The program's wake is saved as it set it; the platform alarm moves a past time to now.
			set: (at) =>
				(at === null
					? rpc(() => ctx.storage.delete("wake")).pipe(
							Effect.andThen(rpc(() => ctx.storage.deleteAlarm())),
						)
					: rpc(() => ctx.storage.put("wake", at)).pipe(
							Effect.andThen(rpc(() => ctx.storage.setAlarm(at))),
						)
				).pipe(Effect.orDie),
		}),
		// Recording captures its sink's services itself (main's P11); the runner no longer provides them.
		Layer.succeed(Recording, {flush: sink.flush.pipe(Effect.provideContext(services))}),
	);
	const runnerLayer = ProgramRunner.layer(saved).pipe(
		Layer.provide(dependencies),
		Layer.provide(Layer.succeedContext(services)),
	);
	const runner = yield* ProgramRunner.pipe(Effect.provide(runnerLayer));
	yield* sink.flush.pipe(Effect.provideContext(services));
	return {
		msg: (input: unknown) => {
			const work = runner
				.msg(input)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services));
			// The door's input span is in another object, so its trace crosses the call as data.
			const sent = Schema.decodeUnknownOption(Delivered)(input);
			return Option.isSome(sent)
				? work.pipe(Effect.withParentSpan(Tracer.externalSpan(sent.value.span)))
				: work;
		},
		open: (client: string) =>
			runner
				.open(client)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
		due: (at: number) =>
			runner
				.due(at)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
		// A platform alarm delivers the saved due time, so a repeated alarm is the same letter.
		alarm: () =>
			rpc(() => ctx.storage.get<number>("wake")).pipe(
				Effect.flatMap((at) =>
					at === undefined
						? Effect.void
						: runner
								.due(at)
								.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
				),
			),
		activity: store.activity,
		recover: () =>
			rpc(() => ctx.storage.get("activity")).pipe(
				Effect.flatMap((value) => Effect.fromResult(recoverActivity(value))),
			),
	};
});
export class ProcessService extends Context.Service<
	ProcessService,
	Effect.Success<ReturnType<typeof processLogic>>
>()("fabrika/Process") {}
export const processRuntime = (ctx: DurableObjectState, env: Env) =>
	ManagedRuntime.make(Layer.effect(ProcessService, processLogic(ctx, env)));
