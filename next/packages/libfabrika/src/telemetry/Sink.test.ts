// p98 and p99 (P37's plan writes them out; the lead commit adds them to docs/plan/tier-1-detail.md,
// "Properties"), for `data/sink.ts` and `data/trace.ts`: a span that ends is never dropped, and its
// tags hold names, ids and numbers only. From "design for bounded objects" and "monitoring is in
// Tier 1" (owner, 2026-11-07). Written before the modules (Tier 1, P37, ticket 238).
//
// The shape these tests hold the modules to, from the plan's sketches:
// - `SpanSink.layer(sql, {object})` gives Effect's `Tracer.Tracer` and `SpanSink` over the object's
//   own SQLite, and needs nothing else. Building it touches nothing.
// - A span that ends writes, before `end` returns, in one step: a `measurements` row (piece = the span's
//   name) and an `unsent` row. Its chain is its own `fab.process` tag, else its nearest ancestor's,
//   else `spans`.
// - `SpanSink.flush` sends `unsent` to each chain's part (`parts`, 0 if none), follows `rolled`,
//   deletes a row only after a good answer, and answers `{sent}`. The sink's own calls end no span.
// - A write that throws `SQLITE_FULL` is held in memory and tried again at each later `end`; the
//   next `flush` fails with `SinkError {reason: "storage", held}` before it sends anything.
// - A row keeps OTLP's span fields. Tags are strings (cut at 128, `<key>.length` beside), numbers
//   and booleans; a `Redacted` is `"<redacted>"`; anything else is dropped and counted in
//   `fab.sink.dropped`. A failed span's class is `error.type`; `Cause.pretty` goes only to content.
// - Words: "run" is an agent run only. A program start is a process, and its tag is `fab.process`.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Layer, Option, Redacted, Schema, Stream, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { processId, processIds } from "../Id.test-support.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { ProcessId } from "../ProcessId.ts";
import type { Sql } from "../Sql.ts";
import { Archive, type BucketCalls } from "./Archive.ts";
import { RecordManager } from "./Records.ts";
import { SinkError, SpanSink } from "./Sink.ts";
import { type Chain, type SpanRow } from "./Trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

type ChainValue = typeof Chain.Type;
type Row = typeof SpanRow.Type;

/** A folder of its own, and every file opened in it. The sink asks for a part's file with a plain
 *  call, so a file cannot be acquired one by one: the folder holds them, and the scope that asked
 *  for the folder closes each one, then removes it (0061). */
const folder = Effect.acquireRelease(
  Effect.sync(() => ({ dir: mkdtempSync(join(tmpdir(), "p37-sink-")), opened: new Array<DatabaseSync>() })),
  ({ dir, opened }) =>
    Effect.sync(() => {
      for (const db of opened.splice(0)) {
        if (db.isOpen) {
          db.close();
        }
      }

      rmSync(dir, { recursive: true, force: true });
    }),
);

/** A folder of its own: the object's file, and any part files, so a test can read every byte. */
const home = folder.pipe(
  Effect.map(({ dir, opened }) => {
    const open = (file: string): DatabaseSync => {
      const db = new DatabaseSync(join(dir, file));
      opened.push(db);
      return db;
    };
    const db = open("object.db");
    const parts = new Map<string, DatabaseSync>();
    const sqls = new Map<string, Sql>();
    const part = (name: string): Sql => {
      const known = sqls.get(name);

      if (known !== undefined) {
        return known;
      }

      const made = open(`${name.replaceAll("/", "_")}.db`);
      parts.set(name, made);
      const sql = nodeSql(made);
      sqls.set(name, sql);
      return sql;
    };
    const bytes = (marker: string) => readdirSync(dir).filter((file) => readFileSync(join(dir, file)).includes(marker));
    return { dir, db, sql: nodeSql(db), open, part, parts, bytes };
  }),
);

const OBJECT = Effect.runSync(processId);
const P1 = OBJECT;
const P2 = Effect.runSync(processId);
const job = (process: string): ChainValue => ({ _tag: "job", process });
const spans: ChainValue = { _tag: "spans" };
const BIG = 1024 * 1024 * 1024;

const world = (
  sql: Sql,
  records: Layer.Layer<RecordManager> = RecordManager.memory(BIG),
  archive: Layer.Layer<Archive> = Archive.memory,
) => Layer.mergeAll(SpanSink.layer(sql, { object: OBJECT }), records, archive);

const flush = SpanSink.use((sink) => sink.flush);

const recorded = (chain: ChainValue) => RecordManager.use((records) => Stream.runCollect(records.read(chain)));

const traced = <A, E, R>(name: string, attributes: Record<string, unknown>, body: Effect.Effect<A, E, R>) =>
  body.pipe(Effect.withSpan(name, { attributes }));

const step = (name: string, attributes: Record<string, unknown> = {}) => traced(name, attributes, Effect.void);

