import { ClientRows, ClientRowsError } from "@kampus/libfabrika/transport/ClientRows";
import { Effect, Layer } from "effect";
import { errorClass } from "./index.ts";

/** Each row names its tab. Nothing is delivered or removed in this slice. */
export const browserRows = Layer.succeed(ClientRows, {
  put: Effect.fn("ClientRows.put")(function* (row) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.callback<IDBDatabase, ClientRowsError>((resume) => {
            try {
              const request = indexedDB.open("fabrika-rows", 1);
              request.onupgradeneeded = () => request.result.createObjectStore("rows", { keyPath: "id" });
              request.onsuccess = () => resume(Effect.succeed(request.result));
              request.onerror = () =>
                resume(Effect.fail(new ClientRowsError({ op: "open", error: errorClass(request.error) })));
              request.onblocked = () => {
                request.onsuccess = () => request.result.close();
                resume(Effect.fail(new ClientRowsError({ op: "open", error: "InvalidStateError" })));
              };
            } catch (cause) {
              resume(Effect.fail(new ClientRowsError({ op: "open", error: errorClass(cause) })));
            }
          }),
          (db) => Effect.sync(() => db.close()),
        );
        yield* Effect.callback<void, ClientRowsError>((resume) => {
          try {
            const tx = db.transaction("rows", "readwrite");
            tx.objectStore("rows").put(row);
            tx.oncomplete = () => resume(Effect.void);
            tx.onerror = tx.onabort = () =>
              resume(Effect.fail(new ClientRowsError({ op: "write", error: errorClass(tx.error) })));
            return Effect.sync(() => {
              try {
                tx.abort();
              } catch {
                /* Already committed. */
              }
            });
          } catch (cause) {
            resume(Effect.fail(new ClientRowsError({ op: "write", error: errorClass(cause) })));
          }
        });
      }),
    );
  }),
});
