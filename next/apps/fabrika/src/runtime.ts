/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { RecordedStart } from "@kampus/libfabrika";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { LedgerError } from "@kampus/libfabrika/ledger/Ledger";
import { connectionRuntime as connection } from "@kampus/libfabrika/workers/gateway";
import {
  projectRuntime as project,
  settings as readSettings,
  type Env as Bindings,
} from "@kampus/libfabrika/workers/runtime";
import { Effect, Layer, Predicate, Schema } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { programs } from "virtual:fabrika-built";
import { Gateway } from "./door.ts";

export { projectJobsLayer } from "@kampus/libfabrika/workers/runtime";

export interface Env extends Bindings {
  readonly INSTANCE: string;
}

const checkedSettings = (env: Pick<Env, "INSTANCE">) =>
  readSettings(env).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));

export const settings = Effect.fn("instance.settings")(function* (env: Pick<Env, "INSTANCE">) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const checked = yield* checkedSettings(env);
  return { ...checked.input, ...checked.input.founding, port: checked.values.port };
});

export const connectionRuntime = (ctx: DurableObjectState, env: Env) =>
  connection(ctx, env, undefined, checkedSettings(env));

export const projectRuntime = (ctx: DurableObjectState, env: Env) =>
  project(ctx, env, {
    input: checkedSettings(env),
    programs,
    // The program is the core pack's `fabrika/counter`; its registered name stays `counter:1`.
    bootstrap: [
      { name: "counter:1", id: "counter:1", program: "fabrika/counter" },
      { name: "checklist:1", id: "checklist:1", program: "fabrika/checklist" },
    ],
    door: (options) =>
      Effect.gen(function* () {
        const checked = yield* RecordedStart;
        const config = {
          ...checked.input,
          port: checked.values.port,
          rateLimit: { limit: checked.values.gatewayLimit, window: checked.values.gatewayWindow },
        };
        return yield* Gateway.pipe(
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
                  Layer.provide(RateLimiterSql.layer(options.sql, { build: config.build, policy: config.rateLimit })),
                ),
              ),
            ),
          ),
        );
      }),
  });
