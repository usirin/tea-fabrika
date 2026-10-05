import {
  decodeJevReply,
  isTransientJevAskErr,
  type JevQuestionMap,
  type JevRequest,
  jevCallThrew,
  jevQuestions,
} from "@demlik/tea/jev";
import { Effect, Layer, Schedule } from "effect";
import type { Reading } from "./comments.ts";
import {
  CommentReader,
  FailureReader,
  Jev,
  Matcher,
  MissingReader,
  type Relation,
  Router,
  Workspace,
} from "./services.ts";
import { Settings, type SettingsShape } from "./settings.ts";

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

/** The two options of the comment question that are not one of the ticket's rules. */
const ADDS = "adds";
const NO_CHANGE = "none";

/**
 * One choice question per comment: which rule, if any, it asks to change. The
 * options are the ticket's rules themselves, so the question is built per call.
 */
export const commentQuestions = (rules: readonly { readonly id: string; readonly rule: string }[]) =>
  jevQuestions({
    asks: {
      type: "choice",
      instructions:
        "`text` is a comment the owner of a ticket left while the work was being built. Each option but the last two is one of the ticket's rules. Does the comment ask for a different result than one of these rules gives, ask for behaviour none of them covers, or ask for no change at all?",
      criteria: {
        ...Object.fromEntries(rules.map((r) => [r.id, `Asks to change this rule: ${r.rule}`])),
        [ADDS]: "Asks for behaviour none of the rules covers",
        [NO_CHANGE]: "Asks for no change in behaviour: a question, thanks, a status note, or agreement with a rule",
      },
    },
  });

/**
 * One choice question per failed test run, worded as in experiment 34, where
 * it named 42 of 42 real failures. The diff is what tells a package the change
 * never declared from a declared one nobody installed: both print the same.
 */
export const failureQuestions = jevQuestions({
  cause: {
    type: "choice",
    instructions:
      "A coding agent changed a codebase (`diff`). Then `command` ran the tests and failed with `output`. The test file was written by the pipeline, not by the agent. What made the run fail?",
    criteria: {
      change:
        "The agent's change is wrong: its code has a bug, does not parse, removed or renamed something still used, or uses a package its diff never adds",
      test_file:
        "The test file itself is broken while the agent's code is fine: it does not parse, or it imports from a path that does not exist",
      environment:
        "The run could not work whatever the code says: a tool or folder is missing, a flag is wrong, the time limit is too short, or a package the diff declares was never installed",
    },
  },
});

/**
 * One yes/no question per untouched file, worded as in experiment 36, where
 * the forgotten file ranked first in 22 of 28 trials over whole packages, and
 * no file reached 0.5 on the 9 changes that were complete.
 */
export const missingQuestions = jevQuestions({
  missed: {
    type: "noul",
    instructions:
      "`ticket` is the work. `diff` is the change made for it so far. `file` is a file the change did not touch, as it was before the change. Does finishing the ticket mean `file` has to change too?",
    criteria: {
      true: "The change is incomplete without editing this file: it calls, tests, documents or mirrors what the diff changed in a way the diff breaks or leaves out",
      false: "This file can stay as it is: it is unaffected by the change, or only on the same subject",
    },
  },
});

/** How much of each text the missing-file question reads, as the probe did. */
const MISSING_CHARS = { ticket: 8_000, diff: 20_000, file: 30_000 };
/** How many files are asked at once, as the probe did. */
const MISSING_POOL = 16;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|wasm)$/i;

/**
 * The package a file sits in: its folder, cut to the first three parts, so
 * `packages/a/src/x/y.ts` is in `packages/a/src`. A file at the top sits in
 * the whole repo.
 */
const packageOf = (path: string) => path.split("/").slice(0, -1).slice(0, 3).join("/");

/**
 * The files the missing-file check asks about: every file where the change
 * started, in a package the change touched, that the change did not touch and
 * that is text.
 */
export function candidatesOf(files: readonly string[], changed: readonly string[]): readonly string[] {
  const packages = new Set(changed.map(packageOf));
  const inside = (path: string) => [...packages].some((p) => p === "" || path.startsWith(`${p}/`));
  return files.filter((path) => !changed.includes(path) && !BINARY.test(path) && inside(path));
}

/**
 * Every floor, limit and the model come from `Settings`. A busy Jev (a 429, a
 * 529 or a call that never got a reply) is asked again `jev.retries` times.
 * The waiting lives in this layer, not in the lane's saved state; a kill while
 * it waits just asks again on resume.
 */
const BACKOFF = Schedule.exponential("500 millis");

/** One Jev call, asked again while Jev is busy. */
const askJev = <Q extends JevQuestionMap>(jev: Jev["Service"], retries: number, request: JevRequest<Q>) =>
  jev.call(request).pipe(
    Effect.match({
      onSuccess: (reply) => decodeJevReply(request, reply),
      onFailure: (failure) => jevCallThrew(failure.cause),
    }),
    Effect.flatMap((outcome) => (outcome._tag === "Ok" ? Effect.succeed(outcome.value) : Effect.fail(outcome.error))),
    Effect.retry({ times: retries, schedule: BACKOFF, while: (error) => isTransientJevAskErr(error.jev) }),
  );

