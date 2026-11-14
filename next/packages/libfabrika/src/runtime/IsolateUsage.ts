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
 * Isolate call timings, attributed to the process whose load produced them.
 *
 * @stability stable
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ProcessId } from "../ProcessId.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const Millis = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isFinite());

/**
 * Schema for the execution methods kept in timing records.
 *
 * @stability stable
 * @category schemas
 */
export const Method = Schema.Literals([
  "describe",
  "init",
  "step",
  "fresh",
  "update",
  "audit",
  "fold",
  "upgrade",
  "reply",
  "admit",
  "check",
  "other",
]);

/**
 * Schema for platform outcomes, with unrecognized words recorded as `other`.
 *
 * @stability stable
 * @category schemas
 */
export const Outcome = Schema.Literals(["ok", "exception", "exceededCpu", "exceededMemory", "canceled", "other"]);

/**
 * Schema for one call's CPU and wall milliseconds. The process comes from its load.
 *
 * @stability stable
 * @category schemas
 */
export const Usage = Schema.Struct({
  process: ProcessId,
  method: Method,
  cpuMs: Millis,
  wallMs: Millis,
  outcome: Outcome,
});

/**
 * Records one CPU-duration span per call. The caller commits the batch together.
 *
 * @stability stable
 * @category combinators
 */
export const record = Effect.fnUntraced(function* (usage: ReadonlyArray<typeof Usage.Type>) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  for (const row of usage) {
    const span = yield* Effect.makeSpan("isolate.cpu", {
      attributes: {
        "fab.process": row.process,
        "fab.isolate.method": row.method,
        "fab.isolate.wall_ms": row.wallMs,
        "fab.isolate.outcome": row.outcome,
      },
    });
    span.end(span.status.startTime + BigInt(Math.round(row.cpuMs * 1_000_000)), Exit.void);
  }
});
