// T843, next/. The driver owner supplies a scoped persistent Sql and its reopen operation (0062).
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Layer, Option, Schema, type Scope } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import { TestClock } from "effect/testing";
import type { Sql } from "../Sql.ts";
import * as RateLimiterSql from "./RateLimiterSql.ts";

export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };
export type Rig = { readonly open: Effect.Effect<Store, never, Scope.Scope> };
const positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }));
const cell = Schema.Struct({ pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })) });
const trace = Schema.Array(cell).check(Schema.isMinLength(30), Schema.isMaxLength(80));

const layer = (sql: Sql, policy: { limit: number; window: number }) =>
  RateLimiter.layer.pipe(Layer.provide(RateLimiterSql.layer(sql, { build: "t843-test", policy })));

const consume = (sql: Sql, key: string, policy: { limit: number; window: number }) =>
  RateLimiter.RateLimiter.use((limiter) =>
    limiter.consume({ key, ...policy, algorithm: "fixed-window", onExceeded: "fail" }),
  ).pipe(Effect.provide(layer(sql, policy)));

const failedWrites = (sql: Sql, cause: Error): Sql => ({
  ...sql,
  exec: (query, ...params) => {
    if (/INSERT|UPDATE/u.test(query) && query.includes("gateway_limits")) {
      throw cause;
    }

    return sql.exec(query, ...params);
  },
});

/** Run the saved-budget laws on the supplied driver. No platform imports enter this module. */
export const suite = (rig: Rig): void => {
  describe("T843 saved sender budget", () => {
    it.effect.prop(
      "T843 atomic store: every counter read and change shares one synchronous transaction (50 runs)",
      { limit: positive },
      ({ limit }) =>
        Effect.gen(function* () {
          const { sql } = yield* rig.open;
          const events: Array<"begin" | "end" | "read" | "write"> = [];
          const observed: Sql = {
            ...sql,
            transaction: (step) => {
              events.push("begin");
              const result = sql.transaction(step);
              events.push("end");
              return result;
            },
            exec: (query, ...params) => {
              if (query.includes("gateway_limits") && /SELECT/iu.test(query)) {
                events.push("read");
              }

              if (query.includes("gateway_limits") && /INSERT|UPDATE|DELETE/iu.test(query)) {
                events.push("write");
              }

              return sql.exec(query, ...params);
            },
          };

          for (let n = 0; n <= limit; n++) {
            yield* Effect.exit(consume(observed, "same-key", { limit, window: 1000 }));
          }

          expect(events).toContain("read");
          expect(events).toContain("write");
          let depth = 0;

          for (const event of events) {
            if (event === "begin") {
              depth++;
            } else if (event === "end") {
              depth--;
            } else {
              expect(depth).toBeGreaterThan(0);
            }
          }

          expect(depth).toBe(0);
        }),
      { arbitrary: { seed: 119120, runs: 50 } },
    );

    it.effect.prop(
      "T843 store: reopen, expired senders, skipped windows and policy changes match history (50 runs)",
      { limit: positive, window: positive, choices: trace },
      ({ limit, window, choices }) =>
        Effect.gen(function* () {
          const store = yield* rig.open;
          const history = new Map<string, { times: Array<number>; until: number; at: number; policy: string }>();
          let now = 100;
          let policy = { limit, window: window * 100 };

          for (const { pick } of choices) {
            const known = [...history.keys()];
            const sender =
              known.length && pick % 3 === 0
                ? Option.getOrThrow(Option.fromUndefinedOr(known[pick % known.length]))
                : `key-${pick % 4}`;
            const saved = history.get(sender);
            const moves = ["take", "same", "reopen", "skip", "change", ...(saved ? ["back", "expiry"] : [])];
            const move = Option.getOrThrow(Option.fromUndefinedOr(moves[pick % moves.length]));

            if (move === "reopen") {
              yield* store.reopen;
            }

            if (move === "skip") {
              now += policy.window * 3;
            }

            if (move === "back" && saved) {
              now = saved.at - 1;
            }

            if (move === "expiry" && saved) {
              now = saved.until;
            }

            if (move === "change") {
              policy = { limit: (policy.limit % 8) + 1, window: policy.window + 100 };
            }

            yield* TestClock.setTime(now);

            for (const [key, row] of history) {
              if (row.until <= now) {
                history.delete(key);
              }
            }

            const old = history.get(sender);
            const same = old?.policy === JSON.stringify(policy);
            const at = old ? Math.max(now, old.at) : now;
            const row =
              old && same
                ? old
                : {
                    times: [],
                    until: (Math.floor(at / policy.window) + 1) * policy.window,
                    at,
                    policy: JSON.stringify(policy),
                  };
            const allowed = row.times.length < policy.limit;
            const result = yield* Effect.exit(consume(store.sql, sender, policy));
            expect(Exit.isSuccess(result)).toBe(allowed);

            if (Exit.isSuccess(result)) {
              row.times.push(at);
              expect(result.value.remaining).toBe(policy.limit - row.times.length);
              expect(Duration.toMillis(result.value.resetAfter)).toBe(row.until - at);
            } else {
              const error = yield* Effect.flip(consume(store.sql, sender, policy));
              expect(error.reason._tag).toBe("RateLimitExceeded");

              if (error.reason._tag === "RateLimitExceeded") {
                expect(Duration.toMillis(error.reason.retryAfter)).toBe(row.until - at);
              }
            }

            row.at = at;
            history.set(sender, row);
            const rows = store.sql.exec("SELECT sender,until,value FROM gateway_limits");
            expect(rows).toHaveLength(history.size);
            expect(rows.length).toBeLessThanOrEqual(4);
            expect(new Set(rows.map((r) => r.sender)).size).toBe(rows.length);

            for (const r of rows) {
              const envelope = JSON.parse(String(r.value));
              expect(envelope.v).toBe(1);
              expect(envelope.build).toBe("t843-test");
              expect(String(r.value)).not.toContain("request");
            }
          }
        }),
      { arbitrary: { seed: 119120, runs: 50 } },
    );

    it.effect.prop(
      "T843 store failure: bad versions, corrupt state and counter write failures retain causes and never grant (50 runs)",
      {
        failure: Schema.Literals([
          "write",
          "{",
          '{"v":99,"build":"t843-test","model":{"_tag":"fresh"}}',
          '{"v":1,"build":"t843-test","model":{"_tag":"open","used":-1}}',
        ]),
      },
      ({ failure }) =>
        Effect.gen(function* () {
          const { sql } = yield* rig.open;
          const policy = { limit: 2, window: 1000 };
          yield* consume(sql, "key", policy);
          const cause = new Error("t843 counter write failed");
          const broken = failure === "write" ? failedWrites(sql, cause) : sql;

          if (failure !== "write") {
            sql.exec("UPDATE gateway_limits SET value=? WHERE sender=?", failure, "key");
          }

          const before = sql.exec("SELECT sender,until,value FROM gateway_limits");
          const result = yield* Effect.flip(consume(broken, "key", policy));
          expect(result.reason._tag).toBe("RateLimitStoreError");
          expect(result.reason).toHaveProperty("cause");
          expect(sql.exec("SELECT sender,until,value FROM gateway_limits")).toEqual(before);

          if (failure === "write" && result.reason._tag === "RateLimitStoreError") {
            expect(result.reason.cause).toBe(cause);
          }
        }),
      { arbitrary: { seed: 119120, runs: 50 } },
    );
  });
};
