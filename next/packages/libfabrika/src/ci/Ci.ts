/**
 * Current check runs at an exact commit, independent of the CI host.
 *
 * @stability experimental
 * @since 0.0.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Equivalence from "effect/Equivalence";
import * as Schema from "effect/Schema";

/**
 * Schema for the conclusions a completed check can report.
 *
 * @stability experimental
 * @category models
 * @since 0.0.0
 */
export const Conclusion = Schema.Literals([
  "success",
  "failure",
  "timed_out",
  "skipped",
  "neutral",
  "cancelled",
  "startup_failure",
]);

/**
 * Schema for queued, running and completed checks; only completed checks hold a conclusion.
 *
 * @stability experimental
 * @category models
 * @since 0.0.0
 */
export const Status = Schema.TaggedUnion({
  queued: {},
  running: {},
  done: { conclusion: Conclusion },
});

const Ms = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * Schema for one reported run. CI clock times are recorded, never used to decide a verdict.
 *
 * @stability experimental
 * @category models
 * @since 0.0.0
 */
export const CheckRun = Schema.Struct({
  name: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  status: Status,
  startedAt: Schema.NullOr(Ms),
  completedAt: Schema.NullOr(Ms),
  url: Schema.NullOr(Schema.NonEmptyString),
});

/**
 * Compares a run's name and source field by field, including any NUL characters.
 *
 * @stability experimental
 * @category guards
 * @since 0.0.0
 */
export const sameKey = Equivalence.Struct({ name: Equivalence.String, source: Equivalence.String });

/**
 * Schema for one current run per name and source, in no defined order.
 *
 * @stability experimental
 * @category models
 * @since 0.0.0
 */
export const Checks = Schema.Array(CheckRun).check(
  Schema.makeFilter(
    (runs) => Arr.dedupeWith(runs, sameKey).length === runs.length || "two runs share a name and source",
  ),
);

/**
 * Error for a CI fault that permits another attempt.
 *
 * @stability experimental
 * @category errors
 * @since 0.0.0
 */
export class CiError extends Schema.TaggedError<CiError>()("CiError", {
  reason: Schema.Literals(["unavailable", "rate_limited"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that selects current runs at a commit. Replace earlier reports of each id, then group
 * by name and source. Any unplaced run makes its key queued: choose the greatest unplaced id and
 * preserve other fields. Otherwise choose highest host order; ties take unfinished, red, lost,
 * then passing. Remaining ties take the greater id by code unit. No report answers [].
 *
 * @stability experimental
 * @category services
 * @since 0.0.0
 */
export class Ci extends Context.Service<
  Ci,
  {
    /** Safe to repeat: two starts request one set of checks. A push already starts GitHub Actions. */
    readonly start: (commit: string) => Effect.Effect<void, CiError>;
    readonly at: (commit: string) => Effect.Effect<typeof Checks.Type, CiError>;
  }
>()("@kampus/libfabrika/Ci") {}
