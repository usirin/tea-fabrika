/**
 * Installation and service-manager contract.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * A loaded job remains loaded even while it has no process.
 *
 * @stability unstable
 * @category schemas
 */
export const Status = Schema.TaggedUnion({
  absent: {},
  loaded: {
    executable: Schema.NonEmptyString,
    args: Schema.Array(Schema.String),
    home: Schema.NonEmptyString,
    configuration: Schema.NonEmptyString,
    pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  },
});

/**
 * Native command failure, including its exit code when one was observed.
 *
 * @stability unstable
 * @category errors
 */
export class Command extends Schema.TaggedError<Command>()("Command", {
  code: Schema.optionalKey(Schema.Int),
  cause: Schema.Defect(),
}) {}

/**
 * File operation failure.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}
/**
 * Unrecognized service-manager output.
 *
 * @stability unstable
 * @category errors
 */
export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", { cause: Schema.Defect() }) {}
/**
 * The job or file belongs to another configuration.
 *
 * @stability unstable
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { cause: Schema.Defect() }) {}

/**
 * Lower controller failure, preserving its protected cause.
 *
 * @stability unstable
 * @category errors
 */
export class BrainControlError extends Schema.TaggedError<BrainControlError>()("BrainControlError", {
  reason: Schema.Union([Command, Storage, Unsupported, Conflict]),
}) {}

/**
 * Operations on one checked installation.
 *
 * @stability unstable
 * @category services
 */
export class BrainControl extends Context.Service<
  BrainControl,
  {
    readonly inspect: Effect.Effect<typeof Status.Type, BrainControlError>;
    readonly install: Effect.Effect<void, BrainControlError>;
    readonly start: Effect.Effect<void, BrainControlError>;
    readonly stop: Effect.Effect<void, BrainControlError>;
    readonly remove: Effect.Effect<void, BrainControlError>;
  }
>()("@kampus/libfabrika/desktop/BrainControl") {}
