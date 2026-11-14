/**
 * The Cloudflare clients the runtime calls through: each Durable Object stub, Durable Object storage
 * and the R2 bucket, wrapped once so a rejected platform call becomes a `LedgerError` with reason
 * `unreachable`.
 *
 * @stability unstable
 */
import type { RpcCallError } from "@alchemy.run/cloudflare/Bridge";
import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
import type { Fetcher } from "@alchemy.run/cloudflare/Fetcher";
import type { WorkerEvent } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Context, Effect, Predicate, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { LedgerError } from "../ledger/Ledger.ts";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import type { ConnectionBinding, ProcessBinding, ProjectBinding } from "./bindings.ts";
import type { ConnectionShape, ProcessShape, RecordShape } from "./objects.ts";
import { reach } from "./reach.ts";

/**
 * Reads only call metadata, including workerd's prototype getters.
 *
 * @stability unstable
 * @category combinators
 */
export const isolateUsage = Effect.fnUntraced(function* (
  process: string,
  items: Extract<WorkerEvent, { type: "tail" }>["input"],
) {
  return yield* Schema.decodeUnknownEffect(Schema.Array(IsolateUsage.Usage))(
    items.map((item) => {
      const event = item.event;
      const method = Predicate.hasProperty(event, "rpcMethod") ? event.rpcMethod : undefined;
      const outcome = item.outcome;
      return {
        process,
        method: Schema.is(IsolateUsage.Method)(method) ? method : "other",
        cpuMs: item.cpuTime,
        wallMs: item.wallTime,
        outcome: Schema.is(IsolateUsage.Outcome)(outcome) ? outcome : "other",
      };
    }),
  );
});

type Client<S> = {
  readonly [K in keyof S]: S[K] extends (...args: infer A) => infer B
    ? (...args: A) => Effect.Effect<Awaited<B>, LedgerError>
    : never;
};

/** A rejected platform call. It keeps the thrown value as its cause (ticket 695), and its message keeps
 *  that value's class and text as `<class>: <text>`. Both stay in memory: a sink stores a typed
 *  failure's tag and reason only, and never puts its text in a tag. */
const thrown = (cause: unknown) =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : `${typeof cause}: ${String(cause)}`;

const unreachable = (cause: unknown) => new LedgerError({ reason: "unreachable", message: thrown(cause), cause });

/** A call the typed stub could not make. Its RpcCallError is the cause, and the message names what
 *  the platform threw inside it, in the form `unreachable` writes. */
const lost = (cause: RpcCallError) => new LedgerError({ reason: "unreachable", message: thrown(cause.cause), cause });

/** An object's contract as its callers see it: each call needs nothing, and fails with `LedgerError`. */
type Calls<S> = {
  readonly [K in keyof S]: S[K] extends (...args: infer A) => Effect.Effect<infer B, infer _E, infer _R>
    ? (...args: A) => Effect.Effect<B, LedgerError>
    : never;
};

/**
 * Returns the thrown value behind an `unreachable` `LedgerError`, rebuilt from its message with its
 * class as `name`, so a failed span names the class that was thrown.
 *
 * **Details**
 *
 * Any other error, and an `unreachable` one with no message or no `<class>: <text>` form, is
 * returned as it is.
 *
 * @stability unstable
 * @category error handling
 */
export const rejected = (error: unknown): unknown => {
  if (!(error instanceof LedgerError) || error.reason !== "unreachable" || error.message === undefined) {
    return error;
  }

  const at = error.message.indexOf(": ");
  return at < 0 ? error : Object.assign(new Error(error.message.slice(at + 2)), { name: error.message.slice(0, at) });
};

/**
 * Service for calls on the Project Durable Object, one Effect per RPC method of its binding.
 *
 * **Details**
 *
 * `ProjectClient.make` wraps a stub. A rejected call fails with a `LedgerError` of reason
 * `unreachable` that keeps the thrown value as its cause.
 *
 * @stability unstable
 * @category services
 */
export class ProjectClient extends Context.Service<
  ProjectClient,
  Client<Omit<ProjectBinding, keyof Rpc.DurableObjectBranded>>
