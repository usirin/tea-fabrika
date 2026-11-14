/**
 * The Connection object's Layer: Alchemy's Effect object around `ConnectionService`.
 *
 * @stability unstable
 */
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { DurableObjectState as ObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Effect } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { connectionLayer, ConnectionService } from "./connection.ts";
import { Connection, type ConnectionShape } from "./objects.ts";
import * as ObjectService from "./ObjectService.ts";
import type { Env, ProjectOptions } from "./runtime.ts";

type Service = (typeof ConnectionService)["Service"];

/** Keeps a `LedgerError` as the call's own failure. Any other failure dies, so the caller sees a
 *  rejected call with the thrown class and text, as it did when the class ran a Promise. */
const called = <A, E>(call: Effect.Effect<A, E>): Effect.Effect<A, LedgerError> =>
  call.pipe(
    Effect.catch((error): Effect.Effect<never, LedgerError> =>
      error instanceof LedgerError ? Effect.fail(error) : Effect.die(error),
    ),
  );

/** The platform's own socket inside Alchemy's wrapper, which the service keys its connections by:
 *  Alchemy wraps it anew for each event. Alchemy names the socket by the types package's module
 *  and the service by the ambient type, so the socket is checked here and not asserted. */
const platformSocket = (socket: Cloudflare.WebSocket): Effect.Effect<WebSocket> =>
  socket.ws instanceof WebSocket
    ? Effect.succeed(socket.ws)
    : Effect.die(new TypeError("The socket of a socket event is not the platform's WebSocket"));

/**
 * Layer that provides the Connection object: it takes what the platform gives an instance and
 * hands every slot and call to `ConnectionService`.
 *
 * **Details**
 *
 * `input` reads the instance's checked settings from the Worker's bindings. The service is built
 * on the first slot or call that reaches the instance, and a failed build is tried again on the
 * next one. The Layer starts no timer and no fiber, so an idle instance sleeps.
 *
 * A socket slot has no failure type, so a failure there dies and the platform sees a rejected
 * event. A call fails with a `LedgerError` as itself, and any other failure of a call dies too.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (options: {
  readonly input: (env: Pick<Env, "INSTANCE">) => NonNullable<ProjectOptions["input"]>;
}) =>
  Connection.make(
    Effect.gen(function* () {
      const state = yield* ObjectState;
      const env = yield* WorkerEnvironment;
      const bindings: Env = {
        INSTANCE: env.INSTANCE,
        PROJECT: env.PROJECT,
        PROCESS: env.PROCESS,
        CONNECTION: env.CONNECTION,
        RECORD: env.RECORD,
        LOADER: env.LOADER,
        MEASUREMENTS: env.MEASUREMENTS,
      };
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: raw state until S5 and S6; not reported, 0042 amendment 2026-11-09
      const raw = state.raw as unknown as DurableObjectState;
      const service = ObjectService.make(
        ConnectionService,
        connectionLayer(raw, bindings, undefined, options.input(bindings)),
      );
      const event = (
        socket: Cloudflare.WebSocket,
        slot: (gateway: Service, ws: WebSocket) => Effect.Effect<void, unknown>,
      ) =>
        service.pipe(
          Effect.flatMap((gateway) => platformSocket(socket).pipe(Effect.flatMap((ws) => slot(gateway, ws)))),
          Effect.orDie,
        );

      return Effect.succeed({
        fetch: ObjectService.fromWebHandler((request) =>
          service.pipe(Effect.flatMap((gateway) => gateway.fetch(request))),
        ),
        webSocketMessage: (socket, text) => event(socket, (gateway, ws) => gateway.message(ws, text)),
        webSocketClose: (socket, code) => event(socket, (gateway, ws) => gateway.close(ws, code)),
        webSocketError: (socket) => event(socket, (gateway, ws) => gateway.close(ws)),
        ring: (stream, rev) => called(service.pipe(Effect.flatMap((gateway) => gateway.ring(stream, rev)))),
        notify: (client, news) => called(service.pipe(Effect.flatMap((gateway) => gateway.notify(client, news)))),
        probe: (session) => called(service.pipe(Effect.flatMap((gateway) => gateway.probe(session)))),
      } satisfies ConnectionShape);
    }),
  );
