import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { LedgerError } from "@kampus/libfabrika/ledger/Ledger";
import { connectionLayer } from "@kampus/libfabrika/workers/gateway";
import { projectLayer, type Env as Bindings } from "@kampus/libfabrika/workers/runtime";
import { Effect, Layer, ManagedRuntime, Predicate, Schema } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import { programs } from "virtual:fabrika-built";
import { Gateway } from "./door.ts";
import { Settings } from "./settings.ts";

export { projectJobsLayer } from "@kampus/libfabrika/workers/runtime";

export interface Env extends Bindings {
  readonly INSTANCE: string;
}

// Strict: the boot struct holds host rights (`starts`), so a field it does not name is refused.
export const settings = Effect.fn("instance.settings")(function* (env: Env) {
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Settings), { onExcessProperty: "error" })(
    env.INSTANCE,
  ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
});

export const connectionRuntime = (ctx: DurableObjectState, env: Env) =>
  ManagedRuntime.make(Layer.unwrap(settings(env).pipe(Effect.map((config) => connectionLayer(ctx, env, config)))));

export const projectRuntime = (ctx: DurableObjectState, env: Env) =>
  ManagedRuntime.make(
    Layer.unwrap(
      settings(env).pipe(
        Effect.map((config) =>
          projectLayer(ctx, env, {
            config,
            ...(config.mail === undefined ? {} : { mail: config.mail }),
            programs,
            // The program is the core pack's `fabrika/counter`; its registered name stays `counter:1`.
            bootstrap: { name: "counter:1", id: "counter:1", program: "fabrika/counter" },
            // The app grants no start until a program needs one; a local instance's caller may.
            starts: config.starts ?? [],
            door: (options) =>
              Gateway.pipe(
                Effect.provide(
                  Gateway.layer({
                    ...options,
                    name: ctx.id.name ?? config.name,
                    url: `http://127.0.0.1:${config.port}`,
                    origins: [`http://127.0.0.1:${config.port}`],
                    location: "local",
                    build: config.build,
                    versions: [1],
                    waiting: { most: 64, ttl: 600_000 },
                    ping: { min: 30_000, max: 75_000 },
                    inputCap: 1_000_000,
                    spentCap: 100_000,
                    rateLimit: config.rateLimit,
                    deliver: (pid, _envelope, _span, incoming) => options.deliver(pid, incoming),
                    inputs: {
                      schema: Schema.Json,
                      raw: [],
                      personOnly: [],
                      name: (m) =>
                        Predicate.isObjectOrArray(m) && Predicate.hasProperty(m, "type") && Predicate.isString(m.type)
                          ? m.type
                          : undefined,
                    },
                    events: { personOnly: [] },
                  }).pipe(
                    Layer.provide(
                      RateLimiter.layer.pipe(
                        Layer.provide(
                          RateLimiterSql.layer(options.sql, { build: config.build, policy: config.rateLimit }),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          }),
        ),
      ),
    ),
  );
