/**
 * Saved view membership and fanout: which clients watch a process's view, and how each update
 * reaches them. This file holds the contract only (0095); `WatchersSql.layer` keeps the membership.
 *
 * @stability unstable
 */
import { Context, type Effect, Schema } from "effect";
import type { Update } from "./Entry.ts";

/**
 * Error for a membership read or write that failed in the store.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Error for a saved membership row that does not decode, or that is stored under another name.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Error for saved view membership that could not be read or written. A delivery that fails is never
 * one: it either ends that client's watch or leaves it in place.
 *
 * @stability unstable
 * @category errors
 */
export class WatchersError extends Schema.TaggedError<WatchersError>()("WatchersError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/**
 * Service for a process's saved view membership and fanout. Transport failures retain membership.
 *
 * **Details**
 *
 * `open` saves a client and sends it the whole view; `publish` sends one patch to every saved
 * client.
 *
 * @stability unstable
 * @category services
 */
export class Watchers extends Context.Service<
  Watchers,
  {
    /**
     * Saves the client as a watcher at the whole view's rev, then sends it that whole view. At most
     * 1,024 clients are held: one more drops the client that opened longest ago.
     */
    readonly open: (client: string, whole: Extract<Update, { type: "whole" }>) => Effect.Effect<void, WatchersError>;
    /** Sends one update to every saved watcher, one after another: a step's patch, or the whole view after a swap. */
    readonly publish: (update: Update) => Effect.Effect<void, WatchersError>;
  }
>()("@kampus/libfabrika/runtime/Watchers") {}
