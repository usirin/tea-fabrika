// Terminal replies, next/: a program's refusal kept under its registered name and stable letter, so a
// retry, a reopen or a successor process answers it again (Tier 1, P13). One SQL transaction reads
// the row, sends the reply machine its Msg and inserts what it remembers: the first row always wins.
// A row that does not decode fails as `bad_row` and stays stored; it never reads as absent.
import { applyCell } from "@demlik/tea";
import { Context, Effect, Layer, Result, Schema, SchemaIssue } from "effect";
import type { Sql } from "../Sql.ts";
import { Model, Reply, reply as machine } from "./internal/reply.ts";

export { Reply };
export type Reply = typeof Reply.Type;

export class RepliesError extends Schema.TaggedError<RepliesError>()("RepliesError", {
  /** `storage`: SQLite threw, or the store is full. `bad_row`: a stored reply does not decode or
   *  disagrees with its key. */
  reason: Schema.Literals(["storage", "bad_row"]),
  /** For a bad row, only the paths that failed: a decoder's own message may quote input text. */
  cause: Schema.optional(Schema.Defect()),
}) {}

const TABLE =
  "CREATE TABLE IF NOT EXISTS process_replies (name TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, id))";

const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Reply));
const encode = Schema.encodeSync(Schema.fromJsonString(Reply));
const issues = SchemaIssue.makeFormatterStandardSchemaV1();

const bytes = (text: string) => new TextEncoder().encode(text).length;

const badRow = (detail: string) => new RepliesError({ reason: "bad_row", cause: new Error(detail) });

/** The stored reply under this key as the machine's Model; a row that fails throws `bad_row`. */
const load = (sql: Sql, name: string, id: string): typeof Model.Type => {
  sql.exec(TABLE);
  const [row] = sql.exec("SELECT value FROM process_replies WHERE name=? AND id=?", name, id);

  if (row === undefined) {
    return Model.cases.empty.make({});
  }

  const saved = decode(row.value);

  if (Result.isFailure(saved)) {
    const paths = issues(saved.failure.issue).issues.map((i) => (i.path ?? []).map(String).join(".") || "row");
    throw badRow(`a stored reply does not decode at ${paths.join(", ")}`);
  }

  if (saved.success.name !== name || saved.success.id !== id) {
    throw badRow("a stored reply disagrees with its key");
  }

  return Model.cases.remembered.make({ reply: saved.success });
};

/** Sends the stored Model its `remember` Msg and inserts what it newly remembers. Run inside one
 *  transaction, so a failed or full write keeps nothing. */
const remember = (sql: Sql, capacity: number, reply: Reply): Reply => {
  const model = load(sql, reply.name, reply.id);
  const [next] = applyCell(machine, model, { type: "remember", reply });

  // The machine never forgets: a remember always leaves a remembered Model.
  if (next._tag !== "remembered") {
    throw new RepliesError({ reason: "storage" });
  }

  if (model._tag === "empty") {
    const value = encode(next.reply);

    if (sql.size() + bytes(reply.name) + bytes(reply.id) + bytes(value) > capacity) {
      throw new RepliesError({ reason: "storage" });
    }

    sql.exec("INSERT INTO process_replies (name,id,value) VALUES (?,?,?)", reply.name, reply.id, value);
  }

  return next.reply;
};

export class Replies extends Context.Service<
  Replies,
  {
    /** The terminal reply stored for this letter under this registered name, or null. */
    readonly reply: (name: string, id: string) => Effect.Effect<Reply | null, RepliesError>;
    /** Stores the reply unless its key holds one, and answers the first stored row. */
    readonly rememberReply: (reply: Reply) => Effect.Effect<Reply, RepliesError>;
  }
>()("@kampus/libfabrika/Replies") {
  /** Replies in the runtime's own recovery SQL, within its storage capacity. */
  static readonly layer = (sql: Sql, limits: { readonly capacity: number }): Layer.Layer<Replies> => {
    const stored = <A>(f: () => A) =>
      Effect.try({
        try: f,
        catch: (error) =>
          error instanceof RepliesError ? error : new RepliesError({ reason: "storage", cause: error }),
      });
    return Layer.succeed(Replies, {
      reply: Effect.fn("replies.reply")(function* (name: string, id: string) {
        const model = yield* stored(() => load(sql, name, id));
        return model._tag === "remembered" ? model.reply : null;
      }),
      rememberReply: Effect.fn("replies.remember")(function* (reply: Reply) {
        return yield* stored(() => sql.transaction(() => remember(sql, limits.capacity, reply)));
      }),
    });
  };
}
