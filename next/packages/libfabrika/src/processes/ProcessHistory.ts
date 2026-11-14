/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
