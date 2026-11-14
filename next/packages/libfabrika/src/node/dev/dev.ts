/**
 * The local brain's driver on Node: it starts the local runtime through a deploy the caller
 * gives, follows its starts, exits and restarts, and hands back stand-ins for its bindings that
 * call it over a private control socket.
 *
 * @stability unstable
 */
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { SystemError } from "@alchemy.run/cloudflare-runtime/core/RuntimeError";
import { applyCell } from "@demlik/tea";
import { Clock, Context, Deferred, Effect, Exit, Queue, Redacted, Ref, Schema, Scope, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess } from "effect/process";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import { BrainEvent } from "../../runtime/BrainEvent.ts";
import { Installed, type Install } from "../../runtime/Code.ts";
import type { CodeEvent } from "../../runtime/Code.ts";
import { SpanSink } from "../../telemetry/Sink.ts";
import { ControlPlugin } from "./ControlPlugin.ts";
import { devRecording } from "./dev-recording.ts";
import { address, devLife, latest, pending, target } from "./DevLife.ts";
import { brainOutbox, checkMemory } from "./local-dev.ts";

/**
 * Error for a call on the local runtime that failed: its `reason` names how, such as `offline`,
 * `unreachable`, `bad_row`, `start_timeout` or `install`.
 *
 * @stability unstable
 * @category errors
 */
export class ControlError extends Schema.TaggedError<ControlError>()("ControlError", {
  reason: Schema.String,
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

type Target = "project" | "process" | "record" | "loader" | "bucket";
type Binding = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;
type Life = typeof devLife.model.Type;

type Cause = {
  readonly reason: (typeof BrainEvent.cases.started.Type)["reason"];
  readonly bytes: number | undefined;
};

// The token a move consumed, so its replacement is settled once.
const consumed = (prev: Life, next: Life) => {
  const id = pending(prev);
  return id !== null && pending(next) !== id ? id : null;
};

const Response = Schema.Struct({
  value: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ reason: Schema.String })),
});

const sample = (pid: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("ps", ["-o", "rss=", "-p", String(pid)]);
      const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], {
        concurrency: 2,
      });

      if (code !== 0) {
        return yield* new ControlError({ reason: "sample" });
      }

      return Number(text.trim()) * 1024;
    }),
  ).pipe(Effect.mapError((cause) => new ControlError({ reason: "sample", cause })));

const bucketChecksum = Effect.fn(function* <E>(work: Effect.Effect<unknown, E>) {
  const raw = yield* work;

  if (raw === null) {
    return null;
  }

  const { sha256 } = yield* Schema.decodeUnknownEffect(Schema.Struct({ sha256: Schema.String }))(raw);
  return {
    checksums: {
      sha256: Uint8Array.from((sha256.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16))).buffer,
    },
  };
});

/**
 * Starts the local instance's brain and answers its address with stand-ins for its bindings:
 * `project`, `process`, `record`, `loader` and `bucket`, each a call over the private control
 * socket.
 *
 * **Details**
 *
 * `deploy` gets a context that holds the runtime's lifecycle hook and the control plugin, and a
 * scope of its own for the runtime. The driver waits for the control socket to listen, for at most
 * 30 seconds, and for the first start. It saves every start, exit, restart wait, brake and stop as
 * a `BrainEvent` in a durable outbox under `home` and sends them to the project, so an event
 * outlives a crash on either side. Once a second it samples the runtime's memory, and at 500 MB or
 * more it ends the process with SIGTERM, so that exit is recorded with the reason `memory`. Closing
 * the caller's scope stops the runtime and records `stopped`.
 *
 * **Gotchas**
 *
 * The control socket listens on 127.0.0.1 only and takes a random bearer token made for this
 * start. A call made while no port is known fails as `offline`.
 *
 * @stability unstable
 * @category constructors
 */
