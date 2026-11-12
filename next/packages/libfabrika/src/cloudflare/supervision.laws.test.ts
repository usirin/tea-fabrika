// P12, next/. Real box methods, execution adapters, runner, manager, receipts and SQLite.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for referee transactions
import { Machine } from "@demlik/tea/effect";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Mailbox, ProcessStore, Writer } from "../coordination/index.ts";
import { Gateway } from "../gateway/Gateway.ts";
import { InputId } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { A, B, brain, data, first, from, ids, PIDS, read, storage } from "../processes/Process.test-support.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, Incoming, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { workerExecution } from "../runtime/Execution.ts";
import { RecoveryStore, recoveryStore } from "../runtime/RecoveryStore.ts";
import { ProgramRunner, Sent, Supervision } from "../runtime/Runner.ts";
import { Written } from "../telemetry/Records.ts";
import { KeyLine, writeSshsig } from "../transport/Sshsig.ts";
import { programBox } from "./box.ts";
import { ProjectService, projectLayer } from "./runtime.ts";

// Only Cloudflare's base class is supplied. No execution or supervision method is replaced.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
const NAME = "counter:1";
const BUILD = "build-a";
const owner = Writer.cases.person.make({ key: "SHA256:fixture", for: from().for });
const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });

const ProjectInput = Schema.Struct({
  type: Schema.String,
  n: Schema.optionalKey(Schema.Int),
  body: Schema.optionalKey(Schema.String),
});

type Move = "rpc" | "decode" | "throw";

