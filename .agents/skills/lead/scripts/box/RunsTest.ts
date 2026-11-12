// RunsTest.layer: the Runs service in memory. It answers every folder with the one answer given,
// and moves nothing.
import { Effect, Layer } from "effect";
import { type Kept, Runs } from "./Runs.ts";

export const layer = (answer: Kept): Layer.Layer<Runs> =>
  Layer.succeed(Runs, Runs.of({ keep: () => Effect.succeed(answer) }));
