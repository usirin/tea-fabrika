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
 * The access machine stepped synchronously, so a fold runs inside a ledger transaction.
 *
 * **Details**
 *
 * It sends `fold` messages through `applyCell` and reads the reply. It never builds or edits a
 * Model itself.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Result } from "effect";
import type { Access, Folded, MemberEvent, Reason } from "./Access.ts";
import { access, members } from "./Access.ts";

/**
 * The Model before any event: the machine's own init, which is `unfounded`.
 *
 * @stability unstable
 * @category models
 */
export const EMPTY: Folded = access.init(null, {})[0];

const step = (model: Folded, event: MemberEvent): Folded => {
  const [next] = applyCell(access, model, { type: "fold", event });
  return next;
};

/**
 * Returns the Model after an event, or the reason the event changes nothing.
 *
 * **Details**
 *
 * It is the one rule: `foldAccess` skips what it refuses, and `ClientManager.write` answers with
 * it, so the door and the view never drift.
 *
 * **Gotchas**
 *
 * An event whose id was already taken is accepted and leaves the Model as it was. Any event but
 * `founded` is refused with `not_member` on an unfounded Model.
 *
 * @stability unstable
 * @category combinators
 */
export const allows = (model: Folded, event: MemberEvent): Result.Result<Folded, Reason> => {
  const next = step(model, event);
  return next.reply._tag === "accepted" ? Result.succeed(next) : Result.fail(next.reply.reason);
};

/**
 * Returns who belongs after every event in order, each one taken or refused by the machine.
 *
 * **Gotchas**
 *
 * A refused event is skipped without error, so a later event can still be taken.
 *
 * @stability unstable
 * @category combinators
 */
export const foldAccess = (events: ReadonlyArray<MemberEvent>): Access => {
  return members(events.reduce(step, EMPTY));
};
