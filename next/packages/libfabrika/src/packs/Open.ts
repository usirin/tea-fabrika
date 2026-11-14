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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
export const session = Effect.fn("repositoryOpen.session")(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
