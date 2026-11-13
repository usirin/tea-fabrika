/**
 * Person confirmation, without a platform handle or an implementation.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a person check's answer: `checked`, by touch or by click, or `declined`.
 *
 * @stability unstable
 * @category schemas
 */
export const Answer = Schema.TaggedUnion({
  checked: { check: Schema.Literals(["touch", "click"]) },
  declined: {},
});

/**
 * Error for a person check that could not run. It keeps the underlying cause.
 *
 * @stability unstable
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  cause: Schema.Defect(),
}) {}

/**
 * Error that a person check fails with. Its `reason` names the failure.
 *
 * @stability unstable
 * @category errors
 */
export class PersonCheckError extends Schema.TaggedError<PersonCheckError>()("PersonCheckError", {
  reason: Schema.Union([Unavailable]),
}) {}

/**
 * Service that asks a person to confirm the action `reason` describes, and answers `checked` or `declined`.
 *
 * @stability unstable
 * @category services
 */
export class PersonCheck extends Context.Service<
  PersonCheck,
  {
    readonly ask: (reason: string) => Effect.Effect<typeof Answer.Type, PersonCheckError>;
  }
>()("@kampus/libfabrika/desktop/PersonCheck") {}
