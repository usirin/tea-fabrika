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
 * Bounded inbox and public restart history, without message content.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ProcessId } from "../ProcessId.ts";

/**
 * History could not reach storage, because the ledger answered `unreachable`.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

/**
 * A history row or its position is invalid: the ledger answered `bad_row`, a position is not a
 * positive safe integer, or a `send` body or `restarted` event does not decode.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Any other ledger failure, which stopped the bounded read before it completed.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * The history service's failure, retaining the lower cause.
 *
 * @stability unstable
 * @category errors
 */
export class ProcessHistoryError extends Schema.TaggedError<ProcessHistoryError>()("ProcessHistoryError", {
  reason: Schema.Union([Unreachable, BadRow, Storage]),
}) {}

/**
 * Two separately captured stream boundaries and the facts read through them.
 *
 * @stability unstable
 * @category models
 */
export type Snapshot = {
  readonly stream: string;
  readonly boundary: number;
  readonly processStream: string;
  readonly processBoundary: number;
  readonly letters: ReadonlyArray<{ readonly id: string; readonly pos: number }>;
  readonly restarts: ReadonlyArray<{
    readonly ref: string;
    readonly rev: number;
    readonly arrivedAt: number;
    readonly name: string;
    readonly after: typeof ProcessId.Type;
    readonly process: typeof ProcessId.Type;
  }>;
};

/**
 * Reads one registered name's inbox and public process history to fixed heads.
 *
 * @stability unstable
 * @category services
 */
export class ProcessHistory extends Context.Service<
  ProcessHistory,
  { readonly read: (name: string) => Effect.Effect<Snapshot, ProcessHistoryError> }
>()("@kampus/libfabrika/processes/ProcessHistory") {}
