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