>()("@kampus/libfabrika/cloudflare/platform.ProjectClient") {
  static make(stub: ProjectBinding): ProjectClient["Service"] {
    return {
      code: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project code RPC enters Effect
        Effect.tryPromise({ try: () => stub.code(...args), catch: unreachable }),
      codeInstall: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project install RPC enters Effect
        Effect.tryPromise({ try: () => stub.codeInstall(...args), catch: unreachable }),
      codeFailed: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project failure RPC enters Effect
        Effect.tryPromise({ try: () => stub.codeFailed(...args), catch: unreachable }),
      settingsStart: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted settings RPC enters Effect
        Effect.tryPromise({ try: () => stub.settingsStart(...args), catch: unreachable }),
      settingsRead: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted settings RPC enters Effect
        Effect.tryPromise({ try: () => stub.settingsRead(...args), catch: unreachable }),
      clientConnect: () =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project clientConnect RPC enters Effect
        Effect.tryPromise({ try: () => stub.clientConnect(), catch: unreachable }),
      target: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project target RPC enters Effect
        Effect.tryPromise({ try: () => stub.target(...args), catch: unreachable }),
      challenge: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project challenge RPC enters Effect
        Effect.tryPromise({ try: () => stub.challenge(...args), catch: unreachable }),
      initialize: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project initialize RPC enters Effect
        Effect.tryPromise({ try: () => stub.initialize(...args), catch: unreachable }),
      route: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project route RPC enters Effect
        Effect.tryPromise({ try: () => stub.route(...args), catch: unreachable }),
      knock: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project knock RPC enters Effect
        Effect.tryPromise({ try: () => stub.knock(...args), catch: unreachable }),
      grant: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project grant RPC enters Effect
        Effect.tryPromise({ try: () => stub.grant(...args), catch: unreachable }),
      disconnect: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project disconnect RPC enters Effect
        Effect.tryPromise({ try: () => stub.disconnect(...args), catch: unreachable }),
      register: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project register RPC enters Effect
        Effect.tryPromise({ try: () => stub.register(...args), catch: unreachable }),
      join: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project join RPC enters Effect
        Effect.tryPromise({ try: () => stub.join(...args), catch: unreachable }),
      leave: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project leave RPC enters Effect
        Effect.tryPromise({ try: () => stub.leave(...args), catch: unreachable }),
      online: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project online RPC enters Effect
        Effect.tryPromise({ try: () => stub.online(...args), catch: unreachable }),
      info: () =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project info RPC enters Effect
        Effect.tryPromise({ try: () => stub.info(), catch: unreachable }),
      start: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project start RPC enters Effect
        Effect.tryPromise({ try: () => stub.start(...args), catch: unreachable }),
      exit: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project exit RPC enters Effect
        Effect.tryPromise({ try: () => stub.exit(...args), catch: unreachable }),
      sign: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project sign RPC enters Effect
        Effect.tryPromise({ try: () => stub.sign(...args), catch: unreachable }),
      commit: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project commit RPC enters Effect
        Effect.tryPromise({ try: () => stub.commit(...args), catch: unreachable }),
      mail: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project mail RPC enters Effect
        Effect.tryPromise({ try: () => stub.mail(...args), catch: unreachable }),
      inbox: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project inbox RPC enters Effect
        Effect.tryPromise({ try: () => stub.inbox(...args), catch: unreachable }),
      own: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project own RPC enters Effect
        Effect.tryPromise({ try: () => stub.own(...args), catch: unreachable }),
      publish: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project publish RPC enters Effect
        Effect.tryPromise({ try: () => stub.publish(...args), catch: unreachable }),
      brain: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project brain RPC enters Effect
        Effect.tryPromise({ try: () => stub.brain(...args), catch: unreachable }),
      append: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project append RPC enters Effect
        Effect.tryPromise({ try: () => stub.append(...args), catch: unreachable }),
      read: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project read RPC enters Effect
        Effect.tryPromise({ try: () => stub.read(...args), catch: unreachable }),
      wait: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project wait RPC enters Effect
        Effect.tryPromise({ try: () => stub.wait(...args), catch: unreachable }),
      processObject: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processObject RPC enters Effect
        Effect.tryPromise({ try: () => stub.processObject(...args), catch: unreachable }),
      processStart: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processStart RPC enters Effect
        Effect.tryPromise({ try: () => stub.processStart(...args), catch: unreachable }),
      processExit: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processExit RPC enters Effect
        Effect.tryPromise({ try: () => stub.processExit(...args), catch: unreachable }),
      processStatus: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processStatus RPC enters Effect
        Effect.tryPromise({ try: () => stub.processStatus(...args), catch: unreachable }),
      processResolve: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processResolve RPC enters Effect
        Effect.tryPromise({ try: () => stub.processResolve(...args), catch: unreachable }),
      processDead: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processDead RPC enters Effect
        Effect.tryPromise({ try: () => stub.processDead(...args), catch: unreachable }),
      processIsLive: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processIsLive RPC enters Effect
        Effect.tryPromise({ try: () => stub.processIsLive(...args), catch: unreachable }),
      processMonitor: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processMonitor RPC enters Effect
        Effect.tryPromise({ try: () => stub.processMonitor(...args), catch: unreachable }),
      processDemonitor: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processDemonitor RPC enters Effect
        Effect.tryPromise({ try: () => stub.processDemonitor(...args), catch: unreachable }),
      processDown: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processDown RPC enters Effect
        Effect.tryPromise({ try: () => stub.processDown(...args), catch: unreachable }),
      processReceive: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processReceive RPC enters Effect
        Effect.tryPromise({ try: () => stub.processReceive(...args), catch: unreachable }),
      processChild: (...args) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Project processChild RPC enters Effect
        Effect.tryPromise({ try: () => stub.processChild(...args), catch: unreachable }),
    };
  }
}

