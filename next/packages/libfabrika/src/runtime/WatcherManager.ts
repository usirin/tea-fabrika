import { Context, type Effect, Schema } from "effect";
import type { Update } from "./Entry.ts";

/** A normal notify return is sent, not a browser acknowledgement. */
export const Publication = Schema.TaggedUnion({ sent: {}, gone: {} });

export class Gone extends Schema.TaggedError<Gone>()("Gone", { cause: Schema.Defect() }) {}

export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

export class WatcherManagerError extends Schema.TaggedError<WatcherManagerError>()("WatcherManagerError", {
  reason: Schema.Union([Gone, Unreachable]),
}) {}

/** Delivers a view to one client; only confirmed absence ends a watch. */
export class WatcherManager extends Context.Service<
  WatcherManager,
  {
    readonly publish: (client: string, update: Update) => Effect.Effect<void, WatcherManagerError>;
  }
>()("@kampus/libfabrika/runtime/Entry.WatcherManager") {}
