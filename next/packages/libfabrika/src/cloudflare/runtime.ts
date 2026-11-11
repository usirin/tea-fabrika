import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
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
import { Base64, Base64Url } from "effect/encoding";
import { admitted } from "../access/Access.ts";
import { ClientManager } from "../access/ClientManager.ts";
import { NotGranted, SigningRefused, Writer, type Session } from "../access/SessionManager.ts";
import * as Id from "../Id.ts";
import { cloudflareSql } from "../ledger/CloudflareSql.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { type Appended, fromHere, lineFor } from "../ledger/Log.ts";
import { Referee } from "../ledger/Referee.ts";
import { Connections } from "../presence/Connections.ts";
import { Mailbox, type From } from "../processes/Mailbox.ts";
import { Owner, ProcessError, Recipient, recoverActivity, Start } from "../processes/Process.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { ProcessManager, remoteProcessManager, type ProcessCalls } from "../processes/ProcessManager.ts";
import type { BrainEvent } from "../runtime/BrainEvent.ts";
import { Alarm, CheckedWriter, Recording, WatcherManager, type Incoming } from "../runtime/Entry.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import type { Descriptor, Sent } from "../runtime/Runner.ts";
import { defaultPolicy, ProgramRunner } from "../runtime/Runner.ts";
import { type Sql } from "../Sql.ts";
import { Archive, type BucketCalls } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { SinkError } from "../telemetry/Trace.ts";
import {
  CommitReply,
  ProcessReplies,
  SigningReply,
  type ConnectionId,
  type GatewayCalls,
  type ConnectionBinding,
  type ProcessBinding,
  type ProcessReply,
  type ProjectBinding,
  type RecordBinding,
} from "./bindings.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import type { RecordShape } from "./objects.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient } from "./platform.ts";

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
  readonly CONNECTION: DurableObjectNamespace<ConnectionBinding>;
  readonly RECORD: DurableObjectNamespace<RecordBinding>;
  readonly LOADER: WorkerLoader;
  readonly MEASUREMENTS: R2Bucket;
}

export interface BrainOptions {
  readonly name: string;
  readonly person: string;
  readonly founder: string;
  readonly window: string | null;
  readonly port: number;
  readonly build: string;
  readonly limits?: { readonly recordBytes: number };
}

export interface ProjectDoorOptions {
  readonly sql: Sql;
  readonly founder: Parameters<typeof ClientManager.layer>[0];
  readonly turn: Semaphore.Semaphore;
  readonly write: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly policy: (process: string) => Effect.Effect<{ inputs: Array<string>; events: Array<string> }, LedgerError>;
  readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
  readonly nextProcess: () => Effect.Effect<string>;
  readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError>;
  readonly deliver: (process: string, input: Incoming) => Effect.Effect<Sent, LedgerError>;
  readonly open: (process: string, client: string) => Effect.Effect<Schema.Json, LedgerError>;
  readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<unknown, LedgerError>;
}

export interface ProjectOptions {
  readonly config: BrainOptions;
  readonly programs: Readonly<Record<string, ProgramSource>>;
  readonly bootstrap: { readonly name: string; readonly id: string; readonly program: string };
  readonly door: (
    options: ProjectDoorOptions,
  ) => Effect.Effect<
    GatewayCalls,
    unknown,
    Ledger | LedgerTransaction | Id.Generator | ClientManager | SpanSink | RecordManager | Archive
  >;
}

export const projectStub = (env: Env, name: string) => env.PROJECT.getByName(name);

/** One Process object per registered name: every process ID of that name, first or successor. */
export const processStub = (env: Env, project: string, name: string) =>
  env.PROCESS.getByName(JSON.stringify([project, name]));

export const recordStub = (env: Env, project: string, name: string) =>
  makeRpcStub<RecordShape>(env.RECORD.getByName(JSON.stringify([project, name])), { errors: [SinkError] });

// Bindings have already entered Effect before the caller adds its RPC span.
export const rpc = Effect.fn("runtime.rpc")(function* <A, E>(work: Effect.Effect<A, E>) {
  return yield* work;
});

