// P34, next/. These are runner calls through P37's actual sink and JobRecords, not a span mock.
// Only this file owns content deletion and trace attribution; other laws inspect lifecycle events.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { vi } from "vitest";
import { programBox } from "../../cloudflare/box.ts";
import { Archive, Mailbox, ProcessManager, ProcessStore, RecordManager, Writer } from "../../coordination/index.ts";
import { A, B, W, X, brain, data, first, from, ids, read, storage } from "../../processes/Process.test-support.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "../../runtime/Entry.ts";
import { workerExecution } from "../../runtime/Execution.ts";
import { RecoveryStore } from "../../runtime/RecoveryStore.ts";
import { type Descriptor, ProgramRunner, Supervision } from "../../runtime/Runner.ts";
import type { Sql } from "../../Sql.ts";
import { SpanSink } from "../../telemetry/Sink.ts";

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const NAME = "counter:1";
const PRIVATE = "private failure text P34";
const owner = Writer.cases.person.make({ key: "SHA256:caller", for: from().for });
const Model = Schema.Struct({ count: Schema.Int });
type Model = typeof Model.Type;
const Msg = Schema.Struct({ type: Schema.Literal("poison") });
// Only the platform base class and the RPC transport are supplied. Box methods are real.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const runnerLayer: (
  p: Descriptor,
  options: { policy: typeof policy; recovery: { sql: Sql; name: string; capacity: number } },
) => ReturnType<typeof ProgramRunner.layer> = ProgramRunner.layer;

const world = (thrown: unknown, adapter: "node" | "worker" = "node", maxDeliveries = policy.maxDeliveries) => {
  const ledger = storage(),
    state = storage(),
    sink = storage();
  const next = ids(A, B, W, X);
  const parts = new Map<string, ReturnType<typeof storage>>();
  const records = RecordManager.sql((name) => {
    let part = parts.get(name);

    if (part === undefined) {
      part = storage();
      parts.set(name, part);
    }

    return part.sql;
  }, 1024 ** 3);
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (s) => [s ?? { count: 0 }, []],
    update: {
      poison: () => {
        throw thrown;
      },
    },
  });
  const p = {
    name: "counter",
    machine,
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: Model) => s },
    refuse: () => null,
    inputs: { poison: { _tag: "write", schema: Msg, description: "Poison", personOnly: false } },
    outputs: {},
    writes: {},
    wake: () => null,
  };
  const alarms: Array<number | null> = [];
  const loader = ProgramLoader.layer({ counter: p }, {});
  const workerLoader = Layer.effect(
    ProgramLoader,
    Effect.gen(function* () {
      const loaded = yield* ProgramLoader.use((l) => l.load("counter", "build-a"));
      const Box = programBox(p, "build-a");
      const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
      const execution = workerExecution({
        init: (s) => box.init(s),
        step: (s, m) => box.step(s, m),
        fresh: (s, m) => box.fresh(s, m),
        update: (s, m) => box.update(s, m),
        audit: (m) => box.audit(m),
        fold: (s, m) => box.fold(s, m),
        upgrade: (s) => box.upgrade(s),
        reply: (c, o) => box.reply(c, o),
        check: (k, f) => box.check(k, f),
        admit: (m) => box.admit(m),
      });
      return { load: () => Effect.succeed({ ...loaded, execution }) };
    }),
  ).pipe(Layer.provide(loader));
  const base = () => Layer.mergeAll(data(ledger.sql), SpanSink.layer(sink.sql, { object: A }), records, Archive.memory);
  const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
  const layer = () =>
    runnerLayer(
      { id: A, name: NAME, program: "counter", build: "build-a", owner },
      {
        policy: { ...policy, maxDeliveries },
        recovery: { sql: state.sql, name: NAME, capacity: 1024 ** 3 },
      },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          adapter === "worker" ? workerLoader : loader,
          ProcessStore.layer(state.sql, { process: A }),
          ProcessManager.layer(brain(), next.next),
          Mailbox.layer,
          Layer.effect(
            CheckedWriter,
            Effect.gen(function* () {
              const m = yield* Mailbox;
              return {
                append: (i: Incoming) => m.send(NAME, i.id, i.envelope.input, from()),
                commit: () => Effect.die("no writes"),
                own: () => Effect.die("no writes"),
              };
            }),
          ).pipe(Layer.provide(Mailbox.layer)),
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Alarm, {
            set: (at) =>
              Effect.sync(() => {
                alarms.push(at);
              }),
          }),
          Recording.layer,
        ).pipe(Layer.provideMerge(base())),
      ),
    );
  const input = {
    id: "poison",
    envelope: { id: `in-${X}-1`, by: owner, arrivedAt: 0, input: { type: "poison" } },
    sentAt: from().sentAt,
    seen: 0,
    span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
  };
  return {
    ledger,
    sink,
    state,
    alarms,
    layer,
    manager,
    input,
    boot: ProcessManager.use((m) => m.start(first(), from())).pipe(Effect.provide(manager())),
    reopen: () => {
      ledger.reopen();
      state.reopen();
      sink.reopen();

      for (const p of parts.values()) {
        p.reopen();
      }
    },
  };
};

