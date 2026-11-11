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
