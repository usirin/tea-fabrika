/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * The durable job service: record, take, start, finish and read one job. This file is the contract
 * only (0095); `JobsLedger.layer` keeps each job as its own ledger stream.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";
import type { ProcessId } from "../ProcessId.ts";
import type { Rev } from "../Rev.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
    /** Jobs whose saved requests name this exact process generation. */
    readonly forProcess: (process: typeof ProcessId.Type) => Stream.Stream<Job, JobsError>;
  }
>()("@kampus/libfabrika/jobs/Jobs") {}