const recorded = (process: string) => RecordManager.use((r) => Stream.runCollect(r.read({ _tag: "job", process })));

const recoverySpans = (w: ReturnType<typeof world>, process: string) =>
  Effect.gen(function* () {
    const until = w.alarms.at(-1);
    expect(until).toBeTypeOf("number");
    w.reopen();
    yield* TestClock.setTime(until!);
    yield* Effect.gen(function* () {
      yield* ProgramRunner.use((r) => r.due(until!));
      const rows = yield* recorded(process);

      for (const name of ["runner.recover", "runner.restart"]) {
        const row = rows.find((r) => r.name === name);
        expect(row, name).toBeDefined();
        expect(row!.attributes).toMatchObject({
          "fab.process": process,
          "fab.runner.until": until,
          "fab.runner.lag": 0,
        });
      }
    }).pipe(Effect.provide(w.layer()));
  });

const failure = fc
  .tuple(fc.constantFrom("Error", "TypeError", "RangeError", "SyntaxError", "custom", "string", "object"), fc.uuid())
  .map(([kind, id]) => {
    const message = `private-message-${id}`;
    class ProgramError extends Error {}
    const value =
      kind === "TypeError"
        ? new TypeError(message)
        : kind === "RangeError"
          ? new RangeError(message)
          : kind === "SyntaxError"
            ? new SyntaxError(message)
            : kind === "custom"
              ? new ProgramError(message)
              : kind === "Error"
                ? new Error(message)
                : kind === "object"
                  ? { message }
                  : message;
    return { value, message, private: [message, ...(value instanceof Error ? [value.stack!] : [])] };
  });

