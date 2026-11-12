// next/, 0140. The real sink on SQLite, through SpanSink's public calls.
// node:sqlite is the edge: Effect has no synchronous in-memory SQLite handle.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import { Archive } from "../Archive.ts";
import { RecordManager } from "../Records.ts";
import { SpanSink } from "../Sink.ts";

const HOUR = 3_600_000;
const H = 1_790_002_800_000;
const TAG = "fab.gateway.refused";
const PIECE = "gateway.route";

const database = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

const world = (db: DatabaseSync) =>
  Layer.mergeAll(
    SpanSink.layer(nodeSql(db), { object: "test-object" }),
    RecordManager.memory(1024 ** 3),
    Archive.memory,
  );

describe("0140 sums", () => {
  it.effect.prop(
    "tagged spans count in place, off-list values become other, and untagged spans still save",
    {
      values: Schema.Array(Schema.Union([Schema.Literal("reserved"), Schema.Json, Schema.Undefined])).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(40),
      ),
    },
    ({ values }) =>
      Effect.gen(function* () {
        const db = yield* database;
        yield* Effect.gen(function* () {
          yield* TestClock.setTime(H - 1);
          // Ending, rather than starting, in H assigns the count to H.
          yield* TestClock.adjust(2).pipe(Effect.withSpan(PIECE, { attributes: { [TAG]: "reserved" } }));
          const expected = new Map<string, number>([["reserved", 1]]);

          for (const value of values) {
            yield* Effect.void.pipe(Effect.withSpan(PIECE, { attributes: { [TAG]: value } }));
            const bucket = value === "reserved" ? "reserved" : "other";
            expected.set(bucket, (expected.get(bucket) ?? 0) + 1);
          }

          expect(db.prepare("SELECT * FROM unsent").all()).toEqual([]);
          expect(db.prepare("SELECT * FROM measurements").all()).toEqual([]);
          const rows = db.prepare("SELECT piece,hour,refused,count FROM sums ORDER BY refused").all();
          expect(rows.map((row) => ({ ...row }))).toEqual(
            [...expected]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([refused, count]) => ({ piece: PIECE, hour: H, refused, count })),
          );
          const sink = yield* SpanSink;
          expect(yield* sink.sums(PIECE, H - HOUR, H + HOUR)).toEqual([]);
          expect(yield* sink.flush).toEqual({ sent: 0 });
          expect(yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })))).toEqual([]);
          yield* Effect.void.pipe(Effect.withSpan(PIECE));
          expect(db.prepare("SELECT * FROM unsent").all()).toHaveLength(1);
          expect(db.prepare("SELECT * FROM measurements WHERE piece=?").all(PIECE)).toHaveLength(1);
          yield* sink.flush;
          const kept = yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })));
          expect(kept.map((row) => row.name)).toEqual([PIECE]);
          yield* TestClock.setTime(H + HOUR);
          expect(yield* sink.sums(PIECE, H, H + HOUR)).toEqual(
            [...expected]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([refused, count]) => ({ _tag: "sum", piece: PIECE, hour: H, refused, count })),
          );
          expect(yield* sink.sums("runtime.rpc", H, H + HOUR)).toEqual([]);
        }).pipe(Effect.provide(world(db)));
      }),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
