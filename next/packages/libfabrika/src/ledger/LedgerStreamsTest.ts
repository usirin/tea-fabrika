// T714, next/. A5 uses the real ledger and discovery layer, with the driver's scope owned above us.
// Page, wildcard-prefix and error-cause plant trials are recorded in the tests-step report.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Schema, type Scope, Stream } from "effect";
import type { Sql } from "../Sql.ts";
import { Doorbell, Ledger } from "./Ledger.ts";
import * as LedgerSql from "./LedgerSql.ts";
import { LedgerStreams, LedgerStreamsError, Storage } from "./LedgerStreams.ts";
import * as LedgerStreamsSql from "./LedgerStreamsSql.ts";
import { Line, lineFor, PAGE } from "./Log.ts";

export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  it.effect(
    "A5: discovery pages distinct names in order and treats SQL wildcard prefixes literally",
    () =>
      Effect.gen(function* () {
        const seen = new Set<string>();
        const tape = Schema.Struct({
          body: Line.fields.body,
          traceId: Line.fields.traceId,
          prefix: Schema.Literals(["job:", "job:%", "job:_", "job:\\", "job:é"]),
          total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(PAGE + 1), Schema.isLessThanOrEqualTo(PAGE * 2 + 3)),
          cells: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).check(
            Schema.isMinLength(6),
            Schema.isMaxLength(16),
          ),
        });
        const law = Effect.fnUntraced(function* (a: typeof tape.Type) {
          const store = yield* open;
          const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
          const layers = () =>
            Layer.mergeAll(
              LedgerSql.layer(store.sql, { reader: "discovery-law" }),
              LedgerStreamsSql.layer(store.sql),
            ).pipe(Layer.provide(quiet));
          let life = yield* Layer.build(layers());
          const names = new Set<string>();
          let sequence = 0;
          const append = Effect.fnUntraced(function* (stream: string, id: string) {
            // Discovery needs valid entries; parent checks and writer encoding have their own laws.
            const line = lineFor(
              {
                by: "discovery",
                for: "discovery",
                sentAt: "",
                seen: 0,
                parent: null,
                traceId: a.traceId,
                build: "test",
              },
              Schema.TaggedStruct("discovery", { value: Line.fields.body }).make({ value: a.body }),
            );
            const answer = yield* Ledger.use((l) => l.append(stream, id, line)).pipe(Effect.provide(life));
            expect(answer._tag).toBe("placed");
            names.add(stream);
          });

          for (let n = 0; n < a.total; n++) {
            yield* append(`${a.prefix}${String(n).padStart(5, "0")}`, "first");
            yield* append(`job:X${n}`, "neighbor");
          }

          for (const choice of a.cells) {
            const known = [...names];

            if (choice % 3 === 0) {
              yield* store.reopen;
              life = yield* Layer.build(layers());
              seen.add("reopen");
            } else if (choice % 3 === 1) {
              yield* append(
                known[choice % known.length] ?? expect.fail("a seeded stream exists"),
                `duplicate-${sequence++}`,
              );
              seen.add("duplicate");
            }

            const actual = yield* LedgerStreams.use((s) => Stream.runCollect(s.list(a.prefix))).pipe(
              Effect.provide(life),
            );
            const expected = [...names].filter((name) => name.startsWith(a.prefix)).sort();
            expect([...actual]).toEqual(expected);
            expect(new Set(actual).size).toBe(actual.length);
            seen.add(a.prefix);
          }
        });
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.schema(tape),
          (a) =>
            Effect.scoped(law(a)).pipe(
              Effect.as(true),
              Effect.catchCause((cause) => Effect.fail(cause)),
            ),
          { seed: 119120, runs: 60, concurrency: 1 },
        );
        expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");

        for (const reached of ["reopen", "duplicate", "job:%", "job:_", "job:\\", "job:é"]) {
          expect(seen).toContain(reached);
        }
      }),
    120_000,
  );

  it.effect.prop(
    "A13: discovery translates a driver failure into its own error and preserves the cause",
    { text: Schema.String },
    ({ text }) =>
      Effect.gen(function* () {
        const failure = new Error(text);
        const sql: Sql = {
          exec: () => {
            // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: a synchronous database driver throws
            throw failure;
          },
          transaction: () => {
            // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: a synchronous database driver throws
            throw failure;
          },
          size: () => 0,
        };
        const result = yield* LedgerStreams.use((s) => Stream.runCollect(s.list("job:"))).pipe(
          Effect.provide(LedgerStreamsSql.layer(sql)),
          Effect.result,
        );
        expect(result._tag).toBe("Failure");

        if (result._tag === "Failure") {
          expect(result.failure).toBeInstanceOf(LedgerStreamsError);
          expect(result.failure.reason).toBeInstanceOf(Storage);
          expect(result.failure.reason.cause).toBe(failure);
        }
      }),
    { arbitrary: { seed: 119120, runs: 60 } },
  );
};
