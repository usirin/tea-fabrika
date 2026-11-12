// P34c Q9, next/. Real sink and SQL; the archive double only records external I/O.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import type { Sql } from "../Sql.ts";
import { Archive, sha256 } from "./Archive.ts";
import { RecordManager } from "./Records.ts";
import { SpanSink } from "./Sink.ts";
import { REFUSED, SumPoint } from "./Trace.ts";

export interface Store {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
}

const Refused = Schema.TaggedStruct("refused", { reason: Schema.Literal("quota") });

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

const Tape = Schema.Array(Schema.Struct({ pick: Nat, reopen: Schema.Boolean })).check(
  Schema.isMinLength(3),
  Schema.isMaxLength(25),
);

const counts = (sql: Sql) =>
  Object.fromEntries(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(({ name }) => [
        String(name),
        sql.exec(`SELECT count(*) AS n FROM "${String(name).replaceAll('"', '""')}"`)[0]?.n,
      ]),
  );

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P34c refusal storage", () => {
    it.effect.prop(
      "Q9 repeated refused batches keep ended children as hourly counts, never raw or archive rows",
      { tape: Tape },
      ({ tape }) =>
        Effect.gen(function* () {
          const store = yield* open;
          const shipped: Array<{ key: string; body: Uint8Array }> = [];
          const archive = Layer.succeed(Archive, {
            put: Effect.fnUntraced(function* (key, bytes) {
              shipped.push({ key, body: bytes });
              return { sha256: yield* sha256(bytes) };
            }),
          });
          const layer = () =>
            SpanSink.layer(store.sql, { object: "quota-project" }).pipe(
              Layer.provideMerge(Layer.merge(archive, RecordManager.memory(1_000_000_000))),
            );
          // Keep one sink alive while retrying so a growing held buffer cannot hide behind a new layer.
          let live = yield* Layer.build(layer());
          let baseline: ReturnType<typeof counts> | undefined;
          let attempts = 0;
          const expected = new Map<string, number>();
          yield* TestClock.setTime(1000);
          const run = Effect.fnUntraced(function* (pick: number) {
            const sink = yield* SpanSink;
            const child = pick % 2 === 0 ? "ledger.append" : "process.msg";
            const outcome = yield* sink.batch(
              Effect.gen(function* () {
                // The child has already ended when the enclosing operation learns the refusal.
                yield* Effect.void.pipe(
                  Effect.withSpan(child, { attributes: { "request.id": `discard-${attempts}` } }),
                );
                yield* Effect.annotateCurrentSpan(REFUSED, "other");
                return Refused.make({ reason: "quota" });
              }).pipe(Effect.withSpan("project.route")),
            );
            expect(outcome).toEqual(Refused.make({ reason: "quota" }));
            yield* sink.check;
            expected.set(child, (expected.get(child) ?? 0) + 1);
            expected.set("project.route", (expected.get("project.route") ?? 0) + 1);
          });

          for (const cell of tape) {
            // Keep the set of pieces fixed after the first attempt while varying retry order.
            yield* run(cell.pick % 2).pipe(Effect.provide(live));
            yield* run(1 - (cell.pick % 2)).pipe(Effect.provide(live));
            attempts += 2;
            const now = counts(store.sql);

            if (baseline === undefined) {
              baseline = now;
            } else {
              expect(now, "every table has the same number of rows as after one pair").toEqual(baseline);
            }

            if (cell.reopen) {
              yield* store.reopen;
              live = yield* Layer.build(layer());
            }

            yield* SpanSink.use((s) => s.flush).pipe(Effect.provide(live));
            expect(shipped, "refusal completion cannot trigger archive writes").toEqual([]);
          }

          yield* TestClock.setTime(3_600_001);
          yield* Effect.gen(function* () {
            const sink = yield* SpanSink;

            for (const [piece, count] of expected) {
              const points = yield* sink.sums(piece, 0, 3_600_000);
              expect(points).toEqual([SumPoint.make({ piece, hour: 0, refused: "other", count })]);
            }

            for (const table of ["unsent", "health"]) {
              const exists = store.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);

              if (exists.length > 0) {
                expect(store.sql.exec(`SELECT count(*) AS n FROM "${table}"`)[0]?.n).toBe(0);
              }
            }
          }).pipe(Effect.provide(live));
        }),
      { arbitrary: { seed: 119120, runs: 40 } },
    );
  });
