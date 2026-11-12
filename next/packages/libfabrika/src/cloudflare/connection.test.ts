// next/, 0140. Only the platform and project answer are fake. The call handler and sink are real.
// node:sqlite is the edge: Effect has no synchronous in-memory SQLite handle.
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { SpanRow } from "../telemetry/Trace.ts";
import { Answer, Attached } from "../transport/Wire.ts";
import { ConnectionService, connectionLayer } from "./connection.ts";
import type { BrainOptions, Env } from "./runtime.ts";

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
          expect(w.saved).toEqual([]);
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
