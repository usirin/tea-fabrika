// SweepsTest.layer: the Sweeps service in memory. It counts the kicks and starts nothing.
import { Effect, Layer } from "effect";
import { Sweeps, SweepsError } from "./Sweeps.ts";

export type Count = { kicks: number };

export const count = (): Count => ({ kicks: 0 });

/** `failing` is the reason every kick fails with, when given. */
export const layer = (c: Count, failing?: string): Layer.Layer<Sweeps> =>
  Layer.succeed(
    Sweeps,
    Sweeps.of({
      kick: Effect.suspend(() => {
        c.kicks += 1;
        return failing === undefined ? Effect.void : Effect.fail(new SweepsError({ reason: failing }));
      }),
    }),
  );
