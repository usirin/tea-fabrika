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
 * Turns one incoming JSON-RPC text frame into the text to send back and the attachment to keep.
 *
 * @stability unstable
 */
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { REFUSED } from "../SpanTag.ts";
import type { Admission, Who } from "./Wire.ts";
import { Answer, Attached, RateCountFailure } from "./Wire.ts";

const Request = Schema.fromJsonString(
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Number]),
    method: Schema.String,
    params: Schema.optional(Schema.Unknown),
  }),
);

type Online = typeof Attached.cases.online.Type;

type Frame<A extends typeof Attached.Type, E, R, E2, R2> = [
  text: string,
  attached: A,
  _admit: (key: string) => Effect.Effect<typeof Admission.Type, E2, R2>,
  route: (
    method: string,
    params: unknown,
    ...identity: A extends Online ? [identity: typeof Who.Type] : []
  ) => Effect.Effect<typeof Answer.Type, E, R>,
];

type Incoming<E, R, E2, R2> = Frame<Online, E, R, E2, R2> | Frame<Exclude<typeof Attached.Type, Online>, E, R, E2, R2>;

const isOnline = <E, R, E2, R2>(frame: Incoming<E, R, E2, R2>): frame is Frame<Online, E, R, E2, R2> =>
  frame[1]._tag === "online";

/**
 * Answers one JSON-RPC 2.0 text frame by calling `route` and shaping its answer for the wire.
 *
 * **Details**
 *
 * Takes the frame as four arguments: the text, the connection's current `Attached` state, an
 * admit function, and the route. The result is `{ send, attached }`: `send` is the text to write
 * back, or `null` when nothing is written, and `attached` is the state to save. The admit
 * function is accepted but this function never calls it. Only an online connection passes its
 * identity to `route`.
 *
 * - Text that is not a JSON-RPC 2.0 request sends nothing and keeps `attached`.
 * - A connection that is not online answers every request with a `no_hello` error, except that a
 *   waiting one may still call `gateway.knock`. `route` is not called for the refused request.
 * - An `ok` answer becomes a JSON-RPC result. A `refused` answer becomes a `-32000` error whose
 *   message and `data.reason` are the reason, plus `data.retryAfter` when the answer has one.
 * - A `parked` answer sends nothing. On an online connection it adds the request's id, stream and
 *   position to `waits`, so a later ring can answer it. Otherwise `attached` is unchanged.
 * - If `route` fails, nothing is sent and `attached` is unchanged. The failure is not rethrown.
 *
 * **Gotchas**
 *
 * A `reserved` or `rate_limited` refusal, and a failure that is a `RateCountFailure`, are also
 * recorded on the current span as the refused tag. The tag is `rate_limited` for that failure.
 *
 * @stability unstable
 * @category combinators
 */
export const answerFrame = Effect.fn("transport.answerFrame")(function* <E, R, E2, R2, A extends typeof Attached.Type>(
  ...frame: Incoming<E, R, E2, R2> & { readonly 1: A }
) {
  const text = frame[0];
  const attached: A = frame[1];
  const request = Schema.decodeUnknownResult(Request)(text);

  if (Result.isFailure(request)) {
    return { send: null, attached };
  }

  const { id, method, params } = request.success;

  if (attached._tag !== "online" && !(attached._tag === "waiting" && method === "gateway.knock")) {
    return {
      send: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "no_hello", data: { reason: "no_hello" } },
      }),
      attached,
    };
  }

  const exit = yield* Effect.exit(
    isOnline(frame) ? frame[3](method, params, frame[1].identity) : frame[3](method, params),
  );

  if (Exit.isFailure(exit)) {
    if (Schema.is(RateCountFailure)(Cause.squash(exit.cause))) {
      yield* Effect.annotateCurrentSpan(REFUSED, "rate_limited");
    }

    return { send: null, attached };
  }

  if (exit.value._tag === "refused" && ["reserved", "rate_limited"].includes(exit.value.reason)) {
    yield* Effect.annotateCurrentSpan(REFUSED, exit.value.reason);
  }

  return Answer.match(exit.value, {
    ok: ({ result }) => ({ send: JSON.stringify({ jsonrpc: "2.0", id, result }), attached }),
    refused: ({ reason, retryAfter }) => ({
      send: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: reason, data: { reason, ...(retryAfter === undefined ? {} : { retryAfter }) } },
      }),
      attached,
    }),
    parked: ({ stream, after }) => ({
      send: null,
      attached:
        attached._tag === "online"
          ? Attached.cases.online.make({
              ...attached,
              waits: [...attached.waits, { id, stream, after }],
            })
          : attached,
    }),
  });
});