/**
 * Service for calls on a Process Durable Object, one Effect per call of its contract.
 *
 * **Details**
 *
 * `ProcessClient.make` wraps a stub. The object's own `LedgerError` crosses as itself, and a call
 * that got no answer fails with reason `unreachable`, keeping Alchemy's `RpcCallError` as its cause.
 *
 * @stability unstable
 * @category services
 */
export class ProcessClient extends Context.Service<ProcessClient, Calls<Omit<ProcessShape, "alarm">>>()(
  "@kampus/libfabrika/cloudflare/platform.ProcessClient",
) {
  static make(stub: ProcessBinding): ProcessClient["Service"] {
    // The object's own LedgerError crosses as itself; a call that got no answer is `unreachable`.
    const process = makeRpcStub<ProcessClient["Service"]>(stub, { errors: [LedgerError] });
    return {
      swap: (...args) => reach(process.swap(...args), lost),
      usage: (...args) => reach(process.usage(...args), lost),
      mailed: (...args) => reach(process.mailed(...args), lost),
      configure: (...args) => reach(process.configure(...args), lost),
      descriptor: (...args) => reach(process.descriptor(...args), lost),
      msg: (...args) => reach(process.msg(...args), lost),
      open: (...args) => reach(process.open(...args), lost),
      due: (...args) => reach(process.due(...args), lost),
      restart: (...args) => reach(process.restart(...args), lost),
      activity: (...args) => reach(process.activity(...args), lost),
      recover: () => reach(process.recover(), lost),
      savedAlarm: () => reach(process.savedAlarm(), lost),
      abort: () => reach(process.abort(), lost),
    };
  }
}

/**
 * Service for calls on a Connection Durable Object: `fetch`, `ring`, `notify` and `probe`.
 *
 * **Details**
 *
 * `GatewayClient.make` wraps a stub. A rejected call fails with a `LedgerError` of reason
 * `unreachable` that keeps the thrown value as its cause.
 *
 * @stability unstable
 * @category services
 */
export class GatewayClient extends Context.Service<
  GatewayClient,
  Client<Omit<ConnectionBinding, keyof Rpc.DurableObjectBranded>>
