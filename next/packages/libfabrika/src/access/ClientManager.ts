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
 * The service that reads who belongs and writes membership events to the ledger.
 *
 * @stability unstable
 */
import { Context, Schema, type Effect } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { Appended } from "../ledger/Log.ts";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
