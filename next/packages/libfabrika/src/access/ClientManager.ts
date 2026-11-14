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
 * The service that reads who belongs and writes membership events to the ledger.
 *
 * @stability unstable
 */
import { Context, Schema, type Effect } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { Appended } from "../ledger/Log.ts";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";
import { Reason, type Access, type MemberEvent } from "./Access.ts";

/**
 * Schema for what the founding screen gives: the name, the first person keys, and the first
 * window.
 *
 * **Details**
 *
 * `window` is null when no window key comes with the founding. When it is present and there is at
 * least one person key, it hangs under the first person key; with no person keys it is dropped.
 *
 * @stability unstable
 * @category models
 */
export const Founder = Schema.Struct({
  name: Schema.String,
  keys: Schema.Array(Schema.String),
  window: Schema.NullOr(Schema.String),
});
/**
 * The decoded type of `Founder`.
 *
 * @stability unstable
 * @category models
 */
export type Founder = typeof Founder.Type;

/**
 * Schema for what `write` answers: taken, ignored or refused.
 *
 * **Details**
 *
 * `applied` and `ignored` both mean the event is in the log, at `rev`. `ignored` carries the rule's
 * reason, because an earlier event won the race and the fold skips this one. `refused` means
 * nothing was written, and its reason is the rule's or the ledger's own.
 *
 * @stability unstable
 * @category models
 */
export const Written = Schema.TaggedUnion({
  /** In the log, and the fold takes it. */
  applied: { rev: Rev },
  /** In the log, but an earlier event won the race. */
  ignored: { rev: Rev, reason: Reason },
  /** Nothing written: the rule's reason, or the ledger's own. */
  refused: { reason: Schema.Union([Reason, Appended.cases.refused.fields.reason]) },
});
/**
 * The decoded type of `Written`.
 *
 * @stability unstable
 * @category models
 */
export type Written = typeof Written.Type;

/**
 * Service for who belongs: a read of the current view and a write of one event.
 *
 * **Details**
 *
 * `members` answers the `Access` view folded from the log. `write` takes an event and who is
 * writing it, and answers with a `Written`.
 *
 * @stability unstable
 * @category services
 */
export class ClientManager extends Context.Service<
  ClientManager,
  {
    readonly members: Effect.Effect<Access, LedgerError>;
    readonly write: (event: MemberEvent, from: From) => Effect.Effect<Written, LedgerError>;
  }
>()("@kampus/libfabrika/access/ClientManager") {}
