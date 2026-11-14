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
 * One client's repository opening, held as the state of the opening machine.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Effect, Ref } from "effect";
import { machine } from "./internal/open.ts";

/**
 * A selection after its checks: the repository's id and key, a label to show, the pinned branch,
 * commit and document hash, whether the document is there, its settings snapshot, and the person
 * opening it.
 *
 * @stability unstable
 * @category models
 */
export type CheckedSelection = import("./internal/open.ts").CheckedSelection;
type Msg = typeof machine.msg.Type;
type State = typeof machine.model.Type;

/**
 * Creates one client's opening session: the state of one repository opening, which changes only
 * when `send` hands the opening machine a Msg. `send` answers the state after the Msg.
 *
 * **Details**
 *
 * The states are `closed`, `checking`, `awaiting_trust`, `saving`, `ready` and `refused`. A Msg
 * out of turn, or for another selection, leaves the state as it is; `select` and `close` always
 * apply.
 *
 * @stability unstable
 * @category constructors
 */
export const session = Effect.fn("repositoryOpen.session")(function* () {
  const state = yield* Ref.make(machine.init(null, undefined)[0]);
  return {
    send: Effect.fn("repositoryOpen.send")(function* (msg: Msg): Effect.fn.Return<State> {
      return yield* Ref.modify(state, (current) => {
        const [next] = applyCell(machine, current, msg);
        return [next, next];
      });
    }),
  };
});
