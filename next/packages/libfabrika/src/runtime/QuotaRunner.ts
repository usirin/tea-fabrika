/**
 * The runner's quota guard: a name with a saved reserve fault does no work until a person
 * restarts it.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotGranted, type Writer } from "../access/SessionManager.ts";
import { QuotasError, type Accounting } from "../processes/Quotas.ts";
import type { ProgramRunner } from "./Runner.ts";

/**
 * Error the runner raises inside a turn when its own letter, a timer's or a command answer's, is
 * refused for quota. The turn catches it, keeps the saved wake or command and sets an alarm to
 * try again.
 *
 * @stability unstable
 * @category errors
 */
export class QuotaWaiting extends Schema.TaggedError<QuotaWaiting>()("QuotaWaiting", {}) {}

/**
 * Wraps a runner so every entry first checks the name's saved reserve fault, and records a
 * reserve fault that the entry itself meets.
 *
 * **Details**
 *
 * On a stopped name `open`, `msg`, `init` and `restart` fail with the fault. `due` and `mailed`
 * end without doing work.
 *
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

/**
 * Restarts a stopped name for a person: clears its saved reserve fault once the pending charge
 * fits, then runs the runner's restart. Any other writer fails with `NotGranted`.
 *
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
