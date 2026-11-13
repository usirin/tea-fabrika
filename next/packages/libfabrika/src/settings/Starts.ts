/**
 * The record of instance starts: the service contract and its errors. The layers live in
 * `cloudflare/`, one that writes the ledger and one that calls it over RPC.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type * as Start from "./Start.ts";

/**
 * Schema for what a read did not find. Today that is only an instance start, named by its id.
 *
 * @stability unstable
 * @category schemas
 */
export const MissingTarget = Schema.TaggedUnion({ instance: { start: Schema.NonEmptyString } });

/**
 * A start's input, its saved entry or a reply failed its checks.
 *
 * @stability unstable
 * @category errors
 */
export class Decode extends Schema.TaggedError<Decode>()("Decode", { cause: Schema.Defect() }) {}

/**
 * No start is recorded under the asked id.
 *
 * @stability unstable
 * @category errors
 */
export class Missing extends Schema.TaggedError<Missing>()("Missing", { target: MissingTarget }) {}

/**
 * The ledger did not place the start's entry, or the id already holds a different start.
 *
 * @stability unstable
 * @category errors
 */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { cause: Schema.Defect() }) {}

/**
 * The ledger could not be read or written.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * The call to the object that keeps the starts did not get through.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

/**
 * The `Starts` service's own error. Its `reason` says what went wrong and, for every reason but
 * `Missing`, keeps the cause.
 *
 * @stability unstable
 * @category errors
 */
export class StartsError extends Schema.TaggedError<StartsError>()("StartsError", {
  reason: Schema.Union([Decode, Missing, Refused, Storage, Unreachable]),
}) {}

/**
 * Service that records instance starts and reads them back.
 *
 * @stability unstable
 * @category services
 */
export class Starts extends Context.Service<
  Starts,
  {
    /**
     * Records the start and answers its receipt. Recording the same start again answers the first
     * receipt. An id that already holds a different start fails with `Refused`.
     */
    readonly record: (input: Start.Input) => Effect.Effect<Start.Receipt, StartsError>;
    /** Answers a recorded start's receipt, or fails with `Missing` when the id holds none. */
    readonly read: (start: string) => Effect.Effect<Start.Receipt, StartsError>;
  }
>()("@kampus/libfabrika/settings/Starts") {}
