// Checks: what a lane asks GitHub about one CI job at one head. This file is the contract only
// (0095): `ChecksGh.layer` asks GitHub through `gh api`, `ChecksTest.layer` answers from a list in
// memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/** GitHub could not be asked, or its answer did not parse. A poll tries again; the reason is kept. */
export class ChecksError extends Schema.TaggedError<ChecksError>()("ChecksError", { reason: Schema.String }) {}

/**
 * One job's check run, as GitHub reports it: its id (an Actions job's check run id is its job id),
 * `queued`, `in_progress` or `completed`, and once completed its conclusion (`success`, `failure`,
 * `cancelled`, `skipped`, `timed_out` and the rest).
 */
export const Job = Schema.Struct({
  id: Schema.Number,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
});
export type Job = typeof Job.Type;

export class Checks extends Context.Service<
  Checks,
  {
    /** The latest Actions check run named `name` at `head`; none before GitHub has made it. */
    readonly job: (head: string, name: string) => Effect.Effect<Option.Option<Job>, ChecksError>;
    /** The whole log of the job with this id, as GitHub serves it. */
    readonly log: (id: number) => Effect.Effect<string, ChecksError>;
  }
>()("lead/ci/Checks") {}
