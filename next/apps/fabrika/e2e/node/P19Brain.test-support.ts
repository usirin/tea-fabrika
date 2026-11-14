// P19 next/. Host-only. The brain launchd starts, in a file of its own, so under Electron it loads
// only the local instance and not the host check's bundler or launchd code.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { BuiltProgram } from "@kampus/libfabrika/runtime/Built";
import { Effect, FileSystem, Schema } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { localInstance } from "../../src/local-instance.ts";
import { Settings } from "../../src/settings.ts";

/**
 * What the host check hands the brain: the built file and the options `localInstance` takes, given
 * as `dev.ts` gives them, with the host check's own settings snapshot, so its port and rate limit
 * are the ones the launchd job was compiled from.
 */
export const BrainInput = Schema.Struct({
  built: Schema.Struct({
    build: Schema.String,
    brain: Schema.String,
    programs: Schema.Record(Schema.String, BuiltProgram),
  }),
  options: Schema.Struct({
    name: Settings.fields.name,
    founding: Settings.fields.founding,
    settings: Settings.fields.settings,
    repo: Settings.fields.repo,
    home: Schema.String,
  }),
});

/** The real local instance, then its ready file, then it waits to be stopped. */
const brain = Effect.fn("P19Host.brain")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const input = yield* fs
    .readFileString(file)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(BrainInput))));
  yield* localInstance(input.built, input.options);
  yield* fs.writeFileString(
    `${input.options.home}/ready.json`,
    JSON.stringify({
      pid: process.pid,
      build: input.built.build,
      node: process.versions.node,
      electron: process.versions.electron,
    }),
  );
  return yield* Effect.never;
});

if (process.argv[2] === "p19:brain") {
  NodeRuntime.runMain(
    Effect.scoped(brain(process.argv[3] ?? "")).pipe(
      Effect.provide([NodeServices.layer, Digest.layerWebCrypto, SecureRandom.layerWebCrypto]),
    ),
  );
}
