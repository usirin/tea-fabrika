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
 * Bounded ledger reads with a caller-supplied trusted fault operation.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProcessHistory, type ProcessHistoryError } from "../processes/ProcessHistory.ts";
import * as Chaos from "./Chaos.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { BadRow, Nemesis, NemesisError, Storage, Unreachable } from "./Nemesis.ts";

const translate = (cause: ProcessHistoryError): NemesisError =>
  new NemesisError({
    reason:
      cause.reason._tag === "Unreachable"
        ? new Unreachable({ cause })
        : cause.reason._tag === "BadRow"
          ? new BadRow({ cause })
          : new Storage({ cause }),
  });

const make = Effect.fnUntraced(function* (operation: Nemesis["Service"]["fire"]) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const history = yield* ProcessHistory;

  return Nemesis.of({
    fire: Effect.fn("nemesis.fire")(function* (request: Chaos.Fire) {
      return yield* operation(request);
    }),
    check: Effect.fn("nemesis.check")(function* (target: Chaos.Target) {
      const { letters, ...snapshot } = yield* history.read(target.name).pipe(Effect.mapError(translate));
      const counts = Chaos.checkHistory(letters);
      yield* Effect.annotateCurrentSpan({
        "fab.nemesis.letters": counts.letters,
        "fab.nemesis.doubled": counts.doubled,
        "fab.nemesis.gaps": counts.gaps,
        "fab.nemesis.boundary": snapshot.boundary,
        "fab.nemesis.processBoundary": snapshot.processBoundary,
      });
      return Chaos.Report.make({
        ...counts,
        ...snapshot,
      });
    }),
  });
});

/**
 * Compose history checking with an explicitly supplied fault operation.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (operation: Nemesis["Service"]["fire"]): Layer.Layer<Nemesis, never, ProcessHistory> =>
  Layer.effect(Nemesis, make(operation));