const count = (db: DatabaseSync, table: string, predicate = "1"): number =>
  Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`).get()?.["n"]);

/** Each table and column in a database whose text holds `marker`, as `table.column`. */
const places = (db: DatabaseSync, marker: string): Array<string> => {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all();
  const found = new Set<string>();

  for (const { name } of tables) {
    for (const row of db.prepare(`SELECT * FROM "${String(name)}"`).all()) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === "string" && value.includes(marker)) {
          found.add(`${String(name)}.${column}`);
        }
      }
    }
  }

  return [...found].sort();
};

const full = () =>
  Object.assign(new Error("database or disk is full"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 13,
    errstr: "database or disk is full",
  });

const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

/** A Sql over a real one that throws SQLITE_FULL on its next `armed` writes, as a full disk would. */
const filling = (inner: Sql) => {
  let armed = 0;
  let inside = false;
  const sql: Sql = {
    exec: (query, ...params) => {
      if (!inside && armed > 0 && WRITE.test(query)) {
        armed -= 1;
        throw full();
      }

      return inner.exec(query, ...params);
    },
    transaction: (work) => {
      if (armed > 0) {
        armed -= 1;
        throw full();
      }

      inside = true;

      try {
        return inner.transaction(work);
      } finally {
        inside = false;
      }
    },
    size: () => inner.size(),
  };
  return { sql, arm: (times: number) => (armed = times) };
};

const hex = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

/** R2 in memory, as its binding behaves: `put` fails when the body does not match its SHA-256. */
const bucket = () => {
  const files = new Map<string, Uint8Array>();
  const calls: BucketCalls = {
    put: (key, body, sha256) => {
      if (hex(body) !== sha256) {
        return Promise.reject(new Error("checksum mismatch"));
      }

      files.set(key, body.slice());
      return Promise.resolve();
    },
    head: (key) => {
      const body = files.get(key);
      return Promise.resolve(body === undefined ? null : { sha256: hex(body) });
    },
  };
  return { calls, files };
};

const ids = (rows: ReadonlyArray<Row>) => rows.map((r) => r.spanId);

describe("T246, P37 decodes TypeID process ids", () => {
  it.effect.prop(
    "a generated valid process reaches its JobRecord",
    { process: processIds },
    ({ process }) =>
      Effect.gen(function* () {
        const { db, sql } = yield* home;
        yield* Effect.gen(function* () {
          yield* step("runner.step", { "fab.process": process });
          expect(yield* flush).toEqual({ sent: 1 });
          expect(count(db, "unsent")).toBe(0);
          expect((yield* recorded(job(process))).map((row) => row.name)).toEqual(["runner.step"]);
        }).pipe(Effect.provide(world(sql)));
      }),
    { arbitrary: { seed: SEED, runs: 40 } },
  );

  // Plant: keep ProcessId as NonEmptyString. P37 must refuse a stored chain with a bad id.
  for (const [label, original] of [
    ["old eight-hex id", "3f9a0c21"],
    ...["i", "l", "o", "u"].map((char) => [char, `process_0${char}${"0".repeat(24)}`] as const),
    ["first character 8", `process_8${"0".repeat(25)}`],
    ["uppercase suffix", `process_${P1.slice(8).toUpperCase()}`],
    ["25 characters", `process_${"0".repeat(25)}`],
    ["27 characters", `process_${"0".repeat(27)}`],
    ["wrong prefix", `person_${P1.slice(8)}`],
    ["leading space", ` ${P1}`],
    ["trailing space", `${P1} `],
    ["trailing newline", `${P1}\n`],
  ] as const) {
    it.effect.prop(
      `a stored process with ${label} fails bad_row, keeps its row, and sends nothing`,
      {
        generated: Schema.String.check(Schema.makeFilter((process) => !Schema.is(ProcessId)(process))),
      },
      ({ generated }) =>
        Effect.forEach(
          [original, generated],
          (process) =>
            Effect.gen(function* () {
              const { db, sql } = yield* home;
              yield* Effect.gen(function* () {
                yield* step("runner.step", { "fab.process": P1 });
                expect(count(db, "unsent")).toBe(1);
                sql.exec(`UPDATE unsent SET chain = json_set(chain, '$.process', ?)`, process);
                const exit = yield* Effect.exit(flush);
                expect(Exit.isFailure(exit), "P37 must reject the stored process id before sending").toBe(true);
                const error = Exit.match(exit, {
                  onFailure: Cause.squash,
                  onSuccess: () => undefined,
                });
                expect(error).toBeInstanceOf(SinkError);
                expect(error).toMatchObject({ reason: "bad_row", held: 0 });
                expect(count(db, "unsent")).toBe(1);
                expect(yield* recorded(job(P1))).toEqual([]);
                expect(yield* recorded(job(process))).toEqual([]);
                sql.exec(`UPDATE unsent SET chain = json_set(chain, '$.process', ?)`, P1);
                expect(yield* flush).toEqual({ sent: 1 });
                expect(count(db, "unsent")).toBe(0);
                expect((yield* recorded(job(P1))).map((row) => row.name)).toEqual(["runner.step"]);
              }).pipe(Effect.provide(world(sql)));
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }
});

describe("p98, a span that ends is never dropped", () => {
  it.live("its rows are in the object's own SQLite before end returns, and a later process's flush sends them", () =>
    Effect.gen(function* () {
      const { db, open } = yield* home;
      // Effect.runSync: nothing may wait on a fiber or a timer for the rows to land.
      const exit = Effect.runSyncExit(
        traced("runner.step", { "fab.process": P1 }, step("ledger.call")).pipe(
          Effect.provide(SpanSink.layer(nodeSql(db), { object: OBJECT })),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      db.close();
      const again = open("object.db");
      expect(count(again, "measurements", "piece IN ('runner.step', 'ledger.call')")).toBe(2);
      expect(count(again, "unsent")).toBe(2);
      yield* Effect.gen(function* () {
        expect(yield* flush).toEqual({ sent: 2 });
        const rows = yield* recorded(job(P1));
        expect(rows.map((r) => r.name).sort()).toEqual(["ledger.call", "runner.step"]);
        expect(count(again, "unsent")).toBe(0);
      }).pipe(Effect.provide(world(nodeSql(again))));
    }),
  );

  it.effect("a span goes to its own process, else its nearest ancestor's, else to spans; each to one chain", () =>
    Effect.gen(function* () {
      const { db, sql } = yield* home;
      yield* Effect.gen(function* () {
        yield* traced("runner.step", { "fab.process": P1 }, traced("runner.cmd", {}, step("ledger.call")));
        yield* traced("runner.step", { "fab.process": P2 }, step("runner.cmd"));
        yield* traced("gateway.envelope", {}, step("ledger.append"));
        yield* traced(
          "runner.step",
          { "fab.process": P1 },
          traced("supervisor.restart", { "fab.process": P2 }, step("leaf")),
        );
        expect(count(db, "unsent"), "every span gets an unsent row, none is measurements only").toBe(10);
        expect(count(db, "measurements")).toBe(10);
        expect(yield* flush).toEqual({ sent: 10 });
        const one = yield* recorded(job(P1));
        const two = yield* recorded(job(P2));
        const outside = yield* recorded(spans);
        expect(one.map((r) => r.name).sort()).toEqual(["ledger.call", "runner.cmd", "runner.step", "runner.step"]);
        expect(two.map((r) => r.name).sort()).toEqual(["leaf", "runner.cmd", "runner.step", "supervisor.restart"]);
        expect(outside.map((r) => r.name).sort()).toEqual(["gateway.envelope", "ledger.append"]);
        const all = [...ids(one), ...ids(two), ...ids(outside)];
        expect(new Set(all).size, "no span in two chains").toBe(10);
        expect(count(db, "unsent")).toBe(0);
      }).pipe(Effect.provide(world(sql)));
    }),
  );

  it.effect("a row keeps OTLP's span fields, its parent and its times", () =>
    Effect.gen(function* () {
      const { db, sql } = yield* home;
      const T = Date.UTC(2026, 10, 7, 21, 59, 59, 990);
      const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(T);
        yield* traced(
          "runner.step",
          { "fab.process": P1, "fab.letter.id": "m-17" },
          TestClock.adjust(4).pipe(
            Effect.andThen(traced("ledger.call", { "rpc.method": "append" }, TestClock.adjust(3))),
          ),
        );
        yield* flush;
        const rows = yield* recorded(job(P1));
        const parent = rows.find((r) => r.name === "runner.step");
        const child = rows.find((r) => r.name === "ledger.call");
        expect(parent).toEqual({
          traceId: expect.any(String),
          spanId: expect.any(String),
          parentSpanId: null,
          name: "runner.step",
          kind: "internal",
          startTimeUnixNano: nanos(T),
          endTimeUnixNano: nanos(T + 7),
          attributes: { "fab.process": P1, "fab.letter.id": "m-17" },
          events: [],
          links: [],
          resource: { attributes: { "fab.object": OBJECT } },
          ok: true,
        });
        expect(child).toMatchObject({
          traceId: parent?.traceId,
          parentSpanId: parent?.spanId,
          startTimeUnixNano: nanos(T + 4),
          endTimeUnixNano: nanos(T + 7),
          attributes: { "rpc.method": "append" },
          ok: true,
        });
        const measurements = db.prepare(`SELECT piece, ms, ok FROM measurements ORDER BY piece`).all();
        expect(measurements.map((h) => [h["piece"], h["ms"], Boolean(h["ok"])])).toEqual([
          ["ledger.call", 3, true],
          ["runner.step", 7, true],
        ]);
      }).pipe(Effect.provide(world(sql)));
    }),
  );

  it.effect("every row names the object that ended it, as OTLP's resource, inside a process and outside one", () =>
    Effect.gen(function* () {
      // Two objects end spans. The spans outside a process share one chain, `spans`, so the row
      // is the only place that says which object ended each one (review must-fix, p98).
      const one = yield* home;
      const two = yield* home;
      const ends = (sql: Sql, object: string, process: string) =>
        Effect.gen(function* () {
          yield* traced("runner.step", { "fab.process": process }, step("ledger.call"));
          yield* step("gateway.envelope", { "fab.n": 1 });
          expect(yield* flush).toEqual({ sent: 3 });
        }).pipe(Effect.provide(SpanSink.layer(sql, { object })));
      yield* Effect.gen(function* () {
        yield* ends(one.sql, OBJECT, P1);
        yield* ends(two.sql, P2, P2);
        const outside = yield* recorded(spans);
        expect(outside).toHaveLength(2);
        expect(
          outside
            .map((r) => r.resource)
            .sort((x, y) => String(x.attributes["fab.object"]).localeCompare(String(y.attributes["fab.object"]))),
        ).toEqual([{ attributes: { "fab.object": OBJECT } }, { attributes: { "fab.object": P2 } }]);

        for (const row of outside) {
          expect(row.attributes, "the object is the resource's, not a span tag").not.toHaveProperty("fab.object");
        }

        for (const [process, object] of [
          [P1, OBJECT],
          [P2, P2],
        ] as const) {
          const rows = yield* recorded(job(process));
          expect(rows).toHaveLength(2);

          for (const row of rows) {
            expect(row.resource).toEqual({ attributes: { "fab.object": object } });
          }
        }
      }).pipe(Effect.provide(Layer.merge(RecordManager.memory(BIG), Archive.memory)));
    }),
  );

  it.effect("a span's links stay on its row, in OTLP's link shape, their tags kept as a span's are", () =>
    Effect.gen(function* () {
      const { sql, bytes } = yield* home;
      const first = Tracer.externalSpan({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      });
      const second = Tracer.externalSpan({
        traceId: "5bf92f3577b34da6a3ce929d0e0e4737",
        spanId: "10f067aa0ba902b8",
      });
      yield* Effect.gen(function* () {
        yield* Effect.void.pipe(
          Effect.withSpan("runner.step", {
            attributes: { "fab.process": P1 },
            links: [
              {
                span: first,
                attributes: {
                  "fab.link": "follows-from",
                  "fab.n": 2,
                  "fab.key": Redacted.make("sk-p98-link"),
                },
              },
              { span: second, attributes: {} },
            ],
          }),
        );
        yield* flush;
        const [row] = yield* recorded(job(P1));
        expect(row?.links).toEqual([
          {
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            spanId: "00f067aa0ba902b7",
            attributes: { "fab.link": "follows-from", "fab.n": 2, "fab.key": "<redacted>" },
          },
          { traceId: "5bf92f3577b34da6a3ce929d0e0e4737", spanId: "10f067aa0ba902b8", attributes: {} },
        ]);
        expect(bytes("sk-p98-link"), "a link's secret is never written").toEqual([]);
      }).pipe(Effect.provide(world(sql)));
    }),
  );

  it.effect.prop(
    "a RecordManager that fails leaves every unsent row; a lost answer's resend adds nothing",
    { generated: SinkError.fields.reason },
    ({ generated }) =>
      Effect.forEach(
        ["unreachable", generated] as const,
        (value) =>
          Effect.gen(function* () {
            const { db, sql } = yield* home;
            yield* Effect.gen(function* () {
              for (let n = 0; n < 4; n++) {
                yield* step("runner.step", { "fab.process": P1, "fab.n": n });
              }

              const real = yield* RecordManager;
              const down = {
                ...real,
                write: () => Effect.fail(new SinkError({ reason: value, held: 0 })),
              };
              const failed = yield* Effect.flip(flush.pipe(Effect.provideService(RecordManager, down)));
              expect(failed).toBeInstanceOf(SinkError);
              expect(count(db, "unsent"), "unsent is deleted only after a good answer").toBe(4);
              expect(yield* recorded(job(P1))).toEqual([]);

              // The part takes the write, and the answer is lost on the way back.
              let lose = 1;
              const lossy = {
                ...real,
                write: (...args: Parameters<typeof real.write>) =>
                  real
                    .write(...args)
                    .pipe(
                      Effect.flatMap((written) =>
                        lose-- > 0 ? Effect.fail(new SinkError({ reason: value, held: 0 })) : Effect.succeed(written),
                      ),
                    ),
              };
              yield* Effect.exit(flush.pipe(Effect.provideService(RecordManager, lossy)));
              expect(count(db, "unsent")).toBe(4);
              expect(yield* flush).toEqual({ sent: 4 });
              const rows = yield* recorded(job(P1));
              expect(rows).toHaveLength(4);
              expect(new Set(ids(rows)).size, "the resend wrote nothing twice").toBe(4);
              expect(count(db, "unsent")).toBe(0);
              expect(yield* flush).toEqual({ sent: 0 });
            }).pipe(Effect.provide(world(sql)));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect("flush follows a part's roll and the next batch starts at the new part", () =>
    Effect.gen(function* () {
      const { db, sql } = yield* home;
      yield* Effect.gen(function* () {
        for (let batch = 0; batch < 3; batch++) {
          for (let n = 0; n < 30; n++) {
            yield* step("runner.step", { "fab.process": P1, "fab.n": batch * 30 + n });
          }

          expect(yield* flush).toEqual({ sent: 30 });
        }

        const rows = yield* recorded(job(P1));
        expect(rows.map((r) => r.attributes["fab.n"])).toEqual(Array.from({ length: 90 }, (_, n) => n));
        const part = db.prepare(`SELECT max(part) AS part FROM parts`).get()?.["part"];
        expect(Number(part), "90 spans under a 16 KB cap roll past part 0").toBeGreaterThan(0);
      }).pipe(Effect.provide(world(sql, RecordManager.memory(16 * 1024))));
    }),
  );

  it.effect.prop(
    "a write that meets SQLITE_FULL once: the step's flush fails with storage, the span lands later",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [0, generated],
        (value) =>
          Effect.gen(function* () {
            const { db, sql: real } = yield* home;
            const { sql, arm } = filling(real);
            yield* Effect.gen(function* () {
              yield* step("runner.step", { "fab.process": P1, "fab.n": value });
              arm(1);
              const exit = yield* Effect.exit(step("runner.step", { "fab.process": P1, "fab.n": 1 }));
              expect(Exit.isSuccess(exit), "end never fails the fiber").toBe(true);
              const error = yield* Effect.flip(flush);
              expect(error).toBeInstanceOf(SinkError);
              expect(error.reason).toBe("storage");
              expect(error.held).toBe(1);
              expect(yield* recorded(job(P1)), "flush fails before it sends anything").toEqual([]);
              yield* step("runner.step", { "fab.process": P1, "fab.n": 2 });
              expect(count(db, "unsent"), "the held span landed at the next end").toBe(3);
              expect(yield* flush).toEqual({ sent: 3 });
              const rows = yield* recorded(job(P1));
              expect(rows.map((r) => r.attributes["fab.n"]).sort()).toEqual([value, 1, 2].sort());
            }).pipe(Effect.provide(world(sql)));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "a disk that stays full: every flush fails, held counts every span, none goes missing",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["warm", generated],
        (value) =>
          Effect.gen(function* () {
            const { db, sql: real } = yield* home;
            const { sql, arm } = filling(real);
            yield* Effect.gen(function* () {
              yield* step(value, {});
              arm(Number.POSITIVE_INFINITY);

              for (let n = 0; n < 5; n++) {
                yield* step("runner.step", { "fab.n": n });
              }

              expect((yield* Effect.flip(flush)).held).toBe(5);

              for (let n = 5; n < 8; n++) {
                yield* step("runner.step", { "fab.n": n });
              }

              const error = yield* Effect.flip(flush);
              expect(error.reason).toBe("storage");
              expect(error.held).toBe(8);
              expect(count(db, "unsent")).toBe(1);
              arm(0);
              yield* step("runner.step", { "fab.n": 8 });
              expect(yield* flush).toEqual({ sent: 10 });
              const rows = yield* recorded(spans);
              expect(rows.map((r) => r.attributes["fab.n"] ?? "warm").sort()).toEqual(
                [0, 1, 2, 3, 4, 5, 6, 7, 8, "warm"].sort(),
              );
            }).pipe(Effect.provide(world(sql)));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "a real full file (max_page_count): unsent plus held is every span, and all land once it has room",
    { generated: Schema.Int.check(Schema.isBetween({ minimum: 120, maximum: 256 })) },
    ({ generated }) =>
      Effect.forEach(
        [120, generated],
        (value) =>
          Effect.gen(function* () {
            const { db, sql } = yield* home;
            yield* Effect.gen(function* () {
              yield* step("warm", {});
              const pages = Number(db.prepare("PRAGMA page_count").get()?.["page_count"]);
              db.exec(`PRAGMA max_page_count = ${pages}`);
              const made = value;

              for (let n = 0; n < made; n++) {
                yield* step("runner.step", { "fab.n": n, "fab.pad": "p".repeat(100) });
              }

              const error = yield* Effect.flip(flush);
              expect(error.reason).toBe("storage");
              expect(error.held).toBeGreaterThan(0);
              expect(count(db, "unsent") + error.held).toBe(made + 1);
              expect(yield* recorded(spans)).toEqual([]);
              db.exec("PRAGMA max_page_count = 1073741823");
              yield* step("runner.step", { "fab.n": made });
              expect(yield* flush).toEqual({ sent: made + 2 });
              const rows = yield* recorded(spans);
              expect(new Set(ids(rows)).size).toBe(made + 2);
            }).pipe(Effect.provide(world(sql)));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "a second flush after a storage failure still fails while spans are held, and sends nothing",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [0, generated],
        (value) =>
          Effect.gen(function* () {
            const { db, sql: real } = yield* home;
            const { sql, arm } = filling(real);
            yield* Effect.gen(function* () {
              yield* step("warm", {});
              arm(Number.POSITIVE_INFINITY);
              yield* step("runner.step", { "fab.n": value });
              expect((yield* Effect.flip(flush)).held).toBe(1);
              arm(0);
              const again = yield* Effect.flip(flush);
              expect(again.reason, "no end since, but the span is still only in memory").toBe("storage");
              expect(again.held).toBe(1);
              expect(yield* recorded(spans), "the second flush sent nothing").toEqual([]);
              expect(count(db, "unsent")).toBe(1);
              yield* step("runner.step", { "fab.n": 1 });
              expect(yield* flush).toEqual({ sent: 3 });
            }).pipe(Effect.provide(world(sql)));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "after a roll, rows the old part already holds are not written again to the next part",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [0, generated],
        (value) =>
          Effect.gen(function* () {
            const { db, sql } = yield* home;
            yield* Effect.gen(function* () {
              yield* step("runner.step", { "fab.process": P1, "fab.n": value });
              yield* step("runner.step", { "fab.process": P1, "fab.n": 1 });
              const real = yield* RecordManager;
              // Part 0 takes both rows, and the answer is lost on the way back.
              let lose = 1;
              const lossy = {
                ...real,
                write: (...args: Parameters<typeof real.write>) =>
                  real
                    .write(...args)
                    .pipe(
                      Effect.flatMap((written) =>
                        lose-- > 0
                          ? Effect.fail(new SinkError({ reason: "unreachable", held: 0 }))
                          : Effect.succeed(written),
                      ),
                    ),
              };
              yield* Effect.exit(flush.pipe(Effect.provideService(RecordManager, lossy)));
              expect(count(db, "unsent")).toBe(2);
              // Part 0 is now past its 1-byte cap: the resend with one new row rolls it.
              yield* step("runner.step", { "fab.process": P1, "fab.n": 2 });
              expect(yield* flush).toEqual({ sent: 3 });
              const rows = yield* recorded(job(P1));
              expect(rows.map((r) => r.attributes["fab.n"])).toEqual([value, 1, 2]);
              expect(count(db, "unsent")).toBe(0);
              expect(Number(db.prepare(`SELECT part FROM parts`).get()?.["part"])).toBe(1);
            }).pipe(Effect.provide(world(sql, RecordManager.memory(1))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "building touches nothing: on a Sql that always throws it builds, and traced work still succeeds",
    { generated: Schema.Unknown },
    ({ generated }) =>
      Effect.forEach(
        [full(), generated],
        (value) => {
          const throwing: Sql = {
            exec: () => {
              throw value;
            },
            transaction: () => {
              throw value;
            },
            size: () => 0,
          };
          return Effect.gen(function* () {
            expect(yield* traced("runner.step", { "fab.process": P1 }, Effect.succeed(7))).toBe(7);
            const error = yield* Effect.flip(flush);
            expect(error.reason).toBe("storage");
            expect(error.held).toBe(1);
          }).pipe(Effect.provide(world(throwing)));
        },
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

// A-Sink's frame shapes are edge inputs; each carries its expected text independently of the sink.
const FrameWord = Schema.String.check(Schema.isPattern(/^[a-z]{3,16}$/));
const FramePosition = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2147483647 }));

const FrameInput = Schema.Struct({
  word: FrameWord,
  rootKind: Schema.Literals(["posix", "url", "windows", "bracket"]),
  frames: Schema.Array(
    Schema.Struct({
      shape: Schema.Literals([
        "url",
        "posix",
        "windows",
        "windowsUrl",
        "node",
        "bundle",
        "bare",
        "anonymous",
        "async",
        "unnamed",
        "eval",
        "nestedEval",
        "slashName",
        "slashBare",
        "query",
      ]),
      name: FrameWord,
      line: FramePosition,
      column: FramePosition,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
});

const frameCases = Arbitrary.schema(FrameInput).pipe(
  Arbitrary.map(({ word, rootKind, frames }) => {
    const root = {
      posix: `/sink-${word}/private`,
      url: `file:///sink-${word}/private`,
      windows: `C:\\sink-${word}\\private`,
      bracket: `/sink ${word} (private)/folder`,
    }[rootKind];
    return {
      root,
      // A span's name can hold a slash, and a name is kept whole: S1 reads only the rest of its frame.
      slashed: frames.flatMap(({ shape, name }) =>
        shape === "slashName" || shape === "slashBare" ? [`${name}/${word}`] : [],
      ),
      frames: frames.map(({ shape, name, line, column }) => {
        const file = `${name}.ts:${line}:${column}`;
        const location = `${root}/nested/${file}`;

        switch (shape) {
          case "url":
            return { raw: `at ${name} (file:///${location})`, kept: `at ${name} (${file})` };
          case "posix":
            return { raw: `at ${name} (/${location})`, kept: `at ${name} (${file})` };
          case "windows":
            return { raw: `at ${name} (C:\\${root}\\nested\\${file})`, kept: `at ${name} (${file})` };
          case "windowsUrl":
            return { raw: `at ${name} (file:///C:/${location})`, kept: `at ${name} (${file})` };
          case "node":
            return {
              raw: `at ${name} (node:internal/process/task_queues:${line}:${column})`,
              kept: `at ${name} (node:internal/process/task_queues:${line}:${column})`,
            };
          case "bundle":
            return { raw: `at ${name} (file:///bundle/${file})`, kept: `at ${name} (${file})` };
          case "bare":
            return { raw: `at ${name}`, kept: `at ${name}` };
          case "anonymous":
            return { raw: "at Array.map (<anonymous>)", kept: "at Array.map (<anonymous>)" };
          case "async":
            return { raw: `at async Promise.all (index ${line})`, kept: `at async Promise.all (index ${line})` };
          case "unnamed":
            return { raw: `at ${location}`, kept: `at ${file}` };
          case "slashName":
            return { raw: `at ${name}/${word} (${location})`, kept: `at ${name}/${word} (${file})` };
          case "slashBare":
            return { raw: `at ${name}/${word}`, kept: `at ${name}/${word}` };
          case "query":
            // A dev server's URL: the query can hold a folder, and the file name sits before it.
            return {
              raw: `at ${name} (http://localhost:5173/src/${name}.ts?t=${root}/${word}:${line}:${column})`,
              kept: `at ${name} (${file})`,
            };
          case "nestedEval":
            return {
              raw: `at eval (eval at ${name} (eval at ${word} (${location}), <anonymous>:${line}:1), <anonymous>:1:${column})`,
              kept: `at eval (eval at ${name} (eval at ${word} (${file}), <anonymous>:${line}:1), <anonymous>:1:${column})`,
            };
          default:
            // An eval frame names the caller it ran in: `eval at <name> (` stays, with its location's file.
            return {
              raw: `at eval (eval at ${name} (${location}), <anonymous>:1:1)`,
              kept: `at eval (eval at ${name} (${file}), <anonymous>:1:1)`,
            };
        }
      }),
    };
  }),
);

