// P17b slice 1, next/. Runtime's suite on real SQLite; every connection and folder is scoped.
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import { expect } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { type Line, lineFor, PAGE } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { inbox, letterLine } from "../processes/Mailbox.ts";
import { ProcessEvent } from "../processes/Process.ts";
import * as ProcessHistoryLedger from "../processes/ProcessHistoryLedger.ts";
import { Nemesis } from "../runtime/Nemesis.ts";
import * as NemesisLedger from "../runtime/NemesisLedger.ts";
import * as NemesisTest from "../runtime/NemesisTest.ts";
import type { Sql } from "../Sql.ts";

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
