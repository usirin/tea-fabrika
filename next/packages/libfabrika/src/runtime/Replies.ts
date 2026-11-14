/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * Terminal replies: a program's refusal kept under its registered name and stable letter, so a
 * retry, a reopen or a successor process answers it again. This file holds the contract only
 * (0095); `RepliesSql.layer` keeps the replies in the runtime's recovery SQL.
 *
 * @stability unstable
 */
import { Context, type Effect, Schema } from "effect";
import type { Reply as ReplySchema } from "./internal/reply.ts";

/**
 * One terminal reply as it is stored: the registered name and stable letter it is kept under, the
 * input it first answered, who wrote that input and for whom, a digest that binds the writer to
 * the input, and the refusal itself.
 *
 * @stability unstable
 * @category models
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Reply = typeof ReplySchema.Type;

/**
 * Error for a terminal reply that could not be read or stored.
 *
 * @stability unstable
 * @category errors
 */
export class RepliesError extends Schema.TaggedError<RepliesError>()("RepliesError", {
  /** `storage`: SQLite threw, or the store is full. `bad_row`: a stored reply does not decode or
   *  disagrees with its key. */
  reason: Schema.Literals(["storage", "bad_row"]),
  /** For a bad row, only the paths that failed: a decoder's own message may quote input text. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Service that keeps a program's refusal of a letter, so the same letter gets the same answer
 * again from a retry, a reopen or a successor process.
 *
 * **Details**
 *
 * A reply is kept under its registered name and its stable letter id. The first stored reply
 * always wins: a later one for the same key changes nothing.
 *
 * **Gotchas**
 *
 * A row that does not decode fails with `bad_row` and stays stored. It never reads as absent, so a
 * damaged reply cannot turn a refused letter into a fresh one.
 *
 * @stability unstable
 * @category services
 */
export class Replies extends Context.Service<
  Replies,
  {
    /** The terminal reply stored for this letter under this registered name, or null. */
    readonly reply: (name: string, id: string) => Effect.Effect<Reply | null, RepliesError>;
    /** Stores the reply unless its key holds one, and answers the first stored row. */
    readonly rememberReply: (reply: Reply) => Effect.Effect<Reply, RepliesError>;
  }
>()("@kampus/libfabrika/runtime/Replies") {}
