import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
import {
  type Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
  Stream,
  Tracer,
} from "effect";
import { Base64, Base64Url } from "effect/encoding";
import * as Redacted from "effect/Redacted";
import { admitted } from "../access/Access.ts";
import { ClientManager } from "../access/ClientManager.ts";
import * as ClientManagerLedger from "../access/ClientManagerLedger.ts";
import {
  NotGranted,
  type SessionManagerError,
  SigningRefused,
  Writer,
  type Session,
} from "../access/SessionManager.ts";
import * as Id from "../Id.ts";
import type { Jobs } from "../jobs/Jobs.ts";
import * as JobsLedger from "../jobs/JobsLedger.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerRemote from "../ledger/LedgerRemote.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerStreams } from "../ledger/LedgerStreams.ts";
import * as LedgerStreamsSql from "../ledger/LedgerStreamsSql.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Appended, type Entry, fromHere, lineFor, type Waited } from "../ledger/Log.ts";
import { Referee } from "../ledger/Referee.ts";
import * as RefereeSql from "../ledger/RefereeSql.ts";
import { Connections } from "../presence/Connections.ts";
import { type Child, Children, ChildrenError, type StartGrant, type Started } from "../processes/Children.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { decodeExitReason, type ExitReason } from "../processes/ExitReason.ts";
import { Mailbox, type From, type Letter } from "../processes/Mailbox.ts";
import {
  type Activity,
  type DeadInput,
  Owner,
  ProcessError,
  type ProcessInfo,
  Recipient,
  type Recovered,
  recoverActivity,
  Start,
  type StartAnswer,
  type State,
} from "../processes/Process.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { ProcessManager, remoteProcessManager, type ProcessCalls } from "../processes/ProcessManager.ts";
import { ProgramMail, type ProgramMailError, type Delivery, type Grants } from "../processes/ProgramMail.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import * as Audit from "../runtime/Audit.ts";
import type { BrainEvent } from "../runtime/BrainEvent.ts";
import { Alarm, CheckedWriter, Recording, type Incoming } from "../runtime/Entry.ts";
import type { Declaration } from "../runtime/Execution.ts";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramDown } from "../runtime/Program.ts";
import type { RecoveryStoreError } from "../runtime/RecoveryStore.ts";
import type { RepliesError } from "../runtime/Replies.ts";
import type { Descriptor, Opened, RunnerError } from "../runtime/Runner.ts";
import { defaultPolicy, ProgramRunner, Sent } from "../runtime/Runner.ts";
import type { Publication } from "../runtime/WatcherManager.ts";
import type { WatchersError } from "../runtime/Watchers.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import * as SettingsStart from "../settings/Start.ts";
import * as Starts from "../settings/Starts.ts";
import { type Sql } from "../Sql.ts";
import { Archive, type BucketCalls } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { SinkError } from "../telemetry/Trace.ts";
import { Answer, RateCountFailure } from "../transport/Wire.ts";
import {
  ChildReplies,
  CommitReply,
  MailReplies,
  type MailReply,
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
import { cloudflareSql } from "./CloudflareSql.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import { mailLayer } from "./mail.ts";
import type { RecordShape } from "./objects.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient } from "./platform.ts";
import * as Publish from "./Publish.ts";
import * as SettingsInput from "./SettingsInput.ts";
import * as SettingsRecorded from "./SettingsRecorded.ts";
import * as SettingsRuntime from "./SettingsRuntime.ts";
import * as SettingsStartsLedger from "./SettingsStartsLedger.ts";
import * as SettingsStartsRemote from "./SettingsStartsRemote.ts";
import { bind as bindTail } from "./tail.ts";
import * as WatcherManagerRemote from "./WatcherManagerRemote.ts";

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
  readonly INSTANCE: string;
  readonly PROJECT: DurableObjectNamespace<ProjectBinding>;
  readonly PROCESS: DurableObjectNamespace<ProcessBinding>;
  readonly CONNECTION: DurableObjectNamespace<ConnectionBinding>;
  readonly RECORD: DurableObjectNamespace<RecordBinding>;
  readonly LOADER: WorkerLoader;
  readonly MEASUREMENTS: R2Bucket;
}

export type BrainOptions = SettingsStart.Input;

/**
 * Decodes the `INSTANCE` binding's JSON as a start's input and checks its settings. Returns the
 * input, the decoded values and the snapshot in its canonical encoding. It records nothing.
 *
 * @stability unstable
 * @category decoding
 */
export const settings = (env: Pick<Env, "INSTANCE">) => SettingsInput.decode(env.INSTANCE);

const checkedSettings = (env: Env) =>
  settings(env).pipe(Effect.mapError((cause) => new Starts.StartsError({ reason: new Starts.Decode({ cause }) })));

type CheckedSettings = Effect.Success<ReturnType<typeof settings>>;

/**
 * Layer that provides `RecordedStart` to a Worker or an object by recording the start with the
 * Project object.
 *
 * **Details**
 *
 * It takes the start's input from the `INSTANCE` binding, or from `input` when one is given, and
 * records it over RPC with the Project object the input names. The Project object does not use
 * this layer: it records the start in its own ledger.
 *
 * @stability unstable
 * @category layers
 */
export function recordedLayer(env: Env): Layer.Layer<RecordedStart, Starts.StartsError>;
export function recordedLayer(
  env: Env,
  input: Effect.Effect<CheckedSettings, LedgerError>,
): Layer.Layer<RecordedStart, LedgerError | Starts.StartsError>;
export function recordedLayer(
  env: Env,
  input: Effect.Effect<CheckedSettings, LedgerError | Starts.StartsError> = checkedSettings(env),
) {
  return Layer.unwrap(
    input.pipe(
      Effect.map(({ input }) =>
        SettingsRecorded.layer(input).pipe(Layer.provide(SettingsStartsRemote.layer(projectStub(env, input.name)))),
      ),
    ),
  );
}

