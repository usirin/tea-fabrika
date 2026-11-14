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
 * Paged history reads stopped at each stream's captured head.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Ledger, type LedgerError } from "../ledger/Ledger.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import { inbox } from "./Mailbox.ts";
import { ProcessEvent, ProcessTable } from "./Process.ts";
import { BadRow, ProcessHistory, ProcessHistoryError, Storage, Unreachable } from "./ProcessHistory.ts";

const Send = Schema.Struct({ m: Schema.Json });
const Position = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const badRow = (cause: unknown) => new ProcessHistoryError({ reason: new BadRow({ cause }) });

const translate = (cause: LedgerError): ProcessHistoryError =>
  new ProcessHistoryError({
    reason:
      cause.reason === "unreachable"
        ? new Unreachable({ cause })
        : cause.reason === "bad_row"
          ? new BadRow({ cause })
          : new Storage({ cause }),
  });

const validate = Effect.fnUntraced(function* (entry: Entry) {
  yield* Schema.decodeUnknownEffect(Position)(entry.pos);

  if (entry._tag === "send") {
    yield* Schema.decodeUnknownEffect(Send)(entry.body);
  }

  if (entry._tag === "restarted") {
    yield* Schema.decodeUnknownEffect(ProcessEvent.cases.restarted)(valueFor(entry));
  }

  return entry;
}, Effect.mapError(badRow));

/**
 * Layer that answers `ProcessHistory` from the ledger's paged streams, keeping the failure of any
 * page.
 *
 * @stability unstable
 * @category layers
 */
export const layer: Layer.Layer<ProcessHistory, never, Ledger> = Layer.effect(
  ProcessHistory,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const head = Effect.fnUntraced(function* (stream: string) {
      const waited = yield* ledger.wait(stream, 0).pipe(Effect.mapError(translate));
      return waited._tag === "ready" ? waited.rev : 0;
    });
    const read = Effect.fnUntraced(function* (stream: string, boundary: number) {
      if (boundary === 0) {
        return [];
      }

      return yield* ledger.read(stream, 0).pipe(
        Stream.takeWhile((entry) => entry.rev <= boundary),
        Stream.mapError(translate),
        Stream.mapEffect(validate),
        Stream.runCollect,
      );
    });

    return ProcessHistory.of({
      read: Effect.fn("process_history.read")(function* (name: string) {
        const stream = inbox(name);
        const processStream = ProcessTable.events(name);
        // Capture both heads before reading either. They are separate snapshots.
        const boundary = yield* head(stream);
        const processBoundary = yield* head(processStream);
        const letters = yield* read(stream, boundary);
        const processes = yield* read(processStream, processBoundary);
        const restarts = [];

        for (const entry of processes) {
          if (entry._tag !== "restarted") {
            continue;
          }

          const event = yield* Schema.decodeUnknownEffect(ProcessEvent.cases.restarted)(valueFor(entry)).pipe(
            Effect.mapError(badRow),
          );

          if (entry.stream === ProcessTable.events(event.name)) {
            restarts.push({
              ref: entry.id,
              rev: entry.rev,
              arrivedAt: entry.arrivedAt,
              name: event.name,
              after: event.after,
              process: event.process,
            });
          }
        }

        return {
          stream,
          boundary,
          processStream,
          processBoundary,
          letters: letters.filter((entry) => entry._tag === "send").map(({ id, pos }) => ({ id, pos })),
          restarts,
        };
      }),
    });
  }),
);
