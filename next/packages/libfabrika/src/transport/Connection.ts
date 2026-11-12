import { applyCell } from "@demlik/tea";
import { Effect, Predicate, Result, Schema, Semaphore } from "effect";
import { REFUSED } from "../telemetry/Trace.ts";
import * as State from "./internal/connection.ts";
import { Answer, type Attached, Wait } from "./Wire.ts";
const Waited = Schema.TaggedUnion({ ready: { rev: Schema.Number }, parked: {} });

const Request = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.String,
  params: Schema.Unknown,
});

const decodeRequest = Schema.decodeUnknownResult(Schema.fromJsonString(Request));

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
  const [unloaded] = State.connection.init(null, {});
  const step = (model: State.Model, msg: State.Msg) => applyCell(State.connection, model, msg)[0];
  // The saved attachment is the Model: each read starts from it, never from a cached copy.
  const read = Effect.suspend(() => {
    const state = options.read();
    return Effect.isEffect(state) ? state : Effect.succeed(state);
  }).pipe(Effect.map((attached) => step(unloaded, { type: "observed", attached })));
  const save = (model: State.Model) => {
    const attached = State.attachment(model);

    if (attached !== null) {
      options.save(attached);
    }
  };
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
    const next = step(now, { type: "answered", wait });

    if (next === now) {
      return;
    }

    save(next);
    respond(wait.id, answer);
  });
  const register = Effect.fnUntraced(function* (wait: typeof Wait.Type) {
    const answer = yield* Effect.result(options.wait(wait.stream, wait.after, options.reader));

    if (Result.isFailure(answer)) {
      const error = answer.failure;
      const reason =
        Predicate.isObjectOrArray(error) && Predicate.hasProperty(error, "reason") && Predicate.isString(error.reason)
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

    if (!State.online(now)) {
      return respond(id, Answer.cases.refused.make({ reason: "no_hello" }));
    }

    const decoded = Schema.decodeUnknownResult(Read)(params);

    if (Result.isFailure(decoded)) {
      return respond(id, Answer.cases.refused.make({ reason: "bad_input" }));
    }

    const wait = Wait.make({ id, ...decoded.success });
    const next = step(now, { type: "waited", wait });

    if (next === now) {
      return respond(id, Answer.cases.refused.make({ reason: "too_many_waits" }));
    }

    // Saved before registration, outside the turn, so a ring during registration finds it.
    save(next);
    yield* register(wait);
  });
  const ordinary = Effect.fnUntraced(function* (request: typeof Request.Type) {
    const now = yield* read;

    if (!State.online(now) && !["initialize", "gateway.knock"].includes(request.method)) {
      return respond(request.id, Answer.cases.refused.make({ reason: "no_hello" }));
    }

    const busy = step(now, { type: "started" });

    if (State.online(busy)) {
      save(busy);
    }

    const answer = yield* options.call(request.method, request.params);

    if (answer._tag === "refused" && answer.reason === "reserved") {
      yield* Effect.annotateCurrentSpan(REFUSED, "reserved");
    }

    respond(request.id, answer);
    // The call may have replaced the attachment: finish from a fresh read.
    const idle = step(yield* read, { type: "finished" });

    if (State.online(idle)) {
      save(idle);
    }

    return answer;
  });
  return {
    frame: Effect.fn("connection.frame")(function* (text: string) {
      const decoded = decodeRequest(text);

      if (Result.isFailure(decoded)) {
        return;
      }

      const request = decoded.success;

      if (request.method === "ledger.wait") {
        return yield* parked(request.id, request.params);
      }

      return yield* ordinary(request).pipe(turn.withPermit);
    }),
    ring: Effect.fn("connection.ring")(function* (stream: string, rev: number) {
      const now = yield* read;

      if (State.online(now)) {
        for (const wait of now.waits) {
          if (wait.stream === stream && rev > wait.after) {
            yield* remove(wait, Answer.cases.ok.make({ result: { rev } }));
          }
        }
      }

      while (true) {
        const latest = yield* read;

        if (!State.online(latest)) {
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

      if (now._tag === "busy") {
        options.close(1012);
      }
    }),
    probe: Effect.fn("connection.probe")(function* (session: string) {
      return session === options.session && State.online(yield* read) ? options.ping() : null;
    }),
  };
};
