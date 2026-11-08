import type {Sent} from "@kampus/libfabrika";
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
	RecordManager,
	Referee,
	SpanSink,
	type BucketCalls,
	type Sql,
} from "@kampus/libfabrika/data";
import {workerLoader, workerSql} from "@kampus/libfabrika/workers";
import {Context, Effect, Exit, Layer, ManagedRuntime, Result, Schema, Semaphore} from "effect";
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
export const rpc = Effect.fnUntraced(function* <A>(send: () => Promise<A>) {
	// oxlint-disable-next-line fabrika/no-promises -- edge: one Durable Object call enters Effect
	return yield* Effect.tryPromise({try: send, catch: () => new LedgerError({why: "unreachable"})});
});

export const bucketCalls = (bucket: R2Bucket): BucketCalls => ({
	put: (key, body, sha256) =>
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
		Effect.runPromise(
			rpc(() => bucket.put(key, new Uint8Array(body), {sha256})).pipe(Effect.asVoid),
		),
	head: (key) =>
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
		Effect.runPromise(
			rpc(() => bucket.head(key)).pipe(
				Effect.map((row) =>
					row?.checksums.sha256 === undefined
						? null
						: {
								sha256: Array.from(new Uint8Array(row.checksums.sha256), (n) =>
									n.toString(16).padStart(2, "0"),
								).join(""),
							},
				),
			),
		),
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
	const bell = Layer.succeed(Doorbell, {
		ring: (to, stream, rev) => rpc(() => env.GATEWAY.getByName(to).ring(stream, rev)),
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
	const inputPolicy = new Set(
		Object.entries(loaded.declaration.inputs)
			.filter(([, p]) => p.personOnly)
			.map(([name]) => name),
	);
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
					personOnly: [...inputPolicy],
					name: (m) =>
						typeof m === "object" && m !== null && "type" in m && typeof m.type === "string"
							? m.type
							: undefined,
				},
				facts: {
					personOnly: Object.entries(loaded.declaration.writes)
						.filter(([, p]) => p.personOnly)
						.map(([name]) => name),
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
		const result = yield* processes.start(request, origin).pipe(turn.withPermit);
		const descriptor = {
			id: result.process,
			name: request.name,
			program: request.code.program,
			build: request.code.hash,
			owner: Writer.cases.person.make({key: founder.by, for: config.person}),
		};
		yield* rpc(() => processStub(env, name, result.process).configure(descriptor));
		return result;
	});
	const boot = yield* start(
		Start.cases.first.make({
			id: "counter:1",
			name: "counter:1",
			code: {program: "counter", hash: loaded.hash},
		}),
		from(),
	);
	const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
		complete(effect).pipe(Effect.provideContext(services));
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
				}).pipe(turn.withPermit),
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
				}).pipe(turn.withPermit),
			),
		own: (pid: string, id: string, stream: string, fact: unknown) =>
			wrapped(
				Effect.gen(function* () {
					if (!(yield* processes.isLive(pid))) return yield* new LedgerError({why: "refused"});
					if (stream.startsWith("door/") || stream.startsWith("processes"))
						return yield* new LedgerError({why: "refused"});
					const body = Schema.decodeUnknownSync(Fact)(fact);
					return yield* ledger.append(stream, id, lineFor(from(), body));
				}).pipe(turn.withPermit),
			),
		brain: (fact: typeof BrainFact.Type) =>
			wrapped(
				ledger
					.append("door/brain", fact.id, lineFor(from(), fact))
					.pipe(
						Effect.withSpan(
							fact._tag === "started"
								? fact.after === null
									? "brain.start"
									: "brain.restart"
								: "brain.stop",
						),
					),
			),
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
	const dependencies = Layer.mergeAll(
		Layer.succeed(ProgramLoader, {load: (name) => loader.load(name, pid)}),
		Layer.succeed(CheckedWriter, {
			sign: (id, parent, kind) => rpc(() => p.sign(pid, id, parent, kind)),
			append: (input) => rpc<Appended>(() => p.inbox(pid, input)),
			commit: (id, session, stream, fact) =>
				rpc<Appended>(() =>
					p.commit(pid, {id, parent: session.parent, kind: fact._tag, stream, fact}),
				),
			own: (id, stream, fact) => rpc<Appended>(() => p.own(pid, id, stream, fact)),
		}),
		Layer.succeed(WatcherManager, {
			publish: (client, update) =>
				rpc(() => p.publish(client, update)).pipe(Effect.catch(() => Effect.void)),
		}),
		Layer.succeed(Alarm, {
			set: (at) =>
				(at === null
					? rpc(() => ctx.storage.deleteAlarm())
					: rpc(() => ctx.storage.setAlarm(at))
				).pipe(Effect.orDie),
		}),
		Layer.succeed(Recording, {flush: sink.flush}),
	);
	const runnerLayer = ProgramRunner.layer(saved).pipe(
		Layer.provide(dependencies),
		Layer.provide(Layer.succeedContext(services)),
	);
	const runner = yield* ProgramRunner.pipe(Effect.provide(runnerLayer));
	yield* sink.flush.pipe(Effect.provideContext(services));
	return {
		msg: (input: unknown) =>
			runner
				.msg(input)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
		open: (client: string) =>
			runner
				.open(client)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
		due: (at: number) =>
			runner
				.due(at)
				.pipe(Effect.annotateSpans({"fab.process": pid}), Effect.provideContext(services)),
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
