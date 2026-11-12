// P17b slice 1, next/. Runtime's suite on real SQLite; every connection and folder is scoped.
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, FileSystem, Layer, Path, Schema, Stream, Tracer } from "effect";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Line, lineFor, PAGE } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { inbox, letterLine } from "../processes/Mailbox.ts";
import { ProcessEvent } from "../processes/Process.ts";
import * as ProcessHistoryLedger from "../processes/ProcessHistoryLedger.ts";
import { Nemesis } from "../runtime/Nemesis.ts";
import * as NemesisLedger from "../runtime/NemesisLedger.ts";
import * as NemesisTest from "../runtime/NemesisTest.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Chain, PROCESS } from "../telemetry/Trace.ts";

const database: NemesisTest.Database = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p17b-history-" });
  const file = path.join(folder, "history.sqlite");
  return Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const process = "process_0000000000e008000000000000";
const successor = "process_0000000000e008000000000001";
const name = "checklist:1";

const from = {
  by: "brain",
  for: "person",
  sentAt: "2026-11-12T00:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "1234567890abcdef1234567890abcdef",
  build: "test",
} as const;

const ledgerLayer = (sql: Sql) =>
  LedgerSql.layer(sql, { reader: process }).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })));

const reader = (sql: Sql) => Ledger.pipe(Effect.provide(ledgerLayer(sql)));

const append = Effect.fnUntraced(function* (ledger: Ledger["Service"], stream: string, key: string, line: Line) {
  const placed = yield* ledger.append(stream, key, line);
  expect(placed._tag).toBe("placed");

  if (placed._tag !== "placed") {
    throw new Error("test history was refused");
  }

  return placed;
});

const head = Effect.fnUntraced(function* (sql: Sql, stream: string) {
  const ledger = yield* reader(sql);
  const waited = yield* ledger.wait(stream, 0);
  return waited._tag === "ready" ? waited.rev : 0;
}, Effect.orDie);

const restart = (reason: string) =>
  lineFor(from, ProcessEvent.cases.restarted.make({ name, after: process, process: successor, reason, build: "test" }));

const seed = Effect.fnUntraced(function* (sql: Sql, count: number, body: string) {
  const transaction = yield* LedgerTransaction.pipe(
    Effect.provide(
      LedgerTransactionSql.layer(sql).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
    ),
  );
  const processBoundary = yield* transaction.transact((turn) => {
    let completed = 0;
    const place = (stream: string, key: string, line: Line, rev: number, pos: number) => {
      const placed = turn.append(stream, key, line);
      expect(placed.rev).toBe(rev);
      expect(placed.pos).toBe(pos);
      completed++;
      return placed;
    };

    for (let i = 0; i < count; i++) {
      place("unrelated", `other-${i}`, letterLine(from, { unrelated: i }), 2 * i + 1, i + 1);
      place(inbox(name), `letter-${i}`, letterLine(from, { item: i, body }), 2 * i + 2, i + 1);
    }

    // A read failure after its first process row is still before this stream's captured head.
    place(
      `processes/${name}`,
      "start-0",
      lineFor(from, ProcessEvent.cases.started.make({ process, name, program: "fabrika/checklist", hash: "test" })),
      2 * count + 1,
      1,
    );
    const fact = place(`processes/${name}`, "restart-1", restart("crash"), 2 * count + 2, 2);
    expect(completed).toBe(2 * count + 2);
    return fact.rev;
  });
  return { boundary: yield* head(sql, inbox(name)), processBoundary };
}, Effect.orDie);

const singleSeed = Effect.fnUntraced(function* (sql: Sql, count: number, body: string) {
  const ledger = yield* reader(sql);

  for (let i = 0; i < count; i++) {
    yield* append(ledger, "unrelated", `other-${i}`, letterLine(from, { unrelated: i }));
    yield* append(ledger, inbox(name), `letter-${i}`, letterLine(from, { item: i, body }));
  }

  // A read failure after its first process row is still before this stream's captured head.
  yield* append(
    ledger,
    `processes/${name}`,
    "start-0",
    lineFor(from, ProcessEvent.cases.started.make({ process, name, program: "fabrika/checklist", hash: "test" })),
  );
  const fact = yield* append(ledger, `processes/${name}`, "restart-1", restart("crash"));
  return { boundary: yield* head(sql, inbox(name)), processBoundary: fact.rev };
}, Effect.orDie);

const seedCase = Arbitrary.schema(
  Schema.Struct({
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
    body: Schema.String.check(Schema.isMaxLength(48)),
  }),
).pipe(
  Arbitrary.map(({ count, body }) => {
    const state = { index: 0, head: 0, positions: new Map<string, number>() };
    const rows: Array<{ id: string; stream: string; rev: number; pos: number }> = [];
    const next = (stream: string, id: string) => {
      const pos = (state.positions.get(stream) ?? 0) + 1;
      state.head++;
      state.positions.set(stream, pos);
      rows.push({ id, stream, rev: state.head, pos });
    };

    for (; state.index < count; state.index++) {
      next("unrelated", `other-${state.index}`);
      next(inbox(name), `letter-${state.index}`);
    }

    next(`processes/${name}`, "start-0");
    next(`processes/${name}`, "restart-1");
    return { count, body, rows };
  }),
);

