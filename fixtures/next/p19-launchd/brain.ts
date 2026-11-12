// P19 next/. This tiny job proves normal exit policy; L13 also starts the full local instance.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schedule } from "effect";

NodeRuntime.runMain(Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const home = process.env.FABRIKA_HOME;
  if (home === undefined) return yield* Effect.die("fixture needs its isolated home");
  yield* Effect.gen(function* () {
    yield* fs.writeFileString(`${home}/fixture-ready.json`, JSON.stringify({ pid: process.pid, node: process.versions.node, electron: process.versions.electron }));
    if (yield* fs.exists(`${home}/exit-normally`)) {
      // A completed Effect makes NodeRuntime exit successfully; launchd must leave it stopped.
      return true;
    }
    return false;
  }).pipe(Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: (done) => done }));
})).pipe(Effect.provide(NodeServices.layer)));
