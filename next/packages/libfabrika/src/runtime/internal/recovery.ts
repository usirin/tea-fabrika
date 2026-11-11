import { Schema } from "effect";
import { ProcessId } from "../../ProcessId.ts";

/** @internal */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/** @internal */
export const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** @internal */
export const Text = Schema.NonEmptyString;
/** How many times one letter is tried before it moves to the dead letters: 1 to 32. */
/** @internal */
export const Deliveries = Count.check(Schema.isLessThanOrEqualTo(32));

/** @internal */
export const Policy = Schema.Struct({
  maxDeliveries: Deliveries,
  intensity: Count,
  periodMs: Count,
  backoff: Schema.Struct({ minMs: Count, maxMs: Count, resetAfterMs: Count }),
}).check(
  Schema.makeFilter((p) => {
    if (p.intensity < p.maxDeliveries || p.backoff.minMs > p.backoff.maxMs) {
      return "invalid restart policy";
    }

    // The first intensity waits must fit in one window, or the brake cannot trip.
    let total = 0;
    let wait = p.backoff.minMs;

    for (let n = 0; n < p.intensity; n++) {
      total += wait;

      if (total >= p.periodMs) {
        return "restart waits exceed the window";
      }

      wait = Math.min(wait * 2, p.backoff.maxMs);
    }

    return true;
  }),
);
/** @internal */
export type Policy = typeof Policy.Type;

/** @internal */
export const AttemptFields = { process: ProcessId, letter: Text, build: Text, seq: Count };

/** @internal */
export const Failure = Schema.TaggedUnion({
  fresh: { ...AttemptFields, error: Text },
  saved: { ...AttemptFields, error: Text },
  interrupted: AttemptFields,
});
/** @internal */
export type Failure = typeof Failure.Type;

/** @internal */
export const Observation = Schema.Struct({
  seq: Count,
  process: ProcessId,
  letter: Text,
  phase: Schema.Literals(["fresh", "saved", "interrupted"]),
  error: Schema.optionalKey(Text),
  at: Millis,
});

/** @internal */
export const Receipt = Schema.Struct({
  letter: Text,
  input: Schema.Json,
  digest: Schema.optionalKey(Text),
  errors: Schema.Array(Text),
  tries: Millis,
  result: Schema.NullOr(Schema.TaggedStruct("refused", { reason: Schema.Literal("dead") })),
  process: ProcessId,
}).check(
  Schema.makeFilter((r) =>
    r.input !== null || (r.digest !== undefined && r.tries === 0 && r.result === null)
      ? true
      : "a failed delivery keeps its input; an accepted delivery keeps its digest",
  ),
);
