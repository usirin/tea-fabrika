// The access machine stepped synchronously, so a fold runs inside a ledger transaction. It sends
// `fold` Msgs through `applyCell` and reads the reply; it never builds or edits a Model itself.
import { applyCell } from "@demlik/tea";
import { Result } from "effect";
import type { Access, Folded, MemberEvent, Reason } from "./Access.ts";
import { access, members } from "./Access.ts";

/** The Model before any event: the machine's own init. */
export const EMPTY: Folded = access.init(null, {})[0];

const step = (model: Folded, event: MemberEvent): Folded => {
  const [next] = applyCell(access, model, { type: "fold", event });
  return next;
};

/**
 * The one rule: what an event does to who belongs, or why it does nothing. The fold skips what it
 * refuses, and `ClientManager.write` answers with it, so the door and the view never drift.
 */
export const allows = (model: Folded, event: MemberEvent): Result.Result<Folded, Reason> => {
  const next = step(model, event);
  return next.reply._tag === "accepted" ? Result.succeed(next) : Result.fail(next.reply.reason);
};

/** Every event in order, each one taken or refused by the machine. */
export const foldAccess = (events: ReadonlyArray<MemberEvent>): Access => {
  return members(events.reduce(step, EMPTY));
};
