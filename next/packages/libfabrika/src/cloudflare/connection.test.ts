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

it.effect("scenario: reserved is counted, other refusals and ok keep rpc spans, the three fixed answer shapes", () =>
  Effect.gen(function* () {
    const db = yield* database;
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
    let writes = 0;
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
            writes++;
            saved.push(...rows.map((row) => row.span));
            // edge: the platform record RPC returns a Promise
            return Promise.resolve({ _tag: "written" });
          },
        }),
      },
      MEASUREMENTS: {},
    });
    const config = fake<BrainOptions>({ name: "test-project", port: 8787 });
    yield* TestClock.setTime(H + 1000);
    yield* Effect.gen(function* () {
      const service = yield* ConnectionService;
      // Layer startup saves connection.wake. It is outside the three calls under test.
      const baseline = saved.length;
      const baselineWrites = writes;
      const beforeMeasurements = Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n);
      const params = { by: "t844-forged", m: { _tag: "comment" } };
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "process.send", params }));
      expect(calls).toEqual([{ method: "process.send", params }]);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 1,
        error: { data: { reason: "reserved" } },
      });
      expect(saved.slice(baseline)).toEqual([]);
      expect(writes).toBe(baselineWrites);
      expect(Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n)).toBe(beforeMeasurements);
      expect(db.prepare("SELECT * FROM unsent").all()).toEqual([]);
      expect(
        db
          .prepare("SELECT piece,hour,refused,count FROM sums")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ piece: "runtime.rpc", hour: H, refused: "reserved", count: 1 }]);

      answer = Answer.cases.refused.make({ reason: "bad_input" });
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "process.send", params: {} }));
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 2,
        error: { data: { reason: "bad_input" } },
      });
      answer = Answer.cases.ok.make({ result: { delivered: true } });
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
      expect(
        db
          .prepare("SELECT count FROM sums WHERE piece='runtime.rpc'")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ count: 1 }]);
      yield* TestClock.setTime(H + HOUR);
    }).pipe(Effect.provide(connectionLayer(state, env, config)));
  }),
);
