// T502 PR 2, next/. The normal build and normal local stack, with a test-only HTTP entry.
import { NodeServices } from "@effect/platform-node";
import { build } from "@kampus/libfabrika/build";
import { Effect, FileSystem, Path, Schedule } from "effect";
import { SecureRandom } from "effect/crypto";
import { localStage } from "./local-stage.ts";
import { heldPort } from "./port.test-support.ts";

export const recordWire = Effect.fnUntraced(
  function* (cap: number) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-r-" });
    const port = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
    const built = yield* build({
      out: path.join(home, "dist"),
      root: path.resolve(import.meta.dirname, "../../../.."),
      entry: path.join(import.meta.dirname, "record-entry.test-support.ts"),
      programs: [],
      files: [],
      chaos: false,
    });
    const old = process.env.ALCHEMY_HOME;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (old === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = old;
        }
      }),
    );
    yield* localStage(built, {
      home,
      name: "record-law",
      person: "record-law",
      founder: "fixture",
      window: null,
      port: port.port,
      limits: { recordBytes: cap },
    });
    const url = `http://127.0.0.1:${port.port}`;
    // oxlint-disable-next-line fabrika/no-promises -- edge: the fixture waits for its local HTTP listener
    yield* Effect.tryPromise(() => fetch(`${url}/ready`)).pipe(
      Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
    );
    return url;
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);