/**
 * @stability unstable
 */
export { SettingsRuntime };

/**
 * Converts a `Starts` answer into the reply sent over RPC: `ok` with the receipt, or the failure's
 * reason by its tag alone. The effect no longer fails with `StartsError`.
 *
 * @stability unstable
 * @category error handling
 */
export const settingsReply = <R>(work: Effect.Effect<SettingsStart.Receipt, Starts.StartsError, R>) =>
  work.pipe(
    Effect.map((value) => SettingsStart.Reply.cases.ok.make({ value })),
    Effect.catchReasons("StartsError", {
      Decode: () => Effect.succeed(SettingsStart.Reply.cases.Decode.make({})),
      Missing: () => Effect.succeed(SettingsStart.Reply.cases.Missing.make({})),
      Refused: () => Effect.succeed(SettingsStart.Reply.cases.Refused.make({})),
      Storage: () => Effect.succeed(SettingsStart.Reply.cases.Storage.make({})),
      Unreachable: () => Effect.succeed(SettingsStart.Reply.cases.Unreachable.make({})),
    }),
  );

/**
 * Replaces a `StartsError` with its wire summary, `Start.Failure`: the reason's tag and no cause.
 * Other failures pass through unchanged.
 *
 * **When to use**
 *
 * Use when a failure leaves the Worker or an object. A cause may hold the start's input, and this
 * keeps it inside.
 *
 * @stability unstable
 * @category error handling
 */
export const settingsFailure = <A, E, R>(work: Effect.Effect<A, E | Starts.StartsError, R>) =>
  work.pipe(
    Effect.catchIf(
      (error): error is Starts.StartsError => error instanceof Starts.StartsError,
      (error) =>
        Effect.fail(error).pipe(
          Effect.catchReasons("StartsError", {
            Decode: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Decode.make({}) }),
              ),
            Missing: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Missing.make({}) }),
              ),
            Refused: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Refused.make({}) }),
              ),
            Storage: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Storage.make({}) }),
              ),
            Unreachable: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Unreachable.make({}) }),
              ),
          }),
        ),
    ),
  );

/**
 * Wraps an object's context for its RPC methods, so a failed build crosses RPC as a fixed summary.
 *
 * **Details**
 *
 * `runPromise` gets the context, provides it to the work and runs it. When the context fails to
 * build, a `StartsError` becomes `Start.Failure`, and a `LedgerError` keeps only its `reason`.
 *
 * @stability unstable
 * @category constructors
 */
export const settingsWire = <R, E>(context: Effect.Effect<Context.Context<R>, E>) => {
  const contextEffect = settingsFailure(context).pipe(
    Effect.mapError((error) => (error instanceof LedgerError ? new LedgerError({ reason: error.reason }) : error)),
  );
  return {
    contextEffect,
    runPromise: <A, E2>(work: Effect.Effect<A, E2, R>) =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC sends only fixed settings failure summaries
      Effect.runPromise(contextEffect.pipe(Effect.flatMap((services) => Effect.provideContext(work, services)))),
  };
};

export interface ProjectDoorOptions {
  readonly sql: Sql;
  readonly founder: Parameters<typeof ClientManagerLedger.layer>[0];
  readonly turn: Semaphore.Semaphore;
  readonly write: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly policy: (process: string) => Effect.Effect<{ inputs: Array<string>; events: Array<string> }, LedgerError>;
  readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
  readonly audit: (process: string, message: unknown) => Effect.Effect<Schema.Json, Audit.AuditError>;
  readonly nextProcess: () => Effect.Effect<string>;
  readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError>;
  readonly deliver: (process: string, input: Incoming) => Effect.Effect<Sent, LedgerError>;
  readonly open: (process: string, client: string) => Effect.Effect<Schema.Json, LedgerError>;
  readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<unknown, LedgerError>;
}

type Boot = { readonly name: string; readonly id: string; readonly program: string };

export interface ProjectOptions {
  readonly input?: Effect.Effect<Effect.Success<ReturnType<typeof settings>>, LedgerError>;
  readonly mail?: { readonly grants: Grants };
  readonly config?: BrainOptions;
  readonly programs: Readonly<Record<string, ProgramSource>>;
  readonly bootstrap: readonly [Boot, ...ReadonlyArray<Boot>];
  /** Which program may start which (P42), a host right. None when absent. */
  readonly starts?: ReadonlyArray<typeof StartGrant.Type>;
  readonly door: (
    options: ProjectDoorOptions,
  ) => Effect.Effect<
    GatewayCalls,
    unknown,
    | Ledger
    | LedgerTransaction
    | Id.Generator
    | ClientManager
    | SpanSink
    | RecordManager
    | Archive
    | Jobs
    | RecordedStart
  >;
}

export const projectStub = (env: Env, name: string) => env.PROJECT.getByName(name);

/** One Process object per registered name: every process ID of that name, first or successor. */
export const processStub = (env: Pick<Env, "PROCESS">, project: string, name: string) =>
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

// Project initialization and calls cross RPC as rendered errors. Keep storage details inside the library.
const projectStorage = Effect.fnUntraced(function* <A, E, R>(
  work: Effect.Effect<A, E, R>,
): Effect.fn.Return<A, E | LedgerError, R> {
  const tracer = yield* Tracer.Tracer;
  const safe = Tracer.make({
    context: tracer.context,
    span(options) {
      const span = tracer.span(options);
      const attribute = span.attribute.bind(span);
      span.attribute = (key, value) => {
        if (key !== "fab.ledger.code") {
          attribute(key, key === "error.type" ? "LedgerError" : value);
        }
      };
      const end = span.end.bind(span);
      span.end = (time, exit) =>
        end(time, Exit.isSuccess(exit) ? exit : Exit.fail(new LedgerError({ reason: "storage" })));
      return span;
    },
  });
  return yield* work.pipe(
    Effect.withTracer(safe),
    Effect.mapError((error) => (Schema.is(LedgerError)(error) ? new LedgerError({ reason: error.reason }) : error)),
    Effect.catchDefect(() => Effect.fail(new LedgerError({ reason: "storage" }))),
  );
});

