/**
 * Isolate call timings, attributed to the process whose load produced them.
 *
 * @stability experimental
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ProcessId } from "../ProcessId.ts";
import { SpanSink } from "../telemetry/Sink.ts";

const Millis = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isFinite());

/**
 * Schema for the execution methods kept in timing records.
 *
 * @stability experimental
 * @category schemas
 */
export const Method = Schema.Literals([
  "describe",
  "init",
  "step",
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
 * @stability experimental
 * @category schemas
 */
export const Outcome = Schema.Literals(["ok", "exception", "exceededCpu", "exceededMemory", "canceled", "other"]);

/**
 * Schema for one call's CPU and wall milliseconds. The process comes from its load.
 *
 * @stability experimental
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
 * Records one CPU-duration span per call, committing the batch together when a sink is installed.
 *
 * @stability experimental
 * @category combinators
 */
export const record = Effect.fnUntraced(function* (usage: ReadonlyArray<typeof Usage.Type>) {
  const work = Effect.gen(function* () {
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
  const sink = yield* Effect.serviceOption(SpanSink);
  yield* Option.isSome(sink) ? sink.value.batch(work) : work;
});
