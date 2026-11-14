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
 * Selection and ownership rules for authenticated job access.
 *
 * @stability unstable
 */
import { Result } from "effect";
import type { Job } from "../jobs/Job.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
type Subject = { readonly process: string; readonly key: string; readonly execution?: string };

/**
 * Checks the saved request and, once assigned, its executor and execution.
 *
 * @stability unstable
 * @category guards
 */
export const owns = (job: Job, subject: Subject): boolean => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
 * @stability unstable
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
