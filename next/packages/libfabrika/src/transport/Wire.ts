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
 * The wire schemas of the gateway transport: the client hello, who is connected, what an answer
 * to a request can be, and the attachment saved for each connection.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/**
 * Schema for the hello a client sends to start a connection.
 *
 * **Details**
 *
 * `versions` lists the protocol versions the client speaks, each at least 1. The server checks
 * `tab` and `nonce` against the ones it expects, and `key` against the expected fingerprint.
 * `signed` holds the armored SSHSIG, made with `key`, over the hello text from `helloText`: the
 * url, the tab and the nonce. `ping` is a duration such as `30s`. `platform` and `os` name the
 * client's runtime, and `sentAt` is the client's own clock time.
 *
 * @stability unstable
 * @category models
 */
export const Hello = Schema.Struct({
  versions: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  has: Schema.Array(Schema.String),
  build: Schema.optionalKey(Schema.NonEmptyString),
  ping: Schema.String,
  key: Schema.String,
  tab: Schema.String,
  nonce: Schema.String,
  platform: Schema.Literals(["browser", "electron", "headless"]),
  os: Schema.Literals(["macos", "windows", "linux", "android", "ios", "unknown"]),
  sentAt: Schema.String,
  signed: Schema.String,
});

/**
 * Schema for the identity of an admitted connection: the key, the person it belongs to, and
 * whether it acts as a window or an agent.
 *
 * @stability unstable
 * @category models
 */
export const Who = Schema.Struct({
  key: Schema.String,
  person: Schema.String,
  as: Schema.Literals(["window", "agent", "hands"]),
});

/**
 * Schema for the outcome of asking whether a key may connect: `admitted` with its identity, or
 * `refused` with the reason `not_granted`.
 *
 * @stability unstable
 * @category models
 */
export const Admission = Schema.TaggedUnion({
  admitted: { identity: Who },
  refused: { reason: Schema.Literal("not_granted") },
});

/**
 * Schema for what handling a request can give back.
 *
 * **Details**
 *
 * `ok` carries a JSON result. `refused` carries a reason, and optionally `retryAfter` in
 * milliseconds, at least 1. `parked` carries no reply yet: it names the stream and position the
 * request waits on.
 *
 * @stability unstable
 * @category models
 */
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

/**
 * Schema for one parked request: its JSON-RPC id, the stream it waits on and the position it
 * waits after.
 *
 * @stability unstable
 * @category models
 */
export const Wait = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  stream: Schema.String,
  after: Schema.Int,
});

/**
 * Schema for the state saved for one connection.
 *
 * **Details**
 *
 * `new` is before any hello, `waiting` holds the client, key, hello and nonce seen so far, and
 * `online` is after a successful hello. Only `online` carries the identity, the negotiated version, the
 * parked `waits`, a `watching` flag and a `busy` flag.
 *
 * @stability unstable
 * @category models
 */
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
    has: Schema.optionalKey(Hello.fields.has),
    build: Schema.optionalKey(Schema.NonEmptyString),
  },
});
