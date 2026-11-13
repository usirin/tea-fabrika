/**
 * The shapes of one instance start: what a host hands in, what the ledger keeps of it, and what
 * comes back as its receipt.
 *
 * @stability unstable
 */
import { Schema } from "effect";
import * as Snapshot from "./Snapshot.ts";

const Text = Schema.NonEmptyString.check(Schema.isMaxLength(256));

/**
 * Schema for who wrote a start's ledger entry: the writer, the person it works for, the writer's
 * own clock, and the trace the write belongs to.
 *
 * @stability unstable
 * @category schemas
 */
export const Origin = Schema.Struct({
  by: Schema.NonEmptyString,
  for: Schema.NonEmptyString,
  sentAt: Schema.String,
  seen: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  parent: Schema.NullOr(Schema.String),
  traceId: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
});

/**
 * Schema for what a host hands in to start an instance.
 *
 * **Details**
 *
 * The ledger keeps `start`, `settings`, `build` and `repo` as the entry's body, and `origin` as the
 * entry's writer fields.
 *
 * @stability unstable
 * @category schemas
 */
export const Input = Schema.Struct({
  settings: Snapshot.Snapshot,
  /** This start's id. Its ledger entry has the same id. */
  start: Schema.NonEmptyString,
  build: Schema.NonEmptyString,
  /** The commit the repo's settings were read at, or null when the start selected no repo. */
  repo: Schema.NullOr(Schema.Struct({ revision: Schema.NonEmptyString })),
  /** The facts given once at founding: the person, their first key, and the first window if there is one. */
  founding: Schema.Struct({
    person: Schema.NonEmptyString,
    founder: Schema.NonEmptyString,
    window: Schema.NullOr(Schema.String),
  }),
  /** The project's name. */
  name: Schema.NonEmptyString,
  /** The entry's writer fields. When absent, the layer that writes the entry makes them. */
  origin: Schema.optionalKey(Origin),
  limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Int.check(Schema.isGreaterThan(0)) })),
  mail: Schema.optionalKey(Schema.Struct({ grants: Schema.Record(Schema.String, Schema.Array(Schema.String)) })),
  /** Which program may start which: a right the host hands in, never a declared setting or a recorded fact. */
  starts: Schema.optionalKey(Schema.Array(Schema.Struct({ source: Text, to: Text }))),
});
/**
 * The decoded Input value.
 *
 * @stability unstable
 * @category models
 */
export type Input = typeof Input.Type;

/**
 * Schema for the part of a start the ledger saves as its entry's body: the start's id, its
 * settings, its build and its repo.
 *
 * @stability unstable
 * @category schemas
 */
export const Body = Schema.Struct({
  start: Input.fields.start,
  settings: Snapshot.Snapshot,
  build: Input.fields.build,
  repo: Input.fields.repo,
});

/**
 * Schema for a recorded start: the saved body, and the ledger entry that holds it.
 *
 * **Details**
 *
 * `entry` says where the entry sits in the ledger, when it arrived and who wrote it. Its `pos` is
 * always 1: a start is the first entry in its own stream.
 *
 * @stability unstable
 * @category schemas
 */
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
/**
 * The decoded Receipt value.
 *
 * @stability unstable
 * @category models
 */
export type Receipt = typeof Receipt.Type;

/**
 * Schema for the answer to a record or read call as it crosses RPC: `ok` with the receipt, or the
 * failure's reason by its tag alone.
 *
 * **Details**
 *
 * A failed reply carries no cause. A cause may hold the start's input, so it stays on the side
 * that failed.
 *
 * @stability unstable
 * @category schemas
 */
export const Reply = Schema.TaggedUnion({
  ok: { value: Receipt },
  Decode: {},
  Missing: {},
  Refused: {},
  Storage: {},
  Unreachable: {},
});

/**
 * Schema for a `StartsError` as it crosses RPC: the reason's tag and nothing else. The error on
 * the side that failed keeps its cause.
 *
 * @stability unstable
 * @category schemas
 */
export const Failure = Schema.TaggedStruct("StartsError", {
  reason: Schema.TaggedUnion({ Decode: {}, Missing: {}, Refused: {}, Storage: {}, Unreachable: {} }),
});