const projectWalk = Effect.fnUntraced(function* (tape: ReadonlyArray<number>, reached: Set<string>) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db);
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const field = (bytes: Uint8Array) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(bytes.length);
    return Buffer.concat([n, bytes]);
  };
  const line = Schema.decodeUnknownSync(KeyLine)(
    `ssh-ed25519 ${Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]).toString("base64")}`,
  );
  const fingerprint = `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`;
  const program = {
    name: "counter",
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (saved) => [saved ?? { count: 0 }, []],
      update: { add: (s, m) => [{ count: s.count + m.n }, []] },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: { add: { _tag: "write", schema: Msg, description: "Add", personOnly: false } },
    outputs: {},
    writes: {},
    wake: () => null,
  };
  const Box = programBox(program, BUILD);
  const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
  let accepted = 0;
  // Only platform handles are supplied. Project routing, audit, Gateway and box calls are real.
  const unused = vi.fn((): never => {
    throw new Error("unused platform call");
  });
  const namespace = (getByName = vi.fn().mockImplementation(unused)) => ({
    getByName,
    newUniqueId: unused,
    idFromName: unused,
    idFromString: unused,
    get: unused,
    jurisdiction: unused,
  });
  const ctx: Parameters<typeof projectLayer>[0] = {
    id: { name: "p13-project", equals: unused, toString: unused },
    storage: {
      sql: { exec: vi.fn().mockImplementation(sql.exec), databaseSize: 0, Cursor: unused, Statement: unused },
      transactionSync: sql.transaction,
      get: unused,
      list: unused,
      put: unused,
      delete: unused,
      deleteAll: unused,
      transaction: unused,
      getAlarm: unused,
      setAlarm: unused,
      deleteAlarm: unused,
      sync: unused,
      getCurrentBookmark: unused,
      getBookmarkForTime: unused,
      onNextSessionRestoreBookmark: unused,
      kv: { get: unused, list: unused, put: unused, delete: unused },
    },
    waitUntil: unused,
    exports: {},
    props: undefined,
    facets: { get: unused, delete: unused, abort: unused, clone: unused },
    blockConcurrencyWhile: unused,
    acceptWebSocket: unused,
    getWebSockets: unused,
    setWebSocketAutoResponse: unused,
    getWebSocketAutoResponse: unused,
    getWebSocketAutoResponseTimestamp: unused,
    setHibernatableWebSocketEventTimeout: unused,
    getHibernatableWebSocketEventTimeout: unused,
    getTags: unused,
    abort: unused,
  };
  const env: Parameters<typeof projectLayer>[1] = {
    PROJECT: namespace(),
    CONNECTION: namespace(),
    LOADER: {
      get: vi.fn().mockReturnValue({ getEntrypoint: vi.fn().mockReturnValue(box), getDurableObjectClass: unused }),
      load: unused,
    },
    PROCESS: namespace(
      vi.fn().mockReturnValue({
        configure: async () => undefined,
        msg: async (input: Incoming) =>
          (await box.admit(input.envelope.input))
            ? Sent.cases.accepted.make({ rev: ++accepted, pos: accepted })
            : Sent.cases.refused.make({ reason: "bad_msg" }),
      }),
    ),
    RECORD: namespace(vi.fn().mockReturnValue({ write: async () => Written.cases.written.make({}) })),
    MEASUREMENTS: {
      head: unused,
      get: unused,
      put: unused,
      createMultipartUpload: unused,
      resumeMultipartUpload: unused,
      delete: unused,
      list: unused,
    },
  };
  const url = "https://fabrika.test/p13-project";
  const project = yield* ProjectService.pipe(
    Effect.provide(
      projectLayer(ctx, env, {
        config: {
          name: "p13-project",
          person: from().for,
          founder: line,
          window: raw.toString("base64url"),
          port: 0,
          build: BUILD,
        },
        programs: { counter: { hash: BUILD, source: "" } },
        bootstrap: { name: NAME, id: "project-start", program: "counter" },
        door: (options) =>
          Gateway.pipe(
            Effect.provide(
              Gateway.layer({
                ...options,
                name: "p13-project",
                url,
                origins: ["https://fabrika.test"],
                versions: [1],
                location: "test",
                build: BUILD,
                waiting: { most: 20, ttl: 600_000 },
                ping: { min: 10_000, max: 60_000 },
                inputCap: 1000,
                spentCap: 1000,
                deliver: (pid, _envelope, _span, incoming) => options.deliver(pid, incoming),
                inputs: {
                  schema: ProjectInput,
                  raw: [],
                  personOnly: [],
                  name: (m) => m.type,
                },
                events: { personOnly: [] },
              }),
            ),
          ),
      }),
    ),
  );
  const client = yield* project.connect();
  const nonce = yield* project.challenge(client);
  const tab = "project-test";
  const signed = yield* writeSshsig({
    text: `fabrika-hello\n${url}\n${tab}\n${nonce}`,
    line,
    space: "fabrika-client",
    sign: (bytes) => Effect.sync(() => sign(null, bytes, pair.privateKey)),
  });
  expect(
    yield* project.initialize(
      client,
      {
        versions: [1],
        has: [],
        ping: "30s",
        key: raw.toString("base64url"),
        tab,
        nonce,
        signed,
        platform: "headless",
        os: "linux",
        sentAt: from().sentAt,
      },
      { url, tab, name: fingerprint },
    ),
  ).toMatchObject({ _tag: "online" });
  const history: Array<{ letter: string; m: typeof ProjectInput.Type; answer: unknown }> = [];

  for (const [n, entropy] of tape.entries()) {
    const moves = history.length === 0 ? ["valid"] : ["valid", "unknown", "retry"];
    const move = moves[entropy % moves.length]!;
    reached.add(move);
    const prior = move === "retry" ? history[Math.floor(entropy / moves.length) % history.length]! : undefined;
    const letter = prior?.letter ?? `project-${n}`;
    const m =
      prior?.m ??
      (move === "unknown"
        ? ProjectInput.make({ type: `unknown-${accepted}`, body: `BODY-${entropy}-${n}` })
        : Msg.make({ type: "add", n: accepted + 1 }));
    const answer = yield* project.route(client, "process.send", {
      pid: project.boot.process,
      letter,
      m,
      sentAt: from().sentAt,
      seen: 0,
    });

    if (prior !== undefined) {
      expect(answer).toEqual(prior.answer);
    } else {
      expect(answer).toMatchObject({ _tag: "ok", result: { _tag: move === "unknown" ? "refused" : "accepted" } });
      history.push({ letter, m, answer });
    }
  }
});

