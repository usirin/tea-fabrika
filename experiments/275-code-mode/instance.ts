// Experiment 275, lab code. next/apps/fabrika's instance (alchemy.run.ts and src/instance.ts), with
// one more Worker in the same stack and the same local runtime: Scripts, door B's Worker Loader.
// Everything goes through Alchemy (0042): Cloudflare.Workers.Worker and Cloudflare.WorkerLoader.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { startDev as start } from "@kampus/libfabrika/node/dev";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import type { Context } from "effect";
import { Effect, Layer, Path } from "effect";
import type { Built } from "../../next/apps/fabrika/src/build.ts";
import { Settings } from "../../next/apps/fabrika/src/settings.ts";

const stack = (built: Pick<Built, "brain">, settings: Settings, scriptsPort: number, local: Context.Context<never>) =>
  Alchemy.Stack(
    "fabrika",
    {
      providers: Cloudflare.providers().pipe(Layer.provide(Layer.succeedContext(local))),
      state: Alchemy.localState(),
    },
    Effect.gen(function* () {
      const measurements = yield* Cloudflare.R2.Bucket("Measurements", {
        name: "fabrika-measurements",
        lifecycleRules: [],
        locks: [],
      });
      const brain = yield* Cloudflare.Workers.Worker("Brain", {
        name: settings.name,
        main: built.brain,
        bundle: false,
        compatibility: { date: "2026-10-12" },
        observability: { enabled: false },
        dev: { host: "127.0.0.1", port: settings.port, strictPort: true },
        env: {
          PROJECT: Cloudflare.DurableObject("Project"),
          PROCESS: Cloudflare.DurableObject("Process"),
          CONNECTION: Cloudflare.DurableObject("Connection"),
          RECORD: Cloudflare.DurableObject("RecordPart"),
          RecordPart: Cloudflare.DurableObject("RecordPart"),
          LOADER: Cloudflare.WorkerLoader(),
          MEASUREMENTS: measurements,
          INSTANCE: JSON.stringify(settings),
        },
      });
      const scripts = yield* Cloudflare.Workers.Worker("Scripts", {
        name: `${settings.name}-scripts`,
        main: new URL("./scripts/worker.js", import.meta.url).pathname,
        bundle: false,
        compatibility: { date: "2026-10-12" },
        observability: { enabled: false },
        dev: { host: "127.0.0.1", port: scriptsPort, strictPort: true },
        env: { LOADER: Cloudflare.WorkerLoader() },
      });
      return { url: brain.url, scripts: scripts.url };
    }),
  );

export const startDev = Effect.fn("exp275.startDev")(function* (
  built: Omit<Built, "assets">,
  options: Omit<Settings, "build"> & { readonly home: string; readonly scriptsPort: number },
) {
  const path = yield* Path.Path;
  const { scriptsPort, ...rest } = options;
  const config = Settings.make({ ...rest, build: built.build });
  return yield* start({ ...config, home: options.home }, (local, scope) => {
    const engine = Layer.mergeAll(
      Layer.succeed(AlchemyContext, { dotAlchemy: path.join(options.home, ".alchemy"), dev: true, adopt: false }),
      Layer.succeed(ArtifactStore, createArtifactStore()),
      Interaction.layerNonInteractive(),
      AuthProvidersLive,
    );
    return deploy({ stack: stack(built, config, scriptsPort, local), stage: "local", dev: true, scope }).pipe(
      Effect.provide(localState()),
      Effect.provide(engine),
    );
  });
});
