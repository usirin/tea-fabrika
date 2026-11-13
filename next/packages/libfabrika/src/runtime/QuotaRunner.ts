/** Saved reserve faults block automatic work until a checked person resumes it.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotGranted, type Writer } from "../access/SessionManager.ts";
import { QuotasError, type Accounting } from "../processes/Quotas.ts";
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
export const guard = (runner: ProgramRunner["Service"], accounting: Accounting): ProgramRunner["Service"] => {
  const checked = <A, E>(work: Effect.Effect<A, E>) =>
    Effect.andThen(accounting.check, work).pipe(
      Effect.tapError((error) =>
        error instanceof QuotasError && error.reason._tag === "RecoveryReserveExhausted"
          ? accounting.recordFault(error.reason)
          : Effect.void,
      ),
    );
  const automatic = (work: ReturnType<ProgramRunner["Service"]["due"]>) =>
    checked(work).pipe(Effect.catchReason("QuotasError", "RecoveryReserveExhausted", () => Effect.void));
  return {
    open: (client) => checked(runner.open(client)),
    msg: (input) => checked(runner.msg(input)),
    due: (at) => automatic(runner.due(at)),
    mailed: automatic(runner.mailed),
    init: () => checked(runner.init()),
    restart: (request) => checked(runner.restart(request)),
  };
};

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
