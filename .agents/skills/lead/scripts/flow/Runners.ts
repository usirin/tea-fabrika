// Runners.ts: the service that does one step's work, picked by the step's name. Today's lead
// tooling (0064). The flow machine never runs anything itself: its one Cmd, `step_run`, goes here.
// A real flow gets its runners from a table (the landing runners); a test gives fakes through the same
// `Runners.layer`, so no test needs git, the network or an agent.

import { Context, Effect, Layer, Schema } from "effect";
import type { Answer } from "./Outcome.ts";
import type { Step } from "./Step.ts";

/** A runner could not do its work at all (it could not start, or its args do not parse). */
export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { reason: Schema.String }) {}

/** One step's work: the step in, its answer out. */
export type Runner<R = never> = (step: Step) => Effect.Effect<Answer, StepFailed, R>;

export class Runners extends Context.Service<
  Runners,
  {
    /** The step names this service has a runner for. */
    readonly names: ReadonlySet<string>;
    readonly run: (step: Step) => Effect.Effect<Answer, StepFailed>;
  }
>()("lead/flow/Runners") {}

/** Runners from a table of name to runner; the runners' own services come from the layer's. */
export const layer = <R>(table: Readonly<Record<string, Runner<R>>>): Layer.Layer<Runners, never, R> =>
  Layer.effect(
    Runners,
    Effect.gen(function* () {
      const services = yield* Effect.context<R>();
      const run = Effect.fn("Runners.run")(function* (step: Step) {
        const runner = table[step.name];

        if (runner === undefined) {
          return yield* new StepFailed({ reason: `no runner for step ${step.name}` });
        }

        return yield* runner(step).pipe(Effect.provideContext(services));
      });
      return Runners.of({ names: new Set(Object.keys(table)), run });
    }),
  );
