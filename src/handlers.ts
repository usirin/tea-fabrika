import type { Outcome } from "@demlik/tea";
import {
  decodeJevReply,
  type JevCmd,
  type JevQuestionMap,
  jevCallThrew,
} from "@demlik/tea/jev";
import { Effect } from "effect";
import type { EffectInterpret } from "@demlik/tea/effect";
import type { FactoryCmd } from "./factory.ts";
import type { build } from "./lane.ts";
import { Builder, Enricher, Jev, Workspace } from "./services.ts";
import type { enrich } from "./triage.ts";

/** A tea Outcome as an Effect: the engine mints `_ok` from success, `_err` from failure. */
const fromOutcome = <A, E>(outcome: Outcome<A, E>): Effect.Effect<A, E> =>
  outcome._tag === "Ok"
    ? Effect.succeed(outcome.value)
    : Effect.fail(outcome.error);

/** One call to Jev, whichever rubric it carries: the judge's or the sorter's. */
const askJev = <Q extends JevQuestionMap>(cmd: JevCmd<Q>) =>
  Effect.gen(function* () {
    const jev = yield* Jev;
    const outcome = yield* jev.call(cmd.input).pipe(
      Effect.match({
        onSuccess: (reply) => decodeJevReply(cmd.input, reply),
        onFailure: (failure) => jevCallThrew(failure.cause),
      }),
    );
    return yield* fromOutcome(outcome);
  });

/** Triage's handlers. */
export const triageInterpret = {
  enrich: (cmd: ReturnType<typeof enrich>) =>
    Effect.gen(function* () {
      const enricher = yield* Enricher;
      return yield* enricher.enrich(cmd);
    }),
  resilient_run: askJev,
};

/** The lane's handlers. Each one only forwards a Cmd to the service behind it. */
export const interpret = {
  build: (cmd: ReturnType<typeof build>) =>
    Effect.gen(function* () {
      const builder = yield* Builder;
      return yield* builder.build(cmd);
    }),
  check: () =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.check();
    }),
  resilient_run: askJev,
};

/**
 * The factory runs both machines, so it needs both sets.
 *
 * The cast is a gap in tea, not in this handler. `createJevAsk` cannot name its
 * Cmd, so the judge's and the sorter's calls both travel as `resilient_run`,
 * and tea's types cannot say "a Cmd of this name answers with whichever rubric
 * it carried". `askJev` does exactly that at run time: it decodes each reply
 * against the questions on its own request.
 */
export const factoryInterpret = {
  ...triageInterpret,
  ...interpret,
  resilient_run: askJev as unknown as EffectInterpret<
    { readonly type: string },
    FactoryCmd,
    Jev
  >["resilient_run"],
};
