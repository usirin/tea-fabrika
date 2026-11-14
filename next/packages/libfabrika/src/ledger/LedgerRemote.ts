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
 * The `Ledger` in any object but the project's: the project's stub, across an object call (0095).
 *
 * @stability unstable
 */
import { Effect, Layer, Schema } from "effect";
import { short } from "../telemetry/Trace.ts";
import { pages } from "./internal/ledgerPages.ts";
import { STREAM, tag } from "./internal/ledgerTrace.ts";
import { Ledger, type LedgerCalls, LedgerError } from "./Ledger.ts";
import { Appended, Entry, Waited } from "./Log.ts";

/**
 * Layer that provides `Ledger` in any object but the project's, by calling the project object
 * through its stub.
 *
 * **Details**
 *
 * A rejected call fails as `unreachable`, and an answer that does not decode as `bad_row`. Each
 * call ends one `ledger.call` span on the caller's side. `caller.reader` is the object's own name,
 * such as `connection:t1`: the name the referee rings after a parked wait.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (stub: LedgerCalls, caller: { readonly reader: string }): Layer.Layer<Ledger> => {
  const call = Effect.fn("ledger.call")(function* <A, M extends keyof LedgerCalls>(
    name: M,
    stream: string,
    answer: Schema.Decoder<A>,
    ...args: Parameters<LedgerCalls[M]>
  ): Effect.fn.Return<A, LedgerError> {
    yield* Effect.annotateCurrentSpan({
      "rpc.method": name,
      ...short({ [STREAM]: stream, [tag("reader")]: caller.reader }),
    });
    const fail = (cause: unknown) => new LedgerError({ reason: "unreachable", cause });
    // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
    const io = Effect.tryPromise({ try: () => Reflect.apply(stub[name], stub, args), catch: fail });
    return yield* io.pipe(
      Effect.flatMap((raw) =>
        Schema.decodeUnknownEffect(answer)(raw).pipe(
          Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
        ),
      ),
      Effect.tapError((error) => Effect.annotateCurrentSpan(tag("reason"), error.reason)),
    );
  });
  const page = Schema.Array(Entry);
  return Layer.succeed(Ledger, {
    append: (stream, id, line) => call("append", stream, Appended, stream, id, line),
    read: (stream, after) => pages(after, (from) => call("read", stream, page, stream, from, caller.reader)),
    wait: (stream, after) => call("wait", stream, Waited, stream, after, caller.reader),
  });
};
