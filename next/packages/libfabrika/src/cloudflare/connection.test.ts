// next/, 0140. Only the platform and project answer are fake. The call handler and sink are real.
// node:sqlite is the edge: Effect has no synchronous in-memory SQLite handle.
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import type * as Tracer from "effect/Tracer";
import { vi } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { SpanRow } from "../telemetry/Trace.ts";
import * as Trace from "../telemetry/Trace.ts";
import { Answer, Attached } from "../transport/Wire.ts";
import { ConnectionService, connectionLayer } from "./connection.ts";
import { ProjectClient } from "./platform.ts";
import type { BrainOptions, Env } from "./runtime.ts";

import { Arbitrary, Cause, Clock, Exit, Layer, Stream } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Chain } from "../telemetry/Trace.ts";
import * as Runtime from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const HOUR = 3_600_000;
const H = 1_790_002_800_000;
const fake = <A>(value: object): A => value as A;

const database = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

const world = (db: DatabaseSync, archiveFailure: "unreachable" | "mismatch" = "unreachable") => {
  const sql = nodeSql(db);
  let attached: typeof Attached.Type = Attached.cases.online.make({
    client: "test-client",
    identity: { key: "test-key", person: "test-person", as: "window" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });
  const frames: Array<string> = [];
  const closes: Array<number> = [];
  const socket = fake<WebSocket>({
    deserializeAttachment: () => attached,
    serializeAttachment: (next: typeof Attached.Type) => {
      attached = next;
    },
    send: (frame: string) => frames.push(frame),
    close: (code: number) => closes.push(code),
  });
  const state = fake<DurableObjectState>({
    id: { name: "test-connection" },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
    },
    getWebSockets: () => [socket],
    getTags: () => ["test-session", "test-tab", "test-key"],
    getWebSocketAutoResponseTimestamp: () => null,
  });
  let answer: typeof Answer.Type = Answer.cases.refused.make({ reason: "reserved" });
  const calls: Array<{ method: string; params: unknown }> = [];
  const saved: Array<SpanRow> = [];
  const stats = { writes: 0, archives: 0 };
  const env = fake<Env>({
    PROJECT: {
      getByName: () => ({
        route: (_client: string, method: string, params: unknown) => {
          calls.push({ method, params });
          // edge: the platform RPC returns a Promise
          return Promise.resolve(answer);
        },
      }),
    },
    RECORD: {
      getByName: () => ({
        write: (_chain: unknown, _part: number, rows: ReadonlyArray<{ span: SpanRow }>) => {
          stats.writes++;
          saved.push(...rows.map((row) => row.span));
          // edge: the platform record RPC returns a Promise
          return Promise.resolve({ _tag: "written" });
        },
      }),
    },
    MEASUREMENTS: {
      put: () => {
        stats.archives++;
        // edge: the platform bucket returns a Promise
        return archiveFailure === "unreachable" ? Promise.reject(new Error("archive unavailable")) : Promise.resolve();
      },
      // edge: a missing bucket object answers through a Promise
      head: () => Promise.resolve(null),
    },
  });
  const config = fake<BrainOptions>({
    name: "test-project",
    port: 8787,
    rateLimit: { limit: 100_000, window: 60_000 },
  });
  return {
    socket,
    frames,
    closes,
    calls,
    saved,
    stats,
    answer: (value: typeof Answer.Type) => {
      answer = value;
    },
    layer: connectionLayer(state, env, config),
  };
};

const tableCounts = (db: DatabaseSync) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [
        name,
        db.prepare(`SELECT count(*) AS n FROM "${String(name).replaceAll('"', '""')}"`).get()?.n,
      ]),
  );

it.effect.prop(
  "T843 RPC: ordinary and parked rate refusals keep delay and bounded frame/RPC sums (50 runs)",
  {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    retryAfter: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60_000 })),
    parked: Schema.Boolean,
  },
  ({ count, retryAfter, parked }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      yield* TestClock.setTime(H + 1000);
      w.answer({ ...Answer.cases.refused.make({ reason: "rate_limited" }), retryAfter });
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        const startupSpans = [...w.saved];
        let first: ReturnType<typeof tableCounts> | undefined;

        for (let id = 0; id < count; id++) {
          yield* service.message(
            w.socket,
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: parked ? "ledger.wait" : "process.send",
              params: parked ? { stream: "empty", after: 0 } : {},
            }),
          );
          expect(JSON.parse(w.frames.at(-1)!)).toMatchObject({
            id,
            error: { data: { reason: "rate_limited", retryAfter } },
          });
          const counts = tableCounts(db);
          first ??= counts;
          expect(counts).toEqual(first);
          expect(w.saved).toEqual(startupSpans);
          expect(w.closes).toEqual([]);
        }

        expect(
          db
            .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
            .all()
            .map((r) => ({ ...r })),
        ).toEqual([
          { piece: "connection.frame", hour: H, refused: "rate_limited", count },
          { piece: "runtime.rpc", hour: H, refused: "rate_limited", count },
        ]);
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);

