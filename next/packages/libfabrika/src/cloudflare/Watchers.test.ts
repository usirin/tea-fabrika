// next/, W5: Project route absence is evidence of departure; RPC failure is not.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema } from "effect";
import { nth } from "../runtime/RepliesTest.ts";
import { Publication, WatcherManager, WatcherManagerError } from "../runtime/WatcherManager.ts";
import type { Sql } from "../Sql.ts";
import * as Publish from "./Publish.ts";
import * as WatcherManagerRemote from "./WatcherManagerRemote.ts";

const Step = Arbitrary.all({
  pick: Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  client: Arbitrary.schema(Schema.NonEmptyString.check(Schema.isMaxLength(240))),
});

const Walk = Arbitrary.array(Step, { minLength: 6, maxLength: 30 });
const patch = { type: "patch", base: 4, rev: 5, patch: [] } as const;

describe("watcher delivery evidence, next/", () => {
  it.live.prop(
    "W5: only missing routes give gone; normal notify returns sent, including no socket",
    [Walk],
    ([steps]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const routes = new Map<string, string>();
          const delivered: Array<{ connection: string; client: string; news: unknown }> = [];
          let failSend = false;
          // Typed synchronous route port. No platform or Connection implementation is replaced here.
          const sql: Sql = {
            exec: (_query, client) => {
              const connection = routes.get(String(client));
              return connection === undefined ? [] : [{ connection }];
            },
            transaction: (f) => f(),
            size: () => 0,
          };
          const publish = Publish.make(sql, (connection: string, client: string, news: unknown) =>
            Effect.suspend(() => {
              if (failSend) {
                return Effect.fail(new Error("unknown send failure"));
              }

              delivered.push({ connection, client, news });
              // Deliberately no socket: Connection.notify's unchanged normal return is still sent.
              return Effect.void;
            }),
          );
          let rpc: "ok" | "throw" | "malformed" = "ok";
          const context = yield* Layer.build(
            WatcherManagerRemote.layer((client, update) =>
              Effect.suspend(() => {
                if (rpc === "throw") {
                  return Effect.fail(new Error("RPC unreachable"));
                }

                if (rpc === "malformed") {
                  return Effect.succeed({ unexpected: true });
                }

                return publish(client, update);
              }),
            ),
          );
          const remote = Context.get(context, WatcherManager);
          const reason = Effect.fnUntraced(function* (client: string) {
            const exit = yield* Effect.exit(remote.publish(client, patch));
            expect(Exit.isFailure(exit)).toBe(true);

            if (!Exit.isFailure(exit)) {
              return "unexpected success";
            }

            expect(Cause.hasFails(exit.cause)).toBe(true);
            const error = Schema.decodeUnknownSync(Schema.toType(WatcherManagerError))(Cause.squash(exit.cause));
            expect(error._tag).toBe("WatcherManagerError");
            expect(error.reason.cause).toBeDefined();
            return error.reason._tag;
          });

          for (const step of steps) {
            const held = [...routes.keys()];
            const client = held.length && step.pick % 2 ? nth(held, step.pick) : step.client;
            routes.delete(client);
            expect(yield* publish(client, patch)).toEqual(Publication.cases.gone.make({}));
            expect(yield* reason(client)).toBe("Gone");
            routes.set(client, `connection-${step.pick}`);
            delivered.length = 0;
            expect(yield* publish(client, patch)).toEqual(Publication.cases.sent.make({}));
            expect(delivered).toEqual([
              { connection: routes.get(client), client, news: { method: "view.patch", params: patch } },
            ]);
            yield* remote.publish(client, patch);
            failSend = true;
            expect(yield* reason(client)).toBe("Unreachable");
            failSend = false;

            for (const mode of ["throw", "malformed"] as const) {
              rpc = mode;
              expect(yield* reason(client)).toBe("Unreachable");
            }

            rpc = "ok";
            // Unknown failure of one route must not poison subsequent live delivery.
            yield* remote.publish(client, patch);

            // Waiting-room and close callers send raw notifications through the same route unchanged.
            for (const news of [{ method: "reinitialized", result: {} }, { method: "closed" }]) {
              delivered.length = 0;
              yield* publish(client, news);
              expect(delivered[0]?.news).toEqual(news);
            }
          }
        }),
      ),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
