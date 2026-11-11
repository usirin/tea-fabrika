// The window's platform in a browser tab, next/ (Tier 1, P14). Only what the browser itself gives:
// one scoped native WebSocket per dial, the profile's key, and the client's own rows in IndexedDB.
// Each provides one of transport's contracts; the window consumes them and decides everything. P18
// keeps the shared socket for every platform; this is P14's one adapter.
import { ClientRows, ClientSocket, type SocketEvent } from "@kampus/libfabrika/transport/Services";
import { Effect, Layer, Queue, Stream } from "effect";
import { openDb, request, transaction } from "./key.ts";

export { browserKey } from "./key.ts";

/** The browser's `ClientSocket`: a native WebSocket whose events wait in a queue from the instant
 *  it exists, so the brain's first frame (its challenge) is never lost. It closes with its scope. */
export const browserSocket = Layer.succeed(ClientSocket, {
  dial: Effect.fnUntraced(function* (url: string) {
    const inbox = yield* Queue.unbounded<SocketEvent>();
    const ws = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const socket = new WebSocket(url);
        socket.addEventListener("open", () => Queue.offerUnsafe(inbox, { event: "open" }));
        socket.addEventListener("message", (e) => Queue.offerUnsafe(inbox, { event: "message", data: e.data }));
        socket.addEventListener("close", (e) => Queue.offerUnsafe(inbox, { event: "close", code: e.code }));
        return socket;
      }),
      (socket) => Effect.sync(() => socket.close(1000, "dial ended")),
    );
    return {
      events: Stream.fromQueue(inbox),
      send: (text: string) => {
        if (ws.readyState !== WebSocket.OPEN) {
          return false;
        }

        ws.send(text);
        return true;
      },
      close: (code: number, reason: string) => ws.close(code, reason),
    };
  }),
});

const ROWS_DB = "fabrika-rows";
const ROWS = "rows";

/** The browser's `ClientRows`: the client's unacknowledged rows in IndexedDB, by id, so a closed
 *  browser keeps them for the next one on the same profile. A put of an id that is there already
 *  replaces it with the same row. */
export const browserRows = Layer.sync(ClientRows, () => {
  let db: IDBDatabase | null = null;
  const opened = Effect.suspend(() =>
    db === null ? Effect.tap(openDb(ROWS_DB, ROWS), (d) => Effect.sync(() => (db = d))) : Effect.succeed(db),
  );
  return {
    put: (row: { readonly id: string }) =>
      Effect.flatMap(opened, (d) =>
        transaction(d, ROWS, (store) => {
          store.put(row, row.id);
          return () => undefined;
        }),
      ),
    all: Effect.flatMap(opened, (d) =>
      request<Array<unknown>>("read", () => d.transaction(ROWS, "readonly").objectStore(ROWS).getAll()),
    ),
    remove: (ids: ReadonlyArray<string>) =>
      Effect.flatMap(opened, (d) =>
        transaction(d, ROWS, (store) => {
          for (const id of ids) {
            store.delete(id);
          }

          return () => undefined;
        }),
      ),
  };
});
