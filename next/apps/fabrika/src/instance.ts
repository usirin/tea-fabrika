import { startDev as start } from "@kampus/libfabrika/node/dev";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { settings as readSettings } from "@kampus/libfabrika/workers/runtime";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { DateTime, Effect, Layer, Path } from "effect";
import { stack } from "../alchemy.run.ts";
import type { Built } from "./build.ts";
import { Settings, type Options } from "./settings.ts";

export const startDev = Effect.fn("instance.startDev")(function* (built: Omit<Built, "assets">, options: Options) {
  const path = yield* Path.Path;
  const identity = options.start ?? (yield* (yield* ProcessIdGenerator).next);
  const span = yield* Effect.currentSpan;
  const config = Settings.make({
    settings: options.settings,
    start: identity,
    build: built.build,
    repo: options.repo,
    founding: options.founding,
    name: options.name,
    origin: options.origin ?? {
      by: `instance:${identity}`,
      for: options.founding.person,
      sentAt: DateTime.formatIso(yield* DateTime.now),
      seen: 0,
      parent: null,
      traceId: span.traceId,
    },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.mail === undefined ? {} : { mail: options.mail }),
    ...(options.starts === undefined ? {} : { starts: options.starts }),
  });
  const checked = yield* readSettings({ INSTANCE: JSON.stringify(config) });
  return yield* start(
    { name: config.name, build: config.build, port: checked.values.port, home: options.home },
    (local, scope) => {
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
      return deploy({ stack: stack(built, checked, local), stage: "local", dev: true, scope }).pipe(
        Effect.provide(localState()),
        Effect.provide(engine),
      );
    },
  );
});
