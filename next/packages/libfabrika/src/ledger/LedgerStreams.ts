/**
 * Discovery of saved ledger stream names, independent of their contents.
 *
 * @stability experimental
 */
import { Context, Schema } from "effect";
import type { Stream } from "effect";

/**
 * A failure while reading the store.
 *
 * @stability experimental
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", {
  cause: Schema.Defect(),
}) {}

/**
 * A saved stream name that failed decoding.
 *
 * @stability experimental
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", {
  cause: Schema.Defect(),
}) {}

/**
 * The discovery service's failure, with its original cause.
 *
 * @stability experimental
 * @category errors
 */
export class LedgerStreamsError extends Schema.TaggedError<LedgerStreamsError>()("LedgerStreamsError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/**
 * Service that lists distinct names matching a literal prefix in storage order.
 *
 * @stability experimental
 * @category services
 */
export class LedgerStreams extends Context.Service<
  LedgerStreams,
  { readonly list: (prefix: string) => Stream.Stream<string, LedgerStreamsError> }
>()("@kampus/libfabrika/ledger/LedgerStreams") {}
