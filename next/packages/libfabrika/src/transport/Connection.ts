import { Effect, Result, Schema, Semaphore } from "effect";
import { Answer, type Attached, Wait } from "./Wire.ts";
const Waited = Schema.TaggedUnion({ ready: { rev: Schema.Number }, parked: {} });

const Request = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.String,
  params: Schema.Unknown,
});

const Read = Schema.Struct({
  stream: Schema.String,
  after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type Options<E, ReadError> = {
  readonly reader: string;
  readonly session: string;
  readonly ping: () => number | null;
  readonly read: () => typeof Attached.Type | Effect.Effect<typeof Attached.Type, ReadError>;
  readonly save: (a: typeof Attached.Type) => void;
  readonly send: (text: string) => void;
  readonly close: (code: number) => void;
  readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<typeof Waited.Type, E>;
  readonly call: (method: string, params: unknown) => Effect.Effect<typeof Answer.Type, E>;
};

export const connection = <E, ReadError = never>(options: Options<E, ReadError>) => {
  const turn = Semaphore.makeUnsafe(1);
  const read = Effect.suspend(() => {
    const state = options.read();
    return Effect.isEffect(state) ? state : Effect.succeed(state);
  });
  const respond = (id: string | number, answer: typeof Answer.Type) => {
    if (answer._tag === "parked") {
      return;
    }

    options.send(
      JSON.stringify(
        answer._tag === "ok"
          ? { jsonrpc: "2.0", id, result: answer.result }
          : {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: answer.reason, data: { reason: answer.reason } },
            },
      ),
    );
  };
  const remove = Effect.fnUntraced(function* (wait: typeof Wait.Type, answer: typeof Answer.Type) {
    const now = yield* read;

    if (
      now._tag !== "online" ||
      !now.waits.some((w) => w.id === wait.id && w.stream === wait.stream && w.after === wait.after)
    ) {
      return;
    }

    options.save({ ...now, waits: now.waits.filter((w) => w.id !== wait.id) });
    respond(wait.id, answer);
  });
  const register = Effect.fnUntraced(function* (wait: typeof Wait.Type) {
    const answer = yield* Effect.result(options.wait(wait.stream, wait.after, options.reader));

    if (Result.isFailure(answer)) {
      const error = answer.failure;
      const reason =
        typeof error === "object" && error !== null && "reason" in error && typeof error.reason === "string"
          ? error.reason
          : "unreachable";
      yield* remove(wait, Answer.cases.refused.make({ reason }));
    } else if (answer.success._tag === "ready") {
      yield* remove(wait, Answer.cases.ok.make({ result: { rev: answer.success.rev } }));
    }

    return Result.isSuccess(answer) && answer.success._tag === "parked";
  });
  const parked = Effect.fnUntraced(function* (id: string | number, params: unknown) {
    const now = yield* read;

    if (now._tag !== "online") {
      return respond(id, Answer.cases.refused.make({ reason: "no_hello" }));
    }

    const decoded = Schema.decodeUnknownResult(Read)(params);

    if (Result.isFailure(decoded)) {
      return respond(id, Answer.cases.refused.make({ reason: "bad_input" }));
    }

    const wait = Wait.make({ id, ...decoded.success });
    const next = { ...now, waits: [...now.waits, wait] };

    if (
      now.waits.some((w) => w.id === id) ||
      next.waits.length > 64 ||
      new TextEncoder().encode(JSON.stringify(next)).length > 16_384
    ) {
      return respond(id, Answer.cases.refused.make({ reason: "too_many_waits" }));
    }

    options.save(next);
    yield* register(wait);
  });
  const ordinary = Effect.fnUntraced(function* (request: typeof Request.Type) {
    const now = yield* read;

    if (now._tag !== "online" && !["initialize", "gateway.knock"].includes(request.method)) {
      return respond(request.id, Answer.cases.refused.make({ reason: "no_hello" }));
    }

    if (now._tag === "online") {
      options.save({ ...now, busy: true });
    }

    const answer = yield* options.call(request.method, request.params);
    respond(request.id, answer);
    const latest = yield* read;

    if (latest._tag === "online") {
      options.save({ ...latest, busy: false });
    }
  });
  return {
    frame: Effect.fn("connection.frame")(function* (text: string) {
      const parsed = Result.try({ try: () => JSON.parse(text), catch: () => null });

      if (Result.isFailure(parsed)) {
        return;
      }

      const decoded = Schema.decodeUnknownResult(Request)(parsed.success);

      if (Result.isFailure(decoded)) {
        return;
      }

      const request = decoded.success;

      if (request.method === "ledger.wait") {
        return yield* parked(request.id, request.params);
      }

      yield* ordinary(request).pipe(turn.withPermit);
    }),
    ring: Effect.fn("connection.ring")(function* (stream: string, rev: number) {
      const now = yield* read;

      if (now._tag === "online") {
        for (const wait of now.waits) {
          if (wait.stream === stream && rev > wait.after) {
            yield* remove(wait, Answer.cases.ok.make({ result: { rev } }));
          }
        }
      }

      while (true) {
        const latest = yield* read;

        if (latest._tag !== "online") {
          return;
        }

        const next = latest.waits
          .filter((wait) => wait.stream === stream)
          .reduce<typeof Wait.Type | undefined>(
            (first, wait) => (first === undefined || wait.after < first.after ? wait : first),
            undefined,
          );

        if (next === undefined || (yield* register(next))) {
          return;
        }
      }
    }),
    wake: Effect.fn("connection.wake")(function* () {
      const now = yield* read;

      if (now._tag === "online" && now.busy) {
        options.close(1012);
      }
    }),
    probe: Effect.fn("connection.probe")(function* (session: string) {
      return session === options.session && (yield* read)._tag === "online" ? options.ping() : null;
    }),
  };
};
