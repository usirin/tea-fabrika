import { createHash } from "node:crypto";
// next/, 0140. Only the platform and project answer are fake. The call handler and sink are real.
// node:sqlite is the edge: Effect has no synchronous in-memory SQLite handle.
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { SpanRow } from "../telemetry/Trace.ts";
import { Answer, Attached } from "../transport/Wire.ts";
import { ConnectionService, connectionLayer } from "./connection.ts";
import type { BrainOptions, Env } from "./runtime.ts";
import * as SettingsRecorded from "./SettingsRecorded.ts";
import * as SettingsStartsLedger from "./SettingsStartsLedger.ts";

import { Arbitrary, Cause, Clock, Context, Exit, Layer, Scope, Stream } from "effect";
import * as fc from "fast-check";
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
  const base = nodeSql(db);
  let settingsReads = 0;
  const sql = {
    ...base,
    exec: (query: string, ...args: Parameters<typeof base.exec> extends [string, ...infer A] ? A : never) => {
      if (/SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
        settingsReads++;
      }

      return base.exec(query, ...args);
    },
  };
  const input = StartsTest.fixture({ name: "test-project", port: 8787 }, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
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
    INSTANCE: JSON.stringify(input),
    PROJECT: {
      getByName: () => ({
        settingsStart: async () => StartsTest.reply(input),
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
  const config = fake<BrainOptions>(input);
  const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(SettingsStartsLedger.layer(sql)));
  return {
    socket,
    frames,
    closes,
    calls,
    saved,
    stats,
    settingsReads: () => settingsReads,
    answer: (value: typeof Answer.Type) => {
      answer = value;
    },
    layer: connectionLayer(state, env, config).pipe(Layer.provide(recorded), Layer.provide(Digest.layerWebCrypto)),
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

StartsTest.law(
  "T753 L11 counted refusals stay bounded across hours and Connection reopens",
  fc.tuple(
    fc.array(fc.nat(), { minLength: 15, maxLength: 60 }),
    fc.constantFrom<"unreachable" | "mismatch">("unreachable", "mismatch"),
  ),
  ([choices, archiveFailure]) =>
    Effect.gen(function* () {
      const db = yield* database;
      let hour = H;
      yield* TestClock.setTime(hour - 16 * 24 * HOUR);
      const open = Effect.fnUntraced(function* () {
        const scope = yield* Effect.acquireRelease(Scope.make(), (owned) => Scope.close(owned, Exit.void));
        const w = world(db, archiveFailure);
        const context = yield* Layer.build(w.layer).pipe(Effect.provideService(Scope.Scope, scope));
        return { scope, w, context, service: Context.get(context, ConnectionService) };
      });
      let owner = yield* open();
      owner.w.answer(Answer.cases.ok.make({ result: { delivered: true } }));
      const accepted = () =>
        owner.service
          .message(owner.w.socket, JSON.stringify({ jsonrpc: "2.0", id: "prime", method: "process.send", params: {} }))
          .pipe(Effect.provideContext(owner.context));
      yield* accepted();
      yield* TestClock.setTime(hour + 1000);
      yield* accepted();
      expect(owner.w.stats.archives).toBeGreaterThan(0);
      owner.w.answer(Answer.cases.refused.make({ reason: "reserved" }));
      const firstInHour = new Map<number, ReturnType<typeof tableCounts>>();
      const totals = new Map<number, number>();

      for (const [index, choice] of choices.entries()) {
        const moves = totals.size === 0 ? ["refuse"] : ["refuse", "refuse", "reopen", "hour"];
        const move = moves[choice % moves.length];

        if (move === "reopen") {
          yield* Scope.close(owner.scope, Exit.void);
          owner = yield* open();
          firstInHour.delete(hour);
          continue;
        }

        if (move === "hour") {
          hour += (1 + (choice % 4)) * HOUR;
          yield* TestClock.setTime(hour);
          continue;
        }

        const writes = owner.w.stats.writes;
        const archives = owner.w.stats.archives;
        const reads = owner.w.settingsReads();
        const starts = db.prepare("SELECT count(*) AS n FROM entries").get()?.n;
        yield* owner.service
          .message(
            owner.w.socket,
            JSON.stringify({ jsonrpc: "2.0", id: index, method: "process.send", params: { by: `forged-${index}` } }),
          )
          .pipe(Effect.provideContext(owner.context));
        expect(owner.w.stats.writes).toBe(writes);
        expect(owner.w.stats.archives).toBe(archives);
        expect(owner.w.settingsReads()).toBe(reads);
        expect(db.prepare("SELECT count(*) AS n FROM entries").get()?.n).toBe(starts);
        const rows = tableCounts(db);

        if (firstInHour.has(hour)) {
          expect(rows).toEqual(firstInHour.get(hour));
        } else {
          firstInHour.set(hour, rows);
        }

        const count = (totals.get(hour) ?? 0) + 1;
        totals.set(hour, count);
        expect(
          db
            .prepare("SELECT piece,count FROM sums WHERE hour=? AND refused='reserved' ORDER BY piece")
            .all(hour)
            .map((row) => ({ ...row })),
        ).toEqual([
          { piece: "connection.frame", count },
          { piece: "runtime.rpc", count },
        ]);
      }
    }).pipe(Effect.provide(TestClock.layer())),
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