it.effect.prop(
  "0140 bound A2: failed archives add no rows per reserved completion, and sums count every refusal",
  {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    archiveFailure: Schema.Literals(["unreachable", "mismatch"]),
  },
  ({ count, archiveFailure }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db, archiveFailure);
      yield* TestClock.setTime(H - 16 * 24 * HOUR);
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        const send = (id: number, params: unknown) =>
          service.message(w.socket, JSON.stringify({ jsonrpc: "2.0", id, method: "process.send", params }));
        w.answer(Answer.cases.ok.make({ result: { delivered: true } }));
        yield* send(0, {});
        yield* TestClock.setTime(H + 1000);
        // An ordinary completion tries the now-due archive before the refused calls begin.
        yield* send(1, {});
        expect(w.stats.archives).toBeGreaterThan(0);
        expect(db.prepare("SELECT * FROM archived").all()).toEqual([]);
        expect(
          db.prepare("SELECT count(*) AS n FROM measurements WHERE at < ?").get(H - 15 * 24 * HOUR)?.n,
        ).toBeGreaterThan(0);
        expect(
          db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='sink.archive' AND ok=0").get()?.n,
        ).toBeGreaterThan(0);
        w.answer(Answer.cases.refused.make({ reason: "reserved" }));
        let first: ReturnType<typeof tableCounts> | undefined;
        const saved = w.saved.length;
        const writes = w.stats.writes;

        for (let i = 0; i < count; i++) {
          yield* send(i + 2, { by: `t844-forged-${i}`, m: { _tag: "comment" } });
          expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
            id: i + 2,
            error: { data: { reason: "reserved" } },
          });
          const rows = tableCounts(db);
          first ??= rows;
          expect(rows).toEqual(first);
          expect(w.saved).toHaveLength(saved);
          expect(w.stats.writes).toBe(writes);
          expect(
            db
              .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
              .all()
              .map((row) => ({ ...row })),
          ).toEqual([
            { piece: "connection.frame", hour: H, refused: "reserved", count: i + 1 },
            { piece: "runtime.rpc", hour: H, refused: "reserved", count: i + 1 },
          ]);
        }

        expect(w.calls).toHaveLength(count + 2);
        expect(w.closes).toEqual([]);
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);

it.effect("scenario: reserved is counted, other refusals and ok keep rpc spans, the three fixed answer shapes", () =>
  Effect.gen(function* () {
    const db = yield* database;
    const w = world(db);
    const { socket, calls, frames, saved, stats, closes } = w;
    yield* TestClock.setTime(H + 1000);
    yield* Effect.gen(function* () {
      const service = yield* ConnectionService;
      // Layer startup saves connection.wake. It is outside the three calls under test.
      const baseline = saved.length;
      const baselineWrites = stats.writes;
      const beforeMeasurements = Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n);
      const params = { by: "t844-forged", m: { _tag: "comment" } };
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "process.send", params }));
      expect(calls).toEqual([{ method: "process.send", params }]);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 1,
        error: { data: { reason: "reserved" } },
      });
      expect(saved.slice(baseline)).toEqual([]);
      expect(stats.writes).toBe(baselineWrites);
      expect(Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n)).toBe(beforeMeasurements);
      expect(db.prepare("SELECT * FROM unsent").all()).toEqual([]);
      expect(
        db
          .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([
        { piece: "connection.frame", hour: H, refused: "reserved", count: 1 },
        { piece: "runtime.rpc", hour: H, refused: "reserved", count: 1 },
      ]);

      w.answer(Answer.cases.refused.make({ reason: "bad_input" }));
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "process.send", params: {} }));
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 2,
        error: { data: { reason: "bad_input" } },
      });
      w.answer(Answer.cases.ok.make({ result: { delivered: true } }));
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "process.send", params: {} }));
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 3,
        result: { delivered: true },
      });
      expect(calls).toHaveLength(3);
      expect(closes).toEqual([]);
      expect(saved.slice(baseline).map((row) => row.name)).toEqual([
        "runtime.rpc",
        "connection.frame",
        "runtime.rpc",
        "connection.frame",
      ]);
      expect(db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='runtime.rpc'").get()?.n).toBe(2);
      expect(db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='connection.frame'").get()?.n).toBe(2);
      expect(
        db
          .prepare("SELECT count FROM sums WHERE piece='runtime.rpc'")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ count: 1 }]);
      expect(
        db
          .prepare("SELECT count FROM sums WHERE piece='connection.frame'")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ count: 1 }]);
      yield* TestClock.setTime(H + HOUR);
    }).pipe(Effect.provide(w.layer));
  }),
);

