import { isWorkerEvent } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { isolateTail } from "@kampus/libfabrika/workers";
import { Brain } from "@kampus/libfabrika/workers/objects";
import { RecordPartLive } from "@kampus/libfabrika/workers/record";
import type { FunctionContext } from "alchemy/Runtime/Function";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Effect } from "effect";
import { connectionObject } from "./runtime.ts";

export const Objects = Brain.make(
  { main: import.meta.url },
  Effect.gen(function* () {
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
  }).pipe(Effect.provide([RecordPartLive, connectionObject])),
);
