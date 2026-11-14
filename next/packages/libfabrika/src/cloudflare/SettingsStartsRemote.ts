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
 * Instance starts recorded and read through RPC calls to the object that keeps them.
 *
 * @stability unstable
 */
import { Effect, Layer, Schema } from "effect";
import * as Start from "../settings/Start.ts";
import {
  Decode,
  Missing,
  MissingTarget,
  Refused,
  Starts,
  StartsError,
  Storage,
  Unreachable,
} from "../settings/Starts.ts";
import * as SettingsInput from "./SettingsInput.ts";

/**
 * The two RPC calls the layer makes. The Project object's binding has this shape.
 *
 * @stability unstable
 * @category models
 */
export interface Calls {
  readonly settingsStart: (input: Start.Input) => PromiseLike<unknown>;
  readonly settingsRead: (start: string) => PromiseLike<unknown>;
}

const unreachable = (cause: unknown) => new StartsError({ reason: new Unreachable({ cause }) });

/**
 * Layer that records and reads instance starts by calling the object that keeps them.
 *
 * **Details**
 *
 * No reply is trusted as it comes. Each one is decoded. An `ok` receipt is checked again, must be
 * for the asked start, and on `record` must match the input. A call that throws fails with
 * `Unreachable`. A failed reply fails with the same reason here.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (calls: Calls) =>
  Layer.succeed(Starts, {
    record: (input) =>
      call(
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted Project settings-start RPC enters Effect
        Effect.tryPromise({ try: () => calls.settingsStart(input), catch: unreachable }),
        input.start,
        input,
      ),
    read: (start) =>
      call(
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted Project settings-read RPC enters Effect
        Effect.tryPromise({ try: () => calls.settingsRead(start), catch: unreachable }),
        start,
      ),
  });

const call = Effect.fnUntraced(function* (
  work: Effect.Effect<unknown, StartsError>,
  start: string,
  input?: Start.Input,
) {
  yield* Schema.decodeUnknownEffect(Start.Input.fields.start)(start).pipe(
    Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
  );
  const raw = yield* work;
  const reply = yield* Schema.decodeUnknownEffect(Start.Reply)(raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
  );

  if (reply._tag === "ok") {
    const saved = yield* SettingsInput.receipt(reply.value, input).pipe(
      Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
    );

    if (saved.start !== start) {
      return yield* new StartsError({ reason: new Decode({ cause: "Start acknowledgement mismatch" }) });
    }

    return saved;
  }

  const reason =
    reply._tag === "Missing"
      ? new Missing({ target: MissingTarget.cases.instance.make({ start }) })
      : reply._tag === "Decode"
        ? new Decode({ cause: reply })
        : reply._tag === "Refused"
          ? new Refused({ cause: reply })
          : reply._tag === "Storage"
            ? new Storage({ cause: reply })
            : new Unreachable({ cause: reply });
  return yield* new StartsError({ reason });
});
