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
/**
 * Worker Loader tail delivery. Only call metadata crosses into the Process object.
 *
 * @stability unstable
 */
import {
  getLoopbackEntrypoint,
  WorkerEnvironment,
  WorkerExecutionContext,
} from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { errorClass } from "../telemetry/Trace.ts";
import { isolateUsage, ProcessClient, rejected } from "./platform.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { processStub, type Env } from "./runtime.ts";

/**
 * Schema for attribution fixed when a program isolate is loaded.
 *
 * @stability stable
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
  ctx: { readonly exports: Parameters<typeof getLoopbackEntrypoint>[0] },
  props: typeof Props.Type,
) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
  env: Pick<Env, "PROCESS">,
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
export const receive = (env: Pick<Env, "PROCESS">, props: unknown, items: Parameters<typeof tail>[2]) =>
  Schema.decodeUnknownEffect(Props)(props).pipe(Effect.flatMap((checked) => tail(env, checked, items)));

/**
 * Reads each tail invocation's props and bindings from Alchemy's live services.
 *
 * @stability unstable
 * @category combinators
 */
export const callback = Effect.fnUntraced(
  function* (items: Parameters<typeof tail>[2]) {
    yield* Effect.logDebug("isolate.tail received", { events: items.length });
    const env = yield* WorkerEnvironment;
    const ctx = yield* WorkerExecutionContext;
    yield* receive({ PROCESS: env.PROCESS }, yield* ctx.props, items);
  },
  Effect.catchCause((cause) => Effect.logError(errorClass(rejected(Cause.squash(cause))))),
);
