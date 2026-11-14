// The durable job service: record, take, start, finish and read one job. This file is the contract
// only (0095); `JobsLedger.layer` keeps each job as its own ledger stream. Tier 1, P39 slice 1.
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";
import type { ProcessId } from "../ProcessId.ts";
import type { Rev } from "../Rev.ts";
import type { Executor, Job, Recorded, Request, Result } from "./Job.ts";

export class JobsError extends Schema.TaggedError<JobsError>()("JobsError", {
  /** `not_found`: no job has that id. `conflict`: other bytes than the saved ones under that id.
   *  `not_target`: a key the request did not select. `lacks_capability`: a need the take did not
   *  advertise. `wrong_execution`: not the saved execution identity. `wrong_state`: a call out of
   *  order. `bad_input`: a value that does not decode. `storage`: the transaction failed. */
  reason: Schema.Literals([
    "not_found",
    "conflict",
    "not_target",
    "lacks_capability",
    "wrong_execution",
    "wrong_state",
    "bad_input",
    "storage",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Where the referee placed an accepted call, and when it arrived. A repeat answers the first. */
export type Receipt = { readonly rev: Rev; readonly arrivedAt: number };

/** A take's receipt, with the execution identity it allocated once. */
export type Taken = Receipt & { readonly execution: string };

export class Jobs extends Context.Service<
  Jobs,
  {
    readonly request: (request: Request, recorded: Recorded) => Effect.Effect<Receipt, JobsError>;
    readonly take: (id: string, executor: Executor, recorded: Recorded) => Effect.Effect<Taken, JobsError>;
    readonly started: (id: string, execution: string, recorded: Recorded) => Effect.Effect<Receipt, JobsError>;
    readonly finish: (
      id: string,
      execution: string,
      result: Result,
      recorded: Recorded,
    ) => Effect.Effect<Receipt, JobsError>;
    readonly read: (id: string) => Effect.Effect<Job, JobsError>;
    /** Jobs whose saved requests name this exact process generation. */
    readonly forProcess: (process: typeof ProcessId.Type) => Stream.Stream<Job, JobsError>;
  }
>()("@kampus/libfabrika/jobs/Jobs") {}
