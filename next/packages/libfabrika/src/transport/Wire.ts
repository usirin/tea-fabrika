import { Schema } from "effect";

export const Hello = Schema.Struct({
  versions: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  has: Schema.Array(Schema.String),
  ping: Schema.String,
  key: Schema.String,
  tab: Schema.String,
  nonce: Schema.String,
  platform: Schema.Literals(["browser", "electron", "headless"]),
  os: Schema.Literals(["macos", "windows", "linux", "android", "ios", "unknown"]),
  sentAt: Schema.String,
  signed: Schema.String,
});

export const Who = Schema.Struct({
  key: Schema.String,
  person: Schema.String,
  as: Schema.Literals(["window", "agent"]),
});

export const Admission = Schema.TaggedUnion({
  admitted: { identity: Who },
  refused: { reason: Schema.Literal("not_granted") },
});

export const Answer = Schema.TaggedUnion({
  ok: { result: Schema.Json },
  refused: {
    reason: Schema.String,
    retryAfter: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  },
  parked: { stream: Schema.String, after: Schema.Int },
});

/**
 * Schema for a rate refusal with the earliest retry delay in milliseconds.
 *
 * @stability unstable
 * @category models
 */
export const RateRefusal = Schema.TaggedStruct("refused", {
  reason: Schema.Literal("rate_limited"),
  retryAfter: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
});

/**
 * Identifies a failed rate count by the static Error message preserved across RPC.
 *
 * @stability unstable
 * @category models
 */
export const RateCountFailure = Schema.Struct({
  message: Schema.Literal("Gateway rate refusal count could not be saved"),
});

export const Wait = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  stream: Schema.String,
  after: Schema.Int,
});

export const Attached = Schema.TaggedUnion({
  new: { client: Schema.String, nonce: Schema.String },
  waiting: { client: Schema.String, key: Schema.String, hello: Hello, nonce: Schema.String },
  online: {
    client: Schema.String,
    identity: Who,
    version: Schema.Int,
    waits: Schema.Array(Wait),
    watching: Schema.Boolean,
    busy: Schema.Boolean,
  },
});
