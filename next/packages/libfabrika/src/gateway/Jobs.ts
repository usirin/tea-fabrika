/**
 * Job methods over an authenticated connection, called inside the shared write turn.
 *
 * @stability unstable
 */
import { Effect, Result, Schema, Stream } from "effect";
import { Job, Result as JobResult, type Recorded } from "../jobs/Job.ts";
import type { Jobs } from "../jobs/Jobs.ts";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { Answer, type Attached } from "../transport/Wire.ts";
import * as JobAccess from "./JobAccess.ts";

const Meta = { sentAt: Schema.String, seen: Rev };
const Take = Schema.Struct({ process: ProcessId, ...Meta });
const Read = Schema.Struct({ process: ProcessId, job: Schema.NonEmptyString });
const Started = Schema.Struct({ ...Read.fields, execution: Schema.NonEmptyString, ...Meta });
const Finish = Schema.Struct({ ...Started.fields, result: JobResult });

const TakeReply = Schema.TaggedUnion({
  idle: {},
  assigned: { job: Job },
  refused: { reason: Schema.String },
});

const strict = { onExcessProperty: "error" } as const;
const no = (reason: string) => Answer.cases.refused.make({ reason });
const ok = (result: Schema.Json) => Answer.cases.ok.make({ result });

/**
 * Routes one job call after fresh authentication inside the Project's shared write turn.
 *
 * @stability unstable
 * @category routing
 */
export const route = Effect.fn("gateway.jobs")(
  function* (jobs: Jobs["Service"], attached: typeof Attached.cases.online.Type, method: string, input: unknown) {
    const { identity, has, build, client } = attached;

    if (identity.as !== "hands") {
      return no("not_allowed");
    }

    if (has === undefined || build === undefined) {
      return no("no_hello");
    }

    const subject = { key: identity.key };
    const record = Effect.fnUntraced(function* (job: Job, meta: typeof Take.Type): Effect.fn.Return<Recorded> {
      // `route` is a named `Effect.fn`, so a span is always here: its absence is a defect.
      const span = yield* Effect.currentSpan.pipe(Effect.orDie);
      return {
        by: identity.key,
        for: identity.person,
        sentAt: meta.sentAt,
        seen: meta.seen,
        parent: job.state._tag === "absent" ? null : job.state.request.parent,
        traceId: span.traceId,
        build,
        connection: client,
        has,
      };
    });

    if (method === "jobs.take") {
      const decoded = Schema.decodeUnknownResult(Take, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const values = yield* Stream.runCollect(jobs.forProcess(params.process));
      const selected = JobAccess.select(values, { ...subject, process: params.process });

      if (Result.isFailure(selected)) {
        return ok(TakeReply.cases.refused.make({ reason: selected.failure }));
      }

      const job = selected.success;

      if (job === null) {
        return ok(TakeReply.cases.idle.make({}));
      }

      if (!JobAccess.owns(job, { ...subject, process: params.process }) || job.state._tag === "absent") {
        return no("not_allowed");
      }

      if (!job.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      yield* jobs.take(
        job.state.request.id,
        { key: identity.key, connection: client, has, build },
        yield* record(job, params),
      );
      return ok(TakeReply.cases.assigned.make({ job: yield* jobs.read(job.state.request.id) }));
    }

    if (method === "jobs.read") {
      const decoded = Schema.decodeUnknownResult(Read, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const job = yield* jobs.read(params.job);
      return JobAccess.owns(job, { ...subject, process: params.process }) ? ok(job) : no("not_allowed");
    }

    if (method === "jobs.started" || method === "jobs.finish") {
      const decoded =
        method === "jobs.started"
          ? Schema.decodeUnknownResult(Started, strict)(input)
          : Schema.decodeUnknownResult(Finish, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      // Only a finish carries a result: `Started` refuses one as an excess property.
      const params: typeof Started.Type & { readonly result?: JobResult } = decoded.success;
      const job = yield* jobs.read(params.job);

      if (
        !JobAccess.owns(job, { ...subject, process: params.process, execution: params.execution }) ||
        job.state._tag === "absent"
      ) {
        return no("not_allowed");
      }

      if (!job.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      const recorded = yield* record(job, params);
      const receipt =
        params.result === undefined
          ? yield* jobs.started(params.job, params.execution, recorded)
          : yield* jobs.finish(params.job, params.execution, params.result, recorded);
      return ok(receipt);
    }

    return no("unknown_method");
  },
  Effect.catchTag("JobsError", (error) => Effect.succeed(no(error.reason))),
);
