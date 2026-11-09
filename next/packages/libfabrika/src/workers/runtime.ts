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
	Stream,
	Tracer,
} from "effect";
import {Base64, Base64Url} from "effect/encoding";
import type {BrainEvent} from "../app/brain-event.ts";
import {Alarm, CheckedWriter, Recording, WatcherManager, type Incoming} from "../app/entry.ts";
import type {Descriptor, Sent} from "../app/runner.ts";
import {ProgramRunner} from "../app/runner.ts";
import {
	admitted,
	ClientManager,
	GatewayManager,
	Mailbox,
	NotGranted,
	ProcessIdGenerator,
	ProcessManager,
	ProcessStore,
	recoverActivity,
	Owner,
	Recipient,
	Writer,
	type From,
	Start,
	SigningRefused,
	type Session,
} from "../coordination/index.ts";
import type {Appended} from "../data/index.ts";
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
} from "../data/index.ts";
import {workerSql} from "../data/worker-sql.ts";
import * as Id from "../id.ts";
import {
	CommitReply,
	SigningReply,
	type ConnectionId,
	type DoorCalls,
	type GatewayBinding,
	type ProcessBinding,
	type ProjectBinding,
	type RecordBinding,
} from "./bindings.ts";
import {workerLoader, type ProgramSource} from "./index.ts";
import {
	BucketClient,
	GatewayClient,
	ProcessClient,
	ProjectClient,
	StorageClient,
} from "./platform.ts";
const Event = Schema.declare<Parameters<typeof lineFor>[1]>(
	(value): value is Parameters<typeof lineFor>[1] =>
		Schema.is(Schema.JsonObject)(value) && typeof value._tag === "string",
);
const SavedDescriptor = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	program: Schema.String,
	build: Schema.String,
	owner: Writer,
});

export interface Env {
	readonly PROJECT: DurableObjectNamespace<ProjectBinding>;
	readonly PROCESS: DurableObjectNamespace<ProcessBinding>;
	readonly GATEWAY: DurableObjectNamespace<GatewayBinding>;
	readonly RECORD: DurableObjectNamespace<RecordBinding>;
	readonly LOADER: WorkerLoader;
	readonly HEALTH: R2Bucket;
}
export interface BrainOptions {
	readonly name: string;
	readonly person: string;
	readonly founder: string;
	readonly window: string | null;
	readonly port: number;
	readonly build: string;
	readonly limits?: {readonly recordBytes: number};
}
export interface ProjectDoorOptions {
	readonly sql: Sql;
	readonly founder: Parameters<typeof ClientManager.layer>[0];
	readonly turn: Semaphore.Semaphore;
	readonly write: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	readonly policy: (
		process: string,
	) => Effect.Effect<{inputs: Array<string>; events: Array<string>}, LedgerError>;
	readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
	readonly nextProcess: () => Effect.Effect<string>;
	readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError>;
	readonly deliver: (process: string, input: Incoming) => Effect.Effect<Sent, LedgerError>;
	readonly open: (process: string, client: string) => Effect.Effect<Schema.Json, LedgerError>;
	readonly wait: (
		stream: string,
		after: number,
		reader: string,
	) => Effect.Effect<unknown, LedgerError>;
}
export interface ProjectOptions {
	readonly config: BrainOptions;
	readonly programs: Readonly<Record<string, ProgramSource>>;
	readonly bootstrap: {readonly name: string; readonly id: string; readonly program: string};
	readonly door: (
		options: ProjectDoorOptions,
	) => Effect.Effect<
		DoorCalls,
		unknown,
		Ledger | LedgerTransaction | Id.Generator | ClientManager | SpanSink | RecordManager | Archive
	>;
}
export const projectStub = (env: Env, name: string) => env.PROJECT.getByName(name);
export const processStub = (env: Env, project: string, pid: string) =>
	env.PROCESS.getByName(JSON.stringify([project, pid]));
export const recordStub = (env: Env, project: string, name: string) =>
	env.RECORD.getByName(JSON.stringify([project, name]));

// Bindings have already entered Effect before the caller adds its RPC span.
export const rpc = Effect.fn("runtime.rpc")(function* <A, E>(work: Effect.Effect<A, E>) {
	return yield* work;
});

