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