/** Checked refusals are replies; storage and descriptor failures remain retryable rejections. */
const childReply = (work: Effect.Effect<Started, unknown>): Effect.Effect<typeof ChildReplies.Type, LedgerError> =>
  work.pipe(
    Effect.map((value) => ChildReplies.cases.ok.make({ value })),
    Effect.catch((error): Effect.Effect<typeof ChildReplies.Type, LedgerError> =>
      error instanceof ChildrenError && error.reason !== "storage"
        ? Effect.succeed(ChildReplies.cases.ChildrenError.make({ reason: error.reason }))
        : Effect.fail(new LedgerError({ reason: "storage" })),
    ),
  );

const processValue = Effect.fnUntraced(function* <A>(reply: ProcessReply<A>) {
  if (reply._tag === "ok") {
    return reply.value;
  }

  const refused = yield* Schema.decodeUnknownEffect(ProcessReplies.cases.ProcessError)(reply).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
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

/** Saves the descriptor, then runs the new process's first turn before the start answers.
 *  A child's first letter waits in its inbox, so `drain` also wakes it (P42): its first alarm steps
 *  that letter, as a wake schedules a mail drain, with no client call. A saved wake is kept. */
export const configureProcess = Effect.fn("process.configure")(function* <E>(
  ctx: DurableObjectState,
  descriptor: Descriptor,
  runtime: { readonly contextEffect: Effect.Effect<Context.Context<ProcessService>, E> },
  drain = false,
) {
  const storage = StorageClient.make(ctx.storage);
  yield* rpc(storage.put("descriptor", descriptor));
  const services = yield* runtime.contextEffect;
  yield* ProcessService.use((p) => p.init()).pipe(Effect.provideContext(services));

  // After init, which sets the alarm from the program's own wake and may clear it.
  if (drain) {
    const saved = yield* rpc(storage.get<number>("wake"));
    const at = saved ?? (yield* Clock.currentTimeMillis);

    if (saved === undefined) {
      yield* rpc(storage.put("wake", at));
    }

    yield* rpc(storage.setAlarm(at));
  }
});

export const savedAlarm = Effect.fn("process.savedAlarm")(function* (ctx: DurableObjectState) {
  return yield* rpc(StorageClient.make(ctx.storage).get<number>("wake"));
});

export const processDescriptor = Effect.fn("process.descriptor")(function* (ctx: DurableObjectState) {
  const descriptor = yield* rpc(StorageClient.make(ctx.storage).get("descriptor"));
  return yield* Schema.decodeUnknownEffect(SavedDescriptor)(descriptor).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
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
  const fail = (cause: unknown) => new LedgerError({ reason: "crypto", cause });
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

export const complete = Effect.fn(function* <A, E, R>(
  work: Effect.Effect<A, E, R>,
  counted: (value: A) => boolean = () => false,
) {
  return yield* work.pipe(
    Effect.exit,
    Effect.flatMap((exit) => {
      if (Option.exists(Exit.findErrorOption(exit), Schema.is(RateCountFailure))) {
        return exit;
      }

      // Counted refusals have nothing to send. Retrying an old archive here would add a row per refusal.
      if (
        Exit.isSuccess(exit) &&
        (counted(exit.value) ||
          (Schema.is(Answer.cases.refused)(exit.value) && ["reserved", "rate_limited"].includes(exit.value.reason)))
      ) {
        return exit;
      }

      return flushed.pipe(
        Effect.flatMap(() => exit),
        Effect.catch((error) => (Exit.isFailure(exit) ? exit : Effect.fail(error))),
      );
    }),
  );
});

export const recordingLayer = (sql: Sql, env: Env, project: string, object: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const start = yield* RecordedStart;
      const services = yield* Layer.build(
        Layer.mergeAll(recordLayer(env, project), archiveLayer(env), SpanSink.layer(sql, { object })),
      );
      const tracer = yield* Tracer.Tracer.pipe(Effect.provideContext(services));
      return Context.add(
        services,
        Tracer.Tracer,
        Tracer.make({
          context: tracer.context,
          span: (options) => {
            const span = tracer.span(options);
            span.attribute("fab.settings", start.snapshot.hash);
            span.attribute("fab.build", start.input.build);
            return span;
          },
        }),
      );
    }),
  );

const fingerprint = Effect.fnUntraced(function* (value: string) {
  const ssh = value.startsWith("ssh-");
  const blob = ssh ? Base64.decode(value.trim().split(/\s+/)[1] ?? "") : Base64Url.decode(value);

  if (Result.isFailure(blob)) {
    return yield* new LedgerError({ reason: "bad_row", cause: blob.failure });
  }

  const bytes = blob.success.slice(-32);
  const fail = (cause: unknown) => new LedgerError({ reason: "crypto", cause });
  // SSH Ed25519 blobs end with the 32 public bytes. P10 uses this same key fingerprint.
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
  const hash = yield* work;
  return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});

const projectLedger = (ctx: DurableObjectState, env: Env, name: string) => {
  const sql = cloudflareSql(ctx.storage);
  const turn = Semaphore.makeUnsafe(1);
  const notifications = Context.Reference<Array<Effect.Effect<void, LedgerError>> | null>(
    "@kampus/libfabrika/cloudflare/runtime.WriteNotifications",
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
    LedgerSql.layer(sql, { reader: `project:${name}` }),
    LedgerTransactionSql.layer(sql),
    RefereeSql.layer(sql),
    LedgerStreamsSql.layer(sql),
  ).pipe(Layer.provide(bell));
  const starts = SettingsStartsLedger.fromLedger().pipe(Layer.provide(ledgerLayer));
  return { sql, turn, write, ledgerLayer, starts };
};

const projectLogic = Effect.fn("project.init")(function* (
  ctx: DurableObjectState,
  env: Env,
  options: ProjectOptions,
  local: ReturnType<typeof projectLedger>,
) {
  const checked = yield* RecordedStart;
  const config = { ...checked.input, ...checked.input.founding, port: checked.values.port };
  const { programs, bootstrap } = options;
  const name = ctx.id.name ?? config.name;
  const { sql, turn, write, ledgerLayer } = local;
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
  const base = Layer.mergeAll(ledgerLayer, recordingLayer(sql, env, name, `project:${name}`));
  const processManager = ProcessManager.layer(
    {
      by,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: yield* ids.next }),
    },
    ids.next,
  );
  const managers = Layer.mergeAll(
    JobsLedger.layer,
    ClientManagerLedger.layer(founder),
    // P42: a child start decides in the turns of the manager that writes it.
    ChildrenLedger.layer({ grants: options.starts ?? checked.input.starts ?? [] }).pipe(
      Layer.provideMerge(processManager),
    ),
  ).pipe(Layer.provideMerge(base));
  const services = Context.add(
    yield* Layer.build(managers).pipe(Effect.provideService(RecordedStart, checked)),
    RecordedStart,
    checked,
  );
  const mail = yield* ProgramMail.pipe(
    Effect.provide(
      ProgramMailLedger.layer({ grants: options.mail?.grants ?? checked.input.mail?.grants ?? {} }).pipe(
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  const ledger = Context.get(services, Ledger),
    referee = Context.get(services, Referee),
    members = Context.get(services, ClientManager),
    processes = Context.get(services, ProcessManager),
    children = Context.get(services, Children);
  const loader = workerLoader(env.LOADER, programs);
  // Validate the whole list before starting any entry.
  const loaded = yield* Effect.forEach(
    bootstrap,
    Effect.fnUntraced(function* (entry) {
      const program = yield* loader.load(entry.program, `project:${name}`);
      return { entry, program };
    }),
    { concurrency: 1 },
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS dev_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)",
  );

  if (!sql.exec("PRAGMA table_info(dev_descriptors)").some((column) => column.name === "pending")) {
    sql.exec("ALTER TABLE dev_descriptors ADD COLUMN pending INTEGER NOT NULL DEFAULT 0");
  }

  /** A start not yet delivered to its object: its saved descriptor, or undefined once delivered. */
  const decodePending = Effect.fnUntraced(function* (pid: string) {
    // Pending 2 is a child's: its configure also wakes it to drain its first letter.
    const [saved] = sql.exec("SELECT value, pending FROM dev_descriptors WHERE process=? AND pending>0", pid);

    if (saved === undefined) {
      return undefined;
    }

    const descriptor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(saved.value).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    return { descriptor, drain: saved.pending === 2 };
  });
  // The object's init may call back into this Project, so the build never waits on a delivery.
  const deliver = Effect.fnUntraced(function* (
    pid: string,
    { descriptor, drain }: { readonly descriptor: typeof SavedDescriptor.Type; readonly drain: boolean },
  ) {
    yield* rpc(ProcessClient.make(processStub(env, name, descriptor.name)).configure(descriptor, drain));
    sql.exec("UPDATE dev_descriptors SET pending=0 WHERE process=?", pid);
  });
  const configure = Effect.fnUntraced(function* (pid: string) {
    const saved = yield* decodePending(pid);

    if (saved !== undefined) {
      yield* deliver(pid, saved);
    }
  });
  /** A process ID's life from history, first or successor; an unknown ID is refused. */
  const resolved = (pid: string) =>
    processes
      .resolve(pid)
      .pipe(Effect.catchTag("ProcessError", (cause) => Effect.fail(new LedgerError({ reason: "refused", cause }))));
  /** The registered name whose object stores this process ID. */
  const processObject = (pid: string) => Effect.map(resolved(pid), (life) => life.name);
  type InputPolicy = { inputs: Array<string>; events: Array<string> };
  const policies = new Map<string, InputPolicy>();
  const remember = (owner: string, declaration: Declaration): InputPolicy => {
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
    const tail = yield* bindTail(ctx, { project: name, name: process.name, process: process.process }).pipe(
      Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
    );
    const program = yield* loader.load(process.program, process.process, tail);
    remember(process.name, program.declaration);

    if (sql.exec("SELECT process FROM dev_descriptors WHERE process=?", process.process).length === 0) {
      const life = yield* Context.get(services, LedgerTransaction).transact((turn) =>
        processes.table(turn).life(process.process),
      );
      const requester =
        Option.isSome(life) && life.value.request._tag === "first" ? life.value.request.requester : undefined;
      // A child's start may have committed before its descriptor. Its object has never been
      // configured, so rebuild from the saved life and its requester's recorded owner.
      const descriptor = yield* requester?._tag === "process"
        ? Effect.gen(function* () {
            const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", requester.process);
            const { owner } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(
              saved?.value,
            ).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
            return {
              id: process.process,
              name: process.name,
              program: process.program,
              build: process.build,
              owner,
            };
          })
        : rpc(ProcessClient.make(processStub(env, name, process.name)).descriptor());
      // Its pending row is delivered after the build, with the other starts.
      sql.exec(
        "INSERT INTO dev_descriptors (process,value,pending) VALUES (?,?,?)",
        process.process,
        JSON.stringify({ ...descriptor, id: process.process, build: process.build }),
        requester?._tag === "process" ? 2 : 0,
      );
    }
  }

  // Routing follows history: an earlier ID of a name takes its name's policy.
  const policy = Effect.fnUntraced(function* (pid: string) {
    const life = yield* resolved(pid);
    const known = policies.get(life.name);

    if (known !== undefined) {
      return known;
    }

    const tail = yield* bindTail(ctx, { project: name, name: life.name, process: life.state.process }).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    const program = yield* loader
      .load(life.state.code.program, life.state.process, tail)
      .pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    return remember(life.name, program.declaration);
  });
  const publish = Publish.make(sql, (connection, client, news) =>
    rpc(GatewayClient.make(env.CONNECTION.getByName(connection)).notify(client, news)),
  );
  const notify = (client: string, news: unknown) => publish(client, news).pipe(Effect.asVoid);
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
      audit: Effect.fn("project.audit")(function* (pid: string, message: unknown) {
        // Like processLogic, load this target's available build; its start record may name an older build.
        const program = yield* Effect.gen(function* () {
          const life = yield* resolved(pid);
          const tail = yield* bindTail(ctx, { project: name, name: life.name, process: life.state.process });
          return yield* loader.load(life.state.code.program, life.state.process, tail);
        }).pipe(
          Effect.mapError(
            (cause) => new Audit.AuditError({ reason: new Audit.Transport({ cause: Redacted.make(cause) }) }),
          ),
        );
        return yield* program.execution.audit(message);
      }),
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
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
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
  /** Places the process and records its descriptor; a first start's row stays pending until delivered. */
  const place = Effect.fnUntraced(function* (request: Start, origin: From) {
    if (!Object.hasOwn(programs, request.code.program)) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const program = yield* loader.load(request.code.program, `project:${name}/${request.name}`);
    return yield* write(
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
  });
  const start = Effect.fnUntraced(function* (request: Start, origin: From) {
    const result = yield* place(request, origin);

    if (request._tag === "first") {
      yield* configure(result.process);
    }

    return result;
  });
  /** A child start (P42): one write turn starts it and saves its descriptor, then its name's object is
   *  configured. A retry of a saved start configures only what is still pending. */
  const child = Effect.fnUntraced(function* (input: Child, origin: From) {
    const answer = yield* write(
      Effect.gen(function* () {
        const answer = yield* children.start(input, origin);

        if (answer._tag === "started") {
          // The child acts for the person its requester acts for, as the boot's child does.
          const [requester] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", input.requester.process);
          const { owner } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ owner: Writer })))(
            requester?.value,
          ).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
          const descriptor = {
            id: answer.process,
            name: answer.name,
            program: input.code.program,
            build: input.code.hash,
            owner,
          };
          sql.exec(
            "INSERT OR IGNORE INTO dev_descriptors (process,value,pending) VALUES (?,?,2)",
            answer.process,
            JSON.stringify(descriptor),
          );
        }

        return answer;
      }),
    );

    if (answer._tag === "started") {
      yield* configure(answer.process);
    }

    return answer;
  });
  // Project RPC input is untrusted: the reason is decoded before the turn or the retirement.
  const exit = Effect.fnUntraced(function* (pid: string, input: ExitReason, origin: From) {
    const reason = yield* Effect.fromResult(decodeExitReason(input)).pipe(
      Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
    );
    yield* Effect.gen(function* () {
      yield* processes.exit(pid, reason, origin);
      yield* door.retire(pid);
    }).pipe(write);
  });
  const Bootstrap = Schema.Struct({ process: Schema.String });
  const boots = yield* Effect.forEach(
    loaded,
    Effect.fnUntraced(function* ({ entry, program }) {
      const original = yield* ledger.read(`processes/${entry.name}`, 0).pipe(
        Stream.filter((fact) => fact.id === entry.id),
        Stream.runHead,
        Effect.map(Option.getOrUndefined),
      );
      return original !== undefined
        ? {
            process: (yield* Schema.decodeUnknownEffect(Bootstrap)(original.body).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            )).process,
            rev: original.rev,
          }
        : yield* place(
            Start.cases.first.make({
              id: entry.id,
              name: entry.name,
              code: { program: entry.program, hash: program.hash },
            }),
            yield* from(),
          );
    }),
    { concurrency: 1 },
  );
  const boot = boots[0];

  if (boot === undefined) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  // A malformed pending row still fails the build; only the deliveries run after it, as handle_continue.
  const pending = yield* Effect.forEach(
    sql.exec("SELECT process FROM dev_descriptors WHERE pending>0"),
    (row) => Effect.map(decodePending(String(row.process)), (saved) => [String(row.process), saved] as const),
    { concurrency: 1 },
  );
  yield* Effect.forkScoped(
    Effect.forEach(
      pending,
      ([pid, saved]) =>
        saved === undefined
          ? Effect.void
          : deliver(pid, saved).pipe(
              // The row stays pending, so the next load sends it again; the failure is still seen.
              Effect.catch((error) => Effect.logWarning(`start of ${pid} not delivered: ${error._tag}`)),
              Effect.onInterrupt(() => Effect.logWarning(`start of ${pid} not delivered: interrupted`)),
            ),
      { concurrency: 1, discard: true },
    ),
  );
  const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
    complete(effect).pipe(projectStorage, Effect.provideContext(services));
  const own = Effect.fn("project.own")(function* (pid: string, id: string, stream: string, event: unknown) {
    if (!(yield* processes.isLive(pid))) {
      return yield* new LedgerError({ reason: "refused" });
    }

    if (stream.startsWith("gateway/") || stream.startsWith("processes")) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const body = yield* Schema.decodeUnknownEffect(Event)(event).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", pid);

    if (saved === undefined) {
      return yield* new LedgerError({ reason: "bad_row" });
    }

    const descriptor = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ owner: Writer, build: Schema.String })),
    )(saved.value).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
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
    mail: (delivery: Delivery, trace?: { traceId: string; spanId: string }) => {
      const work: Effect.Effect<MailReply, ProgramMailError> = write(mail.deliver(delivery)).pipe(
        Effect.map((receipt): MailReply => MailReplies.cases.ok.make({ receipt })),
        Effect.catchTag("ProgramMailError", (error) =>
          error.reason === "storage"
            ? Effect.fail(error)
            : Effect.succeed(MailReplies.cases.refused.make({ reason: error.reason })),
        ),
      );
      return wrapped(trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace))));
    },
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
    publish,
    connect: () => wrapped(door.connect()),
    challenge: (client: ConnectionId) => wrapped(door.challenge(client)),
    initialize: (client: ConnectionId, input: unknown, trusted: { url: string; tab: string; name: string }) =>
      wrapped(door.initialize(client, input, trusted)),
    route: (client: ConnectionId, method: string, params: unknown, reader?: string) =>
      wrapped(
        door.route(client, method, params, reader).pipe(
          // Invalid target messages answer as checked refusals so the connection stays open.
          Effect.catch((error) =>
            Schema.is(Audit.AuditError)(error) && error.reason._tag === "Input"
              ? Effect.succeed(Answer.cases.ok.make({ result: Sent.cases.refused.make({ reason: "bad_msg" }) }))
              : Effect.fail(error),
          ),
        ),
      ),
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
    exit: (pid: string, reason: ExitReason, origin: From) => wrapped(exit(pid, reason, origin)),
    read: (stream: string, after: number, reader: string) => wrapped(referee.read(stream, after, reader)),
    wait: referee.wait,
    append: (stream: string, id: string, line: unknown) => wrapped(referee.append(stream, id, line)),
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
                  Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
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
    processExit: (pid: string, reason: ExitReason, origin: From) => wrapped(processReply(exit(pid, reason, origin))),
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
    processChild: (input: Child, origin: From) => wrapped(childReply(child(input, origin))),
    boot,
  };
}, projectStorage);

