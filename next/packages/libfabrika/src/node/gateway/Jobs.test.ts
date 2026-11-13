// P39 slice 1: the jobs module's laws on node:sqlite (0062). This module owns the driver, so it
// acquires each store in a scope and the scope gives the folder and the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as ClientManagerLedger from "../../access/ClientManagerLedger.ts";
import { Gateway } from "../../gateway/Gateway.ts";
import * as TestSuite from "../../gateway/JobsTest.ts";
import * as RateLimiterSql from "../../gateway/RateLimiterSql.ts";
import * as Id from "../../Id.ts";
import * as JobsLedger from "../../jobs/JobsLedger.ts";
import { Doorbell } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import * as LedgerStreamsSql from "../../ledger/LedgerStreamsSql.ts";
import * as LedgerTransactionSql from "../../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";
import { Archive } from "../../telemetry/Archive.ts";
import { RecordManager } from "../../telemetry/Records.ts";
import { SpanSink } from "../../telemetry/Sink.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p39-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "ledger.db");
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(path);
      // Keep a durable file across reopens without creating a rollback journal on every write.
      // No disk sync per commit, as next/'s other test stores: no law cuts the power, a close keeps
      // every commit, and the gateway's limiter and span sink commit on each call.
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
      return { db, sql: nodeSql(db) };
    }),
    (held) => Effect.sync(() => held.db.isOpen && held.db.close()),
  );
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => handle.sql.exec(query, ...params),
    transaction: (step) => handle.sql.transaction(step),
    size: () => handle.sql.size(),
  };
  const reopen = Effect.sync(() => {
    handle.db.close();
    handle.db = new DatabaseSync(path);
    handle.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
    handle.sql = nodeSql(handle.db);
  });
  const gateway: TestSuite.Store["gateway"] = (options) => {
    const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
    const data = Layer.mergeAll(
      LedgerSql.layer(sql, { reader: "jobs-gateway-law" }),
      LedgerTransactionSql.layer(sql),
      LedgerStreamsSql.layer(sql),
    ).pipe(Layer.provide(quiet));
    const jobs = JobsLedger.layer.pipe(Layer.provide(data), Layer.provide(Id.Generator.layer));
    const services = Layer.mergeAll(
      data,
      jobs,
      ClientManagerLedger.layer(options.founder).pipe(Layer.provide(data)),
      SpanSink.layer(sql, { object: "jobs-law" }),
      RecordManager.memory(4 * 1024 * 1024),
      Archive.memory,
      Id.Generator.layer,
      RateLimiter.layer.pipe(
        Layer.provide(RateLimiterSql.layer(sql, { build: options.build, policy: options.rateLimit })),
      ),
    );
    // The suite's contract names no ledger error: a store that cannot open is a broken test, a defect.
    return Gateway.layer(options).pipe(Layer.provideMerge(services), Layer.orDie);
  };
  return { sql, reopen, gateway } satisfies TestSuite.Store;
});

TestSuite.suite(open);