// Only checked refusals become RPC data. Storage and transport failures still fail the call.
const checkedReply = Effect.fnUntraced(function* <A, B>(
	work: Effect.Effect<A, unknown>,
	ok: (value: A) => B,
) {
	return yield* work.pipe(
		Effect.map(ok),
		Effect.catchIf(
			(error): error is SigningRefused => error instanceof SigningRefused,
			(error) => Effect.succeed(SigningReply.cases.SigningRefused.make({why: error.why})),
		),
		Effect.catchIf(
			(error): error is NotGranted => error instanceof NotGranted,
			() => Effect.succeed(SigningReply.cases.NotGranted.make({})),
		),
	);
});
export const signingReply = Effect.fn("project.signingReply")(function* (
	work: Effect.Effect<Session, unknown>,
) {
	return yield* checkedReply(work, (value) => SigningReply.cases.ok.make({value}));
});
export const commitReply = Effect.fn("project.commitReply")(function* (
	work: Effect.Effect<Appended, unknown>,
) {
	return yield* checkedReply(work, (value) => CommitReply.cases.ok.make({value}));
});
const checkedValue = Effect.fnUntraced(function* <A>(
	reply:
		| (Omit<typeof SigningReply.cases.ok.Type, "value"> & {readonly value: A})
		| typeof SigningReply.cases.SigningRefused.Type
		| typeof SigningReply.cases.NotGranted.Type,
) {
	if (reply._tag === "SigningRefused") return yield* new SigningRefused({why: reply.why});
	if (reply._tag === "NotGranted") return yield* new NotGranted({});
	return reply.value;
});

export const configureProcess = Effect.fn("process.configure")(function* (
	ctx: DurableObjectState,
	descriptor: Descriptor,
) {
	yield* rpc(StorageClient.make(ctx.storage).put("descriptor", descriptor));
});
export const savedAlarm = Effect.fn("process.savedAlarm")(function* (ctx: DurableObjectState) {
	return yield* rpc(StorageClient.make(ctx.storage).get<number>("wake"));
});
export const processDescriptor = Effect.fn("process.descriptor")(function* (
	ctx: DurableObjectState,
) {
	const descriptor = yield* rpc(StorageClient.make(ctx.storage).get("descriptor"));
	return yield* Schema.decodeUnknownEffect(SavedDescriptor)(descriptor).pipe(
		Effect.mapError(() => new LedgerError({why: "bad_row"})),
	);
});

const hex = (bytes: ArrayBuffer) =>
	Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
// R2 refuses a body whose SHA-256 differs from the one sent. The local bucket does not check,
// so the adapter checks first and both places fail the same way.
export const checkedPut = Effect.fnUntraced(function* (
	bucket: R2Bucket,
	key: string,
	body: Uint8Array,
	sha256: string,
) {
	const copy = new Uint8Array(body);
	const fail = () => new LedgerError({why: "crypto"});
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
	const work = Effect.tryPromise({try: () => crypto.subtle.digest("SHA-256", copy), catch: fail});
	const digest = yield* work;
	if (hex(digest) !== sha256.toLowerCase()) return yield* new LedgerError({why: "bad_row"});
	yield* BucketClient.make(bucket).put(key, copy, sha256);
});
export const bucketHead = Effect.fn(function* (bucket: R2Bucket, key: string) {
	const row = yield* BucketClient.make(bucket).head(key);
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
	const bytes = blob.success.slice(-32);
	const fail = () => new LedgerError({why: "crypto"});
	// SSH Ed25519 blobs end with the 32 public bytes. P10 uses this same key fingerprint.
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
	const work = Effect.tryPromise({try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail});
	const hash = yield* work;
	return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});
