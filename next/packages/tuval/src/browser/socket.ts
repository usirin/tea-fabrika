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
import { ClientSocket, ClientSocketError, type SocketEvent } from "@kampus/libfabrika/transport/ClientSocket";
import { Effect, Layer, Queue, Result, Stream } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { errorClass } from "./index.ts";

/** Event handlers attach at construction, before any open or challenge can arrive. */
export const browserSocket = Layer.succeed(ClientSocket, {
  dial: Effect.fn("ClientSocket.dial")(function* (url: string) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    const events = yield* Queue.unbounded<SocketEvent>();
    yield* Effect.addFinalizer(() => Queue.shutdown(events));
    const socket = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const socket = new WebSocket(url);
          socket.onopen = () => Queue.offerUnsafe(events, { event: "open" });
          socket.onmessage = (event) => Queue.offerUnsafe(events, { event: "message", data: event.data });
          socket.onclose = (event) => Queue.offerUnsafe(events, { event: "close", code: event.code });
          return socket;
        },
        catch: (cause) => new ClientSocketError({ error: errorClass(cause) }),
      }),
      (socket) =>
        Effect.sync(() => {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onclose = null;
          socket.close();
        }),
    );
    return {
      events: Stream.fromQueue(events),
      send: (text: string): boolean => {
        if (socket.readyState !== WebSocket.OPEN) {
          return false;
        }

        return Result.isSuccess(Result.try({ try: () => socket.send(text), catch: () => "closed" }));
      },
      close: (code: number, reason?: string) => socket.close(code, reason),
    };
  }),
});
