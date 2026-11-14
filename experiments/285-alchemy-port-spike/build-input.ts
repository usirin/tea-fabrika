// Experiment 285, next/. How the stack hands build input to a Worker that Alchemy bundles, without
// the Worker's own bundle importing it. The Worker file reads this reference for its props. On Node
// the stack provides the real input. Inside workerd nothing provides it, so it is empty.
import { Context } from "effect";
import type { OutputOptions, Plugin } from "rolldown";

export const BuildInput = Context.Reference<{
  readonly plugins?: ReadonlyArray<Plugin>;
  /** Module names mapped to files. Plain data, so it also crosses Alchemy's local provider. */
  readonly alias?: Readonly<Record<string, string>>;
  readonly output?: OutputOptions;
}>("experiments/285/BuildInput", { defaultValue: () => ({}) });