>()("@kampus/libfabrika/cloudflare/platform.GatewayClient") {
  static make(stub: ConnectionBinding): GatewayClient["Service"] {
    // The object's own contract: a LedgerError it fails with crosses as itself. Its `fetch` is
    // Alchemy's fetcher, which keeps a socket upgrade's own Response (a 101 is a raw body).
    const calls = makeRpcStub<Pick<ConnectionShape, "ring" | "notify" | "probe"> & Pick<Fetcher, "fetch">>(stub, {
      errors: [LedgerError],
    });
    return {
      // A lost object is `unreachable` with what the platform threw as its cause. Alchemy's fetcher
      // made a rejected platform fetch a defect; our Alchemy patch makes it fail typed, as an
      // HttpServerError that keeps the rejection as its cause.
      fetch: (request) =>
        calls.fetch(HttpServerRequest.fromWeb(request)).pipe(
          Effect.flatMap((response) =>
            Effect.map(Effect.context<never>(), (context) => HttpServerResponse.toWeb(response, { context })),
          ),
          Effect.mapError((error) => unreachable(error.cause)),
        ),
      ring: (stream, rev) => reach(calls.ring(stream, rev), lost),
      notify: (client, news) => reach(calls.notify(client, news), lost),
      probe: (session) => reach(calls.probe(session), lost),
    };
  }
}

/**
 * Service for calls on the Record Durable Object. `RecordClient.make` hands the stub back as it is.
 *
 * @stability unstable
 * @category services
 */
export class RecordClient extends Context.Service<RecordClient, RecordShape>()(
  "@kampus/libfabrika/cloudflare/platform.RecordClient",
) {
  static make(stub: RecordShape): RecordClient["Service"] {
    return stub;
  }
}

/**
 * Service for a Durable Object's own storage: keys, `sync` and its alarm.
 *
 * **Details**
 *
 * `StorageClient.make` wraps the storage. A rejected call fails with a `LedgerError` of reason
 * `unreachable` that keeps the thrown value as its cause.
 *
 * @stability unstable
 * @category services
 */
export class StorageClient extends Context.Service<
  StorageClient,
  {
    readonly get: <A>(key: string) => Effect.Effect<A | undefined, LedgerError>;
    readonly put: (key: string, value: unknown) => Effect.Effect<void, LedgerError>;
    readonly delete: (key: string) => Effect.Effect<boolean, LedgerError>;
    readonly sync: () => Effect.Effect<void, LedgerError>;
    readonly setAlarm: (at: number) => Effect.Effect<void, LedgerError>;
    readonly deleteAlarm: () => Effect.Effect<void, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/platform.StorageClient") {
  static make(storage: DurableObjectStorage): StorageClient["Service"] {
    return {
      get: <A>(key: string) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage get enters Effect
        Effect.tryPromise({ try: () => storage.get<A>(key), catch: unreachable }),
      put: (key, value) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage put enters Effect
        Effect.tryPromise({ try: () => storage.put(key, value), catch: unreachable }),
      delete: (key) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage delete enters Effect
        Effect.tryPromise({ try: () => storage.delete(key), catch: unreachable }),
      sync: () =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage sync enters Effect
        Effect.tryPromise({ try: () => storage.sync(), catch: unreachable }),
      setAlarm: (at) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object alarm set enters Effect
        Effect.tryPromise({ try: () => storage.setAlarm(at), catch: unreachable }),
      deleteAlarm: () =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object alarm delete enters Effect
        Effect.tryPromise({ try: () => storage.deleteAlarm(), catch: unreachable }),
    };
  }
}

/**
 * Service for the R2 bucket: `put` with the body's SHA-256, and `head`.
 *
 * **Details**
 *
 * `BucketClient.make` wraps the bucket. A rejected call fails with a `LedgerError` of reason
 * `unreachable` that keeps the thrown value as its cause.
 *
 * @stability unstable
 * @category services
 */
export class BucketClient extends Context.Service<
  BucketClient,
  {
    readonly put: (key: string, body: Uint8Array, sha256: string) => Effect.Effect<unknown, LedgerError>;
    readonly head: (key: string) => Effect.Effect<R2Object | null, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/platform.BucketClient") {
  static make(bucket: R2Bucket): BucketClient["Service"] {
    return {
      put: (key, body, sha256) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: R2 put enters Effect
        Effect.tryPromise({ try: () => bucket.put(key, body, { sha256 }), catch: unreachable }),
      head: (key) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: R2 head enters Effect
        Effect.tryPromise({ try: () => bucket.head(key), catch: unreachable }),
    };
  }
}