/** What a call fails with once its spans are flushed and its storage errors are rendered. */
type ProjectFailure = LedgerError | SinkError;

export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly mail: (
      delivery: Delivery,
      trace?: { traceId: string; spanId: string },
    ) => Effect.Effect<MailReply, ProgramMailError | ProjectFailure>;
    readonly target: GatewayCalls["target"];
    readonly register: (client: string, gateway: string, session: string) => Effect.Effect<void>;
    readonly publish: (client: string, update: unknown) => Effect.Effect<typeof Publication.Type, LedgerError>;
    // The door's calls. A door fails with `unknown`, which takes in every other failure.
    readonly connect: () => Effect.Effect<ConnectionId, ProjectFailure>;
    readonly challenge: (client: ConnectionId) => Effect.Effect<string, unknown>;
    readonly initialize: GatewayCalls["initialize"];
    readonly route: (
      client: ConnectionId,
      method: string,
      params: unknown,
      reader?: string,
    ) => Effect.Effect<typeof Answer.Type, unknown>;
    readonly knock: (client: ConnectionId, input: { label: string }) => Effect.Effect<typeof Answer.Type, unknown>;
    readonly grant: GatewayCalls["grant"];
    readonly disconnect: (client: ConnectionId) => Effect.Effect<void, unknown>;
    // Presence.
    readonly join: (row: {
      readonly key: string;
      readonly client: string;
      readonly gateway: string;
      readonly session: string;
      readonly at: number;
    }) => Effect.Effect<void, ProjectFailure>;
    readonly leave: (client: string, session: string) => Effect.Effect<void, ProjectFailure>;
    readonly online: (key: string) => Effect.Effect<
      ReadonlyArray<{
        readonly key: string;
        readonly client: string;
        readonly gateway: string;
        readonly session: string;
        readonly at: number;
        readonly state: "online" | "away" | "unknown";
      }>,
      ProjectFailure
    >;
    readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, ProjectFailure>;
    readonly start: (
      request: Start,
      origin: From,
    ) => Effect.Effect<StartAnswer, ProcessError | ProgramDown | ProjectFailure>;
    readonly exit: (pid: string, reason: ExitReason, origin: From) => Effect.Effect<void, unknown>;
    // The ledger, through the referee.
    readonly read: (
      stream: string,
      after: number,
      reader: string,
    ) => Effect.Effect<ReadonlyArray<Entry>, ProjectFailure>;
    readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<Waited, LedgerError>;
    readonly append: (stream: string, id: string, line: unknown) => Effect.Effect<Appended, ProjectFailure>;
    // A process's own writes.
    readonly sign: (pid: string, id: string, parent: string, kind: string) => Effect.Effect<Session, unknown>;
    readonly commit: (
      pid: string,
      input: {
        readonly id: string;
        readonly parent: string;
        readonly kind: string;
        readonly stream: string;
        readonly event: unknown;
      },
    ) => Effect.Effect<Appended, unknown>;
    readonly inbox: (pid: string, input: Incoming) => Effect.Effect<Appended, unknown>;
    readonly own: (
      pid: string,
      id: string,
      stream: string,
      event: unknown,
      trace?: { traceId: string; spanId: string },
    ) => Effect.Effect<Appended, Cause.NoSuchElementError | ProjectFailure>;
    readonly brain: (event: typeof BrainEvent.Type) => Effect.Effect<Appended, ProjectFailure>;
    // ProcessManager over trusted Project RPC: a refusal is reply data.
    readonly processObject: (pid: string) => Effect.Effect<string, ProjectFailure>;
    readonly processStart: (
      request: Start,
      origin: From,
    ) => Effect.Effect<ProcessReply<StartAnswer>, ProgramDown | ProjectFailure>;
    readonly processExit: (pid: string, reason: ExitReason, origin: From) => Effect.Effect<ProcessReply<void>, unknown>;
    readonly processStatus: (owner: string) => Effect.Effect<
      ProcessReply<{
        readonly name: string;
        readonly state: typeof State.Type;
        readonly at: number;
        readonly restarts: ReadonlyArray<number>;
      }>,
      ProjectFailure
    >;
    readonly processResolve: (
      pid: string,
    ) => Effect.Effect<ProcessReply<{ readonly name: string; readonly state: typeof State.Type }>, ProjectFailure>;
    readonly processDead: (
      pid: string,
      dead: typeof DeadInput.Type,
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processIsLive: (pid: string) => Effect.Effect<boolean, ProjectFailure>;
    readonly processMonitor: (
      ref: string,
      pid: string,
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processDemonitor: (ref: string, origin: From) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processDown: (
      pid: string,
      policy: { readonly reason: string; readonly crashes: number; readonly until: number },
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processReceive: (pid: string, after: number) => Effect.Effect<ProcessReply<Array<Letter>>, ProjectFailure>;
    readonly processChild: (input: Child, origin: From) => Effect.Effect<typeof ChildReplies.Type, ProjectFailure>;
    /** The bootstrap process and the rev of its start. */
    readonly boot: StartAnswer;
  }
>()("@kampus/libfabrika/cloudflare/runtime.ProjectService") {}

export const projectLayer = (
  ctx: DurableObjectState,
  env: Env,
  options: ProjectOptions,
  local = projectLedger(ctx, env, ctx.id.name ?? options.config?.name ?? "project"),
) => {
  const input: Effect.Effect<CheckedSettings, LedgerError | Starts.StartsError> = options.input ?? checkedSettings(env);
  return Layer.unwrap(
    input.pipe(
      Effect.map(({ input }) => {
        const starts = Layer.effect(
          Starts.Starts,
          Starts.Starts.pipe(
            Effect.map((starts) => ({
              record: (value: SettingsStart.Input) => local.write(starts.record(value)),
              read: starts.read,
            })),
          ),
        ).pipe(Layer.provide(local.starts));
        const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(starts));
        return Layer.effect(ProjectService, projectLogic(ctx, env, options, local)).pipe(
          Layer.provide(Layer.merge(ProcessIdGenerator.layer, Id.Generator.layer)),
          Layer.provide(recorded),
        );
      }),
    ),
  );
};

export const projectRuntime = (ctx: DurableObjectState, env: Env, options: ProjectOptions) => {
  const local = projectLedger(ctx, env, ctx.id.name ?? options.config?.name ?? "project");
  const minimal = SettingsRuntime.runtime(local.starts.pipe(Layer.provideMerge(local.ledgerLayer)));
  const ready = Layer.unwrap(
    minimal.contextEffect.pipe(
      Effect.map((services) =>
        projectLayer(ctx, env, options, {
          ...local,
          ledgerLayer: Layer.mergeAll(
            Layer.succeed(Ledger, Context.get(services, Ledger)),
            Layer.succeed(LedgerTransaction, Context.get(services, LedgerTransaction)),
            Layer.succeed(Referee, Context.get(services, Referee)),
            Layer.succeed(LedgerStreams, Context.get(services, LedgerStreams)),
          ),
          starts: Layer.succeed(Starts.Starts, Context.get(services, Starts.Starts)),
        }),
      ),
    ),
  );
  const runtime = SettingsRuntime.runtime(ready);
  const dispose = Effect.all([runtime.disposeEffect, minimal.disposeEffect], { discard: true, concurrency: 1 });
  return {
    ...runtime,
    disposeEffect: dispose,
    settingsStart: (input: SettingsStart.Input) =>
      minimal.provide(settingsReply(Starts.Starts.use((starts) => local.write(starts.record(input))))),
    settingsRead: (start: string) => minimal.provide(settingsReply(Starts.Starts.use((starts) => starts.read(start)))),
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the object owner closes both runtime scopes
    dispose: () => Effect.runPromise(dispose),
  };
};

/** Composes durable job storage on the Project's database for trusted startup code. */
export const projectJobsLayer = (ctx: DurableObjectState, env: Env) =>
  JobsLedger.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LedgerTransactionSql.layer(cloudflareSql(ctx.storage)),
        LedgerStreamsSql.layer(cloudflareSql(ctx.storage)),
      ),
    ),
    Layer.provide(
      Layer.succeed(Doorbell, {
        ring: (to, stream, rev) => rpc(GatewayClient.make(env.CONNECTION.getByName(to)).ring(stream, rev)),
      }),
    ),
    Layer.provide(Id.Generator.layer),
  );

