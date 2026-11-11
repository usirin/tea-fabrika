// T421, next/. The dev stage serves a prebuilt brain, and Alchemy watches its folder to restart
// workerd on a change. On macOS a watch also gets events from before it started (the build
// folder's own creation, up to seconds late), so an event alone is no proof of a change.
// The law hands the watcher its file events itself: the real macOS ones come when they like.
import { createHash } from "node:crypto";
import { watchBundleDirectory } from "@alchemy.run/cloudflare/Workers/Sources/shared";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, FileSystem, Layer, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("T421 the dev stage's watch on the build folder", () => {
  it("scenario: a file event that changes no byte restarts nothing; changed bytes restart once", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
          const reads = yield* Queue.unbounded<string>();
          const changed = yield* Deferred.make<void>();
          const seen: Array<string> = [];
          let content = "export default 1";
          const read = Effect.sync(() => {
            const file = { path: "brain.mjs", content, hash: sha(content) };
            Queue.offerUnsafe(reads, file.hash);
            return { files: [file] as [typeof file], hash: file.hash };
          });
          const watched = Layer.effect(
            FileSystem.FileSystem,
            Effect.map(FileSystem.FileSystem, (fs) => ({
              ...fs,
              watch: () => Stream.fromQueue(events),
            })),
          ).pipe(Layer.provide(NodeServices.layer));
          yield* watchBundleDirectory({ main: "/build/brain.mjs", read }).pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                seen.push(event._tag === "Success" ? `Success ${event.output.hash}` : event._tag);

                if (event._tag === "Success" && event.output.hash === sha("export default 2")) {
                  yield* Deferred.succeed(changed, undefined);
                }
              }),
            ),
            Effect.provide(watched),
            Effect.forkScoped,
          );
          // The first read is the serve. Each later read is the watch answering a file event.
          yield* Queue.take(reads);
          // macOS's late event: the folder itself, with every byte as it was.
          yield* Queue.offer(events, { _tag: "Update", path: "/build" });
          yield* Queue.take(reads);
          content = "export default 2";
          yield* Queue.offer(events, { _tag: "Update", path: "/build/brain.mjs" });
          yield* Deferred.await(changed);
          expect(seen).toEqual([`Success ${sha("export default 1")}`, "Start", `Success ${sha("export default 2")}`]);
        }),
      ),
    ));
});
