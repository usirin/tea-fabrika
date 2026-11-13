// SweepsProcess.layer: the Sweeps service on `gcloop.ts kick --trigger merge`, which starts the
// sweep in the background and returns at once, so nothing here waits on a cleanup.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "./command.ts";
import { Sweeps, SweepsError } from "./Sweeps.ts";

/** `scripts` is the lead's scripts folder, where gcloop.ts sits. */
export const layer = (scripts: string): Layer.Layer<Sweeps, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Sweeps,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const kick = Effect.gen(function* () {
        const ran = yield* run("node", [`${scripts}/gcloop.ts`, "kick", "--trigger", "merge"], scripts);

        if (ran.code !== 0) {
          return yield* new SweepsError({ reason: `gcloop.ts kick exited ${ran.code}: ${lastLine(ran)}` });
        }
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new SweepsError({ reason: `gcloop.ts could not start: ${e.message}` })),
        ),
      );

      return Sweeps.of({ kick });
    }),
  );
