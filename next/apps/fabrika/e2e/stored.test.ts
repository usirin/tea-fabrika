// The law for L17's home scan, `stored` (stored.test-support.ts), run on a home a writer changes. A
// running brain writes each file to `<name>.tmp` and renames it over `<name>` (`durableWrite` in
// libfabrika's `node/dev/local-dev.ts`), so a listed temp file can be gone before the scan reads it:
// that turned L17 red on CI run 43562939099. Here the race is certain, not timed: while the instance
// runs, each listing of its home sees a fresh temp file, and the rename lands before the listing
// returns. The stop writes once more, as the brain's stop saves its `stopped` event.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Ref } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stored } from "./stored.test-support.ts";

const SEED = 119120;

describe("stored", () => {
  it("[secrets] a home whose files are renamed into place under a listing is scanned whole, its stop's last write included", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ secret: fc.stringMatching(/^[A-Za-z0-9]{24,40}$/), writes: fc.integer({ min: 1, max: 4 }) }),
        ({ secret, writes }) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const real = yield* FileSystem.FileSystem,
                  path = yield* Path.Path;
                const dir = yield* real.makeTempDirectoryScoped({ prefix: "stored." });
                const target = path.join(dir, "brain.last.json");
                const pending = `${target}.tmp`;
                const running = yield* Ref.make(true);
                const write = (text: string) =>
                  real.writeFileString(pending, text).pipe(Effect.andThen(real.rename(pending, target)));

                for (let n = 0; n < writes; n++) {
                  yield* write(JSON.stringify(`start_${n}`));
                }

                const fs: FileSystem.FileSystem = {
                  ...real,
                  readDirectory: (folder, options) =>
                    Effect.gen(function* () {
                      if (!(yield* Ref.get(running))) {
                        return yield* real.readDirectory(folder, options);
                      }

                      yield* real.writeFileString(pending, JSON.stringify("start_listed"));
                      const names = yield* real.readDirectory(folder, options);
                      yield* real.rename(pending, target);
                      return names;
                    }),
                };
                const stop = write(JSON.stringify(`stopped_${secret}`)).pipe(Effect.andThen(Ref.set(running, false)));
                const disk = yield* stored({ dir, stop }, new Map(), []).pipe(
                  Effect.provideService(FileSystem.FileSystem, fs),
                );

                expect(disk.raw).toEqual([["home /brain.last.json", JSON.stringify(`stopped_${secret}`)]]);
                expect(disk.outputs).toEqual(disk.raw);
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          ),
      ),
      { seed: SEED, numRuns: 20 },
    );
  });
});
