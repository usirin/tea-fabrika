import { startDev as start } from "@kampus/libfabrika/node/stage";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { Effect, Layer, Path } from "effect";
import { stack } from "../alchemy.run.ts";
import type { Built } from "./build.ts";
import { Settings } from "./settings.ts";

export const startDev = Effect.fn("stage.startDev")(function* (
  built: Omit<Built, "assets">,
  options: Omit<Settings, "build"> & { readonly home: string },
) {
  const path = yield* Path.Path;
  const config = Settings.make({ ...options, build: built.build });
  return yield* start({ ...config, home: options.home }, (local, scope) => {
    const engine = Layer.mergeAll(
      Layer.succeed(AlchemyContext, {
        dotAlchemy: path.join(options.home, ".alchemy"),
        dev: true,
        adopt: false,
      }),
      Layer.succeed(ArtifactStore, createArtifactStore()),
      Interaction.layerNonInteractive(),
    );
    return deploy({ stack: stack(built, config, local), stage: "local", dev: true, scope }).pipe(
      Effect.provide(localState()),
      Effect.provide(engine),
    );
  });
});
