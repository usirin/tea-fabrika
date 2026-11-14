import { startDev as start } from "@kampus/libfabrika/node/dev";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { Effect, Layer, Path, Schema } from "effect";
import { stack } from "../alchemy.run.ts";
import type { Built } from "./build.ts";
import { Quotas, Settings } from "./settings.ts";

export const startDev = Effect.fn("instance.startDev")(function* (
  built: Omit<Built, "assets">,
  options: Omit<Settings, "build"> & { readonly home: string },
) {
  const path = yield* Path.Path;
  const config = Settings.make({ ...options, build: built.build });

  // Every caller's quota values are checked by their declared schemas here, before `INSTANCE` is
  // written, so a bad value stops the start and not the Worker's first object.
  if (config.limits !== undefined) {
    yield* Schema.decodeUnknownEffect(Quotas)(config.limits);
  }

  return yield* start({ ...config, home: options.home }, (local, scope) => {
    const engine = Layer.mergeAll(
      Layer.succeed(AlchemyContext, {
        dotAlchemy: path.join(options.home, ".alchemy"),
        dev: true,
        adopt: false,
      }),
      Layer.succeed(ArtifactStore, createArtifactStore()),
      Interaction.layerNonInteractive(),
      AuthProvidersLive,
    );
    // oxlint-disable-next-line fabrika/no-stage-word -- Alchemy's own key picks its deployment state
    return deploy({ stack: stack(built, config, local), stage: "local", dev: true, scope }).pipe(
      Effect.provide(localState()),
      Effect.provide(engine),
    );
  });
});
