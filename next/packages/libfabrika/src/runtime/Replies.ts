// Terminal replies, next/: a program's refusal kept under its registered name and stable letter, so a
// retry, a reopen or a successor process answers it again (Tier 1, P13). This file is the contract;
// `RepliesSql.layer` keeps them in the runtime's recovery SQL. The first stored row always wins, and a
// row that does not decode fails as `bad_row` and stays stored; it never reads as absent.
import { Context, type Effect, Schema } from "effect";
import type { Reply as ReplySchema } from "./internal/reply.ts";

export type Reply = typeof ReplySchema.Type;

export class RepliesError extends Schema.TaggedError<RepliesError>()("RepliesError", {
  /** `storage`: SQLite threw, or the store is full. `bad_row`: a stored reply does not decode or
   *  disagrees with its key. */
  reason: Schema.Literals(["storage", "bad_row"]),
  /** For a bad row, only the paths that failed: a decoder's own message may quote input text. */
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Replies extends Context.Service<
  Replies,
  {
    /** The terminal reply stored for this letter under this registered name, or null. */
    readonly reply: (name: string, id: string) => Effect.Effect<Reply | null, RepliesError>;
    /** Stores the reply unless its key holds one, and answers the first stored row. */
    readonly rememberReply: (reply: Reply) => Effect.Effect<Reply, RepliesError>;
  }
>()("@kampus/libfabrika/Replies") {}
