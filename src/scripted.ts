import { Effect, Layer } from "effect";
import type { Verdict } from "./judge.ts";
import { Builder, type CheckResult, Jev, Workspace } from "./services.ts";

/** Take the next scripted step, or die: a script that runs dry is a broken test. */
const next = <T>(queue: T[], what: string): Effect.Effect<T> =>
  Effect.suspend(() => {
    const step = queue.shift();
    return step === undefined
      ? Effect.die(new Error(`scripted ${what} ran out of steps`))
      : Effect.succeed(step);
  });

/** A builder that follows a script, and remembers the feedback it was sent. */
export function scriptedBuilder(script: readonly ("ok" | "fail")[]) {
  const queue = [...script];
  const feedback: (string | null)[] = [];
  const layer = Layer.succeed(Builder, {
    build: (_issue, sentBack) =>
      Effect.gen(function* () {
        feedback.push(sentBack);
        const step = yield* next(queue, "builder");
        if (step === "fail") {
          return yield* Effect.fail({ _tag: "agent_failed" as const });
        }
        return { summary: `attempt ${feedback.length}` };
      }),
  });
  return { layer, feedback };
}

/** A workspace whose test runs follow a script. */
export function scriptedWorkspace(script: readonly CheckResult[]) {
  const queue = [...script];
  return Layer.succeed(Workspace, { check: () => next(queue, "workspace") });
}

/** One scripted Jev answer: the verdict and how sure it is. */
export type ScriptedVerdict = readonly [Verdict, number];

/**
 * Jev, scripted per criterion text. Each criterion has its own queue, because
 * the lane asks about all of them at once and the order is not the test's to pin.
 */
export function scriptedJev(
  script: Readonly<Record<string, readonly ScriptedVerdict[]>>,
) {
  const queues = new Map(
    Object.entries(script).map(([text, steps]) => [text, [...steps]]),
  );
  return Layer.succeed(Jev, {
    call: (request) =>
      Effect.gen(function* () {
        const { criterion } = request.state as { readonly criterion: string };
        const [choice, confidence] = yield* next(
          queues.get(criterion) ?? [],
          `jev for "${criterion}"`,
        );
        const rest = (1 - confidence) / 2;
        return {
          status: 200,
          body: {
            model: request.model,
            answers: {
              verdict: {
                type: "choice",
                choice,
                confidence,
                probabilities: {
                  met: rest,
                  not_met: rest,
                  cannot_tell: rest,
                  [choice]: confidence,
                },
              },
            },
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        };
      }),
  });
}
