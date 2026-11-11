// The Ledger in any object but the project's: the project's stub, across an object call (0095).
// Tier 1, P6 (laws p18 to p20, p94 and p95).
import { Effect, Layer, Schema } from "effect";
import { short } from "../telemetry/Trace.ts";
import { pages } from "./internal/ledgerPages.ts";
import { STREAM, tag } from "./internal/ledgerTrace.ts";
import { Ledger, type LedgerCalls, LedgerError } from "./Ledger.ts";
import { Appended, Entry, Waited } from "./Log.ts";

/** Any other object: the project's stub. A rejected call is `unreachable`; an answer that does
 *  not decode, `bad_row`. Each call ends one `ledger.call` span on the caller's side.
 *  `caller.reader` is the object's own name, such as `connection:t1`. */
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
    const fail = () => new LedgerError({ reason: "unreachable" });
    // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
    const io = Effect.tryPromise({ try: () => Reflect.apply(stub[name], stub, args), catch: fail });
    return yield* io.pipe(
      Effect.flatMap((raw) =>
        Schema.decodeUnknownEffect(answer)(raw).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" }))),
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