// One V8 stack line, "at name (location)" or "at location", read here without the sink's own code,
// as laws S1 and S2 in telemetry/Sink.test.ts read theirs. `file` is the last path segment with its
// line and column; a `node:` location is a module name, not a folder on a machine, and stays whole.
const frames = (text: string) =>
  text.split("\n").flatMap((line) => {
    const frame = /^\s*at (?:(.+?) \((.*)\)|(.*?))(?: \{)?$/.exec(line);

    if (frame === null) {
      return [];
    }

    const location = frame[2] ?? frame[3] ?? "";
    const folder = !location.startsWith("node:") && /[/\\]/.test(location);
    const file = folder
      ? location.slice(Math.max(location.lastIndexOf("/"), location.lastIndexOf("\\")) + 1)
      : location;
    return [{ frame: frame[1] === undefined ? file : `${frame[1]} (${file})`, folder }];
  });

/** The wanted frames from the first one that `stored` does not hold in order; empty when all are there. */
const lostFrames = (stored: ReadonlyArray<string>, wanted: ReadonlyArray<string>) => {
  let found = 0;

  for (const one of stored) {
    if (one === wanted[found]) {
      found += 1;
    }
  }

  return wanted.slice(found);
};

const generatedThrow = fc.oneof(
  failure,
  fc
    .oneof(
      fc.jsonValue(),
      fc.constant(undefined),
      fc.bigInt(),
      fc.constant(Symbol("made-up-throw")),
      fc.func(fc.jsonValue()),
    )
    .map((value) => ({ value, message: null, private: [] as string[] })),
);

for (const adapter of ["node", "worker"] as const) {
  it(`${adapter}: generated throw content is deletable; classes alone stay in receipts, dead events and measurements`, async () => {
    await fc.assert(
      fc.asyncProperty(generatedThrow, (sample) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = world(sample.value, adapter, 1);
            yield* w.boot;
            yield* Effect.gen(function* () {
              // A limit of one reaches the dead event on this first Worker failure.
              yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
              const rows = yield* recorded(A);
              const r = yield* RecordManager;
              const chain = { _tag: "job", process: A } as const;
              const contents = yield* Effect.forEach(rows, (row) => r.content(chain, row.spanId), {
                concurrency: 1,
              });
              const kept = contents.flatMap((c) => (Option.isSome(c) && c.value._tag === "kept" ? [c.value] : []));
              expect(kept.length).toBeGreaterThan(0);

              // A-Sink stores each frame with its folders cut, so the law asks for the frames, not the raw stack.
              const thrown = sample.value instanceof Error ? frames(sample.value.stack ?? "") : [];
              const lost = kept.map((c) => [
                ...(sample.message === null || c.message.includes(sample.message) ? [] : [sample.message]),
                ...lostFrames(
                  frames(c.message).map((stored) => stored.frame),
                  thrown.map((raw) => raw.frame),
                ),
              ]);
              expect(
                lost.some((none) => none.length === 0),
                `original message and every stack frame (name, file, line, column) must reach P37; lost: ${JSON.stringify(lost)}`,
              ).toBe(true);

              for (const stored of kept.flatMap((c) => frames(c.message))) {
                expect(stored.folder, `a stored frame names a folder: ${stored.frame}`).toBe(false);
              }

              const receipt = yield* RecoveryStore.use((s) => s.receipt(w.input.id)).pipe(
                Effect.provide(
                  RecoveryStore.layer(w.state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision }),
                ),
              );
              const dead = yield* read(`${A}/dead`);
              const events = yield* read(`processes/${NAME}`);
              const measurements = w.sink.sql.exec("SELECT * FROM measurements");
              const name =
                sample.value instanceof Error
                  ? sample.value.constructor.name
                  : sample.value === null
                    ? "null"
                    : typeof sample.value;
              expect(receipt).toMatchObject({ errors: [name], tries: 1 });
              expect(rows.find((row) => row.name === "runner.throw")?.attributes["error.type"]).toBe(name);
              expect(measurements.filter((row) => row.piece === "runner.throw")).toMatchObject([{ error: name }]);
              expect(dead.map((row) => row.body)).toEqual([expect.objectContaining({ errors: [name], tries: 1 })]);

              for (const text of sample.private) {
                for (const permanent of [
                  rows,
                  receipt,
                  events,
                  dead,
                  measurements,
                  w.sink.sql.exec("SELECT * FROM summary"),
                ]) {
                  expect(JSON.stringify(permanent)).not.toContain(JSON.stringify(text).slice(1, -1));
                }
              }

              for (const content of kept) {
                yield* r.deleteContent(chain, content.spanId, {
                  by: owner.key,
                  reason: "test deletion",
                });
                expect(Option.getOrNull(yield* r.content(chain, content.spanId))).toMatchObject({
                  _tag: "deleted",
                });
              }

              const after = yield* Effect.forEach(rows, (row) => r.content(chain, row.spanId), {
                concurrency: 1,
              });

              for (const text of sample.private) {
                expect(JSON.stringify(after)).not.toContain(JSON.stringify(text).slice(1, -1));
              }

              expect(yield* recorded(A)).toEqual(rows);
              expect(w.sink.sql.exec("SELECT * FROM measurements")).toEqual(measurements);
              expect(
                yield* RecoveryStore.use((s) => s.receipt(w.input.id)).pipe(
                  Effect.provide(
                    RecoveryStore.layer(w.state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision }),
                  ),
                ),
              ).toEqual(receipt);
              expect(yield* read(`${A}/dead`)).toEqual(dead);
              expect(yield* read(`processes/${NAME}`)).toEqual(events);
            }).pipe(Effect.provide(w.layer()));
          }).pipe(Effect.provide(TestClock.layer())),
        ),
      ),
      { seed: 119120, numRuns: 40 },
    );
  });
}

