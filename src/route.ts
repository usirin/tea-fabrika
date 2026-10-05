import {
  DEFAULT_JEV_MODEL,
  decodeJevReply,
  isTransientJevAskErr,
  type JevQuestionMap,
  type JevRequest,
  jevCallThrew,
  jevQuestions,
} from "@demlik/tea/jev";
import { Effect, Layer, Schedule } from "effect";
import { Jev, Matcher, type Relation, Router } from "./services.ts";

/**
 * One narrow question per kind of text, both "is this about the goal": two
 * short texts and "are they about the same thing" is the shape Jev was
 * measured strong on. Each keeps its own wording, because a reason for a
 * change and a problem someone found are not read the same way.
 */
export const routeQuestions = {
  change: jevQuestions({
    serves: {
      type: "choice",
      instructions:
        "`goal` is what a ticket is for. `text` is why a file the ticket does not name was changed. Does that change serve the goal?",
      criteria: {
        serves: "The change is needed for the goal, or directly supports it",
        unrelated: "The change is about something else: the goal would be met without it",
      },
    },
  }),
  finding: jevQuestions({
    serves: {
      type: "choice",
      instructions:
        "`goal` is what a ticket is for. `text` is a problem a reviewer found in the code written for it. Is fixing that problem part of meeting the goal?",
      criteria: {
        serves: "The problem keeps the goal from being met, or is in what was built for it",
        unrelated: "The problem is real but about something else: the goal is met without fixing it",
      },
    },
  }),
};

/** Below this, Jev's answer is `unsure`, and the lane stops instead of guessing. */
export const ROUTE_FLOOR = 0.8;

/**
 * Below this, the matcher says "no match". It is higher than the router's
 * floor because a match is the one answer that lets a finding pass unrouted.
 */
export const MATCH_FLOOR = 0.9;

/** What the matcher calls a different point. No finding id looks like it. */
const NO_MATCH = "none";

/**
 * One choice question per new finding: which decided finding, if any, makes
 * the same point. The options are the decided findings themselves, so the
 * question is built per call.
 */
export const matchQuestions = (candidates: readonly { readonly id: string; readonly text: string }[]) =>
  jevQuestions({
    same: {
      type: "choice",
      instructions:
        "`text` is a problem a reviewer found. Each option but the last is a problem raised earlier. Does `text` make the same point as one of them, even in other words or about another line?",
      criteria: {
        ...Object.fromEntries(candidates.map((c) => [c.id, c.text])),
        [NO_MATCH]: "A different point from every earlier problem",
      },
    },
  });

/**
 * How often a busy Jev is asked again before the router gives up: a 429, a
 * 529 or a call that never got a reply. The waiting lives in this layer, not
 * in the lane's saved state; a kill while it waits just asks again on resume.
 */
const RETRIES = 3;
const BACKOFF = Schedule.exponential("500 millis");

/** One Jev call, asked again while Jev is busy. */
const askJev = <Q extends JevQuestionMap>(jev: Jev["Service"], request: JevRequest<Q>) =>
  jev.call(request).pipe(
    Effect.match({
      onSuccess: (reply) => decodeJevReply(request, reply),
      onFailure: (failure) => jevCallThrew(failure.cause),
    }),
    Effect.flatMap((outcome) => (outcome._tag === "Ok" ? Effect.succeed(outcome.value) : Effect.fail(outcome.error))),
    Effect.retry({ times: RETRIES, schedule: BACKOFF, while: (error) => isTransientJevAskErr(error.jev) }),
  );

/** Jev as the router. The call and the key live in the `Jev` layer underneath. */
export const jevRouter = Layer.effect(
  Router,
  Effect.gen(function* () {
    const jev = yield* Jev;
    return {
      route: ({ about, text, goal }) =>
        Effect.gen(function* () {
          const request = { state: { goal, text }, model: DEFAULT_JEV_MODEL, questions: routeQuestions[about] };
          const answered = yield* askJev(jev, request).pipe(
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

/** Jev as the matcher. Anything short of a sure pick of one earlier problem is "no match". */
export const jevMatcher = Layer.effect(
  Matcher,
  Effect.gen(function* () {
    const jev = yield* Jev;
    return {
      match: ({ text, candidates }) =>
        Effect.gen(function* () {
          const request = { state: { text }, model: DEFAULT_JEV_MODEL, questions: matchQuestions(candidates) };
          const answered = yield* askJev(jev, request).pipe(
            Effect.mapError(() => ({ _tag: "matcher_failed" as const })),
          );
          const { choice, confidence } = answered.answers.same;
          const sure = confidence >= MATCH_FLOOR && choice !== NO_MATCH && candidates.some((c) => c.id === choice);
          return { to: sure ? choice : null, confidence };
        }),
    };
  }),
);