export const startDev = Effect.fn("brain.instance")(function* <E, R>(
  options: {
    readonly name: string;
    readonly port: number;
    readonly build: string;
    readonly home: string;
  },
  deploy: (local: Context.Context<never>, scope: Scope.Scope) => Effect.Effect<unknown, E, R>,
) {
  const config = options,
    scope = yield* Effect.scope,
    ids = yield* ProcessIdGenerator,
    client = yield* HttpClient.HttpClient;
  const outbox = yield* brainOutbox(options.home),
    runtimeScope = yield* Scope.make(),
    events = yield* Queue.unbounded<{ readonly event: RuntimeEvent; readonly cause: Cause }>(),
    // Alchemy's local Worker provider forks the workerd start, so deploy returns before workerd
    // listens. The control socket's first start opens this latch.
    listening = yield* Deferred.make<void>(),
    started = yield* Deferred.make<void>();
  const token = Redacted.make(
    Base64Url.encode(yield* SecureRandom.SecureRandom.use((random) => random.randomBytes(32))),
  );
  const life = yield* Ref.make(devLife.init(null, { last: yield* outbox.last })[0]);
  // Each move folds one Msg atomically, and hands back the state before and after it.
  const send = (msg: typeof devLife.msg.Type) =>
    Ref.modify(life, (prev) => {
      const [next] = applyCell(devLife, prev, msg);
      return [[prev, next] as const, next];
    });
  // The handles behind the machine's replacement tokens.
  const replacements = new Map<string, Deferred.Deferred<void, ControlError>>();
  // What the callback saw last, kept for the next event's row.
  let cause: Cause = { reason: "open", bytes: undefined };
  const call = Effect.fnUntraced(function* (
    target: Target,
    project: string,
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) {
    const port = address(yield* Ref.get(life));

    if (port === null) {
      return yield* new ControlError({ reason: "offline" });
    }

    const url = `http://127.0.0.1:${port}`;
    const fail = (cause: unknown) => new ControlError({ reason: "unreachable", cause });
    const body = yield* Effect.try({
      try: () => JSON.stringify({ target, project, name, method, args }),
      catch: fail,
    });
    const response = yield* HttpClientRequest.post(url).pipe(
      // oxlint-disable-next-line fabrika/no-redacted-value -- the private HTTP header sends the control bearer
      HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(token)}`),
      HttpClientRequest.bodyText(body, "application/json"),
      client.execute,
      // No span and no trace header for a control call: the span sink flushes through this call.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.mapError(fail),
    );
    const raw = yield* response.json.pipe(Effect.mapError((cause) => new ControlError({ reason: "bad_row", cause })));
    const answer = yield* Schema.decodeUnknownEffect(Response)(raw).pipe(
      Effect.mapError((cause) => new ControlError({ reason: "bad_row", cause })),
    );

    if (answer.error !== undefined) {
      return yield* new ControlError(answer.error);
    }

    return answer.value;
  });
  const flush = outbox.flush((event) => call("project", config.name, "", "brain", [event]));
  const recording = yield* devRecording(options.home, `brain:${config.name}`, (target, name, method, args) =>
    call(target, config.name, name, method, args),
  );
  const sink = Context.get(recording, SpanSink);
  const flushRecords = sink.flush.pipe(Effect.provideContext(recording));
  const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    work.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        flushRecords.pipe(
          // The durable queue retries a down receiver. A full local disk still fails loudly.
          Effect.catchIf(
            (error) => error.reason !== "storage",
            () => Effect.void,
          ),
          Effect.flatMap(() => exit),
        ),
      ),
      Effect.provideContext(recording),
    );
  const local = Context.empty().pipe(
    Context.add(RuntimeLifecycle, (event) => {
      const observed = { event, cause };

      // A new child starts with a clean cause before any queued file write can yield.
      if (event.type === "start") {
        cause = { reason: "crash", bytes: undefined };
      }

      Queue.offerUnsafe(events, observed);
    }),
    Context.add(ControlPlugin, {
      sockets: [
        {
          name: "fabrika-control",
          address: "127.0.0.1:0",
          http: {},
          service: {
            name: "user-worker",
            entrypoint: "Control",
            // oxlint-disable-next-line fabrika/no-redacted-value -- Alchemy sends these entrypoint props to workerd
            props: { json: JSON.stringify({ token: Redacted.value(token) }) },
          },
        },
      ],
      start: Effect.fnUntraced(function* (ports) {
        const port = yield* Schema.decodeUnknownEffect(Schema.Int)(ports["fabrika-control"]).pipe(
          Effect.mapError(
            (cause) =>
              new SystemError({
                subtag: "control_port",
                message: "The local runtime returned an invalid control port",
                cause,
              }),
          ),
        );
        const [prev, next] = yield* send({ type: "listened", port });
        yield* Deferred.succeed(listening, undefined);
        const id = consumed(prev, next);
        const ready = id === null ? undefined : replacements.get(id);

        if (id !== null && ready !== undefined) {
          replacements.delete(id);
          yield* Deferred.succeed(ready, undefined);
        }
      }),
    }),
  );
  const stopRuntime = Effect.fn("brain.stop")(function* () {
    const [, stopping] = yield* send({ type: "stop" });
    yield* Scope.close(runtimeScope, Exit.void);
    const start = latest(stopping);

    if (start !== null) {
      const at = yield* Clock.currentTimeMillis;
      const id = `${start}/stopped`;
      yield* outbox.add(BrainEvent.cases.stopped.make({ id, start, at, reason: "stop" }));
      yield* flush.pipe(Effect.ignore);
    }

    yield* send({ type: "stopped" });
    // The stop discards any replacement still waiting; its restart ends with the scope.
    replacements.clear();
  });
  yield* Effect.addFinalizer(() => recorded(stopRuntime()).pipe(Effect.orDie));
  const restartRuntime = Effect.fn("brain.restart")(function* (ready: Deferred.Deferred<void, ControlError>) {
    yield* Deferred.await(ready);
  });
  const recordEvents = Effect.forever(
    Effect.gen(function* () {
      const {
        event,
        cause: { reason, bytes: rss },
      } = yield* Queue.take(events);
      const now = yield* Ref.get(life);

      if (now._tag === "stopping" || now._tag === "stopped") {
        return;
      }

      const start = latest(now) ?? "";

      if (event.type === "exit") {
        const at = yield* Clock.currentTimeMillis;
        yield* outbox.add(
          BrainEvent.cases.exited.make({
            id: `${start}/exited`,
            start,
            at,
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
        // The handle exists before its token, so the listener always finds it.
        const ready = yield* Deferred.make<void, ControlError>();
        replacements.set(start, ready);
        const [prev] = yield* send({ type: "exited", replacement: start });
        const old = pending(prev);

        // A second exit before any listener replaces the token, as main replaced the wait.
        if (old !== null && old !== start) {
          replacements.delete(old);
        }

        yield* Effect.forkIn(recorded(restartRuntime(ready)).pipe(Effect.ignore), scope);
      }

      if (event.type === "start") {
        const next = yield* ids.next;
        const at = yield* Clock.currentTimeMillis;
        const { pid } = event;
        const [, up] = yield* send({ type: "started", start: next, pid, build: config.build, at });

        // Braked and stopping refuse a start.
        if (up._tag !== "spawned" && up._tag !== "online") {
          return;
        }

        const startedEvent = BrainEvent.cases.started.make({
          id: `${next}/started`,
          start: next,
          after: up.session.after,
          build: up.session.build,
          reason,
          pid: up.pid,
          at,
          ...(rss === undefined ? {} : { bytes: rss }),
        });
        yield* outbox.add(startedEvent);
        yield* Deferred.succeed(started, undefined);
      } else if (event.type === "restart") {
        const until = (yield* Clock.currentTimeMillis) + event.delay;
        yield* send({ type: "waiting", until, reason });
        const at = yield* Clock.currentTimeMillis;
        yield* outbox.add(
          BrainEvent.cases.restarting.make({
            id: `${start}/restarting`,
            start,
            at,
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            backoff: event.delay,
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
      } else if (event.type === "stop") {
        const [prev, next] = yield* send({ type: "braked", reason: event.reason });
        const id = consumed(prev, next);
        const ready = id === null ? undefined : replacements.get(id);

        if (id !== null && ready !== undefined) {
          replacements.delete(id);
          yield* Deferred.fail(ready, new ControlError({ reason: event.reason }));
        }

        const at = yield* Clock.currentTimeMillis;
        yield* outbox.add(
          BrainEvent.cases.braked.make({
            id: `${start}/braked`,
            start,
            at,
            reason: event.reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
          }),
        );
      }
    }),
  );
  yield* Effect.forkScoped(recordEvents);
  const startRuntime = Effect.fn("brain.start")(function* () {
    yield* deploy(local, runtimeScope);
    yield* Deferred.await(listening).pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => Effect.fail(new ControlError({ reason: "start_timeout" })),
      }),
    );
    yield* Deferred.await(started);
    yield* call("project", config.name, "", "info", []);
    yield* flush;
  });
  yield* recorded(startRuntime());
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep("1 second");

        const pid = target(yield* Ref.get(life));

        if (pid === null) {
          return;
        }

        yield* checkMemory({
          pid,
          sample,
          replace: (value) =>
            Effect.sync(() => {
              cause = { reason: "memory", bytes: value.bytes };
              process.kill(value.pid, "SIGTERM");
            }),
        }).pipe(Effect.ignore);
        yield* flush.pipe(Effect.ignore);
        yield* flushRecords.pipe(
          Effect.catchIf(
            (error) => error.reason !== "storage",
            () => Effect.void,
          ),
          Effect.orDie,
        );
      }),
    ),
  );
  const proxy = <Members extends object>(
    invoke: (method: string, args: ReadonlyArray<unknown>) => Effect.Effect<unknown, ControlError>,
    members: Members,
  ) =>
    new Proxy(Object.assign<Binding, Members>({}, members), {
      get: (_value, method) => {
        if (method === "then") {
          return undefined;
        }

        if (Object.hasOwn(members, method)) {
          return members[method as keyof Members];
        }

        const work = (args: ReadonlyArray<unknown>) => invoke(String(method), args);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local binding proxy matches Durable Object's Promise API
        return (...args: ReadonlyArray<unknown>) => Effect.runPromise(work(args));
      },
    });
  const binding = (target: Target, project: string, name = "") =>
    proxy((method, args) => call(target, project, name, method, args), {});
  return {
    recording,
    install: (code: Install): Effect.Effect<Installed, ControlError> =>
      recorded(
        call("project", config.name, "", "codeInstall", [code]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Installed)),
        ),
      ).pipe(Effect.mapError((cause) => new ControlError({ reason: "install", cause }))),
    failed: (fact: (typeof CodeEvent.cases)["code.failed"]["Type"]): Effect.Effect<void, ControlError> =>
      recorded(call("project", config.name, "", "codeFailed", [fact]).pipe(Effect.asVoid)).pipe(
        Effect.mapError((cause) => new ControlError({ reason: "install", cause })),
      ),
    url: `http://127.0.0.1:${config.port}`,
    project: (project: string) =>
      proxy((method, args) => call("project", project, "", method === "connect" ? "clientConnect" : method, args), {
        gateways: binding("project", project),
        forProcess: (pid: string) =>
          proxy(
            (method, args) => call("project", project, "", method === "append" ? "commit" : method, [pid, ...args]),
            {},
          ),
      }),
    process: (pid: string) =>
      proxy((method, args) => call("process", config.name, pid, method === "alarm" ? "savedAlarm" : method, args), {}),
    record: (project: string, name: string) => binding("record", project, name),
    loader: {
      load: (name: string, pid: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local Worker Loader proxy matches the platform's Promise API
        Effect.runPromise(call("loader", pid, name, "init", [null]).pipe(Effect.as(binding("loader", pid, name)))),
    },
    bucket: {
      put: (key: string, body: Uint8Array, options: { sha256: string }) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
        Effect.runPromise(call("bucket", config.name, "", "put", [key, [...body], options.sha256])),
      head: (key: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
        Effect.runPromise(bucketChecksum(call("bucket", config.name, "", "head", [key]))),
    },
  };
});
