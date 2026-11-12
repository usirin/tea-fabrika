/** Saved reserve faults block automatic work until a checked person resumes it.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotGranted, type Writer } from "../access/SessionManager.ts";
import type { Accounting } from "../processes/Quotas.ts";
import type { ProgramRunner } from "./Runner.ts";

/** A refused letter leaves its command or wake saved for another admission.
 * @stability unstable
 * @category errors
 */
export class QuotaWaiting extends Schema.TaggedError<QuotaWaiting>()("QuotaWaiting", {}) {}

/** Guard every automatic runner entry before it can change saved work.
 * @stability unstable
 * @category combinators
 */
export const guard = (runner: ProgramRunner["Service"], accounting: Accounting): ProgramRunner["Service"] => ({
  open: (client) => Effect.andThen(accounting.check, () => runner.open(client)),
  msg: (input) => Effect.andThen(accounting.check, () => runner.msg(input)),
  due: (at) => Effect.andThen(accounting.check, () => runner.due(at)),
  mailed: Effect.andThen(accounting.check, runner.mailed),
  restart: (request) => Effect.andThen(accounting.check, () => runner.restart(request)),
});

/** Clear a fault only for the checked person, after testing the pending charge.
 * @stability unstable
 * @category combinators
 */
export const restart = Effect.fn("quota_runner.restart")(function* (
  runner: ProgramRunner["Service"],
  accounting: Accounting,
  request: { readonly id: string; readonly build: string; readonly by: Writer },
) {
  if (request.by._tag !== "person") {
    return yield* new NotGranted({});
  }

  yield* accounting.resume;
  return yield* runner.restart({ id: request.id, build: request.build });
});
