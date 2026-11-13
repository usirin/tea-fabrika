import { Schema } from "effect";
import * as Snapshot from "./Snapshot.ts";

const Text = Schema.NonEmptyString.check(Schema.isMaxLength(256));

export const Origin = Schema.Struct({
  by: Schema.NonEmptyString,
  for: Schema.NonEmptyString,
  sentAt: Schema.String,
  seen: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  parent: Schema.NullOr(Schema.String),
  traceId: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
});

export const Input = Schema.Struct({
  settings: Snapshot.Snapshot,
  start: Schema.NonEmptyString,
  build: Schema.NonEmptyString,
  repo: Schema.NullOr(Schema.Struct({ revision: Schema.NonEmptyString })),
  founding: Schema.Struct({
    person: Schema.NonEmptyString,
    founder: Schema.NonEmptyString,
    window: Schema.NullOr(Schema.String),
  }),
  name: Schema.NonEmptyString,
  origin: Schema.optionalKey(Origin),
  limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Int.check(Schema.isGreaterThan(0)) })),
  mail: Schema.optionalKey(Schema.Struct({ grants: Schema.Record(Schema.String, Schema.Array(Schema.String)) })),
  /** Which program may start which (P42): a right the host hands in, never a declared setting or a recorded fact. */
  starts: Schema.optionalKey(Schema.Array(Schema.Struct({ source: Text, to: Text }))),
});
export type Input = typeof Input.Type;

export const Body = Schema.Struct({
  start: Input.fields.start,
  settings: Snapshot.Snapshot,
  build: Input.fields.build,
  repo: Input.fields.repo,
});

export const Receipt = Schema.Struct({
  ...Body.fields,
  entry: Schema.Struct({
    id: Schema.NonEmptyString,
    stream: Schema.NonEmptyString,
    rev: Schema.Int.check(Schema.isGreaterThan(0)),
    pos: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1 })),
    arrivedAt: Schema.Int,
    ...Origin.fields,
  }),
});
export type Receipt = typeof Receipt.Type;

export const Reply = Schema.TaggedUnion({
  ok: { value: Receipt },
  Decode: {},
  Missing: {},
  Refused: {},
  Storage: {},
  Unreachable: {},
});

/** A failed entry's wire summary. Local service errors retain their causes separately. */
export const Failure = Schema.TaggedStruct("StartsError", {
  reason: Schema.TaggedUnion({ Decode: {}, Missing: {}, Refused: {}, Storage: {}, Unreachable: {} }),
});
