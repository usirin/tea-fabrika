import { it as effectIt } from "@effect/vitest";
// P42 slice 1 (ticket 770), next/: L9 and L10 on a real local instance, L11 on the public Project.
// Outside only: real workerd,
// sockets, object storage, alarms and the private local instance capability, set up as ticket 402's
// supervision test is. Needs ports and its own processes, so it runs in the step's container (0045).
import type { Descriptor } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { letterLine } from "@kampus/libfabrika/processes/Mailbox";
import { Recipient } from "@kampus/libfabrika/processes/Process";
import { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { configureProcess, ProcessService, ProjectService, savedAlarm } from "@kampus/libfabrika/workers/runtime";
import { Clock, Effect, Exit, Layer, Logger, ManagedRuntime, Result, Schema, Scope } from "effect";
import * as fc from "fast-check";
import { assert, describe, expect, it, vi } from "vitest";
import {
  childProject,
  childInstance,
  type ChildFailure,
  type Key,
  letter,
  PROJECT,
  SENT,
} from "./start-child.test-support.ts";

// Each built-in program's hash is the SHA-256 of its source, as `BuiltProgram` requires.
const CODE = vi.hoisted(() => ({
  counter: { hash: "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698", source: "counter" },
  checklist: { hash: "6da624dba5235ba1f3901c904a78ea41debbfb0d8a488aeba7063dba508d9211", source: "checklist" },
  child: { hash: "ddc9e669194254cef019a29d3619a2c16592e5d52e1a81e98b01bd52319149a3", source: "child" },
}));

vi.mock("virtual:fabrika-built", () => ({
  programs: {
    "fabrika/counter": CODE.counter,
    // P14 slice 2: the app boots `checklist:1` after `counter:1`, so the table holds its program too.
    "fabrika/checklist": CODE.checklist,
    "p42/child": CODE.child,
  },
  assets: {},
}));

const STARTS = [{ source: "p42/starter", to: "p42/child" }];
/** Bounded waits tied to observable facts. */
const WAIT = 25_000;

type Fixture = Effect.Success<ReturnType<typeof childInstance>>;
// The instance's private local capability, read call by call as ticket 402's test reads it.
type Instance = Fixture["instance"] & Record<string, any>;

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A real 5 ms pause on Effect's live clock, whatever clock the law runs on: the test clock under
 * `it.effect`, the live one inside a fast-check run.
 */
const realPause = Effect.sleep("5 millis").pipe(Effect.provideService(Clock.Clock, Clock.Clock.defaultValue()));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean, ms = WAIT): Promise<A> => {
  const end = Date.now() + ms;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${label}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door; it keeps every pushed frame. `close` waits for the close. */
const socketAt = (instance: Instance, key: Key, tab: string) => {
  const name = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
  const socket = new WebSocket(String(instance.url).replace("http", "ws") + name);
  const frames: any[] = [];
  const pushed: any[] = [];
  let closeCode: number | undefined;
  let serial = 0;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      const frame = JSON.parse(String(event.data));
      frames.push(frame);

      if (frame.id === undefined) {
        pushed.push(frame);
      }
    }
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.addEventListener("error", () => {
    closeCode ??= 1006;
  });
  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms; last frames ${JSON.stringify(frames.slice(-3))}`);
  };
  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((frame) => frame.id === id);
  };
  const close = async () => {
    socket.close();
    const end = Date.now() + WAIT;

    while (closeCode === undefined && Date.now() < end) {
      await pause(20);
    }
  };
  return { call, next, pushed, close };
};

/** A client acquired in the caller's scope and initialized with a signed hello; the scope closes it. */
const wire = Effect.fnUntraced(function* (instance: Instance, key: Key, tab: string) {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => socketAt(instance, key, tab)),
    (held) => Effect.promise(held.close),
  );
  yield* Effect.promise(() => hello(instance, key, tab, client));
  return { call: client.call, pushed: client.pushed };
});

const hello = async (
  instance: Instance,
  key: Key,
  tab: string,
  { call, next }: Pick<ReturnType<typeof socketAt>, "call" | "next">,
) => {
  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  expect(
    (
      await call("initialize", {
        versions: [1],
        has: ["seal"],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
      })
    ).error,
  ).toBeUndefined();
};

type Client = Effect.Success<ReturnType<typeof wire>>;

/**
 * One real instance for the length of `test`, given back with its scope whatever `test` answers.
 * `connect` acquires a client in that scope, so each socket closes before the instance it reached.
 */
const world = (test: (fixture: Fixture, connect: (tab: string) => Promise<Client>) => Promise<void>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* childInstance(STARTS);
        const scope = yield* Effect.scope;
        const connect = (tab: string) =>
          Effect.runPromise(Scope.provide(scope)(wire(fixture.instance as Instance, fixture.key, tab)));
        yield* Effect.promise(() => test(fixture, connect));
      }),
    ),
  );

const helpers = ({ instance, hashes, from }: Fixture) => {
  const project = () => (instance as Instance).project(PROJECT);
  const call = (method: string, ...args: ReadonlyArray<unknown>) => {
    const target = project();
    const invoke = target[method];

    if (invoke === undefined) {
      throw new Error(`Project has no ${method} method`);
    }

    return invoke.apply(target, [...args]);
  };
  return {
    start: async (name: string, program: "starter" | "child") => {
      const started = await call(
        "start",
        { _tag: "first", id: `start-${name}`, name, code: { program: `p42/${program}`, hash: hashes[program] } },
        from,
      );
      return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
    },
    facts: async (stream: string) =>
      ((await call("read", stream, 0, "audit")) as Array<any>).map((row) => ({ ...row.body, _tag: row._tag })),
    live: async (name: string): Promise<string | undefined> =>
      ((await call("info")) as Array<any>).find((row) => row.name === name)?.process,
  };
};

// Push the escaping edge: an alphanumeric marker alone cannot distinguish these output forms.
const Secret = fc
  .tuple(fc.stringMatching(/^sk-[A-Za-z0-9]{24}$/), fc.constantFrom('"', "/%? ", "\n"))
  .map(([word, suffix]) => word + suffix);

const forms = (text: string) => [text, JSON.stringify(text).slice(1, -1), encodeURIComponent(text)];
// Effect Arbitrary has no command-walk generator or fast-check adapter.
const SecretPick = fc.record({ point: fc.nat(), encoding: fc.integer({ min: 0, max: 2 }) });
type SecretPick = typeof SecretPick extends fc.Arbitrary<infer A> ? A : never;
type SecretWalk = { step: (pick: SecretPick) => Effect.Effect<void, unknown> };
type ChildOutput = "reply" | "span" | "row" | "log";

const ProjectTape = fc
  .commands(
    [
      SecretPick.map((pick): fc.AsyncCommand<object, SecretWalk> => ({
        check: () => true,
        run: (_model, real) => Effect.runPromise(real.step(pick)),
        toString: () => JSON.stringify(pick),
      })),
    ],
    { maxCommands: 12, size: "max" },
  )
  .filter((tape) => [...tape].length >= 4);

// Read stored JSON values and their string leaves. Error causes are deliberately excluded: only
// the message that runPromise actually put in its rejected Error is an error output.
const outputText = (value: unknown): Array<string> => {
  if (typeof value === "string") {
    return [value, JSON.stringify(value)];
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...outputText(entry)]);
  }

  return [];
};

const projectSecrets = Effect.fnUntraced(function* (
  path: "descriptor" | "recovery" | "configuration" | "exit",
  output: ChildOutput,
  secret: string,
  tape: Iterable<fc.AsyncCommand<object, SecretWalk>>,
) {
  const fixture = yield* childProject();
  const outputs: Record<ChildOutput, Array<string>> = { reply: [], span: [], row: [], log: [] };
  const logger = Logger.make((options) => {
    outputs.log.push(
      Logger.formatSimple.log(options),
      Logger.formatLogFmt.log(options),
      Logger.formatJson.log(options),
    );
  });
  const logging = Logger.layer([logger]);
  let scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  let runtime = yield* Scope.provide(scope)(fixture.acquire());
  const reopen = Effect.fnUntraced(function* () {
    yield* Scope.close(scope, Exit.void);
    scope = yield* Scope.make();
    runtime = yield* Scope.provide(scope)(fixture.acquire());
  });
  const project = yield* Effect.promise(() => runtime.runPromise(ProjectService.pipe(Effect.provide(logging))));
  let child = {
    id: `${project.boot.process}/1/0`,
    name: "child:secret",
    code: { program: "p42/child", hash: CODE.child.hash },
    requester: Recipient.cases.process.make({ process: project.boot.process }),
    input: { type: "inc" },
  };
  let pid: string | undefined;
  const call = Effect.fnUntraced(function* () {
    const outcome = yield* Effect.tryPromise({
      try: () =>
        runtime.runPromise(
          ProjectService.use((p) => {
            const request: Effect.Effect<unknown, unknown> =
              path === "exit"
                ? p.processExit(pid ?? "", { _tag: "normal" }, fixture.from)
                : p.processChild(child, fixture.from);
            return request;
          }).pipe(Effect.provide(logging)),
        ),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.result);

    if (Result.isFailure(outcome)) {
      const error = outcome.failure;
      // This is the actual public call's rejection, not Cause.pretty on an in-memory Exit.
      outputs.reply.push(error instanceof Error ? error.message : String(error), String(error));
    } else {
      outputs.reply.push(...outputText(outcome.success));
    }

    return outcome;
  });
  const placed = Effect.fnUntraced(function* () {
    const starts = yield* Effect.promise(() => runtime.runPromise(project.read(`processes/${child.name}`, 0, "audit")));
    const saved = starts.filter((row) => row._tag === "started");
    expect(saved, "L11: the failing path follows a committed child start").toHaveLength(1);
    pid = Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(saved[0]?.body).process;
  });
  const remaining = new Set<ChildFailure>(
    path === "descriptor"
      ? ["owner", "descriptor"]
      : path === "recovery"
        ? ["exists", "owner", "descriptor"]
        : path === "configuration"
          ? ["pending", "configure", "ack"]
          : ["exit_write", "down", "watch_cleanup", "retire"],
  );
  const expected = remaining.size;
  const reached = new Set<ChildFailure>();
  const inspectRows = () => {
    outputs.row.push(...outputText(fixture.rows()));
    outputs.span.push(...outputText(fixture.recorded));
  };

  if (path !== "descriptor" && path !== "exit") {
    // A real failed call leaves exactly the missing descriptor or pending configure to recover.
    if (path === "recovery") {
      fixture.cut();
    } else {
      fixture.fail("configure", new Error("configuration interrupted"));
    }

    expect(Result.isFailure(yield* call())).toBe(true);
    expect(fixture.hit()).toBe(true);
    yield* placed();
    inspectRows();
  }

  const step = Effect.fnUntraced(function* (pick: SecretPick) {
    if (remaining.size === 0) {
      if (path === "recovery") {
        // A failed ManagedRuntime initialization is memoized until that runtime is discarded.
        yield* reopen();
      }

      const answer = yield* call();
      expect(Result.isSuccess(answer), "L11: the failed start is retryable").toBe(true);

      if (Result.isSuccess(answer) && path !== "exit") {
        expect(answer.success).toMatchObject({
          _tag: "ok",
          value: { _tag: "started", process: pid, name: child.name },
        });
      }

      inspectRows();
      return;
    }

    // Only moves possible in the current state are offered: a missing descriptor can be read or
    // inserted; a saved descriptor can be configured; recovery first discards service memory.
    const available = [...remaining];
    const point = available[pick.point % available.length];

    if (point === undefined) {
      return yield* Effect.die("empty child failure walk");
    }

    if (path === "recovery") {
      yield* reopen();
    }

    if (path === "exit") {
      // A completed exit is irreversible. Each remaining failure needs a live child, with both
      // an inbound watch to signal and an outbound watch to remove in the same exit turn.
      child = { ...child, id: `${project.boot.process}/${reached.size + 1}/0`, name: `child:secret:${reached.size}` };
      const started = yield* Effect.promise(() =>
        runtime.runPromise(
          ProjectService.use((p) => p.processChild(child, fixture.from)).pipe(Effect.provide(logging)),
        ),
      );
      expect(started).toMatchObject({ _tag: "ok", value: { _tag: "started" } });
      yield* placed();
      const process = pid ?? "";
      const watched = yield* Effect.promise(() =>
        runtime.runPromise(ProjectService.use((p) => p.processMonitor(`in-${reached.size}`, process, fixture.from))),
      );
      expect(watched).toMatchObject({ _tag: "ok" });
      yield* fixture.monitor(process, project.boot.process, `out-${reached.size}`);
    }

    const marker = forms(secret)[pick.encoding] ?? secret;
    const error = Object.assign(new Error(`SQLITE_FULL at ${marker}`), { name: marker, code: marker, errcode: marker });
    fixture.fail(point, error, path === "exit" || point === "owner" ? undefined : pid);
    const outcome = yield* call();
    expect(fixture.hit(), `L11: ${path}/${point} was reached`).toBe(true);
    expect(Result.isFailure(outcome), "L11: storage failure is an RPC rejection").toBe(true);

    if (path === "descriptor" && pid === undefined) {
      yield* placed();
    }

    inspectRows();

    if (path === "exit") {
      const retried = yield* call();
      expect(retried, "L11: the failed exit remains retryable").toMatchObject({
        _tag: "Success",
        success: { _tag: "ok" },
      });
      const rows = yield* Effect.promise(() => runtime.runPromise(project.read(`processes/${child.name}`, 0, "audit")));
      expect(
        rows.filter((row) => row._tag === "exited"),
        "L11: retry writes one normal exit",
      ).toMatchObject([{ body: { process: pid, reason: { _tag: "normal" } } }]);
      const watches = yield* Effect.promise(() => runtime.runPromise(project.read("processes", 0, "audit")));
      expect(
        watches.filter((row) => row._tag === "demonitored" && JSON.stringify(row.body).includes(`out-${reached.size}`)),
      ).toHaveLength(1);
      inspectRows();
    }

    remaining.delete(point);
    reached.add(point);
  });
  yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: {}, real: { step } }), tape));
  expect(reached.size, "L11: every available failure operation was exercised").toBe(expected);
  expect(fixture.configured.filter((c) => c.descriptor.name === child.name).length).toBeGreaterThan(0);
  const recorded = fixture.recorded.flatMap((batch) =>
    Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ span: SpanRow, content: Schema.NullOr(Schema.String) })))(
      batch,
    ),
  );
  expect(recorded.length, "L11: real stored spans were inspected").toBeGreaterThan(0);

  // Each string leaf gets every check, without Vitest matcher bookkeeping in this hot loop.
  const secretForms = forms(secret);

  for (const text of outputs[output]) {
    for (const form of secretForms) {
      assert(!text.includes(form), `L11: ${path} leaked storage text or metadata into ${output}`);
    }
  }
});

// Each SQL occurrence is a cut, not just each statement spelling: the saved-id read after a
// committed start and the same read before that start are separate operations.
const StoragePath = [
  "fresh",
  "saved",
  "already",
  "ended",
  "recovery",
  "migration",
  "configuration",
  "exit",
  "status",
  "isLive",
  "info",
  "resolve",
  "receive",
  "object",
  "read",
  "append",
] as const;
type StoragePath = (typeof StoragePath)[number];
type StorageCut = { path: StoragePath; operation: number; statement: string };

const storageCall = Effect.fnUntraced(function* (
  path: StoragePath,
  inspect: (
    fixture: Effect.Success<ReturnType<typeof childProject>>,
    call: Effect.Effect<unknown, unknown>,
    reopen: Effect.Effect<void>,
  ) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const fixture = yield* childProject();
  let scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  let runtime = yield* Scope.provide(scope)(fixture.acquire());
  const reopen = Effect.gen(function* () {
    yield* Scope.close(scope, Exit.void);
    scope = yield* Scope.make();
    runtime = yield* Scope.provide(scope)(fixture.acquire());
  });
  const project = yield* Effect.promise(() => runtime.runPromise(ProjectService));
  const child = {
    id: `${project.boot.process}/1/0`,
    name: "child:storage",
    code: { program: "p42/child", hash: CODE.child.hash },
    requester: Recipient.cases.process.make({ process: project.boot.process }),
    input: { type: "inc" },
  };
  const start = ProjectService.use((p) => p.processChild(child, fixture.from));
  let pid = "";
  let rev = 0;
  let prepared = true;

  if (path === "recovery") {
    fixture.cut();
    const failed = yield* Effect.tryPromise({
      try: () => runtime.runPromise(start),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.result);
    prepared = Result.isFailure(failed) && fixture.hit();
    yield* reopen;
  } else if (path === "configuration") {
    fixture.fail("configure", new Error("configuration interrupted"));
    const failed = yield* Effect.tryPromise({
      try: () => runtime.runPromise(start),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.result);
    prepared = Result.isFailure(failed) && fixture.hit();
  } else if (path !== "fresh") {
    const started = yield* Effect.promise(() => runtime.runPromise(start));
    prepared = started._tag === "ok" && started.value._tag === "started";

    if (started._tag !== "ok" || started.value._tag !== "started") {
      return yield* Effect.die("child was not started");
    }

    pid = started.value.process;
    rev = started.value.rev;

    if (path === "migration") {
      // A table from before the pending column held delivered starts only: each start was
      // configured before it answered. The boot's own start is delivered after the build (ticket
      // 762), so wait for it, or the migration would mark an undelivered start as delivered.
      // The pause is a real one, since this law runs on the test clock, which never moves by itself.
      for (let tries = 0; fixture.undelivered() > 0; tries++) {
        expect(tries, "L11: the boot's own start is delivered before the migration").toBeLessThan(1000);
        yield* realPause;
      }

      fixture.legacyDescriptors();
      yield* reopen;
    }

    if (path === "ended") {
      yield* Effect.promise(() =>
        runtime.runPromise(ProjectService.use((p) => p.processExit(pid, { _tag: "normal" }, fixture.from))),
      );
    }

    if (path === "exit") {
      yield* Effect.promise(() =>
        runtime.runPromise(ProjectService.use((p) => p.processMonitor("in", pid, fixture.from))),
      );
      yield* fixture.monitor(pid, project.boot.process, "out");
    }
  }

  expect(prepared, `L11: ${path} begins in its required process state`).toBe(true);
  const call = ProjectService.use((p): Effect.Effect<unknown, unknown> => {
    switch (path) {
      case "status":
        return p.processStatus(child.name);
      case "isLive":
        return p.processIsLive(pid);
      case "info":
        return p.info;
      case "resolve":
        return p.processResolve(pid);
      case "receive":
        return p.processReceive(pid, 0);
      case "object":
        return p.processObject(pid);
      case "read":
        return p.read(`${child.name}/inbox`, 0, pid);
      case "append":
        return p.append(
          "counter:1/inbox",
          `${child.id}/answer`,
          letterLine(fixture.from, {
            type: "start_child_ok",
            cmd: { type: "start_child", id: child.id, input: { program: child.code.program, name: child.name } },
            value: { _tag: "started", process: pid, name: child.name, rev },
          }),
        );
      case "exit":
        return p.processExit(pid, { _tag: "normal" }, fixture.from);
      default:
        return p.processChild(
          path === "already" || path === "ended" ? { ...child, id: `${project.boot.process}/2/0` } : child,
          fixture.from,
        );
    }
  });
  const printed: Array<string> = [];
  const logging = Logger.layer([
    Logger.make((options) => {
      printed.push(Logger.formatSimple.log(options), Logger.formatLogFmt.log(options), Logger.formatJson.log(options));
    }),
  ]);
  const invoke = Effect.tryPromise({
    try: () => runtime.runPromise(call.pipe(Effect.provide(logging))),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
  yield* inspect(fixture, invoke, reopen);
  return printed;
});

const storageSecrets = Effect.fnUntraced(function* () {
  const remaining: Array<StorageCut> = [];

  for (const path of StoragePath) {
    yield* Effect.scoped(
      storageCall(path, (fixture, call) =>
        Effect.gen(function* () {
          fixture.observe();
          yield* call;
          const statements = fixture.observed();
          expect(statements.length, `L11: ${path} reached storage`).toBeGreaterThan(0);
          statements.forEach((statement, operation) => {
            remaining.push({ path, operation, statement });
          });
        }),
      ),
    );
  }

  const inventory = [...remaining];
  const reached = new Set<string>();
  const leaks = new Set<string>();
  const perWalk = Math.max(4, Math.ceil(inventory.length / 100));
  const tape = fc
    .commands(
      [
        SecretPick.map((pick): fc.AsyncCommand<object, SecretWalk> => ({
          check: () => true,
          run: (_model, real) => Effect.runPromise(real.step(pick)),
          toString: () => JSON.stringify(pick),
        })),
      ],
      { maxCommands: perWalk + 8, size: "max" },
    )
    .filter((commands) => [...commands].length >= perWalk);
  const law = Effect.fnUntraced(function* (secret: string, commands: Iterable<fc.AsyncCommand<object, SecretWalk>>) {
    let moves = 0;
    const step = Effect.fnUntraced(function* (pick: SecretPick) {
      // The model records completed cuts only. Pick an unvisited operation that its prepared
      // process state can reach, or repeat a visited one once the whole inventory is covered.
      const available = remaining.length > 0 ? remaining : inventory;
      const cut = available[pick.point % available.length];

      if (cut === undefined) {
        return yield* Effect.die("empty storage inventory");
      }

      const marker = forms(secret)[pick.encoding] ?? secret;
      const fault = Object.assign(new Error(`SQLITE_FULL at ${marker}`), {
        name: marker,
        code: marker,
        errcode: marker,
      });
      const outputs: Record<ChildOutput, Array<string>> = { reply: [], row: [], span: [], log: [] };
      const printed = yield* Effect.scoped(
        storageCall(cut.path, (fixture, call, reopen) =>
          Effect.gen(function* () {
            fixture.observe(cut.operation, fault);
            const outcome = yield* call.pipe(Effect.result);
            fixture.observed();
            expect(fixture.hit(), `L11: ${cut.path}/${cut.operation} ${cut.statement}`).toBe(true);

            if (Result.isFailure(outcome)) {
              const error = outcome.failure;
              outputs.reply.push(error instanceof Error ? error.message : String(error), String(error));
            } else {
              outputs.reply.push(...outputText(outcome.success));
            }

            outputs.row.push(...outputText(fixture.rows()));
            outputs.span.push(...outputText(fixture.recorded));

            if (cut.path === "recovery" || cut.path === "migration") {
              yield* reopen;
            }

            const recovered = yield* call;
            outputs.reply.push(...outputText(recovered));
            outputs.row.push(...outputText(fixture.rows()));
            outputs.span.push(...outputText(fixture.recorded));
          }),
        ),
      );
      outputs.log.push(...(printed ?? []));

      for (const [output, texts] of Object.entries(outputs)) {
        if (texts.some((text) => forms(secret).some((form) => text.includes(form)))) {
          leaks.add(`${cut.path}/${cut.operation} ${cut.statement} -> ${output}`);
        }
      }

      reached.add(`${cut.path}/${cut.operation}`);

      if (remaining.length > 0) {
        remaining.splice(remaining.indexOf(cut), 1);
      }

      moves++;
    });
    yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: {}, real: { step } }), commands));
    expect(moves, "L11: the storage walk is not empty").toBeGreaterThan(0);
  });
  yield* Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(Secret, tape, (secret, commands) => Effect.runPromise(law(secret, commands))),
      { seed: 119120, numRuns: 100, endOnFailure: true },
    ),
  );
  expect(remaining, "L11: every storage operation in every flow was cut").toEqual([]);
  expect(reached.size).toBe(inventory.length);
  expect(
    [...leaks].sort(),
    `L11: ${reached.size} storage operations were cut; storage text or metadata reached these outputs`,
  ).toEqual([]);
});

describe("P42 slice 1: a code start on the real Worker path", () => {
  effectIt.effect(
    "L11: every storage read and write in the child and lifecycle flows keeps error text and metadata out of outputs",
    storageSecrets,
  );

  for (const path of ["descriptor", "recovery", "configuration", "exit"] as const) {
    for (const output of ["reply", "span", "row", "log"] as const) {
      effectIt.effect(
        `L11: Project.${path === "exit" ? "processExit" : "processChild"} ${path} failures keep storage text and metadata out of ${output}`,
        () =>
          Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(Secret, ProjectTape, (secret, tape) =>
                Effect.runPromise(Effect.scoped(projectSecrets(path, output, secret, tape))),
              ),
              { seed: 119120, numRuns: 100, endOnFailure: true },
            ),
          ),
      );
    }
  }

  // scenario: L10. One committed-start cut, before the descriptor can be saved. Real-instance
  // execution is checked below; here the public Project service must repair the interrupted start.
  it("scenario: L10: a committed child without its descriptor recovers and configures once", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* childProject();
          const scope = yield* Scope.make();
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
          const first = yield* Scope.provide(scope)(fixture.acquire());
          const project = yield* Effect.promise(() => first.runPromise(ProjectService));
          const boot = project.boot.process;
          const child = {
            id: `${boot}/1/0`,
            name: "child:cut",
            code: { program: "p42/child", hash: CODE.child.hash },
            requester: Recipient.cases.process.make({ process: boot }),
            input: { type: "inc" },
          };
          fixture.cut();
          const cut = yield* Effect.promise(() =>
            first.runPromise(Effect.exit(project.processChild(child, fixture.from))),
          );
          expect(fixture.hit(), "L10: the cut reached the descriptor write").toBe(true);
          expect(cut._tag).toBe("Failure");
          const starts = yield* Effect.promise(() => first.runPromise(project.read("processes/child:cut", 0, "audit")));
          const committed = starts.filter((row) => row._tag === "started");
          expect(committed, "L10: the child start committed before the descriptor failed").toHaveLength(1);
          const input = yield* Effect.promise(() => first.runPromise(project.read("child:cut/inbox", 0, "audit")));
          expect(input, "L10: the first letter committed with the start").toHaveLength(1);
          expect(fixture.configured.filter((call) => call.descriptor.name === child.name)).toEqual([]);
          yield* Scope.close(scope, Exit.void);
          const reopened = yield* fixture.acquire();
          const recovered = yield* Effect.promise(() => reopened.runPromise(ProjectService));
          const reply = yield* Effect.promise(() => reopened.runPromise(recovered.processChild(child, fixture.from)));
          expect(reply, "L10: retry finds the saved start with its original revision").toMatchObject({
            _tag: "ok",
            value: { _tag: "started", name: child.name, rev: committed[0]?.rev },
          });
          expect(
            fixture.configured.filter((call) => call.descriptor.name === child.name),
            "L10: recovery rebuilds the descriptor and wakes the first letter once",
          ).toEqual([
            {
              descriptor: {
                id: Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(committed[0]?.body).process,
                name: child.name,
                program: "p42/child",
                build: CODE.child.hash,
                owner: fixture.configured[0]?.descriptor.owner,
              },
              wake: true,
            },
          ]);
          expect(
            yield* Effect.promise(() => reopened.runPromise(recovered.read("child:cut/inbox", 0, "audit"))),
          ).toEqual(input);
        }),
      ),
    );
  });

  // scenario: L10, A7. One storage cut between saving the first wake and setting its alarm.
  // The real-instance check below proves execution; this checks the public configure handoff's retry.
  it("scenario: L10: a retry after the first alarm write fails arms the saved wake", async () => {
    const values = new Map<string, unknown>();
    let armed: number | undefined;
    let fail = true;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the fixture supplies only the storage calls configureProcess reads; workerd owns the full context
    const ctx = {
      exports: { IsolateTail: () => ({ fetch: async () => new Response() }) },
      storage: {
        get: async (key: string) => values.get(key),
        put: async (key: string, value: unknown) => {
          values.set(key, value);
        },
        setAlarm: async (at: number) => {
          if (fail) {
            fail = false;
            throw new Error("first alarm write failed");
          }

          armed = at;
        },
      },
    } as unknown as Parameters<typeof configureProcess>[0];
    const descriptor: Descriptor = {
      id: "process_0000000000e008000000000001",
      name: "child:alarm",
      program: "p42/child",
      build: "p42-alarm",
      owner: Writer.cases.person.make({ key: "SHA256:test", for: "person_01m6v5270hf3c8x2q7w9z4k5mn" }),
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const unused = () => Effect.die("unexpected process service call");
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() =>
              ManagedRuntime.make(
                Layer.succeed(ProcessService, {
                  usage: unused,
                  msg: unused,
                  swap: unused,
                  mailed: unused,
                  open: unused,
                  due: unused,
                  init: () => Effect.void,
                  restart: unused,
                  alarm: unused,
                  activity: unused,
                  recover: unused,
                }),
              ),
            ),
            (runtime: ManagedRuntime.ManagedRuntime<ProcessService, never>) => runtime.disposeEffect,
          );
          yield* Effect.promise(async () => {
            const first = await Effect.runPromise(Effect.result(configureProcess(ctx, descriptor, runtime, true)));
            expect(first._tag).toBe("Failure");
            const wake = await Effect.runPromise(savedAlarm(ctx));
            expect(wake).toBeTypeOf("number");
            expect(armed).toBeUndefined();
            await Effect.runPromise(configureProcess(ctx, descriptor, runtime, true));
            expect(armed, "L10: retry arms the first wake even though its saved value already exists").toBe(wake);
            expect(values.get("descriptor")).toEqual(descriptor);
            expect(await Effect.runPromise(savedAlarm(ctx))).toBe(wake);
          });
        }),
      ),
    );
  });

  // scenario: L9. Only the real project holds the client list a notify would reach, so one real
  // instance with one connected client is the check; generated Node laws cannot see that list.
  it("scenario: L9: a code start sends nothing to any client: no view, no notify, no focus", async () => {
    await world(async (fixture, connect) => {
      const { start, live } = helpers(fixture);
      const starter = await start("starter:1", "starter");
      const client = await connect("children");

      const quiet = client.pushed.length;
      const sent = await client.call(
        "process.send",
        letter(starter, "start-1", { type: "start", program: "p42/child", name: "child:1", input: { type: "inc" } }),
      );
      expect(sent, "the starter takes the letter").toMatchObject({ result: { _tag: "accepted" } });
      const child = await until(
        "the child is live",
        () => live("child:1"),
        (pid) => pid !== undefined,
      );
      // Settle: anything the start would push has had its turn.
      await pause(1_000);
      const after = client.pushed.slice(quiet);
      expect(
        after.filter(
          (frame) => JSON.stringify(frame).includes(String(child)) || JSON.stringify(frame).includes("child:1"),
        ),
        "L9: no frame about the child reaches any client",
      ).toEqual([]);
      expect(
        after.filter((frame) => /notify|view|focus|open/i.test(String(frame.method))),
        "L9: a code start opens, notifies and focuses nothing",
      ).toEqual([]);
    });
  });

  // scenario: L10. Only a real object proves the descriptor and configure path: a child started by
  // code must run, and a throw must restart it in its own object as the boot's child restarts.
  it("scenario: L10: a started child runs, and a throw restarts it in its own object while others keep their counts", async () => {
    await world(async (fixture, connect) => {
      const { start, live, facts } = helpers(fixture);
      const starter = await start("starter:1", "starter");
      const peer = await start("child:boot", "child");
      const other = await until(
        "the independent counter is live",
        () => live("counter:1"),
        (pid) => pid !== undefined,
      );
      expect(other).toBeDefined();
      const client = await connect("children");

      for (let n = 0; n < 2; n++) {
        expect(await client.call("process.send", letter(other ?? "", `other-inc-${n}`, { type: "inc" }))).toMatchObject(
          {
            result: { _tag: "accepted" },
          },
        );
      }

      const otherView = await until(
        "the independent counter has a nonzero count",
        () => client.call("view.open", { pid: other }),
        (frame) => frame.result?.view?.count === 2,
      );
      expect(await client.call("process.send", letter(peer, "peer-inc", { type: "inc" }))).toMatchObject({
        result: { _tag: "accepted" },
      });
      const peerView = await until(
        "another life of the child's program has a nonzero count",
        () => client.call("view.open", { pid: peer }),
        (frame) => frame.result?.view?.count === 1,
      );

      await client.call(
        "process.send",
        letter(starter, "start-1", { type: "start", program: "p42/child", name: "child:1", input: { type: "inc" } }),
      );
      const first = String(
        await until(
          "the started child is live",
          () => live("child:1"),
          (pid) => pid !== undefined,
        ),
      );
      // It runs: its first letter was stepped, and a door letter steps it again.
      const view = await until(
        "the child stepped its first letter",
        () => client.call("view.open", { pid: first }),
        (frame) => frame.result?.view?.count === 1,
      );
      expect(view, "L10: the child's first letter is its input").toMatchObject({ result: { view: { count: 1 } } });
      expect(await client.call("process.send", letter(first, "inc-1", { type: "inc" }))).toMatchObject({
        result: { _tag: "accepted" },
      });
      await until(
        "the child stepped its next letter",
        () => client.call("view.open", { pid: first }),
        (frame) => frame.result?.view?.count === 2,
      );
      const starterView = await until(
        "the starter saved its request and answer",
        () => client.call("view.open", { pid: starter }),
        (frame) => frame.result?.view?.asked === 1 && frame.result?.view?.told?.length === 1,
      );
      expect(starterView.result.view.told).toMatchObject([{ _tag: "started", process: first, name: "child:1" }]);

      // A throw restarts it: one restarted fact naming the old life, in the child's own name.
      await client.call("process.send", letter(first, "throw-1", { type: "throw" }));
      const [restarted] = await until(
        "one restarted fact after the child's throw",
        async () => (await facts("processes/child:1")).filter((fact) => fact._tag === "restarted"),
        (rows) => rows.length >= 1,
      );
      expect(restarted, "L10: P34 restarts the child in its own name").toMatchObject({
        after: first,
        name: "child:1",
      });
      const second = await until(
        "the successor is live",
        () => live("child:1"),
        (pid) => pid !== undefined && pid !== first,
      );
      expect(second).toBe(restarted?.["process"]);

      // Its starter and the other program keep their lives and their counts.
      expect(await live("starter:1"), "L10: the starter keeps its life").toBe(starter);
      expect(await live("counter:1"), "L10: another program keeps its life").toBe(other);
      expect(await live("child:boot"), "L10: another life of the child's program stays live").toBe(peer);
      expect(
        (await client.call("view.open", { pid: starter })).result?.view,
        "L10: the starter keeps its saved state after the child throws",
      ).toEqual(starterView.result.view);
      expect(
        (await client.call("view.open", { pid: other })).result?.view,
        "L10: the independent program keeps its nonzero count after the child throws",
      ).toEqual(otherView.result.view);
      expect(
        (await client.call("view.open", { pid: peer })).result?.view,
        "L10: another life of the child's program keeps its nonzero count",
      ).toEqual(peerView.result.view);
      expect(
        (await facts("processes/starter:1")).filter((fact) => fact._tag === "restarted"),
        "L10: the starter's restarts are unchanged",
      ).toEqual([]);
      expect(
        (await facts("processes/counter:1")).filter((fact) => fact._tag === "restarted"),
        "L10: another program's restarts are unchanged",
      ).toEqual([]);
      expect(
        (await facts("processes/child:boot")).filter((fact) => fact._tag === "restarted"),
        "L10: another life of the child's program has no restart",
      ).toEqual([]);
    });
  });
});
