/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
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
export const record = Effect.fnUntraced(function* (usage: ReadonlyArray<typeof Usage.Type>) {
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
