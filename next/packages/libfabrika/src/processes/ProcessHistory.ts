/**
 * Bounded inbox and public restart history, without message content.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ProcessId } from "../ProcessId.ts";

/**
 * History could not reach storage.
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

/**
 * A known history row or its position is invalid.
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Storage failed before the bounded read completed.
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * The history service's failure, retaining the lower cause.
 * @stability unstable
 * @category errors
 */
export class ProcessHistoryError extends Schema.TaggedError<ProcessHistoryError>()("ProcessHistoryError", {
  reason: Schema.Union([Unreachable, BadRow, Storage]),
}) {}

/**
 * Two separately captured stream boundaries and the facts read through them.
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
 * @stability unstable
 * @category services
 */
export class ProcessHistory extends Context.Service<
  ProcessHistory,
  { readonly read: (name: string) => Effect.Effect<Snapshot, ProcessHistoryError> }
>()("@kampus/libfabrika/processes/ProcessHistory") {}
