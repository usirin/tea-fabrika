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
import { ClientRows, ClientRowsError } from "@kampus/libfabrika/transport/ClientRows";
import { Effect, Layer } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { errorClass } from "./index.ts";

/** Each row names its tab. Nothing is delivered or removed in this slice. */
export const browserRows = Layer.succeed(ClientRows, {
  put: Effect.fn("ClientRows.put")(function* (row) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