const storedFrames = Effect.fnUntraced(function* (
  sample: typeof frameCases extends Arbitrary.Arbitrary<infer A> ? A : never,
) {
  const { sql } = yield* walkHome;
  return yield* Effect.gen(function* () {
    const inner = new Error("inner message /message/path stays");
    inner.stack = [`Error: ${inner.message}`, ...sample.frames.map(({ raw }) => `    ${raw}`)].join("\n");
    const outer = new Error("outer message C:\\message\\path stays", { cause: inner });
    outer.stack = [`Error: ${outer.message}`, ...sample.frames.map(({ raw }) => `    ${raw}`)].join("\n");
    const fail = Effect.fn("sink.frames")(function* () {
      return yield* Effect.sync(() => {
        // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- A-Sink exercises a thrown Error and its nested cause
        throw outer;
      });
    });
    const exit = yield* Effect.exit(fail());
    expect(Exit.isFailure(exit)).toBe(true);

    if (!Exit.isFailure(exit)) {
      return yield* Effect.die("expected the generated throw");
    }

    const pretty = Cause.pretty(exit.cause);
    yield* flush;
    const rows = yield* recorded(spans);
    expect(rows.filter((row) => row.name === "sink.frames")).toHaveLength(1);
    const row = rows.find((row) => row.name === "sink.frames");
    const content = yield* RecordManager.use((records) => records.content(spans, row?.spanId ?? ""));
    expect(Option.isSome(content) && content.value._tag === "kept").toBe(true);
    const message = Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "";
    return { pretty, message };
  }).pipe(Effect.provide(world(sql)));
});

