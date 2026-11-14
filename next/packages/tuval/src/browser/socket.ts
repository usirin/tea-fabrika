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
import { ClientSocket, ClientSocketError, type SocketEvent } from "@kampus/libfabrika/transport/ClientSocket";
import { Effect, Layer, Queue, Result, Stream } from "effect";
import { errorClass } from "./index.ts";

/** Event handlers attach at construction, before any open or challenge can arrive. */
export const browserSocket = Layer.succeed(ClientSocket, {
  dial: Effect.fn("ClientSocket.dial")(function* (url: string) {
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
