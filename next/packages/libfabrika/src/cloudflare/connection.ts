import { Cause, Clock, Context, Effect, Layer, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Waited } from "../ledger/Log.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { errorClass, REFUSED } from "../telemetry/Trace.ts";
import { connection } from "../transport/Connection.ts";
import { Answer, Attached, Hello } from "../transport/Wire.ts";
import type { ConnectionId } from "./bindings.ts";
import { cloudflareSql } from "./CloudflareSql.ts";
import { ProjectClient, rejected } from "./platform.ts";
import {
  complete,
  projectStub,
  recordedLayer,
  recordingLayer,
  rpc,
  SettingsRuntime,
  type BrainOptions,
  type Env,
  type ProjectOptions,
} from "./runtime.ts";

const gatewayLogic = Effect.fnUntraced(function* (ctx: DurableObjectState, env: Env) {
  const checked = yield* RecordedStart;
  const port = checked.values.port;
  const config = checked.input;
  const p = ProjectClient.make(projectStub(env, config.name)),
    ids = yield* ProcessIdGenerator;
  const gateway = yield* Schema.decodeUnknownEffect(Schema.String)(ctx.id.name).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  const recording = yield* Layer.build(
    recordingLayer(cloudflareSql(ctx.storage), env, config.name, `connection:${gateway}`),
  ).pipe(Effect.provideService(RecordedStart, checked));
  const recorded = <A, E>(work: Effect.Effect<A, E>) => complete(work).pipe(Effect.provideContext(recording));
  yield* recorded(Effect.void);
  const connections = new Map<WebSocket, ReturnType<typeof connection>>();
  const attached = Effect.fnUntraced(function* (ws: WebSocket) {
    return yield* Schema.decodeUnknownEffect(Attached)(ws.deserializeAttachment()).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
  });
  const make = Effect.fnUntraced(function* (ws: WebSocket) {
    const [session, tab, key] = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([Schema.String, Schema.String, Schema.String]),
    )(ctx.getTags(ws)).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    const c = connection({
      reader: gateway,
      session,
      read: () => attached(ws),
      save: (a) => ws.serializeAttachment(a),
      send: (text) => ws.send(text),
      close: (code) => ws.close(code, "reconnect"),
      ping: () => ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
      wait: Effect.fnUntraced(function* (stream, after, reader) {
        const state = yield* attached(ws);
        const answer = yield* rpc(p.route(state.client as ConnectionId, "ledger.wait", { stream, after }, reader));

        if (answer._tag === "parked") {
          return Waited.cases.parked.make({});
        }

        if (answer._tag !== "ok") {
          return yield* Effect.fail(answer);
        }

        const ready = yield* Schema.decodeUnknownEffect(Schema.Struct({ rev: Schema.Int }))(answer.result).pipe(
          Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
        );
        return Waited.cases.ready.make(ready);
      }),
      call: Effect.fnUntraced(
        function* (method, params) {
          const client = (yield* attached(ws)).client as ConnectionId;

          if (method === "initialize") {
            const hello = Schema.decodeUnknownResult(Hello)(params);
            const result = yield* rpc(
              p.initialize(client, params, {
                url: `http://127.0.0.1:${port}`,
                tab,
                name: key,
              }),
            );

            if (result._tag === "refused") {
              if (Result.isSuccess(hello)) {
                ws.serializeAttachment(
                  Attached.cases.waiting.make({
                    client,
                    key: hello.success.key,
                    hello: hello.success,
                    nonce: hello.success.nonce,
                  }),
                );
              }

              return result;
            }

            ws.serializeAttachment(
              Attached.cases.online.make({
                client,
                identity: result.identity,
                version: result.version,
                waits: [],
                watching: false,
                busy: false,
              }),
            );
            const at = yield* Clock.currentTimeMillis;
            yield* rpc(p.join({ client, key: result.identity.key, gateway, session, at }));
            return Answer.cases.ok.make({
              result: { identity: result.identity, version: result.version, ping: result.ping },
            });
          }

          if (method === "gateway.knock") {
            const input = yield* Schema.decodeUnknownEffect(Schema.Struct({ label: Schema.String }))(params).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            );
            const result = yield* rpc(p.knock(client, input));

            if (result._tag === "ok") {
              const waiting = yield* Schema.decodeUnknownEffect(
                Schema.Struct({ code: Schema.String, until: Schema.Number }),
              )(result.result).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
              yield* rpc(p.publish(client, { method: "gateway.waiting", params: waiting }));
              return Answer.cases.ok.make({ result: waiting });
            }

            return result;
          }

          return yield* rpc(
            p
              .route(client, method, params)
              .pipe(
                Effect.tap((answer) =>
                  answer._tag === "refused" && answer.reason === "reserved"
                    ? Effect.annotateCurrentSpan(REFUSED, "reserved")
                    : Effect.void,
                ),
              ),
          );
        },
        // A failed or defective call still answers its request without exposing error details. It is
        // kept on a failed span, as runner.throw does: `error.type` names the class that was thrown, and
        // the span fails with the typed error, so stored content keeps its tag and reason, never the
        // thrown text, which may hold a bearer or a raw frame.
        Effect.catchCause((cause) => {
          const failure = Cause.squash(cause);
          return Effect.exit(
            Effect.fail(failure).pipe(
              Effect.withSpan("gateway.refused", { attributes: { "error.type": errorClass(rejected(failure)) } }),
            ),
          ).pipe(Effect.as(Answer.cases.refused.make({ reason: "unreachable" })));
        }),
      ),
    });
    connections.set(ws, c);
    return c;
  });
  const connected = Effect.fnUntraced(function* (ws: WebSocket) {
    return connections.get(ws) ?? (yield* make(ws));
  });
  const close = Effect.fn("connection.close")(function* (ws: WebSocket) {
    const state = yield* attached(ws),
      [session] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(
        ctx.getTags(ws),
      ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    yield* rpc(p.leave(state.client, session));
    yield* rpc(p.disconnect(state.client as ConnectionId));
    connections.delete(ws);
  });
  const ring = Effect.fn("connection.ring")(function* (stream: string, rev: number) {
    for (const ws of ctx.getWebSockets()) {
      if ((yield* attached(ws))._tag === "online") {
        yield* (yield* connected(ws)).ring(stream, rev);
      }
    }
  });
  const probe = Effect.fn("connection.probe")(function* (session: string) {
    for (const ws of ctx.getWebSockets(session)) {
      if ((yield* attached(ws))._tag === "online") {
        return yield* (yield* connected(ws)).probe(session);
      }
    }

    return yield* new LedgerError({ reason: "unreachable" });
  });
  const notify = Effect.fn("connection.notify")(function* (client: string, news: unknown) {
    for (const ws of ctx.getWebSockets()) {
      if ((yield* attached(ws)).client === client) {
        yield* Effect.try({
          try: () => {
            if (typeof news === "object" && news !== null && "close" in news && typeof news.close === "number") {
              ws.close(news.close, "permission changed");
            } else {
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  ...(typeof news === "object" && news !== null ? news : {}),
                }),
              );
            }
          },
          catch: (cause) => new LedgerError({ reason: "unreachable", cause }),
        });
      }
    }
  });

  for (const ws of ctx.getWebSockets()) {
    const work = (yield* make(ws)).wake();
    yield* (yield* attached(ws))._tag === "online" ? recorded(work) : work;
  }

  return {
    fetch: Effect.fnUntraced(function* (request: Request) {
      const path = new URL(request.url).pathname.split("/");

      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const segments = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String]))(
        path.slice(2, 4),
      ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
      const [key, tab] = yield* Effect.try({
        try: () => [decodeURIComponent(segments[0]), decodeURIComponent(segments[1])] as const,
        catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
      });
      const client = yield* rpc(p.clientConnect()),
        nonce = yield* rpc(p.challenge(client)),
        session = yield* ids.next;
      const pair = new WebSocketPair(),
        server = pair[1];
      ctx.acceptWebSocket(server, [session, tab, key]);
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
      server.serializeAttachment(Attached.cases.new.make({ client, nonce }));
      yield* rpc(p.register(client, gateway, session));
      yield* make(server);
      server.send(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce } }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }),
    message: Effect.fnUntraced(function* (ws: WebSocket, text: string | ArrayBuffer) {
      const state = yield* attached(ws);

      if (typeof text !== "string") {
        return;
      }

      const work = (yield* connected(ws)).frame(text);
      yield* state._tag === "online" ? recorded(work) : work;
    }),
    close: Effect.fnUntraced(function* (ws: WebSocket) {
      return yield* (yield* attached(ws))._tag === "online" ? recorded(close(ws)) : close(ws);
    }),
    ring: (stream: string, rev: number) => recorded(ring(stream, rev)),
    probe: (session: string) => recorded(probe(session)),
    notify: Effect.fnUntraced(function* (client: string, news: unknown) {
      const states = yield* Effect.forEach(ctx.getWebSockets(), attached, { concurrency: 1 });
      const online = states.some((state) => state.client === client && state._tag === "online");
      return yield* online ? recorded(notify(client, news)) : notify(client, news);
    }),
  };
});

export class ConnectionService extends Context.Service<
  ConnectionService,
  Effect.Success<ReturnType<typeof gatewayLogic>>
>()("@kampus/libfabrika/cloudflare/connection.ConnectionService") {}

export const connectionLayer = (
  ctx: DurableObjectState,
  env: Env,
  _config?: BrainOptions,
  input?: ProjectOptions["input"],
) =>
  Layer.effect(ConnectionService, gatewayLogic(ctx, env)).pipe(
    Layer.provide(ProcessIdGenerator.layer),
    Layer.provide(input === undefined ? recordedLayer(env) : recordedLayer(env, input)),
  );

export const connectionRuntime = (
  ctx: DurableObjectState,
  env: Env,
  config?: BrainOptions,
  input?: ProjectOptions["input"],
) => SettingsRuntime.runtime(connectionLayer(ctx, env, config, input));
