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
import { isWorkerEvent } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { isolateTail } from "@kampus/libfabrika/workers";
import { Brain } from "@kampus/libfabrika/workers/objects";
import { RecordPartLive } from "@kampus/libfabrika/workers/record";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import type { FunctionContext } from "alchemy/Runtime/Function";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Effect } from "effect";

export const Objects = Brain.make(
  { main: import.meta.url },
  Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    // edge: Alchemy's Main types fetch only; its Worker runtime also supports tail listeners.
    const context = (yield* RuntimeContext) as FunctionContext;
    yield* context.listen((event) => {
      if (!isWorkerEvent(event) || event.type !== "tail") {
        return;
      }

      return isolateTail(event.input);
    });
    yield* Effect.logDebug("isolate.tail listener registered");
    return {};
  }).pipe(Effect.provide(RecordPartLive)),
);
