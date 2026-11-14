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
import { type Decision, Policy } from "./RateLimit.ts";

const Saved = Schema.Struct({
  v: Schema.Literal(1),
  build: Schema.NonEmptyString,
  model: Rate.Model.check(Schema.makeFilter((s) => s._tag !== "fresh")),
});

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Saved));
const encode = Schema.encodeSync(Schema.fromJsonString(Saved));

const fail = (cause: unknown) =>
  new RateLimiter.RateLimiterError({
    reason: new RateLimiter.RateLimitStoreError({ message: "Gateway budget storage failed", cause }),
  });

const unsupported = Effect.fail(fail(new Error("Unsupported gateway budget operation")));

/**
 * Takes one attempt from a sender's fixed-window budget in `table`, in one transaction, and answers
 * the decision. A budget that cannot be decided throws its cause, and the transaction rolls back.
 *
 * @stability unstable
 * @category combinators
 */
export const take = (
  sql: Sql,
  options: {
    readonly table: "gateway_limits" | "gateway_draft_limits";
    readonly key: string;
    readonly at: number;
    readonly policy: Policy;
    readonly build: string;
  },
): typeof Decision.cases.allowed.Type | typeof Decision.cases.refused.Type =>
  sql.transaction(() => {
    const { table, key, at, policy, build } = options;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (sender TEXT PRIMARY KEY, until INTEGER NOT NULL, value TEXT NOT NULL)`,
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS ${table}_until ON ${table}(until)`);
    sql.exec(`DELETE FROM ${table} WHERE until<=?`, at);
    const row = sql.exec(`SELECT until,value FROM ${table} WHERE sender=?`, key)[0];
    const model = row === undefined ? Rate.machine.init(null, {})[0] : decode(row.value).model;
    const [next, commands] = applyCell<
      typeof Rate.Model.Type,
      typeof Rate.machine.msg.Type,
      ReturnType<typeof Rate.machine.init>[1][number]
    >(Rate.machine, model, { type: "take", at, policy });
    const command = commands[0];

    if (command === undefined) {
      return Schema.decodeUnknownSync(Schema.Never)(next);
    }

    const decision = command.decision;

    if (decision._tag === "invalid") {
      // A synchronous transaction rolls back by throwing; the caller keeps the cause.
      throw decision.cause;
    }

    if (next._tag === "fresh") {
      return Schema.decodeUnknownSync(Schema.Never)(next);
    }

    sql.exec(
      `INSERT INTO ${table} (sender,until,value) VALUES (?,?,?) ON CONFLICT(sender) DO UPDATE SET until=excluded.until,value=excluded.value`,
      key,
      next.until,
      encode({ v: 1, build, model: next }),
    );
    return decision;
  });

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
        try: () => {
          const decision = take(sql, { table: "gateway_limits", key: request.key, at, policy, build });
          return decision._tag === "allowed"
            ? ([decision.count, decision.ttl] as const)
            : ([policy.limit + 1, decision.retryAfter] as const);
        },
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