it("A13: project routing keeps unknown message types as normal refusals through the real audit callback", async () => {
  const reached = new Set<string>();
  await fc.assert(
    fc.asyncProperty(fc.array(fc.noBias(fc.nat()), { minLength: 12, maxLength: 24 }), (tape) =>
      Effect.runPromise(Effect.scoped(projectWalk(tape, reached))),
    ),
    { seed: 119120, numRuns: 6, endOnFailure: true },
  );
  expect([...reached]).toEqual(expect.arrayContaining(["valid", "unknown", "retry"]));
});

const thrown = fc.oneof(
  fc
    .tuple(fc.constantFrom("Error", "TypeError", "RangeError", "SyntaxError", "custom"), fc.string())
    .map(([kind, message]) => {
      class ProgramError extends Error {}
      return kind === "TypeError"
        ? new TypeError(message)
        : kind === "RangeError"
          ? new RangeError(message)
          : kind === "SyntaxError"
            ? new SyntaxError(message)
            : kind === "custom"
              ? new ProgramError(message)
              : new Error(message);
    }),
  fc.jsonValue(),
  fc.constant(undefined),
  fc.bigInt(),
  fc.constant(Symbol("made-up-throw")),
  fc.func(fc.jsonValue()),
);

const failureClass = (value: unknown) =>
  value instanceof Error ? value.constructor.name : value === null ? "null" : typeof value;

const world = (adapter: "node" | "worker", limit: number, failure: unknown) => {
  const ledger = storage(),
    state = storage();
  const next = ids(...PIDS);
  let move: Move | "ok" = "ok",
    calls = 0,
    alarm: number | null = null;
  const program = {
    name: "counter",
    maxDeliveries: limit,
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (saved) => [saved ?? { count: 0 }, []],
      update: {
        add: (s, m) => {
          calls++;

          if (move === "throw") {
            throw failure;
          }

          return [{ count: s.count + m.n }, []];
        },
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: { add: { _tag: "write", schema: Msg, description: "Add", personOnly: false } },
    outputs: {},
    writes: {},
    wake: () => null,
  } as const;
  const manager = ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(data(ledger.sql)));
  const recovery = RecoveryStore.layer(state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
  // The service is typed by what the store keeps; the journal is read through the machine's schema.
  const journal = recoveryStore(state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
  const layer = () => {
    const loader = Layer.effect(
      ProgramLoader,
      Effect.gen(function* () {
        const real = yield* ProgramLoader;
        const loaded = yield* real.load("counter", BUILD);
        const Box = programBox(program, BUILD);
        const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
        const execution =
          adapter === "node"
            ? loaded.execution
            : workerExecution({
                init: (s) => box.init(s),
                fresh: async (s, m) => {
                  if (move === "rpc") {
                    return Effect.runPromise(Effect.fail(new Error("transport failed before checking")));
                  }

                  if (move === "decode") {
                    return { unrecognized: true };
                  }

                  return box.fresh(s, m);
                },
                update: (s, m) => box.update(s, m),
                audit: (m) => box.audit(m),
                step: async (s, m) => {
                  if (move === "rpc") {
                    return Effect.runPromise(Effect.fail(new Error("transport failed before the program")));
                  }

                  if (move === "decode") {
                    return { unrecognized: true };
                  }

                  return box.step(s, m);
                },
                fold: (s, m) => box.fold(s, m),
                upgrade: (s) => box.upgrade(s),
                reply: (c, o) => box.reply(c, o),
                check: (k, f) => box.check(k, f),
                admit: (m) => box.admit(m),
              });
        return { load: () => Effect.succeed({ ...loaded, execution }) };
      }),
    ).pipe(Layer.provide(ProgramLoader.layer({ counter: program }, {})));
    const checked = Layer.effect(
      CheckedWriter,
      Effect.map(Mailbox, (mailbox) => ({
        append: (i: Incoming) =>
          mailbox.send(
            NAME,
            i.id,
            i.envelope.input,
            from({ by: i.envelope.by.key, parent: i.envelope.id, sentAt: i.sentAt }),
          ),
        commit: () => Effect.die("no write declared"),
        own: () => Effect.die("no write declared"),
      })),
    ).pipe(Layer.provide(Mailbox.layer));
    return ProgramRunner.layer(
      { id: A, name: NAME, program: "counter", build: BUILD, owner },
      {
        policy: {
          maxDeliveries: limit,
          intensity: 32,
          periodMs: 100000,
          backoff: { minMs: 1, maxMs: 1, resetAfterMs: 100000 },
        },
        recovery: { sql: state.sql, name: NAME, capacity: 1024 ** 3 },
      },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          loader,
          checked,
          ProcessStore.layer(state.sql, { process: A }),
          Layer.succeed(Alarm, {
            set: (at) =>
              Effect.sync(() => {
                alarm = at;
              }),
          }),
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Recording, { flush: Effect.void }),
          Mailbox.layer,
        ).pipe(Layer.provideMerge(manager)),
      ),
    );
  };
  return {
    ledger,
    state,
    layer,
    move: (value: Move | "ok") => {
      move = value;
    },
    calls: () => calls,
    boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager)),
    receipt: (letter: string) => RecoveryStore.use((s) => s.receipt(letter)).pipe(Effect.provide(recovery)),
    snapshot: journal.load,
    recover: Effect.gen(function* () {
      const saved = yield* journal.load;
      expect(saved).not.toBeNull();
      // The journal keeps the restart wait in its start until the restart brake trips (P34c slice 2).
      const at = saved?.journal;
      const until =
        at?._tag === "waiting_recovery" || at?._tag === "writing_down"
          ? at.recovery.until
          : at?._tag === "waiting_start" && at.timing._tag === "scheduled"
            ? at.timing.until
            : undefined;

      if (until !== undefined) {
        expect(alarm).toBe(until);
        yield* TestClock.setTime(until);
        yield* ProgramRunner.use((r) => r.due(until)).pipe(Effect.provide(layer()));
      }
    }),
    read: (stream: string) => read(stream).pipe(Effect.provide(data(ledger.sql))),
  };
};

