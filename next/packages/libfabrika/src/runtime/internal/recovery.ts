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
/** @internal */
export type Receipt = typeof Receipt.Type;

// T936 slice 2: the pure part of a recovery save. Given the text each receipt row holds, it says
// which receipts a save must write and how many bytes that adds, with no read per receipt.
const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(Receipt));

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/** @internal What one save writes: each receipt whose text differs from its row, and the bytes that adds. */
export type Changes = {
  readonly changed: ReadonlyArray<{ readonly letter: string; readonly text: string }>;
  readonly growth: number;
};

/**
 * @internal Compares each receipt's text with the text its row holds in `rows`, keyed by letter. A
 * receipt equal to its row is skipped. A changed one adds the difference in bytes, and a new one
 * also adds its key, `name` and letter, as the row's own bytes.
 */
export const changes = (name: string, rows: ReadonlyMap<string, string>, receipts: Iterable<Receipt>): Changes => {
  const changed: Array<{ readonly letter: string; readonly text: string }> = [];
  let growth = 0;

  for (const receipt of receipts) {
    const text = encodeReceipt(receipt);
    const prior = rows.get(receipt.letter);

    if (prior === text) {
      continue;
    }

    growth += prior === undefined ? bytes(text) + bytes(name) + bytes(receipt.letter) : bytes(text) - bytes(prior);
    changed.push({ letter: receipt.letter, text });
  }

  return { changed, growth };
};