describe("A-Sink, stored error frames keep no machine folders", () => {
  it.effect.prop(
    "S1 [secrets]: every stored frame loses folders, including nested causes and encoded roots",
    { sample: frameCases },
    ({ sample }) =>
      Effect.gen(function* () {
        const { message } = yield* storedFrames(sample);

        for (const root of [
          sample.root,
          JSON.stringify(sample.root).slice(1, -1),
          encodeURI(sample.root),
          encodeURIComponent(sample.root),
        ]) {
          expect(message.includes(root), "stored content copied a generated root").toBe(false);
        }

        for (const line of message.split("\n").filter((line) => /^\s*at /.test(line))) {
          const frame = line.trim();
          const named = sample.slashed.find((name) => frame === `at ${name}` || frame.startsWith(`at ${name} (`));
          const location = named === undefined ? frame : frame.slice(`at ${named}`.length);
          const withoutNode = location.replace(/node:[^)]*/g, "");
          expect(withoutNode, "a stored frame names a folder").not.toMatch(/[/\\]/);
        }
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "S2: frame order, names, file positions and every non-frame byte survive",
    { sample: frameCases },
    ({ sample }) =>
      Effect.gen(function* () {
        const { pretty, message } = yield* storedFrames(sample);
        const before = pretty.split("\n");
        const after = message.split("\n");
        expect(after).toHaveLength(before.length);

        for (const [index, line] of before.entries()) {
          const frame = /^(\s*)at (.*)$/.exec(line);

          if (frame === null) {
            expect(after[index]).toBe(line);
            continue;
          }

          const generated = sample.frames.find(({ raw }) => raw === `at ${frame[2]}`);

          if (generated !== undefined) {
            expect(after[index]).toBe(`${frame[1]}${generated.kept}`);
          } else {
            // Effect.fn contributes its own real frame, beside the generated Error stacks.
            const own = /^(\s*at sink\.frames(?: \(definition\))? \().*[/\\]([^/\\]+:\d+:\d+\)(?: \{)?)$/.exec(line);
            expect(own, `unexpected Effect.fn frame: ${line}`).not.toBeNull();
            expect(after[index]).toBe(`${own?.[1]}${own?.[2]}`);
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});

const SECRET = "sk-p99-secret";
const NOTE = "note-body-p99";
const NOTE_TWO = "note-two-p99";
const a = (n: number) => "a".repeat(n);

class NoteError extends Error {
  override readonly name = "NoteError";
}

describe("p99, tags hold names, ids and numbers; a message only in content", () => {
  it.effect(
    "no Redacted text anywhere, and a throw's message only in content, never in a tag, measurements or R2",
    () =>
      Effect.gen(function* () {
        const h = yield* home;
        const r2 = bucket();
        const day = Date.UTC(2026, 9, 23, 10);
        yield* Effect.gen(function* () {
          yield* TestClock.setTime(day);
          const thrown = yield* Effect.exit(
            traced(
              "runner.step",
              { "fab.process": P1, "fab.key": Redacted.make(SECRET) },
              Effect.sync(() => {
                // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- the law is about a step that throws, as the plan's trace has it
                throw new TypeError(`${NOTE} was not a function`);
              }),
            ),
          );
          expect(Exit.isFailure(thrown)).toBe(true);
          yield* Effect.exit(
            traced("ledger.call", { "fab.process": P1 }, Effect.fail(new NoteError(`${NOTE_TWO} failed`))),
          );

          expect(places(h.db, NOTE), "before flush, only unsent's content holds the message").toEqual([
            "unsent.content",
          ]);
          expect(places(h.db, NOTE_TWO)).toEqual(["unsent.content"]);
          const measurements = h.db.prepare(`SELECT piece, ok, error FROM measurements ORDER BY piece`).all();
          expect(measurements.map((x) => [x["piece"], Boolean(x["ok"]), x["error"]])).toEqual([
            ["ledger.call", false, "NoteError"],
            ["runner.step", false, "TypeError"],
          ]);

          yield* flush;
          const rows = yield* recorded(job(P1));
          const failed = rows.find((x) => x.name === "runner.step");
          expect(failed?.ok).toBe(false);
          expect(failed?.attributes["fab.key"]).toBe("<redacted>");
          expect(failed?.attributes["error.type"]).toBe("TypeError");
          expect(rows.find((x) => x.name === "ledger.call")?.attributes["error.type"]).toBe("NoteError");

          for (const x of rows) {
            for (const value of Object.values(x.attributes)) {
              expect(String(value)).not.toContain(NOTE);
              expect(String(value)).not.toContain(NOTE_TWO);
            }
          }

          const content = yield* RecordManager.use((records) => records.content(job(P1), failed?.spanId ?? ""));
          expect(Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "").toContain(NOTE);

          // Two weeks on, the day's raw rows go to R2: they hold the class, never the message.
          yield* TestClock.setTime(day + 15 * 24 * 3_600_000);
          yield* step("runner.step", {});
          yield* flush;
          expect(r2.files.size, "the day was archived").toBeGreaterThan(0);

          for (const body of r2.files.values()) {
            const text = new TextDecoder().decode(body);
            expect(text).not.toContain(SECRET);
            expect(text).not.toContain(NOTE);
            expect(text).not.toContain(NOTE_TWO);
          }

          expect(places(h.db, NOTE), "the object keeps no message after flush").toEqual([]);

          for (const [name, db] of h.parts) {
            for (const place of [...places(db, NOTE), ...places(db, NOTE_TWO)]) {
              expect(place.startsWith("content."), `${name}: ${place}`).toBe(true);
            }
          }

          expect(h.bytes(SECRET), "no file holds the Redacted text, in any byte").toEqual([]);
        }).pipe(Effect.provide(world(h.sql, RecordManager.sql(h.part, BIG), Archive.bucket(r2.calls))));
      }),
  );

  it("every kept tag is a string of at most 128 characters, a number or a boolean; the rest is counted", async () => {
    const key = fc.constantFrom(...Array.from({ length: 8 }, (_, n) => `fab.k${n}`));
    const value = fc.oneof(
      fc.string({ maxLength: 400 }),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((x) => !Object.is(x, -0)),
      fc.boolean(),
      fc.string().map((text) => Redacted.make(`${SECRET}-${text}`)),
      fc.object({ maxDepth: 1 }),
      fc.array(fc.integer(), { maxLength: 3 }),
      fc.constant(null),
      fc.bigInt(),
    );
    await fc.assert(
      fc.asyncProperty(fc.dictionary(key, value, { maxKeys: 8 }), (tags) => {
        return Effect.runPromise(
          Effect.gen(function* () {
            const { sql } = yield* home;
            yield* Effect.gen(function* () {
              yield* step("runner.step", { "fab.process": P1, ...tags });
              yield* flush;
              const [row] = yield* recorded(job(P1));
              const kept = row?.attributes ?? {};
              let dropped = 0;

              for (const [k, v] of Object.entries(tags)) {
                if (typeof v === "string") {
                  if (v.length <= 128) {
                    expect(kept[k]).toBe(v);
                  } else {
                    expect(v.startsWith(String(kept[k]))).toBe(true);
                    expect(String(kept[k]).length).toBeLessThanOrEqual(128);
                    expect(kept[`${k}.length`]).toBe(v.length);
                  }
                } else if (typeof v === "number" || typeof v === "boolean") {
                  expect(kept[k]).toBe(v);
                } else if (Redacted.isRedacted(v)) {
                  expect(kept[k]).toBe("<redacted>");
                } else {
                  expect(k in kept, `${k} is dropped`).toBe(false);
                  dropped += 1;
                }
              }

              expect(kept["fab.sink.dropped"] ?? 0).toBe(dropped);

              for (const v of Object.values(kept)) {
                expect(["string", "number", "boolean"]).toContain(typeof v);

                if (typeof v === "string") {
                  expect(v.length).toBeLessThanOrEqual(128);
                  expect(v).not.toContain(SECRET);
                }
              }
            }).pipe(Effect.provide(world(sql)));
          }).pipe(Effect.scoped),
        );
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it.effect(
    "text past 128 is cut to 128, or to 127 when the cut would split a surrogate pair, with <key>.length beside",
    () =>
      Effect.gen(function* () {
        const { sql } = yield* home;
        yield* Effect.gen(function* () {
          yield* step("runner.step", {
            "fab.process": P1,
            "fab.fits": a(128),
            "fab.over": a(200),
            // A high surrogate at the 128th character: the pair would split, so the cut keeps 127.
            "fab.d800": `${a(127)}\u{10000}`,
            "fab.d83d": `${a(127)}😀`,
            "fab.dbff": `${a(127)}\u{10FFFF}`,
            // A low surrogate there ends a pair, and the characters next to the range are not one.
            "fab.low": `${a(126)}😀b`,
            "fab.d7ff": `${a(127)}퟿b`,
            "fab.e000": `${a(127)}b`,
          });
          yield* flush;
          const [row] = yield* recorded(job(P1));
          expect(row?.attributes).toEqual({
            "fab.process": P1,
            "fab.fits": a(128),
            "fab.over": a(128),
            "fab.over.length": 200,
            "fab.d800": a(127),
            "fab.d800.length": 129,
            "fab.d83d": a(127),
            "fab.d83d.length": 129,
            "fab.dbff": a(127),
            "fab.dbff.length": 129,
            "fab.low": `${a(126)}😀`,
            "fab.low.length": 129,
            "fab.d7ff": `${a(127)}퟿`,
            "fab.d7ff.length": 129,
            "fab.e000": `${a(127)}`,
            "fab.e000.length": 129,
          });
        }).pipe(Effect.provide(world(sql)));
      }),
  );

  it.effect("a row keeps its events' names, times and tags; a tag an event drops is counted", () =>
    Effect.gen(function* () {
      const { sql } = yield* home;
      yield* Effect.gen(function* () {
        yield* Effect.currentSpan.pipe(
          Effect.flatMap((span) =>
            Effect.sync(() => {
              span.event("cache.miss", 1_250_000_000n, { "fab.key": "k-1", "fab.bad": {} });
              span.event("cache.fill", 1_260_000_000n, { "fab.n": 3, "fab.worse": [1] });
            }),
          ),
          Effect.withSpan("runner.step", { attributes: { "fab.process": P1 } }),
        );
        yield* flush;
        const [row] = yield* recorded(job(P1));
        expect(row?.events).toEqual([
          { name: "cache.miss", timeUnixNano: "1250000000", attributes: { "fab.key": "k-1" } },
          { name: "cache.fill", timeUnixNano: "1260000000", attributes: { "fab.n": 3 } },
        ]);
        expect(row?.attributes, "the span's own tags drop nothing; its events drop two").toEqual({
          "fab.process": P1,
          "fab.sink.dropped": 2,
        });
      }).pipe(Effect.provide(world(sql)));
    }),
  );

  it.effect("a failure's text past 1,000,000 characters is cut there, with its full length after", () =>
    Effect.gen(function* () {
      const { sql } = yield* home;
      yield* Effect.gen(function* () {
        const exit = yield* Effect.exit(
          traced("runner.step", { "fab.process": P1 }, Effect.fail(new NoteError(a(1_100_000)))),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        yield* flush;
        const [row] = yield* recorded(job(P1));
        const content = yield* RecordManager.use((records) => records.content(job(P1), row?.spanId ?? ""));
        const message = Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "";
        const tail = /\n\[cut: (\d+) characters\]$/.exec(message);
        expect(tail, "the cut text ends with its full length").not.toBeNull();
        const full = Number(tail?.[1]);
        expect(full).toBeGreaterThan(1_100_000);
        expect(message.length).toBe(1_000_000 + (tail?.[0].length ?? 0));
        expect(message.slice(0, 1_000_000)).toContain(`NoteError: ${a(1000)}`);
      }).pipe(Effect.provide(world(sql)));
    }),
  );
});

// T705 (0037, 0046): the held and failed flags become one machine, and the public calls keep their
// behavior. The walk reads what the calls so far have done before it picks the next one (0093);
// the history it keeps is of spans ended, commits that landed and flushes tried, never the machine.
const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));
const Call = Schema.Struct({ pick: Nat, word: Schema.String.check(Schema.isMaxLength(64)) });

type Call = typeof Call.Type;
type Public = "end" | "end_fails" | "flush" | "summaries" | "summaries_fail";

/** What the calls so far did: spans held in memory, a failure no flush has reported yet, rows in
 *  `unsent`, and every span ended, by its `fab.n` and word. */
type Seen = {
  readonly held: ReadonlyArray<number>;
  readonly unreported: boolean;
  readonly unsent: number;
  readonly ended: ReadonlyArray<readonly [number, string]>;
};

/** Calls possible from here, weighted so held spans meet blocked flushes before and after a commit
 *  lands them, and a failure with nothing held meets both a commit and a flush. */
const callsFrom = (seen: Seen): ReadonlyArray<Public> => {
  if (seen.held.length > 0) {
    return ["flush", "end", "flush", "end_fails", "summaries", "summaries_fail", "end"];
  }

  if (seen.unreported) {
    return ["end", "flush", "summaries", "end_fails", "flush"];
  }

  return ["end_fails", "end", "flush", "summaries_fail", "end", "summaries"];
};

/** One walk's own object file, in a folder of its own, closed and removed when the walk's scope
 *  ends (0061), so 100 runs never hold 100 open files. */
const walkHome = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = mkdtempSync(join(tmpdir(), "t705-sink-"));
    const db = new DatabaseSync(join(dir, "object.db"));
    return { dir, db, sql: nodeSql(db) };
  }),
  ({ dir, db }) =>
    Effect.sync(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }),
);

describe("T705, the sink's public calls keep their order through one machine", () => {
  it.effect.prop(
    "calls match the transition table: end stays synchronous, a failed commit keeps every span " +
      "for its retry, and a blocked flush sends nothing",
    { calls: Arbitrary.array(Arbitrary.schema(Call), { minLength: 1, maxLength: 40 }) },
    ({ calls }) =>
      Effect.gen(function* () {
        const { db, sql: real } = yield* walkHome;
        const { sql, arm } = filling(real);
        yield* Effect.gen(function* () {
          const services = yield* Effect.context<SpanSink>();
          /** Ends one span outside any fiber: its rows are there the moment `runSync` returns. */
          const end = (n: number, word: string, fails: boolean) => {
            arm(fails ? 1 : 0);
            const exit = Effect.runSyncExit(
              step("runner.step", { "fab.n": n, "fab.word": word }).pipe(Effect.provideContext(services)),
            );
            arm(0);
            expect(Exit.isSuccess(exit), "end never fails the fiber").toBe(true);
          };
          const sent = () => recorded(spans).pipe(Effect.map((rows) => rows.length));
          end(-1, "warm", false);
          let seen: Seen = { held: [], unreported: false, unsent: 1, ended: [[-1, "warm"]] };

          for (const [n, { pick, word }] of calls.entries()) {
            const options = callsFrom(seen);
            const call = options[pick % options.length] ?? "flush";

            if (call === "end" || call === "end_fails") {
              end(n, word, call === "end_fails");
              const ended = [...seen.ended, [n, word] as const];
              seen =
                call === "end_fails"
                  ? { ...seen, held: [...seen.held, n], unreported: true, ended }
                  : { ...seen, held: [], unsent: seen.unsent + seen.held.length + 1, ended };
              expect(count(db, "unsent"), `unsent right after ${call}`).toBe(seen.unsent);
            } else if (call === "flush") {
              const before = yield* sent();
              const exit = yield* Effect.exit(flush);

              if (seen.held.length > 0 || seen.unreported) {
                expect(
                  Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit,
                  "a held span or an unreported failure blocks the flush",
                ).toEqual(new SinkError({ reason: "storage", held: seen.held.length }));
                expect(yield* sent(), "a blocked flush sends nothing").toBe(before);
                seen = { ...seen, unreported: false };
              } else {
                expect(Exit.isSuccess(exit) ? exit.value : Cause.squash(exit.cause)).toEqual({
                  sent: seen.unsent,
                });
                expect(yield* sent()).toBe(before + seen.unsent);
                seen = { ...seen, unsent: 0 };
              }

              expect(count(db, "unsent")).toBe(seen.unsent);
            } else {
              arm(call === "summaries_fail" ? 1 : 0);
              const exit = yield* Effect.exit(SpanSink.use((sink) => sink.summaries(0, 1)));
              arm(0);

              if (call === "summaries_fail") {
                expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit).toEqual(
                  new SinkError({ reason: "storage", held: seen.held.length }),
                );
                seen = { ...seen, unreported: true };
              } else {
                expect(Exit.isSuccess(exit), "a summaries commit lands the held spans").toBe(true);
                seen = { ...seen, held: [], unsent: seen.unsent + seen.held.length };
              }

              expect(count(db, "unsent")).toBe(seen.unsent);
            }
          }

          // Recovery: one more span lands every held one, and the flushes after it send them all.
          end(calls.length, "last", false);
          const owed = yield* Effect.exit(flush);
          expect(Exit.isFailure(owed), "only an unreported failure fails the flush after").toBe(seen.unreported);

          if (Exit.isFailure(owed)) {
            expect(Cause.squash(owed.cause)).toEqual(new SinkError({ reason: "storage", held: 0 }));
            yield* flush;
          }

          const rows = yield* recorded(spans);
          const byN = (x: readonly [number, string], y: readonly [number, string]) => x[0] - y[0];
          expect(
            rows.map((row) => [Number(row.attributes["fab.n"]), String(row.attributes["fab.word"])] as const).sort(byN),
            "every ended span reaches its record once, with its own payload",
          ).toEqual([...seen.ended, [calls.length, "last"] as const].sort(byN));
          expect(count(db, "unsent")).toBe(0);
        }).pipe(Effect.provide(world(sql)));
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// A-Sink S3 [secrets] (0186, ticket 502): the class that leaked into law 5's saved home. A typed
// failure, which the sink stores as its tag and reason, ended inside nested `Effect.fn` spans whose
// own frames carry folders and ` (definition)` markers. The expected frames come from the raw
// `Cause.pretty` of the same exit, cut here by this test's own reading, never by the sink's code.
const TypedInput = Schema.Struct({
  tag: Schema.String.check(Schema.isPattern(/^[A-Z][a-z]{2,12}Error$/)),
  reason: Schema.String.check(Schema.isPattern(/^[a-z][a-z ]{0,30}[a-z]$/)),
  // At most 5 levels: `Cause.pretty` prints 10 span frames, a call and a definition for each level.
  names: Schema.Array(FrameWord).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
});

/** The repo root, and the forms a stored text could copy it in: plain, JSON-escaped and as URLs. */
const repoRoot = join(import.meta.dirname, "..", "..", "..", "..", "..");

const rootForms = [
  repoRoot,
  JSON.stringify(repoRoot).slice(1, -1),
  encodeURI(repoRoot),
  encodeURIComponent(repoRoot),
  pathToFileURL(repoRoot).href,
];

/** A span frame of a generated `Effect.fn`, "at <span>[ (definition)] (<location>)", with its
 *  location cut to the last path segment by this test's own reading. */
const spanFrames = (text: string) =>
  text.split("\n").flatMap((line) => {
    const frame = /^\s*at (typed\.[a-z]+\.\d+(?: \(definition\))?) \((.*)\)(?: \{)?$/.exec(line);

    if (frame === null) {
      return [];
    }

    const location = frame[2] ?? "";
    return [`${frame[1]} (${location.slice(Math.max(location.lastIndexOf("/"), location.lastIndexOf("\\")) + 1)})`];
  });

describe("A-Sink S3, a typed failure through nested Effect.fn spans stores no machine folder", () => {
  it.effect.prop(
    "S3 [secrets]: no stored frame names a folder or the repo root, and every span frame keeps its name, file, line and column",
    { sample: Arbitrary.schema(TypedInput) },
    ({ sample }) =>
      Effect.gen(function* () {
        const { sql } = yield* walkHome;
        yield* Effect.gen(function* () {
          class Typed extends Schema.TaggedError<Typed>()(sample.tag, { reason: Schema.String }) {}
          const names = sample.names.map((name, depth) => `typed.${name}.${depth}`);
          const innermost = Effect.fn(names.at(-1) ?? "typed.none.0")(function* () {
            return yield* new Typed({ reason: sample.reason });
          });
          const outermost = names
            .slice(0, -1)
            .reduceRight<() => Effect.Effect<never, Typed>>((inner, name) => Effect.fn(name)(() => inner()), innermost);
          const exit = yield* Effect.exit(outermost());

          if (!Exit.isFailure(exit)) {
            return yield* Effect.die("expected the generated typed failure");
          }

          const expected = spanFrames(Cause.pretty(exit.cause));

          for (const name of names) {
            expect(expected.some((frame) => frame.startsWith(`${name} (`))).toBe(true);
          }

          yield* flush;
          const rows = (yield* recorded(spans)).filter((row) => names.includes(row.name));
          expect(rows).toHaveLength(names.length);

          for (const row of rows) {
            const content = yield* RecordManager.use((records) => records.content(spans, row.spanId));
            const message = Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "";
            expect(message.includes(sample.tag) && message.includes(sample.reason), "tag and reason are kept").toBe(
              true,
            );

            for (const form of rootForms) {
              expect(message.includes(form), `stored content copied the repo root: ${message}`).toBe(false);
            }

            for (const line of message.split("\n").filter((line) => /^\s*at /.test(line))) {
              expect(line.replace(/node:[^)]*/g, ""), "a stored frame names a folder").not.toMatch(/[/\\]/);
            }

            expect(spanFrames(message), "each span frame keeps its name, file, line and column").toEqual(expected);
          }
        }).pipe(Effect.provide(world(sql)));
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});