const T864_DAY = 24 * HOUR;

const T864Draw = Schema.Struct({
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  value: Schema.Json,
});

const t864Draws = Arbitrary.array(Arbitrary.schema(T864Draw), { minLength: 4, maxLength: 12 });
const T864Due = Schema.Array(Schema.Struct({ day: Schema.String, rows: Schema.Int, part: Schema.Int }));

const t864Pending = (db: DatabaseSync) =>
  db
    .prepare("SELECT spanId FROM unsent ORDER BY rowid")
    .all()
    .map((row) => String(row.spanId));

const t864Due = (db: DatabaseSync, now: number) =>
  Schema.decodeUnknownSync(T864Due)(
    db
      .prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, count(*) AS rows,
      1 + coalesce((SELECT max(part) FROM archived
        WHERE day = strftime('%Y-%m-%d', measurements.at / 1000, 'unixepoch')), 0) AS part
      FROM measurements WHERE at < ? GROUP BY day ORDER BY day`)
      .all(Math.floor((now - 15 * T864_DAY) / T864_DAY) * T864_DAY),
  );

const t864Tables = (db: DatabaseSync) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [
        name,
        db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`).all(),
      ]),
  );

const t864Delivered = Effect.gen(function* () {
  const records = yield* RecordManager;
  const spans = yield* Stream.runCollect(records.read(Chain.cases.spans.make({})));
  return Array.from(spans, (span) => span.spanId);
});

const t864Prepare = Effect.fnUntraced(function* (db: DatabaseSync, draw: typeof T864Draw.Type) {
  const now = yield* Clock.currentTimeMillis;

  if (
    !db.prepare("SELECT name FROM sqlite_schema WHERE name='unsent'").get() ||
    t864Pending(db).length === 0 ||
    t864Due(db, now).length === 0
  ) {
    for (let i = 0; i <= draw.pick % 3; i++) {
      yield* Effect.void.pipe(Effect.withSpan("t864.pending", { attributes: { value: JSON.stringify(draw.value) } }));
    }

    yield* TestClock.adjust(17 * T864_DAY + draw.pick);
    yield* Effect.void.pipe(Effect.withSpan("t864.current"));
  }

  const pending = t864Pending(db);
  const due = t864Due(db, yield* Clock.currentTimeMillis);
  expect(pending.length).toBeGreaterThan(0);
  expect(due.length).toBeGreaterThan(0);
  expect(
    db
      .prepare(`SELECT count(*) AS n FROM measurements WHERE at < ?
    AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM aggregated)`)
      .get(Math.floor(((yield* Clock.currentTimeMillis) - 15 * T864_DAY) / T864_DAY) * T864_DAY)?.n,
  ).toBe(0);
  return { pending, due };
});

const t864Layer = (db: DatabaseSync, pick: number) =>
  Layer.mergeAll(
    SpanSink.layer(nodeSql(db), { object: "t864" }),
    RecordManager.memory(1 + (pick % 2048)),
    Archive.memory,
  );

