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
 * Another job or listener owns the requested resource.
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