const projectLogic = Effect.fn("project.init")(function* (
	ctx: DurableObjectState,
	env: Env,
	options: ProjectOptions,
) {
	const {config, programs, bootstrap} = options;
	const name = ctx.id.name ?? config.name,
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
		yield* rpc(GatewayClient.make(env.GATEWAY.getByName(to)).ring(stream, rev));
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
	const loaded = yield* loader.load(bootstrap.program, `project:${name}`);
	sql.exec(
		"CREATE TABLE IF NOT EXISTS stage_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)",
	);
	if (!sql.exec("PRAGMA table_info(stage_descriptors)").some((column) => column.name === "pending"))
		sql.exec("ALTER TABLE stage_descriptors ADD COLUMN pending INTEGER NOT NULL DEFAULT 0");
	const configure = Effect.fnUntraced(function* (pid: string) {
		const [saved] = sql.exec(
			"SELECT value FROM stage_descriptors WHERE process=? AND pending=1",
			pid,
		);
		if (saved === undefined) return;
		const descriptor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(
			saved.value,
		).pipe(Effect.mapError(() => new LedgerError({why: "bad_row"})));
		yield* rpc(ProcessClient.make(processStub(env, name, pid)).configure(descriptor));
		sql.exec("UPDATE stage_descriptors SET pending=0 WHERE process=?", pid);
	});
	const policies = new Map<string, {inputs: Array<string>; events: Array<string>}>();
	const remember = (pid: string, declaration: typeof loaded.declaration) =>
		policies.set(pid, {
			inputs: Object.entries(declaration.inputs)
				.filter(([, p]) => p.personOnly)
				.map(([name]) => name),
			events: Object.entries(declaration.writes)
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
			const descriptor = yield* rpc(
				ProcessClient.make(processStub(env, name, process.process)).descriptor(),
			);
			sql.exec(
				"INSERT INTO stage_descriptors (process,value) VALUES (?,?)",
				process.process,
				JSON.stringify(descriptor),
			);
		}
		yield* configure(process.process);
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
			yield* rpc(
				GatewayClient.make(env.GATEWAY.getByName(String(row.gateway))).notify(client, news),
			);
	});
	sql.exec(
		"CREATE TABLE IF NOT EXISTS stage_clients (client TEXT PRIMARY KEY, gateway TEXT NOT NULL, session TEXT NOT NULL)",
	);
	const door = yield* options
		.door({
			sql,
			founder,
			turn,
			write,
			policy,
			isLive: processes.isLive,
			nextProcess: () => ids.next,
			notify,
			deliver: (pid, incoming) =>
				rpc(ProcessClient.make(processStub(env, name, pid)).msg(incoming)),
			open: (pid, client) =>
				rpc(ProcessClient.make(processStub(env, name, pid)).open(client)).pipe(
					Effect.flatMap((value) =>
						Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
							Effect.mapError(() => new LedgerError({why: "bad_row"})),
						),
					),
				),
			wait: referee.wait,
		})
		.pipe(Effect.provideContext(services));
	const gateways = yield* GatewayManager.pipe(
		Effect.provide(
			GatewayManager.layer(sql, {
				probe: (gateway, session) =>
					rpc(GatewayClient.make(env.GATEWAY.getByName(gateway)).probe(session)),
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
	const from = Effect.fn(function* (parent: string | null = null) {
		return yield* fromHere({by, for: config.person, seen: 0, parent, build: config.build}).pipe(
			Effect.orDie,
		);
	});
	const start = Effect.fnUntraced(function* (request: Start, origin: From) {
		if (!Object.hasOwn(programs, request.code.program))
			return yield* new LedgerError({why: "refused"});
		const program = yield* loader.load(request.code.program, `project:${name}/${request.name}`);
		const result = yield* write(
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
					"INSERT OR IGNORE INTO stage_descriptors (process,value,pending) VALUES (?,?,1)",
					result.process,
					JSON.stringify(descriptor),
				);
				return result;
			}),
		);
		yield* configure(result.process);
		return result;
	});
	const original = yield* ledger.read(`processes/${bootstrap.name}`, 0).pipe(
		Stream.filter((entry) => entry.id === bootstrap.id),
		Stream.runHead,
		Effect.map(Option.getOrUndefined),
	);
	const Bootstrap = Schema.Struct({process: Schema.String});
	const boot =
		original !== undefined
			? {
					process: (yield* Schema.decodeUnknownEffect(Bootstrap)(original.body).pipe(
						Effect.mapError(() => new LedgerError({why: "bad_row"})),
					)).process,
					rev: original.rev,
				}
			: yield* start(
					Start.cases.first.make({
						id: bootstrap.id,
						name: bootstrap.name,
						code: {program: bootstrap.program, hash: loaded.hash},
					}),
					yield* from(),
				);
	const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
		complete(effect).pipe(Effect.provideContext(services));
	const own = Effect.fn("project.own")(function* (
		pid: string,
		id: string,
		stream: string,
		event: unknown,
	) {
		if (!(yield* processes.isLive(pid))) return yield* new LedgerError({why: "refused"});
		if (stream.startsWith("door/") || stream.startsWith("processes"))
			return yield* new LedgerError({why: "refused"});
		const body = yield* Schema.decodeUnknownEffect(Event)(event).pipe(
			Effect.mapError(() => new LedgerError({why: "bad_row"})),
		);
		const [saved] = sql.exec("SELECT value FROM stage_descriptors WHERE process=?", pid);
		if (saved === undefined) return yield* new LedgerError({why: "bad_row"});
		const descriptor = yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(Schema.Struct({owner: Writer, build: Schema.String})),
		)(saved.value).pipe(Effect.mapError(() => new LedgerError({why: "bad_row"})));
		const origin = yield* fromHere({
			by: descriptor.owner.key,
			for: descriptor.owner.for,
			seen: 0,
			parent: null,
			build: descriptor.build,
		});
		return yield* ledger.append(stream, id, lineFor(origin, body));
	});
	const brain = Effect.fn("project.brain")(function* (event: typeof BrainEvent.Type) {
		return yield* ledger.append("door/brain", event.id, lineFor(yield* from(), event));
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
		exit: (pid: string, reason: string, origin: From) =>
			wrapped(
				Effect.gen(function* () {
					yield* processes.exit(pid, reason, origin);
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
								m: yield* Schema.decodeUnknownEffect(Schema.Json)(input.envelope.input).pipe(
									Effect.mapError(() => new LedgerError({why: "bad_row"})),
								),
							}),
						),
					);
				}).pipe(write),
			),
		own: (
			pid: string,
			id: string,
			stream: string,
			event: unknown,
			trace?: {traceId: string; spanId: string},
		) => {
			const work = own(pid, id, stream, event);
			return wrapped(
				write(
					trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace))),
				),
			);
		},
		brain: (event: typeof BrainEvent.Type) => wrapped(brain(event)),
		boot,
	};
});