it.effect.prop(
  "batched seed matches single appends row for row",
  [seedCase],
  ([{ count, body, rows }]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const openBatched = yield* database;
        const openSingle = yield* database;
        const batched = yield* openBatched;
        const single = yield* openSingle;
        const batchedHeads = yield* seed(batched, count, body);
        const singleHeads = yield* singleSeed(single, count, body);
        const batchedRows = batched.exec("SELECT * FROM entries ORDER BY rev");
        const singleRows = single.exec("SELECT * FROM entries ORDER BY rev");
        expect(batchedRows).toEqual(singleRows);

        for (const entries of [batchedRows, singleRows]) {
          expect(entries).toHaveLength(2 * count + 2);
          expect(entries.map(({ id, stream, rev, pos }) => ({ id, stream, rev, pos }))).toEqual(rows);
        }

        expect(batchedHeads).toEqual(singleHeads);
        expect(batchedHeads).toEqual({ boundary: 2 * count, processBoundary: 2 * count + 2 });
      }),
    ),
  { arbitrary: { seed: 119120, runs: 25 } },
);

type ServiceOptions = NonNullable<Parameters<NemesisTest.Driver["service"]>[2]>;

const service = Effect.fnUntraced(function* (
  sql: Sql,
  operation: Nemesis["Service"]["fire"],
  options: ServiceOptions = {},
) {
  const ledger = yield* reader(sql);
  const failure = options.failure;
  const lower = failure === undefined ? undefined : new LedgerError({ reason: failure.reason, cause: failure.cause });
  const affected = failure?.part.startsWith("inbox") ? inbox(name) : `processes/${name}`;
  const controlled: Ledger["Service"] = {
    ...ledger,
    wait: (stream, after) =>
      Effect.gen(function* () {
        expect(after, "capture uses the nonblocking wait from zero").toBe(0);

        if (lower !== undefined && stream === affected && failure?.part.endsWith("wait")) {
          return yield* Effect.fail(lower);
        }

        const captured = yield* ledger.wait(stream, after);

        if (options.parked !== undefined) {
          expect(captured._tag).toBe("parked");
          yield* append(ledger, stream, `late-${options.parked}`, letterLine(from, { n: options.parked }));
        }

        for (let i = 0; i < (options.tails ?? 0); i++) {
          yield* append(
            ledger,
            stream,
            `tail-${i}`,
            stream === inbox(name) ? letterLine(from, { late: i }) : restart("late"),
          );
        }

        return captured;
      }),
    read: (stream, after) =>
      lower !== undefined && stream === affected && failure?.part.endsWith("read")
        ? ledger.read(stream, after).pipe(Stream.take(1), Stream.concat(Stream.fail(lower)))
        : ledger.read(stream, after),
  };
  const context = yield* Layer.build(
    NemesisLedger.layer(operation).pipe(
      Layer.provide(ProcessHistoryLedger.layer),
      Layer.provide(Layer.succeed(Ledger, controlled)),
    ),
  );
  return Context.get(context, Nemesis);
}, Effect.orDie);

NemesisTest.suite({
  database,
  seed,
  head,
  service,
  page: PAGE,
  telemetry: Effect.fnUntraced(function* (sql, process) {
    const context = yield* Layer.build(SpanSink.layer(sql, { object: "chaos-test" }));
    const sink = Context.get(context, SpanSink);
    const tracer = Context.get(context, Tracer.Tracer);
    return {
      trace: <A, E, R>(work: Effect.Effect<A, E, R>) =>
        work.pipe(Effect.withSpan("chaos.test", { attributes: { [PROCESS]: process } }), Effect.withTracer(tracer)),
      read: Effect.gen(function* () {
        const records = RecordManager.sql(() => sql, 1024 ** 3);
        yield* sink.flush.pipe(Effect.provide(Layer.merge(records, Archive.memory)));
        const rows = yield* RecordManager.use((manager) =>
          Stream.runCollect(manager.read(Chain.cases.job.make({ process }))),
        ).pipe(Effect.provide(records));
        const health = sql
          .exec("SELECT * FROM measurements")
          .filter((row) => typeof row["piece"] === "string" && /nemesis/i.test(row["piece"]));
        return { rows, health };
      }).pipe(Effect.orDie),
    };
  }),
  damage: (sql, key, kind) => {
    if (kind === "json" || kind === "body") {
      sql.exec(
        "UPDATE entries SET body=? WHERE stream=? AND id=?",
        kind === "json" ? "{" : JSON.stringify({ missing: true }),
        inbox("checklist:1"),
        key,
      );
    } else {
      sql.exec(
        "UPDATE entries SET pos=? WHERE stream=? AND id=?",
        kind === "zero" ? 0 : kind === "negative" ? -1 : 1.5,
        inbox("checklist:1"),
        key,
      );
    }
  },
});
