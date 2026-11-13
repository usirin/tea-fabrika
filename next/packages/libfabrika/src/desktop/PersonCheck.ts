/**
 * Person confirmation, without a platform handle or an implementation.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a completed person check or a declined request.
 * @stability unstable
 * @category schemas
 */
export const Answer = Schema.TaggedUnion({
  checked: { check: Schema.Literals(["touch", "click"]) },
  declined: {},
});

/**
 * A person check could not run, retaining the underlying cause.
 * @stability unstable
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  cause: Schema.Defect(),
}) {}

/**
 * Failure to run a person check.
 * @stability unstable
 * @category errors
 */
export class PersonCheckError extends Schema.TaggedError<PersonCheckError>()("PersonCheckError", {
  reason: Schema.Union([Unavailable]),
}) {}

/**
 * Service that asks a person to confirm the named action.
 * @stability unstable
 * @category services
 */
export class PersonCheck extends Context.Service<
  PersonCheck,
  {
    readonly ask: (reason: string) => Effect.Effect<typeof Answer.Type, PersonCheckError>;
  }
>()("@kampus/libfabrika/desktop/PersonCheck") {}
