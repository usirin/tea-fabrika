import type { Outcome } from "@demlik/tea";
import {
  decodeJevReply,
  type JevCmd,
  type JevQuestionMap,
  jevCallThrew,
} from "@demlik/tea/jev";
import { Effect } from "effect";
import type { build, prepare, route } from "./lane.ts";
import { Builder, Enricher, Jev, Router, Workspace } from "./services.ts";
import type { enrich } from "./triage.ts";

/** A tea Outcome as an Effect: the engine mints `_ok` from success, `_err` from failure. */
const fromOutcome = <A, E>(outcome: Outcome<A, E>): Effect.Effect<A, E> =>
  outcome._tag === "Ok"
    ? Effect.succeed(outcome.value)
    : Effect.fail(outcome.error);

/** One call to Jev, decoded against the questions on its own request. */
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
  prepare: (cmd: ReturnType<typeof prepare>) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.prepare(cmd.issue);
    }),
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
  route: (cmd: ReturnType<typeof route>) =>
    Effect.gen(function* () {
      const router = yield* Router;
      const routed = yield* router.route({ text: cmd.text, goal: cmd.goal });
      return { file: cmd.file, ...routed };
    }),
};

/** The factory runs both machines, so it needs both sets. */
export const factoryInterpret = { ...triageInterpret, ...interpret };