// Only checked refusals become RPC data. Storage and transport failures still fail the call.
const checkedReply = Effect.fnUntraced(function* <A, B>(work: Effect.Effect<A, unknown>, ok: (value: A) => B) {
  return yield* work.pipe(
    Effect.map(ok),
    Effect.catchIf(
      (error): error is SigningRefused => error instanceof SigningRefused,
      (error) => Effect.succeed(SigningReply.cases.SigningRefused.make({ reason: error.reason })),
    ),
    Effect.catchIf(
      (error): error is NotGranted => error instanceof NotGranted,
      () => Effect.succeed(SigningReply.cases.NotGranted.make({})),
    ),
  );
});

export const signingReply = Effect.fn("project.signingReply")(function* (work: Effect.Effect<Session, unknown>) {
  return yield* checkedReply(work, (value) => SigningReply.cases.ok.make({ value }));
});

export const commitReply = Effect.fn("project.commitReply")(function* (work: Effect.Effect<Appended, unknown>) {
  return yield* checkedReply(work, (value) => CommitReply.cases.ok.make({ value }));
});

/** A ProcessManager call's checked refusal becomes reply data; other failures still fail the call. */
export const processReply = <A, E>(work: Effect.Effect<A, E | ProcessError>): Effect.Effect<ProcessReply<A>, E> =>
  work.pipe(
    Effect.map((value): ProcessReply<A> => ({ ...ProcessReplies.cases.ok.make({ value }), value })),
    Effect.catch((error): Effect.Effect<ProcessReply<A>, E> =>
      error instanceof ProcessError
        ? Effect.succeed(ProcessReplies.cases.ProcessError.make({ reason: error.reason }))
        : Effect.fail(error),
    ),
  );

const processValue = Effect.fnUntraced(function* <A>(reply: ProcessReply<A>) {
  if (reply._tag === "ok") {
    return reply.value;
  }

  const refused = yield* Schema.decodeUnknownEffect(ProcessReplies.cases.ProcessError)(reply).pipe(
    Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
  );
  return yield* new ProcessError({ reason: refused.reason });
});

/** A trusted restart: its request ID makes a repeat one replacement. */
const RestartRequest = Schema.Struct({ id: Schema.NonEmptyString, build: Schema.NonEmptyString });