it.effect.prop(
  "T864 reserved completion does not flush",
  { draws: t864Draws },
  ({ draws }) =>
    Effect.gen(function* () {
      const db = yield* database;
      yield* TestClock.setTime(H);
      yield* Effect.gen(function* () {
        for (const draw of draws) {
          const { pending, due } = yield* t864Prepare(db, draw);
          const tables = t864Tables(db);
          const delivered = yield* t864Delivered;
          const answer = Answer.cases.refused.make({ reason: "reserved" });
          expect(yield* Runtime.complete(Effect.succeed(answer))).toBe(answer);
          expect(t864Tables(db)).toEqual(tables);
          expect(t864Pending(db)).toEqual(pending);
          expect(t864Due(db, yield* Clock.currentTimeMillis)).toEqual(due);
          const after = yield* t864Delivered;
          expect(after).toEqual(delivered);
          expect(after).not.toContain(pending[draw.pick % pending.length]);
          expect(
            db
              .prepare("SELECT * FROM archived WHERE day=? AND part=?")
              .get(due[draw.pick % due.length]!.day, due[draw.pick % due.length]!.part),
          ).toBeUndefined();
        }
      }).pipe(Effect.provide(t864Layer(db, draws[0]!.pick)));
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);

it.effect.prop(
  "T864 ordinary success and failure both flush",
  { draws: t864Draws },
  ({ draws }) =>
    Effect.gen(function* () {
      const db = yield* database;
      yield* TestClock.setTime(H);
      yield* Effect.gen(function* () {
        const counts = { success: 0, failure: 0 };

        for (const draw of draws) {
          const { pending, due } = yield* t864Prepare(db, draw);
          const unvisited = (["success", "failure"] as const).filter((outcome) => counts[outcome] === 0);
          const choices = unvisited.length > 0 ? unvisited : (["success", "failure"] as const);
          const outcome = choices[draw.pick % choices.length]!;
          const answer = Answer.cases.ok.make({ result: draw.value });
          const failure = new LedgerError({ reason: "unreachable" });
          const exit = yield* Effect.exit(
            Runtime.complete(outcome === "success" ? Effect.succeed(answer) : Effect.fail(failure)),
          );
          const delivered = yield* t864Delivered;

          for (const id of pending) {
            expect(delivered, "complete delivers each pending span").toContain(id);
            expect(t864Pending(db)).not.toContain(id);
          }

          for (const day of due) {
            expect(db.prepare("SELECT * FROM archived WHERE day=? AND part=?").get(day.day, day.part)).toMatchObject({
              ...day,
              key: expect.stringContaining(`measurements/t864/${day.day}`),
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
            expect(
              db
                .prepare("SELECT count(*) AS n FROM measurements WHERE strftime('%Y-%m-%d', at / 1000, 'unixepoch')=?")
                .get(day.day)?.n,
            ).toBe(0);
          }

          expect(t864Due(db, yield* Clock.currentTimeMillis)).toEqual([]);
          expect(
            db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='sink.archive' AND ok=1").get()?.n,
          ).toBeGreaterThan(0);

          if (outcome === "success") {
            expect(Exit.isSuccess(exit)).toBe(true);

            if (Exit.isSuccess(exit)) {
              expect(exit.value).toBe(answer);
            }
          } else {
            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              expect(Cause.squash(exit.cause)).toBe(failure);
            }
          }

          counts[outcome]++;
        }

        expect(counts.success).toBeGreaterThan(0);
        expect(counts.failure).toBeGreaterThan(0);
        expect(counts.success + counts.failure).toBe(draws.length);
      }).pipe(Effect.provide(t864Layer(db, draws[0]!.pick)));
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);

const AnswerWalk = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 20 })),
  seed: Schema.Int,
});

const EarlyFrameWalk = Schema.Struct({
  fresh: Attached.cases.new,
  waiting: Attached.cases.waiting,
  count: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 8 })),
  seed: Schema.Int,
});

const answerCases = {
  ok: Answer.cases.ok,
  parked: Answer.cases.parked,
  reserved: Answer.cases.refused.mapFields((fields) => ({ ...fields, reason: Schema.Literal("reserved") })),
  bad_input: Answer.cases.refused.mapFields((fields) => ({ ...fields, reason: Schema.Literal("bad_input") })),
};

const answerCategories = ["ok", "parked", "reserved", "bad_input"] as const;

const sample = Effect.fnUntraced(function* <S extends Schema.Constraint>(schema: S, seed: number) {
  return (yield* Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0]!;
});

const readAttachment = (w: ReturnType<typeof world>) =>
  Schema.decodeUnknownSync(Attached)(w.socket.deserializeAttachment());

const ordinaryFrame = Effect.fnUntraced(function* (state: typeof Attached.Type, seed: number, index: number) {
  const input = yield* sample(Schema.Struct({ id: Schema.String, params: Schema.Json }), seed);
  return {
    jsonrpc: "2.0",
    id: `${state.client}:${index}:${input.id}`,
    method: "process.send",
    params: { state: state._tag, value: input.params },
  };
});

