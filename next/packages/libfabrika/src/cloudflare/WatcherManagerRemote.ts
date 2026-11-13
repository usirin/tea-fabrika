import { Effect, Layer, Schema } from "effect";
import type { Update } from "../runtime/Entry.ts";
import { Gone, Publication, Unreachable, WatcherManager, WatcherManagerError } from "../runtime/WatcherManager.ts";

/** Decode the boundary before interpreting absence. Unknown replies never end a watch. */
export const layer = <E>(
  publish: (client: string, update: Update) => Effect.Effect<unknown, E>,
): Layer.Layer<WatcherManager> =>
  Layer.succeed(WatcherManager, {
    publish: Effect.fn("watchers.remote.publish")(function* (client: string, update: Update) {
      const outcome = yield* Effect.suspend(() => publish(client, update)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Publication)),
        Effect.mapError((cause) => new WatcherManagerError({ reason: new Unreachable({ cause }) })),
      );

      if (outcome._tag === "gone") {
        return yield* new WatcherManagerError({ reason: new Gone({ cause: outcome }) });
      }
    }),
  });
