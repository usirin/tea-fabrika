/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
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
    /** Sends one patch to every saved watcher, one after another. */
    readonly publish: (patch: Extract<Update, { type: "patch" }>) => Effect.Effect<void, WatchersError>;
  }
>()("@kampus/libfabrika/runtime/Watchers") {}
