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
 * Read through the ledger's paged stream, preserving failures from every page.
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
