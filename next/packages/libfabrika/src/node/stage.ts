import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { SystemError } from "@alchemy.run/cloudflare-runtime/core/RuntimeError";
import { applyCell } from "@demlik/tea";
import { Context, DateTime, Deferred, Effect, Exit, Queue, Redacted, Schema, Scope, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { ChildProcess } from "effect/process";
import { BrainEvent } from "../app/brain-event.ts";
import { brainLife } from "../app/brain-life.ts";
import { ProcessIdGenerator } from "../coordination/process-id.ts";
import { SpanSink } from "../data/sink.ts";
import { watchKeys } from "./keybindings.ts";
import { brainOutbox, checkMemory } from "./local-stage.ts";
import { stageRecording } from "./stage-recording.ts";

class ControlPlugin extends Plugin.Service<ControlPlugin>()("cloudflare-runtime/plugin/FabrikaControl") {}

class ControlError extends Schema.TaggedError<ControlError>()("ControlError", {
  reason: Schema.String,
}) {}

type Target = "project" | "process" | "record" | "loader" | "bucket";
type Binding = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;

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
  ).pipe(Effect.mapError(() => new ControlError({ reason: "sample" })));

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

export const startStage = Effect.fn("brain.stage")(function* <E, R>(
  options: {
    readonly name: string;
    readonly port: number;
    readonly build: string;
    readonly home: string;
    /** The commands the person's `keybindings.toml` may bind. With them, the stage reads the
     *  file under its home for its whole life and hands each checked change to the brain. */
    readonly keys?: { readonly commands: ReadonlyArray<string> };
  },
  deploy: (local: Context.Context<never>, scope: Scope.Scope) => Effect.Effect<unknown, E, R>,
) {
  const config = options,
    scope = yield* Effect.scope,
    ids = yield* ProcessIdGenerator;
  const outbox = yield* brainOutbox(options.home),
    runtimeScope = yield* Scope.make(),
    events = yield* Queue.unbounded<{
      readonly event: RuntimeEvent;
      readonly reason: (typeof BrainEvent.cases.started.Type)["reason"];
      readonly bytes: number | undefined;
    }>(),
    // Alchemy's local Worker provider forks the workerd start, so deploy returns before workerd
    // listens. The control socket's first start opens this latch.
    listening = yield* Deferred.make<void>(),
    started = yield* Deferred.make<void>();
  const token = Redacted.make(
    Base64Url.encode(yield* SecureRandom.SecureRandom.use((random) => random.randomBytes(32))),
  );
  let port = 0,
    pid = 0,
    previous = yield* outbox.last,
    start = "",
    stopping = false;
  let replacement: Deferred.Deferred<void, ControlError> | null = null;
  let reason: "open" | "crash" | "memory" | "core" = "open",
    bytes: number | undefined;
  let state = brainLife.init(null, {})[0];
  const transition = (
    msg:
      | Parameters<typeof brainLife.update.started>[1]
      | { type: "waiting"; after: string; until: number; reason: string }
      | { type: "braked"; after: string; reason: string }
      | { type: "stop" }
      | { type: "stopped" },
  ) => {
    state = applyCell(brainLife, state, msg)[0];
  };
  const call = Effect.fnUntraced(function* (
    target: Target,
    project: string,
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) {
    if (port === 0) {
      return yield* new ControlError({ reason: "offline" });
    }

    const url = `http://127.0.0.1:${port}`;
    const fail = () => new ControlError({ reason: "unreachable" });
    const request = yield* Effect.try({
      try: () => ({
        method: "POST",
        headers: {
          // oxlint-disable-next-line fabrika/no-redacted-value -- the private HTTP header sends the control bearer
          authorization: `Bearer ${Redacted.value(token)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ target, project, name, method, args }),
      }),
      catch: fail,
    });
    // oxlint-disable-next-line fabrika/no-promises -- edge: the private runtime socket is an HTTP transport for object calls
    const response = yield* Effect.tryPromise({ try: () => fetch(url, request), catch: fail });
    const badRow = () => new ControlError({ reason: "bad_row" });
    // oxlint-disable-next-line fabrika/no-promises -- edge: the binding transport response returns a Promise
    const raw = yield* Effect.tryPromise({ try: () => response.json(), catch: badRow });
    const answer = yield* Schema.decodeUnknownEffect(Response)(raw).pipe(
      Effect.mapError(() => new ControlError({ reason: "bad_row" })),
    );

    if (answer.error !== undefined) {
      return yield* new ControlError(answer.error);
    }

    return answer.value;
  });
  const flush = outbox.flush((event) => call("project", config.name, "", "brain", [event]));
  const recording = yield* stageRecording(options.home, `brain:${config.name}`, (target, name, method, args) =>
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
      const observed = { event, reason, bytes };

      // A new child starts with a clean cause before any queued file write can yield.
      if (event.type === "start") {
        reason = "crash";
        bytes = undefined;
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
        port = yield* Schema.decodeUnknownEffect(Schema.Int)(ports["fabrika-control"]).pipe(
          Effect.mapError(
            () =>
              new SystemError({
                subtag: "control_port",
                message: "The local runtime returned an invalid control port",
              }),
          ),
        );
        yield* Deferred.succeed(listening, undefined);

        if (replacement !== null) {
          yield* Deferred.succeed(replacement, undefined);
          replacement = null;
        }
      }),
    }),
  );
  const stopRuntime = Effect.fn("brain.stop")(function* () {
    stopping = true;
    transition({ type: "stop" });
    yield* Scope.close(runtimeScope, Exit.void);

    if (start !== "") {
      yield* outbox.add(
        BrainEvent.cases.stopped.make({
          id: `${start}/stopped`,
          start,
          at: Date.now(),
          reason: "stop",
        }),
      );
      yield* flush.pipe(Effect.ignore);
    }

    transition({ type: "stopped" });
  });
  yield* Effect.addFinalizer(() => recorded(stopRuntime()).pipe(Effect.orDie));
  const restartRuntime = Effect.fn("brain.restart")(function* (ready: Deferred.Deferred<void, ControlError>) {
    yield* Deferred.await(ready);
  });
  const recordEvents = Effect.forever(
    Effect.gen(function* () {
      const { event, reason, bytes: rss } = yield* Queue.take(events);

      if (stopping) {
        return;
      }

      if (event.type === "exit") {
        yield* outbox.add(
          BrainEvent.cases.exited.make({
            id: `${start}/exited`,
            start,
            at: Date.now(),
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
        pid = 0;
        const ready = yield* Deferred.make<void, ControlError>();
        replacement = ready;
        yield* Effect.forkIn(recorded(restartRuntime(ready)).pipe(Effect.ignore), scope);
      }

      if (event.type === "start") {
        previous = start || previous;
        start = yield* ids.next;
        pid = event.pid;
        const startedEvent = BrainEvent.cases.started.make({
          id: `${start}/started`,
          start,
          after: previous,
          build: config.build,
          reason,
          pid,
          at: Date.now(),
          ...(rss === undefined ? {} : { bytes: rss }),
        });
        transition({ type: "started", ...startedEvent });
        yield* outbox.add(startedEvent);
        yield* Deferred.succeed(started, undefined);
      } else if (event.type === "restart") {
        transition({ type: "waiting", after: start, until: Date.now() + event.delay, reason });
        yield* outbox.add(
          BrainEvent.cases.restarting.make({
            id: `${start}/restarting`,
            start,
            at: Date.now(),
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            backoff: event.delay,
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
      } else if (event.type === "stop") {
        if (replacement !== null) {
          yield* Deferred.fail(replacement, new ControlError({ reason: event.reason }));
          replacement = null;
        }

        transition({ type: "braked", after: start, reason: event.reason });
        yield* outbox.add(
          BrainEvent.cases.braked.make({
            id: `${start}/braked`,
            start,
            at: Date.now(),
            reason: event.reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
          }),
        );
        pid = 0;
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

  if (options.keys !== undefined) {
    const random = yield* SecureRandom.SecureRandom;
    /** One key settings change through the trusted local control, never a public route. */
    const publish = Effect.fn("keys.publish")(function* (change: object) {
      const id = Base64Url.encode(yield* random.randomBytes(12));
      const sentAt = DateTime.formatIso(yield* DateTime.now);
      yield* call("project", config.name, "", "settings", [
        { id: `keys-${id}`, source: "file", reader: `stage:${config.name}`, sentAt, ...change },
      ]);
    });
    const settings = (change: object) => publish(change).pipe(Effect.ignore, Effect.provideContext(recording));
    yield* watchKeys({
      file: `${options.home}/keybindings.toml`,
      commands: options.keys.commands,
      defaults: {},
      publish: ({ rows }) => settings({ rows }),
      status: ({ error }) => (error === null ? Effect.void : settings({ error })),
    });
  }

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep("1 second");

        if (stopping || pid === 0) {
          return;
        }

        yield* checkMemory({
          pid,
          sample,
          replace: (value) =>
            Effect.sync(() => {
              reason = "memory";
              bytes = value.bytes;
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
