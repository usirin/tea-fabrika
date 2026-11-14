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
// T502 PR 2, next/. Test fixtures only; both namespaces are taken in Layer init.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Cause, Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/http";

interface Reply {
  readonly path: ReadonlyArray<string>;
  readonly n: number;
}

interface PingShape {
  readonly hit: (n: number) => Effect.Effect<Reply>;
  readonly leaf: (n: number) => Effect.Effect<Reply>;
}

interface PongShape {
  readonly back: (n: number) => Effect.Effect<Reply>;
}

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
class Ping extends Cloudflare.DurableObject<Ping, PingShape>()("Ping") {}
class Pong extends Cloudflare.DurableObject<Pong, PongShape>()("Pong") {}
export class Host extends Cloudflare.Worker<Host, Record<never, never>, Ping | Pong>()("SiblingHost") {}

const PingLive = Ping.make(
  Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    const pongs = yield* Pong.from(Host);
    return Effect.succeed({
      hit: Effect.fnUntraced(function* (n: number) {
        // Plant replaces the following call with a bare lookup inside this method.
        const reply = yield* pongs.getByName("one").back(n + 1);
        return { path: ["ping.hit", ...reply.path], n: reply.n };
      }),
      leaf: (n: number) => Effect.succeed({ path: ["ping.leaf"], n: n + 1 }),
    });
  }),
);

const PongLive = Pong.make(
  Effect.gen(function* () {
    const pings = yield* Ping.from(Host);
    return Effect.succeed({
      back: Effect.fnUntraced(function* (n: number) {
        const reply = yield* pings.getByName("one").leaf(n + 1);
        return { path: ["pong.back", ...reply.path], n: reply.n };
      }),
    });
  }),
);

// oxlint-disable-next-line import/no-default-export -- edge: Alchemy runs this Worker from main: import.meta.url, and workerd loads a Worker by its default export (0058)
export default Host.make(
  {
    main: import.meta.url,
    dev: { host: "127.0.0.1", port: Number(process.env.T502_PORT), strictPort: true },
    compatibility: { date: "2026-10-12" },
  },
  Effect.gen(function* () {
    const pings = yield* Ping.from(Host);
    return {
      fetch: Effect.gen(function* () {
        const reply = yield* pings.getByName("one").hit(0);
        return yield* HttpServerResponse.json(reply);
      }).pipe(
        Effect.catchCause((cause) => Effect.succeed(HttpServerResponse.text(Cause.pretty(cause), { status: 500 }))),
      ),
    };
  }).pipe(Effect.provide(Layer.mergeAll(PingLive, PongLive))),
);
