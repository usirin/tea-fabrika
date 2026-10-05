import {
  DEFAULT_JEV_MODEL,
  decodeJevReply,
  isTransientJevAskErr,
  jevCallThrew,
  jevQuestions,
} from "@demlik/tea/jev";
import { Effect, Layer, Schedule } from "effect";
import { Jev, type Relation, Router } from "./services.ts";

/**
 * One narrow question: does the reason for an extra change serve the ticket's
 * goal? Two short texts and "are they about the same thing" is the shape Jev
 * was measured strong on.
 */
export const routeQuestions = jevQuestions({
  serves: {
    type: "choice",
    instructions:
      "`goal` is what a ticket is for. `reason` is why a file the ticket does not name was changed. Does that change serve the goal?",
    criteria: {
      serves: "The change is needed for the goal, or directly supports it",
      unrelated: "The change is about something else: the goal would be met without it",
    },
  },
});

/** Below this, Jev's answer is `unsure`, and the lane stops instead of guessing. */
export const ROUTE_FLOOR = 0.8;

/**
 * How often a busy Jev is asked again before the router gives up: a 429, a
 * 529 or a call that never got a reply. The waiting lives in this layer, not
 * in the lane's saved state; a kill while it waits just asks again on resume.
 */
const RETRIES = 3;
const BACKOFF = Schedule.exponential("500 millis");

/** Jev as the router. The call and the key live in the `Jev` layer underneath. */
export const jevRouter = Layer.effect(
  Router,
  Effect.gen(function* () {
    const jev = yield* Jev;
    return {
      route: ({ text, goal }) =>
        Effect.gen(function* () {
          const request = { state: { goal, reason: text }, model: DEFAULT_JEV_MODEL, questions: routeQuestions };
          const once = jev.call(request).pipe(
            Effect.match({
              onSuccess: (reply) => decodeJevReply(request, reply),
              onFailure: (failure) => jevCallThrew(failure.cause),
            }),
            Effect.flatMap((outcome) =>
              outcome._tag === "Ok" ? Effect.succeed(outcome.value) : Effect.fail(outcome.error),
            ),
          );
          const answered = yield* once.pipe(
            Effect.retry({ times: RETRIES, schedule: BACKOFF, while: (error) => isTransientJevAskErr(error.jev) }),
            Effect.mapError(() => ({ _tag: "router_failed" as const })),
          );
          const { choice, confidence } = answered.answers.serves;
          const relation: Relation =
            confidence < ROUTE_FLOOR ? "unsure" : choice === "serves" ? "related" : "unrelated";
          return { relation, confidence };
        }),
    };
  }),
);