const incoming = (letter: string, n: number): Incoming =>
  Incoming.make({
    id: letter,
    envelope: {
      id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
      by: owner,
      arrivedAt: 0,
      input: { type: "add", n },
    },
    sentAt: from().sentAt,
    seen: 0,
    span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
  });

const sequence = fc.record({
  limit: fc.integer({ min: 1, max: 4 }),
  moves: fc.array(fc.constantFrom<Move>("rpc", "decode", "throw"), { minLength: 1, maxLength: 8 }),
  n: fc.integer({ min: -1000, max: 1000 }),
  letter: fc.uuid(),
});

for (const source of ["rpc", "decode"] as const) {
  it(`supervised ${source} failures never change deliveries, receipt failures or dead events`, async () => {
    await fc.assert(
      fc.asyncProperty(sequence, (sample) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = world("worker", sample.limit, new TypeError("program failed"));
            yield* w.boot;
            const input = incoming(sample.letter, sample.n);
            let crashes = 0;

            for (const move of [source, ...sample.moves]) {
              if (crashes === sample.limit) {
                break;
              }

              w.move(move);
              const beforeCalls = w.calls();
              const exit = yield* ProgramRunner.use((r) => r.msg(input)).pipe(Effect.provide(w.layer()), Effect.exit);

              if (move === "throw") {
                crashes++;
              }

              const receipt = yield* w.receipt(input.id);

              // First assert the durable record, even when the caller was also given a false dead answer.
              if (crashes === 0) {
                expect(receipt, "transport failure during checking has no admitted input").toBeNull();
              } else {
                expect(receipt).toMatchObject({
                  tries: crashes,
                  errors: Array.from({ length: crashes }, () => "TypeError"),
                  result: crashes === sample.limit ? { _tag: "refused", reason: "dead" } : null,
                });
              }

              if (move !== "throw") {
                expect(w.calls()).toBe(beforeCalls);
                expect(Exit.isFailure(exit)).toBe(true);
                const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
                expect(Cause.hasDies(cause)).toBe(false);
                expect(Cause.findErrorOption(cause)).toMatchObject({
                  _tag: "Some",
                  value: { _tag: "ProgramDown", source: move },
                });
                const saved = yield* w.snapshot;
                // No attempt is left open: the journal is not stepping.
                expect(saved?.journal._tag).not.toBe("stepping");
                expect(saved?.observations).toHaveLength(crashes);
              }

              const dead = (yield* Effect.forEach(PIDS, (p) => w.read(`${p}/dead`), {
                concurrency: 1,
              })).flat();
              expect(dead).toHaveLength(crashes === sample.limit ? 1 : 0);
              expect(yield* w.read(`${NAME}/inbox`)).toEqual([]);

              if (crashes < sample.limit) {
                w.move("ok");
                yield* w.recover;
              }
            }

            if (crashes < sample.limit) {
              w.move("ok");
              expect(yield* ProgramRunner.use((r) => r.msg(input)).pipe(Effect.provide(w.layer()))).toMatchObject({
                _tag: "accepted",
                pos: 1,
              });
              expect(yield* w.read(`${NAME}/inbox`)).toHaveLength(1);
            }
          }).pipe(Effect.provide(TestClock.layer())),
        ),
      ),
      {
        seed: 119120,
        numRuns: 25,
        // Review 6: one rejected or malformed RPC must not exhaust the allowed limit of one.
        examples: [
          [{ limit: 1, moves: ["rpc"], n: 1, letter: "rpc-limit-one" }],
          [{ limit: 1, moves: ["decode"], n: 1, letter: "decode-limit-one" }],
          [{ limit: 3, moves: ["rpc", "decode", "throw", "rpc", "throw"], n: 1, letter: "mixed" }],
        ],
      },
    );
  });
}

