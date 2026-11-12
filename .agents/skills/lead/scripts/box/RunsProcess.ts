// RunsProcess.layer: the Runs service on keepruns.sh, the one mover every cleanup shares.
import { Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Runs } from "./Runs.ts";

/** `script` is keepruns.sh's path. It reads MAIN, the checkout runs/ moves into, from `env` alone. */
export const layer = (
  script: string,
  env: Readonly<Record<string, string | undefined>>,
): Layer.Layer<Runs, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Runs,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const keep = Effect.fn("RunsProcess.keep")(
        function* (folder: string) {
          const handle = yield* ChildProcess.make("sh", [script, folder], {
            env,
            extendEnv: false,
            stdin: "ignore",
            stderr: "ignore",
          });
          const [said, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode], {
            concurrency: 2,
          });
          return { said, kept: Number(code) === 0 };
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.orElseSucceed(() => ({ said: "", kept: false })),
      );
      return Runs.of({ keep });
    }),
  );
