/**
 * Effect's rate-limit store backed by the Project's shared Sql.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as Schema from "effect/Schema";
import type { Sql } from "../Sql.ts";
import * as Rate from "./internal/rateLimit.ts";
import { Policy } from "./RateLimit.ts";

const Saved = Schema.Struct({
  v: Schema.Literal(1),
  build: Schema.NonEmptyString,
  model: Rate.machine.model.check(Schema.makeFilter((s) => s._tag !== "fresh")),
});

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Saved));
const encode = Schema.encodeSync(Schema.fromJsonString(Saved));

const fail = (cause: unknown) =>
  new RateLimiter.RateLimiterError({
    reason: new RateLimiter.RateLimitStoreError({ message: "Gateway budget storage failed", cause }),
  });

const unsupported = Effect.fail(fail(new Error("Unsupported gateway budget operation")));

const make = (sql: Sql, options: { readonly build: string; readonly policy: Policy }) => {
  const checked = Schema.decodeUnknownResult(Policy)(options.policy);
  const build = options.build;
  return RateLimiter.RateLimiterStore.of({
    fixedWindow: Effect.fnUntraced(function* (
      request: Parameters<(typeof RateLimiter.RateLimiterStore)["Service"]["fixedWindow"]>[0],
    ) {
      const policy = yield* Effect.fromResult(checked).pipe(Effect.mapError(fail));

      if (
        request.tokens !== 1 ||
        request.limit !== policy.limit ||
        !Duration.equals(request.refillRate, Duration.divideUnsafe(Duration.millis(policy.window), policy.limit))
      ) {
        return yield* unsupported;
      }

      const at = yield* Clock.currentTimeMillis;
      return yield* Effect.try({
        try: () =>
          sql.transaction(() => {
            sql.exec(
              "CREATE TABLE IF NOT EXISTS gateway_limits (sender TEXT PRIMARY KEY, until INTEGER NOT NULL, value TEXT NOT NULL)",
            );
            sql.exec("CREATE INDEX IF NOT EXISTS gateway_limits_until ON gateway_limits(until)");
            sql.exec("DELETE FROM gateway_limits WHERE until<=?", at);
            const row = sql.exec("SELECT until,value FROM gateway_limits WHERE sender=?", request.key)[0];
            const model = row === undefined ? Rate.machine.init(null, {})[0] : decode(row.value).model;
            const [next, commands] = applyCell(Rate.machine, model, { type: "take", at, policy });
            const command = commands[0];

            if (command === undefined) {
              return Schema.decodeUnknownSync(Schema.Never)(next);
            }

            const decision = command.decision;

            if (decision._tag === "invalid") {
              // A synchronous transaction rolls back by throwing; Effect.try below keeps the cause.
              throw decision.cause;
            }

            if (next._tag === "fresh") {
              return Schema.decodeUnknownSync(Schema.Never)(next);
            }

            sql.exec(
              "INSERT INTO gateway_limits (sender,until,value) VALUES (?,?,?) ON CONFLICT(sender) DO UPDATE SET until=excluded.until,value=excluded.value",
              request.key,
              next.until,
              encode({ v: 1, build, model: next }),
            );
            return decision._tag === "allowed"
              ? ([decision.count, decision.ttl] as const)
              : ([policy.limit + 1, decision.retryAfter] as const);
          }),
        catch: fail,
      });
    }),
    tokenBucket: () => unsupported,
    adaptiveConsume: () => unsupported,
    adaptiveFeedback: () => unsupported,
  });
};

/**
 * Supplies Effect's fixed-window store from the Project's shared synchronous Sql.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (
  sql: Sql,
  options: { readonly build: string; readonly policy: Policy },
): Layer.Layer<RateLimiter.RateLimiterStore> => Layer.succeed(RateLimiter.RateLimiterStore, make(sql, options));
