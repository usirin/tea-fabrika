/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
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

class Ping extends Cloudflare.DurableObject<Ping, PingShape>()("Ping") {}
class Pong extends Cloudflare.DurableObject<Pong, PongShape>()("Pong") {}
export class Host extends Cloudflare.Worker<Host, Record<never, never>, Ping | Pong>()("SiblingHost") {}

const PingLive = Ping.make(
  Effect.gen(function* () {
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
