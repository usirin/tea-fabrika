// Experiment 285, next/. One Effect Worker and one Effect Durable Object, for the questions about
// `fetch`, `ctx.props`, the control branch and the cost of a call. Throwaway probe code: it follows
// the shape of `next/apps/fabrika/src/sibling-objects.test-support.ts`.
//
// Node imports this file to plan the stack, so it names no `cloudflare:*` module.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
import { Cause, Effect, Layer } from "effect";
import { HttpBody, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Turn, TurnLive } from "./turn.ts";

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

/** The plain service an object hands to, as `ConnectionService` is on main: raw Request in, raw Response out. */
const service = (state: { readonly acceptWebSocket: (socket: never, tags: Array<string>) => void }) => ({
  fetch: (request: Request) =>
    Effect.promise(async () => {
      if (request.headers.get("upgrade") === "websocket") {
        const pair = new WebSocketPair();
        state.acceptWebSocket(pair[1] as never, ["raw"]);
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
      }

      const body = request.method === "POST" ? await request.text() : "";
      return new Response(`${request.method} ${new URL(request.url).pathname} ${body}`, {
        status: 207,
        headers: { "x-raw": "yes" },
      });
    }),
});

/** A raw platform Response as the answer of Alchemy's request slot. */
const raw = (response: Response) =>
  HttpServerResponse.setBody(HttpServerResponse.empty({ status: response.status }), HttpBody.raw(response));

/** The plan's `handed`: the request slot gives the raw Request to the service and returns its raw Response. */
const handed = (fetch: (request: Request) => Effect.Effect<Response>) =>
  Cloudflare.Request.pipe(Effect.flatMap(fetch), Effect.map(raw));

interface EchoShape {
  readonly echo: (n: number) => Effect.Effect<number>;
  readonly born: () => Effect.Effect<number>;
  readonly fetch: NonNullable<Cloudflare.DurableObjectShape["fetch"]>;
  readonly webSocketMessage: NonNullable<Cloudflare.DurableObjectShape["webSocketMessage"]>;
}

export class Echo extends Cloudflare.DurableObject<Echo, EchoShape>()("Echo") {}
export class Probe extends Cloudflare.Worker<Probe, Record<never, never>, Echo | Turn>()("Probe285") {}

export const EchoLive = Echo.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const plain = service(state.raw as never);
    const born = Date.now();
    return Effect.succeed({
      echo: (n: number) => Effect.succeed(n + 1),
      born: () => Effect.succeed(born),
      fetch: handed(plain.fetch),
      // socket.ws is the platform's own socket inside Alchemy's wrapper.
      webSocketMessage: (socket, message) =>
        Effect.sync(() => socket.ws.send(`echo ${typeof message === "string" ? message : "bytes"}`)),
    } satisfies EchoShape);
  }),
);

const text = (body: unknown, status = 200) => HttpServerResponse.json(body, { status });

/** What the control socket's caller may ask. A stand-in for `control()` in libfabrika. */
const control = (path: string, bearer: string | undefined, token: string) =>
  bearer === `Bearer ${token}`
    ? text({ branch: "control", path })
    : text({ branch: "control", refused: "bearer" }, 401);

export default Probe.make(
  {
    main: import.meta.url,
    dev: { host: "127.0.0.1" },
    compatibility: { date: "2026-10-12" },
  },
  Effect.gen(function* () {
    const ctx = yield* Cloudflare.WorkerExecutionContext; // init: a reference only
    const env = yield* Cloudflare.WorkerEnvironment;
    const echoes = yield* Echo.from(Probe);
    const turns = yield* Turn.from(Probe);
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://probe");
        const props = yield* ctx.props; // an empty object for a request from outside

        // The control branch: taken only when the caller's binding carried a token.
        if (typeof props.token === "string") {
          return yield* control(url.pathname, request.headers.authorization, props.token);
        }

        if (url.pathname === "/props") {
          return yield* text({ branch: "door", props, keys: Object.keys(props) });
        }

        if (url.pathname === "/mint") {
          // Code inside the Worker can make a stub of itself that carries props. Nothing outside can.
          const mint = ctx.exports.default;

          if (mint === undefined) {
            return yield* text({ minted: "no default export to mint from" }, 500);
          }

          const self = yield* mint({ props: { token: "minted" } });
          const reply = yield* Effect.promise(() =>
            self.raw.fetch("http://self/anything", { headers: { authorization: "Bearer minted" } }),
          );
          return yield* text({ minted: yield* Effect.promise(() => reply.json()) });
        }

        if (url.pathname === "/calls") {
          // n calls to one object, one after another, by one of three callers.
          const name = url.searchParams.get("name") ?? "one";
          const way = url.searchParams.get("way") ?? "sibling";
          const n = Number(url.searchParams.get("n") ?? "0");
          const callers: Record<string, (i: number) => Effect.Effect<number, unknown>> = {
            // Today: a Promise stub to a plain class, wrapped where the client calls it.
            plain: (i) => Effect.tryPromise(() => env.PLAIN.getByName(name).echo(i) as Promise<number>),
            // After S1: the same binding through Alchemy's stub, to the bridge class.
            stub: (i) => makeRpcStub<EchoShape>(env.Echo.getByName(name)).echo(i),
            // After S4: the sibling taken in init, to the bridge class.
            sibling: (i) => echoes.getByName(name).echo(i),
          };
          const caller = callers[way];

          if (caller === undefined) {
            return yield* text({ unknown: way }, 400);
          }

          let last = 0;

          for (let i = 0; i < n; i++) {
            last = yield* caller(i);
          }

          return yield* text({ way, n, last });
        }

        if (url.pathname.startsWith("/object/")) {
          // The raw request goes on to the object's own request slot.
          return yield* echoes.getByName("one").fetch(request);
        }

        if (url.pathname.startsWith("/turn/")) {
          const turn = turns.getByName(url.searchParams.get("name") ?? "one");
          const body = request.method === "POST" ? yield* request.json : null;
          return yield* text(yield* turn.run(url.pathname.slice("/turn/".length), body));
        }

        return yield* text({ branch: "door", path: url.pathname }, 404);
      }).pipe(
        Effect.catchCause((cause) => Effect.succeed(HttpServerResponse.text(Cause.pretty(cause), { status: 500 }))),
      ),
    };
  }).pipe(Effect.provide(Layer.mergeAll(EchoLive, TurnLive))),
);