it("Node records the actual class for generated Error and non-Error throws", async () => {
  await fc.assert(
    fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const w = world("node", 1, failure);
          yield* w.boot;
          w.move("throw");
          expect(
            yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(Effect.provide(w.layer())),
          ).toMatchObject({ _tag: "refused", reason: "dead" });
          expect(yield* w.receipt(letter)).toMatchObject({
            tries: 1,
            errors: [failureClass(failure)],
          });
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    ),
    {
      seed: 119120,
      numRuns: 25,
      examples: [
        [undefined, "undefined-throw"],
        [null, "null-throw"],
        [Symbol("made-up"), "symbol-throw"],
      ],
    },
  );
});

it("the real Worker box records the same thrown class as Node under supervision", async () => {
  await fc.assert(
    fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const receipts = [],
            dead = [];

          for (const adapter of ["node", "worker"] as const) {
            const w = world(adapter, 1, failure);
            yield* w.boot;
            w.move("throw");
            const exit = yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(
              Effect.provide(w.layer()),
              Effect.exit,
            );
            expect(exit).toMatchObject({ _tag: "Success", value: { _tag: "refused", reason: "dead" } });
            receipts.push(yield* w.receipt(letter));
            dead.push(
              (yield* Effect.forEach([A, B], (p) => w.read(`${p}/dead`), { concurrency: 1 })).flat().map((r) => r.body),
            );
          }

          const expected = failureClass(failure);
          expect(receipts[0]).toMatchObject({ errors: [expected], tries: 1 });
          expect(dead[0]).toMatchObject([{ errors: [expected], tries: 1 }]);
          expect(receipts[1]).toMatchObject({ errors: [expected], tries: 1 });
          expect(dead[1]).toMatchObject([{ errors: [expected], tries: 1 }]);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    ),
    {
      seed: 119120,
      numRuns: 25,
      // Review 6: the box used to record ProgramDown in place of this TypeError.
      examples: [[new TypeError("private program text"), "worker-class"]],
    },
  );
});
