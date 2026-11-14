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
 * The events of a local brain's life, as the driver that runs the brain on a laptop records them.
 *
 * @stability unstable
 */
import { Schema } from "effect";

const Life = {
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  at: Schema.Number,
};

const Reason = Schema.Literals(["open", "crash", "memory", "core"]);

const Exit = {
  exitCode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  signal: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bytes: Schema.optionalKey(Schema.Int),
  backoff: Schema.optionalKey(Schema.Number),
};

/**
 * Schema for one event in a local brain's life: `started`, `exited`, `restarting`, `braked` or
 * `stopped`.
 *
 * **Details**
 *
 * Every case carries its own `id`, the `start` it belongs to, and `at`, the driver's clock when it
 * happened. A `started` also names the start it came `after`, its build and its OS `pid`. The exit
 * fields (`exitCode`, `signal`, `bytes`, `backoff`) are there when the driver knows them. The
 * project appends each event to the `gateway/brain` stream under its `id`.
 *
 * @stability unstable
 * @category schemas
 */
export const BrainEvent = Schema.TaggedUnion({
  started: {
    ...Life,
    after: Schema.NullOr(Schema.String),
    build: Schema.String,
    reason: Reason,
    pid: Schema.Int,
    ...Exit,
  },
  exited: { ...Life, reason: Reason, ...Exit },
  restarting: { ...Life, reason: Reason, ...Exit, backoff: Schema.Number },
  braked: { ...Life, reason: Schema.Literals(["intensity", "restart_failed"]), ...Exit },
  stopped: { ...Life, reason: Schema.Literal("stop"), ...Exit },
});
