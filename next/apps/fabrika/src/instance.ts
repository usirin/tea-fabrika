/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { startDev as start } from "@kampus/libfabrika/node/dev";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { settings as readSettings } from "@kampus/libfabrika/workers/runtime";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { DateTime, Effect, Layer, Path } from "effect";
import { stack } from "../alchemy.run.ts";
import type { Built } from "./build.ts";
import { Settings, type Options } from "./settings.ts";

export const startDev = Effect.fn("instance.startDev")(function* (built: Omit<Built, "assets">, options: Options) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