// The trace a delivered letter carries from the door, as P11's Incoming names it.
const Delivered = Schema.Struct({
  span: Schema.Struct({ traceId: Schema.String, spanId: Schema.String }),
});

const processLogic = Effect.fnUntraced(function* (
  ctx: DurableObjectState,
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
) {
  const checked = yield* RecordedStart;
  // The object is its registered name's; its first process's descriptor names its storage.
  const [project] = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
  )(ctx.id.name).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
  const stub = projectStub(env, project),
    p = ProjectClient.make(stub),
    storage = StorageClient.make(ctx.storage),
    sql = cloudflareSql(ctx.storage),
    loader = workerLoader(env.LOADER, programs);
  const saved = yield* processDescriptor(ctx);
  const ledger = LedgerRemote.layer(stub, { reader: saved.id });
  const base = Layer.mergeAll(ledger, recordingLayer(sql, env, project, saved.id));
  const all = Layer.mergeAll(ProcessStore.layer(sql, { process: saved.id, storage }), Mailbox.layer).pipe(
    Layer.provideMerge(base),
  );
  const services = yield* Layer.build(all).pipe(Effect.provideService(RecordedStart, checked));
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
  // A child start is decided in the project, in its ledger's turns; this side asks, as for a start.
  const children = Children.of({
    start: (input, from) =>
      asked(rpc(p.processChild(input, from))).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ChildReplies)),
        Effect.mapError((cause) => new ChildrenError({ reason: "storage", cause })),
        Effect.flatMap((reply) =>
          reply._tag === "ok" ? Effect.succeed(reply.value) : Effect.fail(new ChildrenError({ reason: reply.reason })),
        ),
      ),
  });
  const dependencies = Layer.mergeAll(
    mailLayer(env, project),
    Layer.succeed(CheckedWriter, {
      sign: (id, parent, kind) =>
        Effect.suspend(() => rpc(p.sign(active, id, parent, kind))).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SigningReply)),
          Effect.mapError((cause) => new LedgerError({ reason: "unreachable", cause })),
          Effect.flatMap(checkedValue),
        ),
      append: (input) => Effect.suspend(() => rpc(p.inbox(active, input))),
      commit: (id, session, stream, event) =>
        Effect.suspend(() =>
          rpc(p.commit(active, { id, parent: session.parent, kind: event._tag, stream, event })),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CommitReply)),
          Effect.mapError((cause) => new LedgerError({ reason: "unreachable", cause })),
          Effect.flatMap(checkedValue),
        ),
      own: Effect.fn("process.own")(function* (id: string, stream: string, event: unknown) {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie);
        return yield* rpc(p.own(active, id, stream, event, { traceId: span.traceId, spanId: span.spanId }));
      }),
    }),
    WatcherManagerRemote.layer((client, update) => rpc(p.publish(client, { ...update, pid: active }))),
    Layer.succeed(Alarm, {
      // Keep the program's wake; the platform requires a positive alarm time.
      set: (at) =>
        (at === null
          ? rpc(storage.delete("wake")).pipe(Effect.andThen(rpc(storage.deleteAlarm())))
          : rpc(storage.put("wake", at)).pipe(Effect.andThen(rpc(storage.setAlarm(Math.max(1, at)))))
        ).pipe(Effect.orDie),
    }),
    // Recording captures its sink's services itself (main's P11); the runner no longer provides them.
    Layer.succeed(Recording, { flush: sink.flush.pipe(Effect.provideContext(services)) }),
    // The project's brain writes as `brain:<project>`, the one writer its process table trusts.
    remoteProcessManager(manager, `brain:${project}`),
    Layer.succeed(Children, children),
  );
  // P34 on the Worker: receipts and pending recovery live in this object's own SQLite, beside
  // ProcessStore, under the registered name every successor shares.
  const runnerLayer = ProgramRunner.withLoader(
    saved,
    {
      load: (name) =>
        Effect.gen(function* () {
          const process = active;
          const tail = yield* bindTail(ctx, { project, name: saved.name, process }).pipe(
            Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
          );
          return yield* loader.load(name, process, tail);
        }),
    },
    { policy: defaultPolicy, recovery: { sql, name: saved.name, capacity: 1024 ** 3 } },
  ).pipe(Layer.provide(dependencies), Layer.provide(Layer.succeedContext(services)));
  const runner = yield* ProgramRunner.pipe(Effect.provide(runnerLayer));
  yield* sink.flush.pipe(Effect.provideContext(services));
  const attributed = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => work.pipe(Effect.annotateSpans({ "fab.process": active }), Effect.provideContext(services)));
  return {
    usage: Effect.fnUntraced(
      function* (rows: unknown) {
        const usage = yield* Schema.decodeUnknownEffect(Schema.Array(IsolateUsage.Usage))(rows);
        yield* sink.batch(IsolateUsage.record(usage));
      },
      Effect.withSpan("process.usage"),
      (work) => complete(work),
      Effect.provideContext(services),
    ),
    msg: (input: unknown) => {
      const work = attributed(runner.msg(input));
      // The door's input span is in another object, so its trace crosses the call as data.
      const sent = Schema.decodeUnknownOption(Delivered)(input);
      return Option.isSome(sent) ? work.pipe(Effect.withParentSpan(Tracer.externalSpan(sent.value.span))) : work;
    },
    mailed: (trace?: { traceId: string; spanId: string }) => {
      const work = attributed(complete(runner.mailed));
      return trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace)));
    },
    open: (client: string) => attributed(runner.open(client)),
    due: (at: number) => attributed(runner.due(at)),
    init: () => attributed(runner.init()),
    restart: (request: unknown) =>
      Schema.decodeUnknownEffect(RestartRequest)(request).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
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