const observeRpc = Effect.fnUntraced(function* (spans: Array<Tracer.Span>) {
  const make = ProjectClient.make;
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(ProjectClient, "make").mockImplementation((stub) => {
        const client = make(stub);
        return {
          ...client,
          route: (...args) =>
            Effect.gen(function* () {
              spans.push(yield* Effect.currentSpan.pipe(Effect.orDie));
              return yield* client.route(...args);
            }),
        };
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
});

const recordingSnapshot = (db: DatabaseSync, w: ReturnType<typeof world>) => ({
  tables: tableCounts(db),
  saved: [...w.saved],
  writes: w.stats.writes,
  archives: w.stats.archives,
});

it.effect.prop(
  "t863 L1: only reserved answers tag the ended RPC span as refused",
  { walk: AnswerWalk },
  ({ walk }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      const spans: Array<Tracer.Span> = [];
      yield* observeRpc(spans);
      yield* TestClock.setTime(H + 1000);
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        const reached = new Set<keyof typeof answerCases>();

        for (let i = 0; i < walk.count; i++) {
          const state = readAttachment(w);
          expect(state._tag).toBe("online");
          const remaining = answerCategories.filter((key) => !reached.has(key));
          const category = yield* sample(
            Schema.Literals(remaining.length > 0 ? remaining : answerCategories),
            walk.seed + i * 3,
          );
          const answer = yield* sample(answerCases[category], walk.seed + i * 3 + 1);
          const request = yield* ordinaryFrame(state, walk.seed + i * 3 + 2, i);
          w.answer(answer);
          const replies = w.frames.length;
          yield* service.message(w.socket, JSON.stringify(request));
          expect(w.calls).toHaveLength(i + 1);
          expect(w.calls.at(-1)).toEqual({ method: request.method, params: request.params });
          expect(spans).toHaveLength(i + 1);
          const span = spans[i]!;
          expect(span.name).toBe("runtime.rpc");
          expect(span.status._tag).toBe("Ended");
          expect(span.attributes.has(Trace.REFUSED)).toBe(category === "reserved");
          expect(span.attributes.get(Trace.REFUSED)).toBe(category === "reserved" ? "reserved" : undefined);

          if (answer._tag === "parked") {
            expect(w.frames).toHaveLength(replies);
          } else {
            expect(w.frames).toHaveLength(replies + 1);
            const reply = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!);
            expect(reply).toMatchObject(
              answer._tag === "ok"
                ? { id: request.id, result: answer.result }
                : { id: request.id, error: { data: { reason: answer.reason } } },
            );
          }

          expect(readAttachment(w)._tag).toBe("online");
          reached.add(category);
        }

        expect([...reached].sort()).toEqual(Object.keys(answerCases).sort());
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);

it.effect.prop(
  "t863 L2: new and waiting frames leave all recording unchanged until online",
  { walk: EarlyFrameWalk },
  ({ walk }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const initial of [walk.fresh, walk.waiting]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const db = yield* database;
            const w = world(db);
            const online = readAttachment(w);
            w.socket.serializeAttachment(initial);
            yield* TestClock.setTime(H + 1000);
            yield* Effect.gen(function* () {
              const service = yield* ConnectionService;
              const baseline = recordingSnapshot(db, w);

              for (let i = 0; i < walk.count; i++) {
                const state = readAttachment(w);
                expect(state._tag).toBe(initial._tag);
                const request = yield* ordinaryFrame(state, walk.seed + i, i);
                const replies = w.frames.length;
                yield* service.message(w.socket, JSON.stringify(request));
                expect(w.frames).toHaveLength(replies + 1);
                expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
                  id: request.id,
                  error: { data: { reason: "no_hello" } },
                });
                expect(w.calls).toEqual([]);
                expect(readAttachment(w)).toEqual(state);
                expect(recordingSnapshot(db, w)).toEqual(baseline);
                reached.add(state._tag);
              }

              w.socket.serializeAttachment(online);
              const state = readAttachment(w);
              const answer = yield* sample(Answer.cases.ok, walk.seed + walk.count);
              const request = yield* ordinaryFrame(state, walk.seed + walk.count + 1, walk.count);
              w.answer(answer);
              yield* service.message(w.socket, JSON.stringify(request));
              expect(w.calls).toEqual([{ method: request.method, params: request.params }]);
              expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
                id: request.id,
                result: answer.result,
              });
              expect(w.saved.slice(baseline.saved.length).map((span) => span.name)).toContain("runtime.rpc");
              expect(w.stats.writes).toBeGreaterThan(baseline.writes);
              expect(tableCounts(db)).not.toEqual(baseline.tables);
            }).pipe(Effect.provide(w.layer));
          }),
        );
      }

      expect([...reached].sort()).toEqual(["new", "waiting"]);
    }),
  { arbitrary: { seed: 119120, runs: 50 } },
);
