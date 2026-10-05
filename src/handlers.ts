import type { Outcome } from "@demlik/tea";
import {
  decodeJevReply,
  type JevCmd,
  type JevQuestionMap,
  jevCallThrew,
} from "@demlik/tea/jev";
import { Effect } from "effect";
import type { weigh } from "./comments.ts";
import type { fetchComments, fetchTicket } from "./tracker.ts";
import type { build, prepare } from "./lane.ts";
import type { inspect, match, route } from "./review.ts";
import {
  Builder,
  CommentReader,
  Enricher,
  Jev,
  Matcher,
  Repo,
  Reviewer,
  Router,
  Tracker,
  Workspace,
} from "./services.ts";
import type { catchUp, land, retest, seal } from "./ship.ts";
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
  fetch_ticket: (cmd: ReturnType<typeof fetchTicket>) =>
    Effect.gen(function* () {
      const tracker = yield* Tracker;
      return yield* tracker.ticket(cmd.issue);
    }),
  enrich: (cmd: ReturnType<typeof enrich>) =>
    Effect.gen(function* () {
      const enricher = yield* Enricher;
      return yield* enricher.enrich(cmd);
    }),
  resilient_run: askJev,
};

/** Review's handlers. */
export const reviewInterpret = {
  route: (cmd: ReturnType<typeof route>) =>
    Effect.gen(function* () {
      const router = yield* Router;
      const routed = yield* router.route({ about: cmd.about, text: cmd.text, goal: cmd.goal });
      return { key: cmd.key, ...routed };
    }),
  inspect: (cmd: ReturnType<typeof inspect>) =>
    Effect.gen(function* () {
      const reviewer = yield* Reviewer;
      return yield* reviewer.review({ issue: cmd.issue, diff: cmd.diff, open: cmd.open, decided: cmd.decided });
    }),
  match: (cmd: ReturnType<typeof match>) =>
    Effect.gen(function* () {
      const matcher = yield* Matcher;
      const matched = yield* matcher.match({ text: cmd.text, candidates: cmd.candidates });
      return { key: cmd.key, ...matched };
    }),
};

/** The handlers for reading the owner's comments. */
export const commentInterpret = {
  fetch_comments: (cmd: ReturnType<typeof fetchComments>) =>
    Effect.gen(function* () {
      const tracker = yield* Tracker;
      return { comments: yield* tracker.comments(cmd.issue) };
    }),
  weigh: (cmd: ReturnType<typeof weigh>) =>
    Effect.gen(function* () {
      const reader = yield* CommentReader;
      const read = yield* reader.weigh({ text: cmd.text, rules: cmd.rules }).pipe(
        // The lane learns which comment failed from the error, so only that one goes to a person.
        Effect.mapError((error) => ({ ...error, key: cmd.key })),
      );
      return { key: cmd.key, ...read };
    }),
};

/** The lane's handlers, review's among them. Each one only forwards a Cmd to the service behind it. */
export const interpret = {
  ...reviewInterpret,
  ...commentInterpret,
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
  fresh_check: () =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.freshCheck();
    }),
};

/** Ship's handlers: each one forwards to the repo. */
export const shipInterpret = {
  seal: (cmd: ReturnType<typeof seal>) =>
    Effect.gen(function* () {
      return yield* (yield* Repo).seal(cmd.message);
    }),
  land: (cmd: ReturnType<typeof land>) =>
    Effect.gen(function* () {
      return yield* (yield* Repo).land(cmd.head);
    }),
  catch_up: (cmd: ReturnType<typeof catchUp>) =>
    Effect.gen(function* () {
      return yield* (yield* Repo).catchUp(cmd.head);
    }),
  retest: (cmd: ReturnType<typeof retest>) =>
    Effect.gen(function* () {
      return yield* (yield* Repo).retest(cmd.head);
    }),
};

/** The factory runs every machine, so it needs every set. */
export const factoryInterpret = { ...triageInterpret, ...interpret, ...shipInterpret };