/** What a runner call fails with: the union `ProgramRunner`'s calls name. */
type RunnerFailure =
  | LedgerError
  | RecoveryStoreError
  | SessionManagerError
  | ProgramDown
  | RunnerError
  | SinkError
  | ProcessError
  | NotGranted
  | RepliesError
  | WatchersError;

export class ProcessService extends Context.Service<
  ProcessService,
  {
    readonly usage: (rows: unknown) => Effect.Effect<void, Schema.SchemaError | SinkError>;
    readonly msg: (input: unknown) => Effect.Effect<Sent, RunnerFailure>;
    readonly mailed: (trace?: { traceId: string; spanId: string }) => Effect.Effect<void, RunnerFailure>;
    readonly open: (client: string) => Effect.Effect<Opened, RunnerFailure>;
    readonly due: (at: number) => Effect.Effect<void, RunnerFailure>;
    readonly init: () => Effect.Effect<void, RunnerFailure>;
    readonly restart: (request: unknown) => Effect.Effect<void, RunnerFailure>;
    readonly alarm: () => Effect.Effect<void, RunnerFailure>;
    readonly activity: (value: typeof Activity.Type) => Effect.Effect<void, LedgerError>;
    /** The saved activity marker after a wake: `idle`, or `interrupted` with the step that was cut short. */
    readonly recover: () => Effect.Effect<typeof Recovered.Type, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/runtime.ProcessService") {}

export const processRuntime = (ctx: DurableObjectState, env: Env, programs: Readonly<Record<string, ProgramSource>>) =>
  SettingsRuntime.runtime(
    Layer.effect(ProcessService, processLogic(ctx, env, programs)).pipe(Layer.provide(recordedLayer(env))),
  );
