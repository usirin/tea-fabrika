import { Context, Schema, type Effect } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { Appended } from "../ledger/Log.ts";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";
import { Reason, type Access, type MemberEvent } from "./Access.ts";

/** What the founding screen gives: the name, the first person keys, and the first window. */
export const Founder = Schema.Struct({
  name: Schema.String,
  keys: Schema.Array(Schema.String),
  window: Schema.NullOr(Schema.String),
});
export type Founder = typeof Founder.Type;

/** What `write` answers. */
export const Written = Schema.TaggedUnion({
  /** In the log, and the fold takes it. */
  applied: { rev: Rev },
  /** In the log, but an earlier event won the race (flag 6). */
  ignored: { rev: Rev, reason: Reason },
  /** Nothing written: the rule's reason, or the ledger's own. */
  refused: { reason: Schema.Union([Reason, Appended.cases.refused.fields.reason]) },
});
export type Written = typeof Written.Type;

export class ClientManager extends Context.Service<
  ClientManager,
  {
    readonly members: Effect.Effect<Access, LedgerError>;
    readonly write: (event: MemberEvent, from: From) => Effect.Effect<Written, LedgerError>;
  }
>()("@kampus/libfabrika/access/ClientManager") {}
