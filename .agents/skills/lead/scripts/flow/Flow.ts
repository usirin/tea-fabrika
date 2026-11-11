// Flow.ts: a flow is a named, ordered list of typed steps, as data (0064). Today's lead tooling,
// read through its module. A flow file default-exports one:
//
//   export default Flow.make("land-0065", [Step.act("format", { dir }), Step.check("lint", { dir })]);
//
// The flow runner saves it to its state file and walks it with the flow machine. The step names
// are unique, so a `send` names exactly one step. `attempts` caps how many step attempts one
// flow may make, so a `send` loop ends `stuck`.

import { Schema } from "effect";
import { Step } from "./Step.ts";

const uniqueNames = Schema.makeFilter<ReadonlyArray<Step>>(
  (steps) => new Set(steps.map((s) => s.name)).size === steps.length,
  { expected: "steps with unique names" },
);

export const Flow = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  steps: Schema.NonEmptyArray(Step).check(uniqueNames),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type Flow = typeof Flow.Type;

/** The cap on step attempts when a flow names none. */
export const ATTEMPTS = 32;

/** A flow; it throws on a bad name or two steps of one name, when the flow file loads. */
export const make = (
  name: string,
  steps: readonly [Step, ...ReadonlyArray<Step>],
  options: { readonly attempts?: number } = {},
): Flow => Flow.make({ name, steps, attempts: options.attempts ?? ATTEMPTS });

/** Whether two flows are the same data: a resume refuses a flow file that changed. */
export const equals = Schema.toEquivalence(Flow);
