/**
 * The `Gateway` service's own error and its reasons. It sits in a file of its own so the
 * gateway's store and nonce files can build it without importing `Gateway.ts`, which imports them.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/**
 * Reason for gateway state that could not be read or written: the `Sql` threw, a saved key is not
 * one the gateway could have made, or the store of spent nonces is full. A throw or a decoder's
 * failure is kept as `cause`; a key of the wrong length and a full store have none.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Reason for a saved gateway state value that does not decode. The decoder's failure is kept as
 * `cause`.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Reason for a WebCrypto call that failed: importing the challenge key, signing a nonce or
 * checking one. The rejection is kept as `cause`.
 *
 * @stability unstable
 * @category errors
 */
export class Crypto extends Schema.TaggedError<Crypto>()("Crypto", { cause: Schema.Defect() }) {}

/**
 * Error of the `Gateway` service for a fault below its rules: its own tables, or the crypto it
 * runs. A refusal by the rules is an answer or `NotGranted` instead.
 *
 * @stability unstable
 * @category errors
 */
export class GatewayError extends Schema.TaggedError<GatewayError>()("GatewayError", {
  reason: Schema.Union([Storage, BadRow, Crypto]),
}) {}