const checkedValue = Effect.fnUntraced(function* <A>(
  reply:
    | (Omit<typeof SigningReply.cases.ok.Type, "value"> & { readonly value: A })
    | typeof SigningReply.cases.SigningRefused.Type
    | typeof SigningReply.cases.NotGranted.Type,
) {
  if (reply._tag === "SigningRefused") {
    return yield* new SigningRefused({ reason: reply.reason });
  }

  if (reply._tag === "NotGranted") {
    return yield* new NotGranted({});
  }

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

export const processDescriptor = Effect.fn("process.descriptor")(function* (ctx: DurableObjectState) {
  const descriptor = yield* rpc(StorageClient.make(ctx.storage).get("descriptor"));
  return yield* Schema.decodeUnknownEffect(SavedDescriptor)(descriptor).pipe(
    Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
  );
});

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");

// R2 refuses a body whose SHA-256 differs from the one sent. The local bucket does not check,
// so the adapter checks first and both places fail the same way.
export const checkedPut = Effect.fnUntraced(function* (
  bucket: R2Bucket,
  key: string,
  body: Uint8Array,
  sha256: string,
) {
  const copy = new Uint8Array(body);
  const fail = () => new LedgerError({ reason: "crypto" });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", copy), catch: fail });
  const digest = yield* work;

  if (hex(digest) !== sha256.toLowerCase()) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  yield* BucketClient.make(bucket).put(key, copy, sha256);
});

export const bucketHead = Effect.fn(function* (bucket: R2Bucket, key: string) {
  const row = yield* BucketClient.make(bucket).head(key);
  return row?.checksums.sha256 === undefined ? null : { sha256: hex(row.checksums.sha256) };
});

export const bucketCalls = (bucket: R2Bucket): BucketCalls => ({
  put: (key, body, sha256) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
    Effect.runPromise(checkedPut(bucket, key, body, sha256)),
  head: (key) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
    Effect.runPromise(bucketHead(bucket, key)),
});

const recordLayer = (env: Env, project: string) => RecordManager.remote((name) => recordStub(env, project, name));

const archiveLayer = (env: Env) => Archive.bucket(bucketCalls(env.MEASUREMENTS));
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
  Layer.mergeAll(recordLayer(env, project), archiveLayer(env), SpanSink.layer(sql, { object }));

const fingerprint = Effect.fnUntraced(function* (value: string) {
  const ssh = value.startsWith("ssh-");
  const blob = ssh ? Base64.decode(value.trim().split(/\s+/)[1] ?? "") : Base64Url.decode(value);

  if (Result.isFailure(blob)) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  const bytes = blob.success.slice(-32);
  const fail = () => new LedgerError({ reason: "crypto" });
  // SSH Ed25519 blobs end with the 32 public bytes. P10 uses this same key fingerprint.
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
  const hash = yield* work;
  return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});

const projectLogic = Effect.fn("project.init")(function* (ctx: DurableObjectState, env: Env, options: ProjectOptions) {
  const { config, programs, bootstrap } = options;
  const name = ctx.id.name ?? config.name,
    sql = cloudflareSql(ctx.storage);
  const turn = yield* Semaphore.make(1);
  const notifications = Context.Reference<Array<Effect.Effect<void, LedgerError>> | null>(
    "fabrika/WriteNotifications",
    { defaultValue: () => null },
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
    yield* rpc(GatewayClient.make(env.CONNECTION.getByName(to)).ring(stream, rev));
  });
  const bell = Layer.succeed(Doorbell, {
    ring: Effect.fnUntraced(function* (to, stream, rev) {
      const send = ring(to, stream, rev);
      const pending = yield* notifications;

      if (pending === null) {
        return yield* send;
      }

      const context = yield* Effect.context<never>();
      pending.push(send.pipe(Effect.provideContext(context)));
    }),
  });
  const ledgerLayer = Layer.mergeAll(
    Ledger.sql(sql, { reader: `project:${name}` }),
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
        recipient: Recipient.cases.client.make({ client: "brain", session: yield* ids.next }),
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
    "CREATE TABLE IF NOT EXISTS dev_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)",
  );

  if (!sql.exec("PRAGMA table_info(dev_descriptors)").some((column) => column.name === "pending")) {
    sql.exec("ALTER TABLE dev_descriptors ADD COLUMN pending INTEGER NOT NULL DEFAULT 0");
  }

  const configure = Effect.fnUntraced(function* (pid: string) {
    const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=? AND pending=1", pid);

    if (saved === undefined) {
      return;
    }

    const descriptor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(saved.value).pipe(
      Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
    );
    yield* rpc(ProcessClient.make(processStub(env, name, descriptor.name)).configure(descriptor));
    sql.exec("UPDATE dev_descriptors SET pending=0 WHERE process=?", pid);
  });
  /** A process ID's life from history, first or successor; an unknown ID is refused. */
  const resolved = (pid: string) =>
    processes
      .resolve(pid)
      .pipe(Effect.catchTag("ProcessError", () => Effect.fail(new LedgerError({ reason: "refused" }))));
  /** The registered name whose object stores this process ID. */
  const processObject = (pid: string) => Effect.map(resolved(pid), (life) => life.name);
  type InputPolicy = { inputs: Array<string>; events: Array<string> };
  const policies = new Map<string, InputPolicy>();
  const remember = (owner: string, declaration: typeof loaded.declaration): InputPolicy => {
    const policy = {
      inputs: Object.entries(declaration.inputs)
        .filter(([, p]) => p.personOnly)
        .map(([name]) => name),
      events: Object.entries(declaration.writes)
        .filter(([, p]) => p.personOnly)
        .map(([name]) => name),
    };
    policies.set(owner, policy);
    return policy;
  };

  for (const process of yield* processes.info) {
    const program = yield* loader.load(process.program, process.process);
    remember(process.name, program.declaration);

    if (sql.exec("SELECT process FROM dev_descriptors WHERE process=?", process.process).length === 0) {
      const descriptor = yield* rpc(ProcessClient.make(processStub(env, name, process.name)).descriptor());
      sql.exec(
        "INSERT INTO dev_descriptors (process,value) VALUES (?,?)",
        process.process,
        JSON.stringify({ ...descriptor, id: process.process, build: process.build }),
      );
    }

    yield* configure(process.process);
  }

  // Routing follows history: an earlier ID of a name takes its name's policy.
  const policy = Effect.fnUntraced(function* (pid: string) {
    const life = yield* resolved(pid);
    const known = policies.get(life.name);

    if (known !== undefined) {
      return known;
    }

    const program = yield* loader
      .load(life.state.code.program, life.state.process)
      .pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
    return remember(life.name, program.declaration);
  });
  const notify = Effect.fnUntraced(function* (client: string, news: unknown) {
    const [row] = sql.exec("SELECT connection FROM dev_clients WHERE client=?", client);

    if (row !== undefined) {
      yield* rpc(GatewayClient.make(env.CONNECTION.getByName(String(row.connection))).notify(client, news));
    }
  });
  sql.exec(
    "CREATE TABLE IF NOT EXISTS dev_clients (client TEXT PRIMARY KEY, connection TEXT NOT NULL, session TEXT NOT NULL)",
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
        processObject(pid).pipe(
          Effect.flatMap((owner) => rpc(ProcessClient.make(processStub(env, name, owner)).msg(incoming))),
        ),
      open: (pid, client) =>
        processObject(pid).pipe(
          Effect.flatMap((owner) => rpc(ProcessClient.make(processStub(env, name, owner)).open(client))),
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
              Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
            ),
          ),
        ),
      wait: referee.wait,
    })
    .pipe(Effect.provideContext(services));
  const gateways = yield* Connections.pipe(
    Effect.provide(
      Connections.layer(sql, {
        probe: (gateway, session) => rpc(GatewayClient.make(env.CONNECTION.getByName(gateway)).probe(session)),
        admitted: (key) =>
          members.members.pipe(
            Effect.flatMap((m) =>
              Effect.forEach(
                [...m.keys.keys()],
                (raw) =>
                  Effect.gen(function* () {
                    if ("reason" in admitted(m, raw)) {
                      return false;
                    }

                    return raw === key || (yield* fingerprint(raw)) === key;
                  }),
                { concurrency: 1 },
              ),
            ),
            Effect.map((values) => values.some(Boolean)),
          ),
      }),
    ),
    Effect.provideContext(services),
  );
  const from = Effect.fn(function* (parent: string | null = null) {
    return yield* fromHere({ by, for: config.person, seen: 0, parent, build: config.build }).pipe(Effect.orDie);
  });
  const start = Effect.fnUntraced(function* (request: Start, origin: From) {
    if (!Object.hasOwn(programs, request.code.program)) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const program = yield* loader.load(request.code.program, `project:${name}/${request.name}`);
    const result = yield* write(
      Effect.gen(function* () {
        const result = yield* processes.start(request, origin);
        remember(request.name, program.declaration);
        const descriptor = {
          id: result.process,
          name: request.name,
          program: request.code.program,
          build: request.code.hash,
          owner: Writer.cases.person.make({ key: founder.by, for: config.person }),
        };
        // Only a first start configures its name's object. A successor shares that object, which
        // may be the caller awaiting this start, so it is recorded here and never called back.
        sql.exec(
          "INSERT OR IGNORE INTO dev_descriptors (process,value,pending) VALUES (?,?,?)",
          result.process,
          JSON.stringify(descriptor),
          request._tag === "first" ? 1 : 0,
        );
        return result;
      }),
    );

    if (request._tag === "first") {
      yield* configure(result.process);
    }

    return result;
  });
  const exit = (pid: string, reason: string, origin: From) =>
    Effect.gen(function* () {
      yield* processes.exit(pid, reason, origin);
      yield* door.retire(pid);
    }).pipe(write);
  const original = yield* ledger.read(`processes/${bootstrap.name}`, 0).pipe(
    Stream.filter((entry) => entry.id === bootstrap.id),
    Stream.runHead,
    Effect.map(Option.getOrUndefined),
  );
  const Bootstrap = Schema.Struct({ process: Schema.String });
  const boot =
    original !== undefined
      ? {
          process: (yield* Schema.decodeUnknownEffect(Bootstrap)(original.body).pipe(
            Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
          )).process,
          rev: original.rev,
        }
      : yield* start(
          Start.cases.first.make({
            id: bootstrap.id,
            name: bootstrap.name,
            code: { program: bootstrap.program, hash: loaded.hash },
          }),
          yield* from(),
        );
  const wrapped = <A, E>(effect: Effect.Effect<A, E>) => complete(effect).pipe(Effect.provideContext(services));
  const own = Effect.fn("project.own")(function* (pid: string, id: string, stream: string, event: unknown) {
    if (!(yield* processes.isLive(pid))) {
      return yield* new LedgerError({ reason: "refused" });
    }

    if (stream.startsWith("gateway/") || stream.startsWith("processes")) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const body = yield* Schema.decodeUnknownEffect(Event)(event).pipe(
      Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
    );
    const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", pid);

    if (saved === undefined) {
      return yield* new LedgerError({ reason: "bad_row" });
    }

    const descriptor = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ owner: Writer, build: Schema.String })),
    )(saved.value).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
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
    return yield* ledger.append("gateway/brain", event.id, lineFor(yield* from(), event));
  });
  yield* flushed.pipe(Effect.provideContext(services));
  return {
    target: door.target,
    register: (client: string, gateway: string, session: string) =>
      Effect.sync(() => {
        sql.exec(
          "INSERT INTO dev_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET connection=excluded.connection,session=excluded.session",
          client,
          gateway,
          session,
        );
      }),
    publish: (client: string, update: unknown) =>
      notify(
        client,
        typeof update === "object" && update !== null && "type" in update
          ? { method: update.type === "whole" ? "view.whole" : "view.patch", params: update }
          : update,
      ),
    connect: () => wrapped(door.connect()),
    challenge: (client: ConnectionId) => wrapped(door.challenge(client)),
    initialize: (client: ConnectionId, input: unknown, trusted: { url: string; tab: string; name: string }) =>
      wrapped(door.initialize(client, input, trusted)),
    route: (client: ConnectionId, method: string, params: unknown, reader?: string) =>
      wrapped(door.route(client, method, params, reader)),
    knock: (client: ConnectionId, input: { label: string }) => wrapped(door.knock(client, input)),
    grant: (input: unknown) => wrapped(door.grant(input)),
    disconnect: (client: ConnectionId) => wrapped(door.disconnect(client)),
    join: Effect.fnUntraced(function* (row: Parameters<typeof gateways.join>[0]) {
      sql.exec(
        "INSERT INTO dev_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET connection=excluded.connection,session=excluded.session",
        row.client,
        row.gateway,
        row.session,
      );
      yield* wrapped(gateways.join(row));
    }),
    leave: Effect.fnUntraced(function* (client: string, session: string) {
      sql.exec("DELETE FROM dev_clients WHERE client=? AND session=?", client, session);
      yield* wrapped(gateways.leave(client, session));
    }),
    online: (key: string) => wrapped(gateways.online(key)),
    info: wrapped(processes.info),
    start: (request: Start, origin: From) => wrapped(start(request, origin)),
    exit: (pid: string, reason: string, origin: From) => wrapped(exit(pid, reason, origin)),
    read: referee.read,
    wait: referee.wait,
    append: referee.append,
    sign: (pid: string, id: string, parent: string, kind: string) => wrapped(door.sign(pid, id, parent, kind)),
    commit: (pid: string, input: Omit<Parameters<typeof door.append>[0], "process">) =>
      wrapped(door.append({ ...input, process: pid })),
    inbox: (pid: string, input: Incoming) =>
      wrapped(
        Effect.gen(function* () {
          if (!(yield* processes.isLive(pid))) {
            return yield* new LedgerError({ reason: "refused" });
          }

          yield* door.checkDelivery(pid, input);
          const row = (yield* processes.info).find((r) => r.process === pid);

          if (row === undefined) {
            return yield* new LedgerError({ reason: "refused" });
          }

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
              Schema.TaggedStruct("send", { m: Schema.Json }).make({
                m: yield* Schema.decodeUnknownEffect(Schema.Json)(input.envelope.input).pipe(
                  Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
                ),
              }),
            ),
          );
        }).pipe(write),
      ),
    own: (pid: string, id: string, stream: string, event: unknown, trace?: { traceId: string; spanId: string }) => {
      const work = own(pid, id, stream, event);
      return wrapped(write(trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace)))));
    },
    brain: (event: typeof BrainEvent.Type) => wrapped(brain(event)),
    // ProcessManager over trusted Project RPC: refusals are reply data, mutations take the turn.
    processObject: (pid: string) => wrapped(processObject(pid)),
    processStart: (request: Start, origin: From) => wrapped(processReply(start(request, origin))),
    processExit: (pid: string, reason: string, origin: From) => wrapped(processReply(exit(pid, reason, origin))),
    processStatus: (owner: string) => wrapped(processReply(processes.status(owner))),
    processResolve: (pid: string) => wrapped(processReply(processes.resolve(pid))),
    processDead: (pid: string, dead: Parameters<typeof processes.dead>[1], origin: From) =>
      wrapped(processReply(write(processes.dead(pid, dead, origin)))),
    processIsLive: (pid: string) => wrapped(processes.isLive(pid)),
    processMonitor: (ref: string, pid: string, origin: From) =>
      wrapped(processReply(write(processes.monitor(ref, pid, origin)))),
    processDemonitor: (ref: string, origin: From) => wrapped(processReply(write(processes.demonitor(ref, origin)))),
    processDown: (pid: string, policy: Parameters<typeof processes.down>[1], origin: From) =>
      wrapped(processReply(write(processes.down(pid, policy, origin)))),
    processReceive: (pid: string, after: number) =>
      wrapped(processReply(Stream.runCollect(processes.receive(pid, after)))),
    boot,
  };
});

