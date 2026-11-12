/**
 * Worker Loader tail delivery. Only call metadata crosses into the Process object.
 *
 * @stability unstable
 */
import type { fromDurableObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { Worker } from "@alchemy.run/cloudflare/Workers/Worker";
import {
  getLoopbackEntrypoint,
  isWorkerEvent,
  WorkerExecutionContext,
} from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { errorClass } from "../telemetry/Trace.ts";
import { isolateUsage, ProcessClient, rejected } from "./platform.ts";
import { processStub, type Env } from "./runtime.ts";

/**
 * Schema for attribution fixed when a program isolate is loaded.
 *
 * @stability experimental
 * @category schemas
 */
export const Props = Schema.Struct({ project: Schema.String, name: Schema.String, process: Schema.String });

/**
 * Binds the tail to the name and process being loaded, including a successor.
 *
 * @stability unstable
 * @category constructors
 */
export const bind = Effect.fnUntraced(function* (
  ctx: Parameters<typeof fromDurableObjectState>[0],
  props: typeof Props.Type,
) {
  const tail = yield* getLoopbackEntrypoint(ctx.exports, "IsolateTail", { props });
  // The existing loader still takes native code options until its Alchemy port.
  return tail.raw;
});

/**
 * Sends one batch to its name's object. A failed delivery logs only the error class and is dropped.
 *
 * @stability unstable
 * @category combinators
 */
export const tail = Effect.fnUntraced(function* (
  env: Env,
  props: typeof Props.Type,
  items: Parameters<typeof isolateUsage>[1],
) {
  const work = Effect.gen(function* () {
    const rows = yield* isolateUsage(props.process, items);
    const stub = processStub(env, props.project, props.name);
    yield* ProcessClient.make(stub).usage(rows);
  });
  yield* work.pipe(Effect.catchCause((cause) => Effect.logError(errorClass(rejected(Cause.squash(cause))))));
});

/**
 * Runs the platform tail callback using its load-bound props.
 *
 * @stability unstable
 * @category combinators
 */
export const receive = (env: Env, props: unknown, items: Parameters<typeof tail>[2]) =>
  Schema.decodeUnknownEffect(Props)(props).pipe(Effect.flatMap((checked) => tail(env, checked, items)));

class TailWorker extends Worker<TailWorker, Record<never, never>>()("IsolateTail") {}

/**
 * Alchemy handles the platform callback and supplies the invocation's props.
 *
 * @stability unstable
 * @category layers
 */
export const layer = TailWorker.make(
  { main: import.meta.url },
  Effect.gen(function* () {
    const worker = yield* Worker;
    yield* worker.listen((event) => {
      if (isWorkerEvent(event) && event.type === "tail") {
        return Effect.gen(function* () {
          const ctx = yield* WorkerExecutionContext;
          return yield* receive(event.env, yield* ctx.props, event.input);
        }).pipe(Effect.catchCause((cause) => Effect.logError(errorClass(rejected(Cause.squash(cause))))));
      }
    });
    return {};
  }),
);
