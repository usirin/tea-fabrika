/**
 * The durable job service: record, take, start, finish and read one job. This file is the contract
 * only (0095); `JobsLedger.layer` keeps each job as its own ledger stream.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { Rev } from "../Rev.ts";
import type { Executor, Job, Recorded, Request, Result } from "./Job.ts";

/**
 * A job call failed. The `reason` says why. `cause` keeps the decode or ledger error underneath,
 * when there is one.
 *
 * @stability unstable
 * @category errors
 */
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

/**
 * Where the referee placed an accepted call, and when it arrived. A repeat answers the first.
 *
 * @stability unstable
 * @category models
 */
export type Receipt = { readonly rev: Rev; readonly arrivedAt: number };

/**
 * A take's receipt, with the execution identity it allocated once.
 *
 * @stability unstable
 * @category models
 */
export type Taken = Receipt & { readonly execution: string };

/**
 * Service that keeps jobs: `request` records one, `take` assigns it to an executor, `started` and
 * `finish` report its progress, and `read` answers its state and events.
 *
 * **Details**
 *
 * Each write takes the writer's `Recorded` facts and answers a `Receipt`. A repeat of an accepted
 * call answers the first receipt, and a call the job's state does not allow writes nothing and
 * fails with `JobsError`. `take` answers the execution identity, which `started` and `finish` must
 * then present. `read` fails with `not_found` for an unknown id.
 *
 * @stability unstable
 * @category services
 */
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
  }
>()("@kampus/libfabrika/jobs/Jobs") {}
