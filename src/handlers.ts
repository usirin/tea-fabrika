import type { Outcome } from "@demlik/tea";
import type { JevCmd } from "@demlik/tea/jev";
import { Effect } from "effect";
import { ask, type Questions } from "./judge.ts";
import type { build } from "./lane.ts";
import { Builder, Jev, Workspace } from "./services.ts";

/** A tea Outcome as an Effect: the engine mints `_ok` from success, `_err` from failure. */
const fromOutcome = <A, E>(outcome: Outcome<A, E>): Effect.Effect<A, E> =>
  outcome._tag === "Ok"
    ? Effect.succeed(outcome.value)
    : Effect.fail(outcome.error);

/** The lane's handlers. Each one only forwards a Cmd to the service behind it. */
export const interpret = {
  build: (cmd: ReturnType<typeof build>) =>
    Effect.gen(function* () {
      const builder = yield* Builder;
      return yield* builder.build(cmd.issue, cmd.feedback);
    }),
  check: () =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.check();
    }),
  resilient_run: (cmd: JevCmd<Questions>) =>
    Effect.gen(function* () {
      const jev = yield* Jev;
      const outcome = yield* jev.call(cmd.input).pipe(
        Effect.match({
          onSuccess: (reply) => ask.decode(cmd.input, reply),
          onFailure: (failure) => ask.rejected(failure.cause),
        }),
      );
      return yield* fromOutcome(outcome);
    }),
};
