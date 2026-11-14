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
 * Public lifecycle for a home-owned brain.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * A lower operation failed; its cause is protected by the driver.
 *
 * @stability unstable
 * @category errors
 */
export class Operation extends Schema.TaggedError<Operation>()("Operation", {
  action: Schema.Literals(["inspect", "install", "start", "stop", "cleanup"]),
  cause: Schema.Defect(),
}) {}

/**
 * A bounded lifecycle attempt expired.
 *
 * @stability unstable
 * @category errors
 */
export class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  action: Schema.Literals(["up", "start", "stop"]),
  cause: Schema.Defect(),
}) {}

/**
 * Another job, file or listener owns the requested resource.
 *
 * @stability unstable
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { cause: Schema.Defect() }) {}

/**
 * Lifecycle failure with a checked reason.
 *
 * @stability unstable
 * @category errors
 */
export class BrainServiceError extends Schema.TaggedError<BrainServiceError>()("BrainServiceError", {
  reason: Schema.Union([Operation, Timeout, Conflict]),
}) {}

/**
 * Starts or reuses a brain, or awaits its confirmed shutdown.
 *
 * @stability unstable
 * @category services
 */
export class BrainService extends Context.Service<
  BrainService,
  {
    readonly up: Effect.Effect<{ readonly url: string }, BrainServiceError>;
    readonly stop: Effect.Effect<void, BrainServiceError>;
  }
>()("@kampus/libfabrika/desktop/BrainService") {}
