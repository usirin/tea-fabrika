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