export class ProjectService extends Context.Service<
	ProjectService,
	Effect.Success<ReturnType<typeof projectLogic>>
>()("fabrika/Project") {}
export const projectLayer = (ctx: DurableObjectState, env: Env, options: ProjectOptions) =>
	Layer.effect(ProjectService, projectLogic(ctx, env, options)).pipe(
		Layer.provide(Layer.merge(ProcessIdGenerator.layer, Id.Generator.layer)),
	);
export const projectRuntime = (ctx: DurableObjectState, env: Env, options: ProjectOptions) =>
	ManagedRuntime.make(projectLayer(ctx, env, options));

// The trace a delivered letter carries from the door, as P11's Incoming names it.
const Delivered = Schema.Struct({
	span: Schema.Struct({traceId: Schema.String, spanId: Schema.String}),
});
const processLogic = Effect.fnUntraced(function* (
	ctx: DurableObjectState,
	env: Env,
	programs: Readonly<Record<string, ProgramSource>>,
) {
	const [project, pid] = yield* Schema.decodeUnknownEffect(
		Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
	)(ctx.id.name).pipe(Effect.mapError(() => new LedgerError({why: "bad_row"})));
	const stub = projectStub(env, project),
		p = ProjectClient.make(stub),
		storage = StorageClient.make(ctx.storage),
		sql = workerSql(ctx.storage),
		loader = workerLoader(env.LOADER, programs);
	const ledger = Ledger.remote(stub, {reader: pid});
	const base = Layer.mergeAll(ledger, recordingLayer(sql, env, project, pid));
	const all = Layer.mergeAll(ProcessStore.layer(sql, {process: pid, storage}), Mailbox.layer).pipe(
		Layer.provideMerge(base),
	);
	const services = yield* Layer.build(all);
	const store = Context.get(services, ProcessStore),
		sink = Context.get(services, SpanSink);
	const saved = yield* processDescriptor(ctx);
	const publish = Effect.fn("process.publish")(function* (client: string, update: unknown) {
		yield* rpc(p.publish(client, update));
	});
	const dependencies = Layer.mergeAll(
		Layer.succeed(CheckedWriter, {
			sign: (id, parent, kind) =>
				rpc(p.sign(pid, id, parent, kind)).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(SigningReply)),
					Effect.mapError(() => new LedgerError({why: "unreachable"})),
					Effect.flatMap(checkedValue),
				),
			append: (input) => rpc(p.inbox(pid, input)),
			commit: (id, session, stream, event) =>
				rpc(
					p.commit(pid, {id, parent: session.parent, kind: event._tag, stream, fact: event}),
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(CommitReply)),
					Effect.mapError(() => new LedgerError({why: "unreachable"})),
					Effect.flatMap(checkedValue),
				),
			own: Effect.fn("process.own")(function* (id: string, stream: string, event: unknown) {
				const span = yield* Effect.currentSpan.pipe(Effect.orDie);
				return yield* rpc(
					p.own(pid, id, stream, event, {traceId: span.traceId, spanId: span.spanId}),
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
					? rpc(storage.delete("wake")).pipe(Effect.andThen(rpc(storage.deleteAlarm())))
					: rpc(storage.put("wake", at)).pipe(Effect.andThen(rpc(storage.setAlarm(at))))
				).pipe(Effect.orDie),
		}),
		// Recording captures its sink's services itself (main's P11); the runner no longer provides them.
		Layer.succeed(Recording, {flush: sink.flush.pipe(Effect.provideContext(services))}),
	);
	const runnerLayer = ProgramRunner.withLoader(saved, {
		load: (name) => loader.load(name, pid),
	}).pipe(Layer.provide(dependencies), Layer.provide(Layer.succeedContext(services)));
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
			rpc(storage.get<number>("wake")).pipe(
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
			rpc(storage.get("activity")).pipe(
				Effect.flatMap((value) => Effect.fromResult(recoverActivity(value))),
			),
	};
});
export class ProcessService extends Context.Service<
	ProcessService,
	Effect.Success<ReturnType<typeof processLogic>>
>()("fabrika/Process") {}
export const processRuntime = (
	ctx: DurableObjectState,
	env: Env,
	programs: Readonly<Record<string, ProgramSource>>,
) => ManagedRuntime.make(Layer.effect(ProcessService, processLogic(ctx, env, programs)));
