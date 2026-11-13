import { Context, type Effect, Schema } from "effect";
import type { Update } from "./Entry.ts";

export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

export class WatchersError extends Schema.TaggedError<WatchersError>()("WatchersError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/** Process-owned saved membership and fanout. Transport failures retain membership. */
export class Watchers extends Context.Service<
  Watchers,
  {
    readonly open: (client: string, whole: Extract<Update, { type: "whole" }>) => Effect.Effect<void, WatchersError>;
    readonly publish: (patch: Extract<Update, { type: "patch" }>) => Effect.Effect<void, WatchersError>;
  }
>()("@kampus/libfabrika/runtime/Watchers") {}
