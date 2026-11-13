/**
 * The disabled step hook, with no live fault dependencies.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { StepFault } from "./StepFault.ts";

/**
 * Leaves every supervised step unchanged.
 *
 * @stability unstable
 * @category layers
 */
export const layer: Layer.Layer<StepFault> = Layer.succeed(StepFault, {
  before: Effect.fn("StepFaultNone.before")(() => Effect.void),
});