export class ProjectService extends Context.Service<ProjectService, Effect.Success<ReturnType<typeof projectLogic>>>()(
  "fabrika/Project",
) {}

export const projectLayer = (ctx: DurableObjectState, env: Env, options: ProjectOptions) =>
  Layer.effect(ProjectService, projectLogic(ctx, env, options)).pipe(
    Layer.provide(Layer.merge(ProcessIdGenerator.layer, Id.Generator.layer)),
  );

export const projectRuntime = (ctx: DurableObjectState, env: Env, options: ProjectOptions) =>
  ManagedRuntime.make(projectLayer(ctx, env, options));

// The trace a delivered letter carries from the door, as P11's Incoming names it.
const Delivered = Schema.Struct({
  span: Schema.Struct({ traceId: Schema.String, spanId: Schema.String }),
});

const processLogic = Effect.fnUntraced(function* (
  ctx: DurableObjectState,
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
) {
  // The object is its registered name's; its first process's descriptor names its storage.
  const [project] = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
  )(ctx.id.name).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
  const stub = projectStub(env, project),
    p = ProjectClient.make(stub),
    storage = StorageClient.make(ctx.storage),
    sql = cloudflareSql(ctx.storage),
    loader = workerLoader(env.LOADER, programs);
  const saved = yield* processDescriptor(ctx);
  const ledger = Ledger.remote(stub, { reader: saved.id });
  const base = Layer.mergeAll(ledger, recordingLayer(sql, env, project, saved.id));
  const all = Layer.mergeAll(ProcessStore.layer(sql, { process: saved.id, storage }), Mailbox.layer).pipe(
    Layer.provideMerge(base),
  );
  const services = yield* Layer.build(all);
  const store = Context.get(services, ProcessStore),
    sink = Context.get(services, SpanSink);
  // The name's live process, as the manager's status last answered it. Writes, loading and span
  // attribution follow it, so a successor signs and appends as itself.
  let active = saved.id;
  // Every manager call is idempotent by its own IDs, so an answer the transport lost is asked again,
  // a bounded number of times. A refusal is an answer and is never asked again.
  const asked = <A, E>(work: Effect.Effect<A, E>) =>
    work.pipe(
      Effect.retry({
        times: 2,
        while: (error) => error instanceof LedgerError && error.reason === "unreachable",
      }),
    );
  const manager: ProcessCalls = {
    start: (request, from) => asked(rpc(p.processStart(request, from))).pipe(Effect.flatMap(processValue)),
    exit: (process, reason, from) =>
      asked(rpc(p.processExit(process, reason, from))).pipe(Effect.flatMap(processValue)),
    info: Effect.suspend(() => asked(rpc(p.info()))),
    status: (name) =>
      asked(rpc(p.processStatus(name))).pipe(
        Effect.flatMap(processValue),
        Effect.tap((status) =>
          Effect.sync(() => {
            if (name === saved.name && status.state._tag === "live") {
              active = status.state.process;
            }
          }),
        ),
      ),
    resolve: (process) => asked(rpc(p.processResolve(process))).pipe(Effect.flatMap(processValue)),
    dead: (process, dead, from) => asked(rpc(p.processDead(process, dead, from))).pipe(Effect.flatMap(processValue)),
    isLive: (process) => asked(rpc(p.processIsLive(process))),
    monitor: (ref, process, from) =>
      asked(rpc(p.processMonitor(ref, process, from))).pipe(Effect.flatMap(processValue)),
    demonitor: (ref, from) => asked(rpc(p.processDemonitor(ref, from))).pipe(Effect.flatMap(processValue)),
    receive: (process, after) => asked(rpc(p.processReceive(process, after))).pipe(Effect.flatMap(processValue)),
    down: (process, policy, from) =>
      asked(rpc(p.processDown(process, policy, from))).pipe(Effect.flatMap(processValue)),
  };
  const publish = Effect.fn("process.publish")(function* (client: string, update: unknown) {
    yield* rpc(p.publish(client, update));
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(CheckedWriter, {
      sign: (id, parent, kind) =>
        Effect.suspend(() => rpc(p.sign(active, id, parent, kind))).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SigningReply)),
          Effect.mapError(() => new LedgerError({ reason: "unreachable" })),
          Effect.flatMap(checkedValue),
        ),
      append: (input) => Effect.suspend(() => rpc(p.inbox(active, input))),
      commit: (id, session, stream, event) =>
        Effect.suspend(() =>
          rpc(p.commit(active, { id, parent: session.parent, kind: event._tag, stream, event })),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CommitReply)),
          Effect.mapError(() => new LedgerError({ reason: "unreachable" })),
          Effect.flatMap(checkedValue),
        ),
      own: Effect.fn("process.own")(function* (id: string, stream: string, event: unknown) {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie);
        return yield* rpc(p.own(active, id, stream, event, { traceId: span.traceId, spanId: span.spanId }));
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
    Layer.succeed(Recording, { flush: sink.flush.pipe(Effect.provideContext(services)) }),
    remoteProcessManager(manager),
  );
  // P34 on the Worker: receipts and pending recovery live in this object's own SQLite, beside
  // ProcessStore, under the registered name every successor shares.
  const runnerLayer = ProgramRunner.withLoader(
    saved,
    { load: (name) => Effect.suspend(() => loader.load(name, active)) },
    { policy: defaultPolicy, recovery: { sql, name: saved.name, capacity: 1024 ** 3 } },
  ).pipe(Layer.provide(dependencies), Layer.provide(Layer.succeedContext(services)));
  const runner = yield* ProgramRunner.pipe(Effect.provide(runnerLayer));
  yield* sink.flush.pipe(Effect.provideContext(services));
  const attributed = <A, E>(work: Effect.Effect<A, E>) =>
    Effect.suspend(() => work.pipe(Effect.annotateSpans({ "fab.process": active }), Effect.provideContext(services)));
  return {
    msg: (input: unknown) => {
      const work = attributed(runner.msg(input));
      // The door's input span is in another object, so its trace crosses the call as data.
      const sent = Schema.decodeUnknownOption(Delivered)(input);
      return Option.isSome(sent) ? work.pipe(Effect.withParentSpan(Tracer.externalSpan(sent.value.span))) : work;
    },
    open: (client: string) => attributed(runner.open(client)),
    due: (at: number) => attributed(runner.due(at)),
    restart: (request: unknown) =>
      Schema.decodeUnknownEffect(RestartRequest)(request).pipe(
        Effect.mapError(() => new LedgerError({ reason: "bad_row" })),
        Effect.flatMap((checked) => attributed(runner.restart(checked))),
      ),
    // A platform alarm delivers the saved due time, so a repeated alarm is the same letter.
    alarm: () =>
      rpc(storage.get<number>("wake")).pipe(
        Effect.flatMap((at) => (at === undefined ? Effect.void : attributed(runner.due(at)))),
      ),
    activity: store.activity,
    recover: () =>
      rpc(storage.get("activity")).pipe(Effect.flatMap((value) => Effect.fromResult(recoverActivity(value)))),
  };
});

export class ProcessService extends Context.Service<ProcessService, Effect.Success<ReturnType<typeof processLogic>>>()(
  "fabrika/Process",
) {}

export const processRuntime = (ctx: DurableObjectState, env: Env, programs: Readonly<Record<string, ProgramSource>>) =>
  ManagedRuntime.make(Layer.effect(ProcessService, processLogic(ctx, env, programs)));
