import { applyCell } from "@demlik/tea";
import { Effect, Ref } from "effect";
import { machine } from "./internal/open.ts";

export type CheckedSelection = import("./internal/open.ts").CheckedSelection;
type Msg = typeof machine.msg.Type;
type State = typeof machine.model.Type;

/** One client owns a session. All changes pass through the opening machine. */
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
