// Shared by libfabrika's own laws: a fast-check property whose check is a scoped Effect, run as one
// Effect from the shared seed, so a law file does not paste its own runner and failure type.
import { Effect, Schema, type Scope } from "effect";
import * as fc from "fast-check";

/** The shared fixed seed every law runs from. */
const SEED = 119120;

/** fast-check's own failure report, with its counterexample, as a law's typed failure. */
class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * Checks `law` on values from `arbitrary`, each in a scope of its own, from the shared seed. `parameters`
 * are fast-check's own, such as `numRuns` and `examples`; a failure is `PropertyFailed` with fast-check's
 * report, the law's own error included.
 */
export const property = <A>(
  arbitrary: fc.Arbitrary<A>,
  law: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
  parameters: fc.Parameters<[A]>,
): Effect.Effect<void, PropertyFailed> => {
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped check
  const checked = fc.asyncProperty(arbitrary, (value) => Effect.runPromise(Effect.asVoid(Effect.scoped(law(value)))));
  const options = { seed: SEED, includeErrorInReport: true, ...parameters };
  // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
  return Effect.tryPromise({ try: () => fc.assert(checked, options), catch: (cause) => new PropertyFailed({ cause }) });
};
