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
