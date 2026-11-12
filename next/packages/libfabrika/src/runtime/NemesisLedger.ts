/**
 * Bounded ledger reads with a caller-supplied trusted fault operation.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProcessHistory, type ProcessHistoryError } from "../processes/ProcessHistory.ts";
import * as Chaos from "./Chaos.ts";
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

const make = Effect.fnUntraced(function* (operation: Nemesis["Service"]["fire"]) {
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