/** Jev as the router. The call and the key live in the `Jev` layer underneath. */
export const jevRouter = Layer.effect(
  Router,
  Effect.gen(function* () {
    const jev = yield* Jev;
    const settings = yield* Settings;
    return {
      route: ({ about, text, goal }) =>
        Effect.gen(function* () {
          const request = { state: { goal, text }, model: settings.jev.model, questions: routeQuestions[about] };
          const answered = yield* askJev(jev, settings.jev.retries, request).pipe(
            Effect.mapError(() => ({ _tag: "router_failed" as const })),
          );
          const { choice, confidence } = answered.answers.serves;
          const relation: Relation =
            confidence < settings.review.route_floor ? "unsure" : choice === "serves" ? "related" : "unrelated";
          return { relation, confidence };
        }),
    };
  }),
);

/**
 * Jev as the comment reader. A rule or "adds" below `comments.floor`, and a
 * "changes nothing" below its own higher floor, are `unsure`.
 */
export const jevCommentReader = Layer.effect(
  CommentReader,
  Effect.gen(function* () {
    const jev = yield* Jev;
    const settings = yield* Settings;
    return {
      weigh: ({ text, rules }) =>
        Effect.gen(function* () {
          const request = { state: { text }, model: settings.jev.model, questions: commentQuestions(rules) };
          const answered = yield* askJev(jev, settings.jev.retries, request).pipe(
            Effect.mapError(() => ({ _tag: "reader_failed" as const })),
          );
          const { choice, confidence } = answered.answers.asks;
          return { reading: readingOf(choice, confidence, rules, settings.comments), confidence };
        }),
    };
  }),
);

/** Jev as the failure reader. Any pick below the floor is `unsure`. */
export const jevFailureReader = Layer.effect(
  FailureReader,
  Effect.gen(function* () {
    const jev = yield* Jev;
    const settings = yield* Settings;
    const { floor, diff_chars, output_chars } = settings.failure;
    return {
      read: ({ command, diff, output }) =>
        Effect.gen(function* () {
          const state = { command, diff: diff.slice(0, diff_chars), output: output.slice(-output_chars) };
          const request = { state, model: settings.jev.model, questions: failureQuestions };
          const answered = yield* askJev(jev, settings.jev.retries, request).pipe(
            Effect.mapError(() => ({ _tag: "reader_failed" as const })),
          );
          const { choice, confidence } = answered.answers.cause;
          return { cause: confidence < floor ? "unsure" : choice, confidence };
        }),
    };
  }),
);

/**
 * Jev as the missing-file reader: one call per candidate, at most
 * `MISSING_POOL` at once. Over `review.missing_max_files` candidates nothing is
 * asked. One call that fails for good fails the read, so the check is skipped
 * rather than read from part of the files.
 */
export const jevMissingReader = Layer.effect(
  MissingReader,
  Effect.gen(function* () {
    const jev = yield* Jev;
    const settings = yield* Settings;
    const workspace = yield* Workspace;
    const { missing_floor, missing_max_files } = settings.review;
    const failed = () => ({ _tag: "reader_failed" as const });
    return {
      find: ({ issue, diff, changed }) =>
        Effect.gen(function* () {
          const files = yield* workspace.baseFiles().pipe(Effect.mapError(failed));
          const candidates = candidatesOf(files, changed);
          if (candidates.length > missing_max_files) {
            return { kind: "too_many" as const, candidates: candidates.length, cap: missing_max_files };
          }
          const ticket = { title: issue.title, body: issue.body.slice(0, MISSING_CHARS.ticket) };
          const shown = diff.slice(0, MISSING_CHARS.diff);
          const asked = yield* Effect.forEach(
            candidates,
            (path) =>
              Effect.gen(function* () {
                const content = (yield* workspace.baseFile(path).pipe(Effect.mapError(failed))).slice(0, MISSING_CHARS.file);
                const state = { ticket, diff: shown, file: { path, content } };
                const request = { state, model: settings.jev.model, questions: missingQuestions };
                const answered = yield* askJev(jev, settings.jev.retries, request).pipe(Effect.mapError(failed));
                return { file: path, yes: answered.answers.missed.noul };
              }),
            { concurrency: MISSING_POOL },
          );
          const flagged = asked.filter((a) => a.yes >= missing_floor).sort((a, b) => b.yes - a.yes);
          return { kind: "checked" as const, asked: asked.length, flagged };
        }),
    };
  }),
);

/** Jev's pick as a reading, with the floors applied. */
function readingOf(
  choice: string,
  confidence: number,
  rules: readonly { readonly id: string }[],
  floors: SettingsShape["comments"],
): Reading {
  if (choice === NO_CHANGE) return confidence >= floors.no_change_floor ? { kind: "none" } : { kind: "unsure" };
  if (confidence < floors.floor) return { kind: "unsure" };
  if (choice === ADDS) return { kind: "adds" };
  return rules.some((r) => r.id === choice) ? { kind: "changes", criterion: choice } : { kind: "unsure" };
}

/** Jev as the matcher. Anything short of a sure pick of one earlier problem is "no match". */
export const jevMatcher = Layer.effect(
  Matcher,
  Effect.gen(function* () {
    const jev = yield* Jev;
    const settings = yield* Settings;
    return {
      match: ({ text, candidates }) =>
        Effect.gen(function* () {
          const request = { state: { text }, model: settings.jev.model, questions: matchQuestions(candidates) };
          const answered = yield* askJev(jev, settings.jev.retries, request).pipe(
            Effect.mapError(() => ({ _tag: "matcher_failed" as const })),
          );
          const { choice, confidence } = answered.answers.same;
          const sure = confidence >= settings.review.match_floor && choice !== NO_MATCH && candidates.some((c) => c.id === choice);
          return { to: sure ? choice : null, confidence };
        }),
    };
  }),
);
