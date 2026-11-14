// next/, p90 only. Keep the real entry and replace only its gateway's policy callback.
import { applyCell } from "@demlik/tea";
import { RecordedStart } from "@kampus/libfabrika";
import { Gateway } from "@kampus/libfabrika/gateway/Gateway";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { LedgerError } from "@kampus/libfabrika/ledger/Ledger";
import { Answer } from "@kampus/libfabrika/transport/Wire";
import { projectRuntime, settings, settingsWire } from "@kampus/libfabrika/workers/runtime";
import { Deferred, Effect, Layer, Predicate, Schema } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import { programs } from "virtual:fabrika-built";
import { Project as RealProject } from "../src/brain.ts";
import * as Hold from "./chaos-revoke.test-support.ts";

export { Connection, Control, IsolateTail, Process, RecordPart } from "../src/brain.ts";
// oxlint-disable-next-line import/no-default-export -- edge: the local runtime loads the real Worker's default fetch
export { default } from "../src/brain.ts";

const heldOwner = (ctx: Parameters<typeof projectRuntime>[0], env: Parameters<typeof projectRuntime>[1]) =>
  projectRuntime(ctx, env, {
    input: settings(env).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause }))),
    programs,
    bootstrap: [
      { name: "counter:1", id: "counter:1", program: "fabrika/counter" },
      { name: "checklist:1", id: "checklist:1", program: "fabrika/checklist" },
    ],
    door: (options) =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        let [model] = Hold.controller.init(null, {});
        const move = (msg: typeof Hold.Msg.Type) =>
          Effect.sync(() => {
            const previous = model;
            [model] = applyCell(Hold.controller, model, msg);
            return [previous, model] as const;
          });
        const checked = yield* RecordedStart;
        const config = { ...checked.input, port: checked.values.port };
        const rateLimit = { limit: checked.values.gatewayLimit, window: checked.values.gatewayWindow };
        const gateway = yield* Gateway.pipe(
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
              rateLimit,
              deliver: (pid, _envelope, _span, incoming) => options.deliver(pid, incoming),
              policy: Effect.fnUntraced(function* (pid: string) {
                const policy = yield* options.policy(pid);
                const [previous, next] = yield* move({ type: "arrive", process: pid });

                // Gateway.route calls policy only after online has checked this real connection.
                if (previous._tag === "armed" && next._tag === "held") {
                  yield* Deferred.await(release);
                }

                return policy;
              }),
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
                  Layer.provide(RateLimiterSql.layer(options.sql, { build: config.build, policy: rateLimit })),
                ),
              ),
            ),
          ),
        );
        return {
          ...gateway,
          route: (...[client, method, params, reader]: Parameters<typeof Gateway.Service.route>) => {
            // Only the private test control binding supplies this non-connection ID.
            if (String(client) !== "p90-control") {
              return gateway.route(client, method, params, reader);
            }

            return Effect.gen(function* () {
              if (method === "p90.arm") {
                const { process } = yield* Schema.decodeUnknownEffect(Schema.Struct({ process: Schema.String }))(
                  params,
                ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
                yield* move({ type: "arm", process });
              } else if (method === "p90.release") {
                yield* move({ type: "release" });
                yield* Deferred.succeed(release, undefined);
              }

              return Answer.cases.ok.make({ result: Schema.encodeSync(Hold.Model)(model) });
            });
          },
        };
      }),
  });

export class Project extends RealProject {
  override readonly owner = heldOwner(this.ctx, this.env);
  override readonly runtime = settingsWire(this.owner.contextEffect);
}
