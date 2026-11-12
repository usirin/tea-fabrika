// Jobs on the ledger (0095): each job is its own stream, named from its command id. One call is one
// transaction: read the stream, fold it through the job machine, step the call, and append it only
// when the machine accepts it. A repeat answers the first event's receipt; a refusal writes nothing.
// Tier 1, P39 slice 1.
import { applyCell } from "@demlik/tea";
import { Effect, Layer, Result as R, Schema, Stream } from "effect";
import * as Id from "../Id.ts";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerStreams } from "../ledger/LedgerStreams.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { type Entry, lineFor, valueFor } from "../ledger/Log.ts";
import type { ProcessId } from "../ProcessId.ts";
import { job, Msg } from "./internal/job.ts";
import { Event, Executor, type Job, Recorded, Request, Result } from "./Job.ts";
import { Jobs, JobsError } from "./Jobs.ts";

/** The execution identity a take allocates, once per job. */
const Execution = Id.make("execution");

/** An accepted call as its entry keeps it: the event's case, and the facts it brought. */
const Stored = Schema.TaggedUnion({
  requested: { request: Request },
  taken: { executor: Executor, execution: Schema.NonEmptyString },
  started: { execution: Schema.NonEmptyString },
  finished: { execution: Schema.NonEmptyString, result: Result },
});
type Stored = typeof Stored.Type;

const decodeStored = Schema.decodeUnknownSync(Stored);
const encodeStored = Schema.encodeSync(Stored);
const decodeEvent = Schema.decodeUnknownSync(Event);
const decodeCall = Schema.decodeUnknownResult(Schema.Struct({ msg: Msg, recorded: Recorded }));

const stream = (id: string) => `job:${id}`;

const toMsg = (stored: Stored): Msg => {
  if (stored._tag === "requested") {
    return { type: "request", request: stored.request };
  }

  if (stored._tag === "taken") {
    return { type: "take", executor: stored.executor, execution: stored.execution };
  }

  return stored._tag === "started"
    ? { type: "start", execution: stored.execution }
    : { type: "finish", execution: stored.execution, result: stored.result };
};

const toStored = (msg: Msg): Stored => {
  if (msg.type === "request") {
    return Stored.cases.requested.make({ request: msg.request });
  }

  if (msg.type === "take") {
    return Stored.cases.taken.make({ executor: msg.executor, execution: msg.execution });
  }

  return msg.type === "start"
    ? Stored.cases.started.make({ execution: msg.execution })
    : Stored.cases.finished.make({ execution: msg.execution, result: msg.result });
};

type Model = (typeof job)["model"]["Type"];

const step = (model: Model, msg: Msg): Model => applyCell(job, model, msg)[0];

const fold = (entries: ReadonlyArray<Entry>): Model =>
  entries.reduce((model, entry) => step(model, toMsg(decodeStored(valueFor(entry)))), job.init(null, undefined)[0]);

/** A ledger failure as the jobs module's: a line the referee refused is the caller's input. */
const translated = (cause: LedgerError) =>
  new JobsError({ reason: cause.reason === "refused" ? "bad_input" : "storage", cause });

export const layer = Layer.effect(
  Jobs,
  Effect.gen(function* () {
    const ledger = yield* LedgerTransaction;
    const ids = yield* Id.Generator;
    const streams = yield* LedgerStreams;

    const read = Effect.fn("jobs.read")(function* (id: string) {
      const found = yield* ledger
        .transact((turn) => {
          const entries = [...turn.read(stream(id), 0)];
          const events = entries.map((entry) => decodeEvent({ ...entry, event: entry._tag }));
          return { state: fold(entries).state, events };
        })
        .pipe(Effect.mapError(translated));

      if (found.state._tag === "absent") {
        return yield* new JobsError({ reason: "not_found" });
      }

      return found satisfies Job;
    });

    /** One call in one transaction. It answers the receipt of the call's event and the job after it. */
    const call = Effect.fnUntraced(function* (id: string, input: Msg, said: Recorded) {
      const decoded = decodeCall({ msg: input, recorded: said });

      if (R.isFailure(decoded)) {
        return yield* new JobsError({ reason: "bad_input", cause: decoded.failure });
      }

      const { msg, recorded } = decoded.success;
      const stored = toStored(msg);
      const answer = yield* ledger
        .transact((turn) => {
          const model = step(fold([...turn.read(stream(id), 0)]), msg);

          if (model.answer._tag === "refused") {
            return R.fail(model.answer.reason);
          }

          if (model.answer._tag === "accepted") {
            turn.append(stream(id), `${id}/${stored._tag}`, lineFor(recorded, encodeStored(stored)));
          }

          const entry = [...turn.read(stream(id), 0)].find((e) => e._tag === stored._tag);

          // An accepted or repeated call has its event in the stream; a stream without one is a broken store.
          return entry === undefined
            ? R.fail("storage" as const)
            : R.succeed({ receipt: { rev: entry.rev, arrivedAt: entry.arrivedAt }, state: model.state });
        })
        .pipe(Effect.mapError(translated));

      if (R.isFailure(answer)) {
        return yield* new JobsError({ reason: answer.failure });
      }

      return answer.success;
    });

    return {
      request: Effect.fn("jobs.request")(function* (request: Request, recorded: Recorded) {
        return (yield* call(request.id, { type: "request", request }, recorded)).receipt;
      }),
      take: Effect.fn("jobs.take")(function* (id: string, executor: Executor, recorded: Recorded) {
        const proposed = yield* ids
          .next(Execution)
          .pipe(Effect.mapError((cause) => new JobsError({ reason: "storage", cause })));
        const { receipt, state } = yield* call(id, { type: "take", executor, execution: proposed }, recorded);
        // An accepted or repeated take leaves the job owned, so the saved assignment is there.
        const execution = state._tag === "absent" || state._tag === "requested" ? proposed : state.assignment.execution;
        return { ...receipt, execution };
      }),
      started: Effect.fn("jobs.started")(function* (id: string, execution: string, recorded: Recorded) {
        return (yield* call(id, { type: "start", execution }, recorded)).receipt;
      }),
      finish: Effect.fn("jobs.finish")(function* (id: string, execution: string, result: Result, recorded: Recorded) {
        return (yield* call(id, { type: "finish", execution, result }, recorded)).receipt;
      }),
      read,
      forProcess: (process: typeof ProcessId.Type) =>
        streams.list("job:").pipe(
          Stream.mapError((cause) => new JobsError({ reason: "storage", cause })),
          Stream.mapEffect((name) => read(name.slice("job:".length))),
          Stream.filter((job) => job.state._tag !== "absent" && job.state.request.process === process),
        ),
    };
  }),
);
