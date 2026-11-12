/**
 * Selection and ownership rules for authenticated job access.
 *
 * @stability experimental
 */
import { Result } from "effect";
import type { Job } from "../jobs/Job.ts";

type Subject = { readonly process: string; readonly key: string; readonly execution?: string };

/**
 * Checks the saved request and, once assigned, its executor and execution.
 *
 * @stability experimental
 * @category guards
 */
export const owns = (job: Job, subject: Subject): boolean => {
  const state = job.state;

  if (state._tag === "absent" || state.request.process !== subject.process || state.request.target !== subject.key) {
    return false;
  }

  if (state._tag === "requested") {
    return subject.execution === undefined;
  }

  return (
    state.assignment.executor.key === subject.key &&
    (subject.execution === undefined || state.assignment.execution === subject.execution)
  );
};

/**
 * Selects unfinished work for one process and key, refusing competing candidates.
 *
 * @stability experimental
 * @category getters
 */
export const select = (jobs: ReadonlyArray<Job>, subject: Subject): Result.Result<Job | null, "ambiguous"> => {
  const candidates = jobs.filter(
    (job) =>
      job.state._tag !== "absent" &&
      job.state._tag !== "finished" &&
      job.state.request.process === subject.process &&
      job.state.request.target === subject.key,
  );
  return candidates.length > 1 ? Result.fail("ambiguous") : Result.succeed(candidates[0] ?? null);
};
