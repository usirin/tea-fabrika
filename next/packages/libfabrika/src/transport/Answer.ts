import { Effect, Exit, Result, Schema } from "effect";
import type { Admission, Who } from "./Wire.ts";
import { Answer, Attached } from "./Wire.ts";

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
    return { send: null, attached };
  }

  return Answer.match(exit.value, {
    ok: ({ result }) => ({ send: JSON.stringify({ jsonrpc: "2.0", id, result }), attached }),
    refused: ({ reason }) => ({
      send: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: reason, data: { reason } },
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