describe("P34 supervision recording", () => {
  for (const [value, name] of [
    [new TypeError(PRIVATE), "TypeError"],
    [new RangeError(PRIVATE), "RangeError"],
    [PRIVATE, "string"],
    [17, "number"],
    [null, "null"],
  ] as const) {
    it.effect(
      `recording plant, wrapper-only class: observed ${name} reaches its process JobRecord before failure returns`,
      () =>
        Effect.gen(function* () {
          const w = world(value);
          yield* w.boot;
          yield* Effect.gen(function* () {
            yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
            const throws = (yield* recorded(A)).filter((row) => row.name === "runner.throw");
            expect(throws).toHaveLength(1);
            expect(throws[0]!.attributes).toMatchObject({
              "fab.process": A,
              "error.type": name,
              "fab.runner.letter": "poison",
              "fab.runner.build": "build-a",
              "fab.runner.phase": "fresh",
              "fab.runner.attempt": 1,
            });
            expect(BigInt(throws[0]!.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(throws[0]!.startTimeUnixNano));
            expect(w.sink.sql.exec("SELECT count(*) n FROM unsent")[0]?.n).toBe(0);
          }).pipe(Effect.provide(w.layer()));
        }),
    );
  }

  it.effect.prop(
    "content plant, message in errors/reason/measurements: only deletable content holds failure text and stack",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        [PRIVATE, generated],
        (value) =>
          Effect.gen(function* () {
            const secret = value === PRIVATE ? value : `private-supervision:${value}:marker`;
            const w = world(new TypeError(secret));
            yield* w.boot;
            yield* Effect.gen(function* () {
              yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
              const rows = yield* recorded(A);
              const r = yield* RecordManager;
              const contents = yield* Effect.forEach(
                rows,
                (row) => r.content({ _tag: "job", process: A }, row.spanId),
                { concurrency: 1 },
              );
              const at = contents.findIndex((content) =>
                Option.match(content, {
                  onNone: () => false,
                  onSome: (c) => c._tag === "kept" && c.message.includes(secret),
                }),
              );
              expect(
                at,
                "the original throw must reach deletable content before guards erase it",
              ).toBeGreaterThanOrEqual(0);
              expect(JSON.stringify(rows)).not.toContain(secret);
              expect(JSON.stringify(w.sink.sql.exec("SELECT * FROM measurements"))).not.toContain(secret);
              expect(JSON.stringify(yield* read(`processes/${NAME}`))).not.toContain(secret);
              expect(JSON.stringify(yield* read(`${A}/dead`))).not.toContain(secret);

              for (const output of [
                rows,
                w.sink.sql.exec("SELECT * FROM measurements"),
                yield* read(`processes/${NAME}`),
                yield* read(`${A}/dead`),
              ]) {
                expect(JSON.stringify(output)).not.toContain(JSON.stringify(secret).slice(1, -1));
              }

              const span = rows[at]!;
              yield* r.deleteContent({ _tag: "job", process: A }, span.spanId, {
                by: owner.key,
                reason: "test deletion",
              });
              expect(Option.getOrNull(yield* r.content({ _tag: "job", process: A }, span.spanId))).toMatchObject({
                _tag: "deleted",
              });
              expect((yield* recorded(A)).find((row) => row.spanId === span.spanId)).toEqual(span);
            }).pipe(Effect.provide(w.layer()));
          }),
        { discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect(
    "recording plant, successor spans in predecessor record or flush before span end: every recovery is attributed",
    () =>
      Effect.gen(function* () {
        const w = world(new TypeError(PRIVATE));
        yield* w.boot;

        for (const [n, process] of [A, B, W].entries()) {
          yield* Effect.gen(function* () {
            yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input)));
            const rows = yield* recorded(process);
            expect(rows.filter((row) => row.name === "runner.throw")).toHaveLength(1);

            if (n === 2) {
              expect(rows.some((row) => row.name === "runner.dead")).toBe(true);
            }
          }).pipe(Effect.provide(w.layer()));

          if (n < 2) {
            yield* recoverySpans(w, process);
          }
        }
      }),
  );
});
