/**
 * Bounded ledger reads with a caller-supplied trusted fault operation.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Ledger, type LedgerError } from "../ledger/Ledger.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import { inbox } from "../processes/Mailbox.ts";
import { ProcessEvent } from "../processes/Process.ts";
import * as Chaos from "./Chaos.ts";
import { BadRow, Nemesis, NemesisError, Storage, Unreachable } from "./Nemesis.ts";

const Send = Schema.Struct({ m: Schema.Json });
const Position = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

const translate = (cause: LedgerError): NemesisError =>
  new NemesisError({
    reason:
      cause.reason === "unreachable"
        ? new Unreachable({ cause })
        : cause.reason === "bad_row"
          ? new BadRow({ cause })
          : new Storage({ cause }),
  });

const validate = Effect.fnUntraced(function* (entry: Entry) {
  yield* Schema.decodeUnknownEffect(Position)(entry.pos).pipe(
    Effect.mapError((cause) => new NemesisError({ reason: new BadRow({ cause }) })),
  );

  if (entry._tag === "send") {
    yield* Schema.decodeUnknownEffect(Send)(entry.body).pipe(
      Effect.mapError((cause) => new NemesisError({ reason: new BadRow({ cause }) })),
    );
  }

  if (entry._tag === "restarted") {
    yield* Schema.decodeUnknownEffect(ProcessEvent.cases.restarted)(valueFor(entry)).pipe(
      Effect.mapError((cause) => new NemesisError({ reason: new BadRow({ cause }) })),
    );
  }

  return entry;
});

const make = Effect.fnUntraced(function* (operation: Nemesis["Service"]["fire"]) {
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

  return Nemesis.of({
    fire: Effect.fn("nemesis.fire")(function* (request: Chaos.Fire) {
      return yield* operation(request);
    }),
    check: Effect.fn("nemesis.check")(function* (target: Chaos.Target) {
      const stream = inbox(target.name);
      const processStream = `processes/${target.name}`;
      // Capture both heads before consuming either stream. They are not an atomic snapshot.
      const boundary = yield* head(stream);
      const processBoundary = yield* head(processStream);
      const letters = yield* read(stream, boundary);
      const processes = yield* read(processStream, processBoundary);
      const counts = Chaos.checkHistory(letters.filter((entry) => entry._tag === "send"));
      yield* Effect.annotateCurrentSpan({
        "fab.nemesis.letters": counts.letters,
        "fab.nemesis.doubled": counts.doubled,
        "fab.nemesis.gaps": counts.gaps,
        "fab.nemesis.boundary": boundary,
        "fab.nemesis.processBoundary": processBoundary,
      });
      return Chaos.Report.make({
        ...counts,
        stream,
        boundary,
        processStream,
        processBoundary,
        restarts: Chaos.restarts(processes),
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
export const layer = (operation: Nemesis["Service"]["fire"]): Layer.Layer<Nemesis, never, Ledger> =>
  Layer.effect(Nemesis, make(operation));
