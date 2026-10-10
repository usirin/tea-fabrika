import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import type { JevQuestion, JevRequest } from "@demlik/tea/jev";
import { type Issue, type RawIssue, testNames } from "./issue.ts";
import {
  type BuildAnswer,
  type BuildRequest,
  Builder,
  type CheckResult,
  CommentReader,
  type EnrichRequest,
  Enricher,
  type FailureCause,
  FailureReader,
  type FreshRun,
  Jev,
  Matcher,
  MissingReader,
  type Prepared,
  type Relation,
  type ReviewReport,
  type ReviewRequest,
  Reviewer,
  Repo,
  Router,
  Tracker,
  Workspace,
} from "./services.ts";
import type { Reading } from "./comments.ts";
import type { MissingAnswer } from "./review.ts";
import type { Comment } from "./tracker.ts";
import type { IssueType, Priority, Value } from "./sort.ts";

/** Take the next scripted step, or die: a script that runs dry is a broken test. */
const next = <T>(queue: T[], what: string): Effect.Effect<T> =>
  Effect.suspend(() => {
    const step = queue.shift();
    return step === undefined
      ? Effect.die(new Error(`scripted ${what} ran out of steps`))
      : Effect.succeed(step);
  });

/** The one conversation a scripted builder pretends to have. */
export const SCRIPTED_SESSION = "scripted-session";

/** One scripted build: `ok` is a plain "done", `fail` is an agent that broke. */
export type ScriptedBuild = "ok" | "fail" | BuildAnswer;

/** A builder that follows a script, and remembers every request it was sent. */
export function scriptedBuilder(script: readonly ScriptedBuild[]) {
  const queue = [...script];
  const requests: BuildRequest[] = [];
  const layer = Layer.succeed(Builder, {
    build: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        const step = yield* next(queue, "builder");
        if (step === "fail") {
          return yield* Effect.fail({ _tag: "agent_failed" as const });
        }
        return step === "ok" ? { kind: "done" as const, summary: `attempt ${requests.length}`, deviations: [] } : step;
      }),
  });
  return { layer, requests };
}

/**
 * A builder that writes real files: each attempt writes the next step's files
 * into `dir`. It stands in for an agent until a real one sits behind `Builder`.
 */
export function scriptedFileBuilder(
  dir: string,
  script: readonly Readonly<Record<string, string>>[],
) {
  const queue = [...script];
  const layer = Layer.succeed(Builder, {
    build: () =>
      Effect.gen(function* () {
        const files = yield* next(queue, "file builder");
        yield* Effect.promise(async () => {
          for (const [path, text] of Object.entries(files)) {
            await mkdir(dirname(join(dir, path)), { recursive: true });
            await writeFile(join(dir, path), text);
          }
        });
        return { kind: "done" as const, summary: `wrote ${Object.keys(files).join(", ")}`, deviations: [] };
      }),
  });
  return { layer };
}

/**
 * The run of an issue's tests on untouched code that a fresh issue gets: every
 * example fails, because nothing is built yet.
 */
export const allFailing = (issue: Issue): Prepared => ({
  passing: [],
  failing: testNames(issue),
  output: "",
});

/**
 * A workspace whose test runs follow a script. `prepared` answers the runs on
 * untouched code; left out, every one of them fails, as on a fresh issue.
 */
export function scriptedWorkspace(
  checks: readonly CheckResult[],
  prepared?: readonly Prepared[],
  /** Each fresh check's result. Left out, every fresh copy passes as the folder did. */
  fresh?: readonly FreshRun[],
  /** The files where the change started, by path. */
  base: Readonly<Record<string, string>> = {},
  /** The files the change has edited, as it left them. Any other file reads as it was in `base`; a file in neither, as deleted. */
  current: Readonly<Record<string, string>> = {},
) {
  const checkQueue = [...checks];
  const prepareQueue = prepared === undefined ? undefined : [...prepared];
  const freshQueue = fresh === undefined ? undefined : [...fresh];
  return Layer.succeed(Workspace, {
    testCommand: "node --test",
    baseFiles: () => Effect.succeed(Object.keys(base)),
    baseFile: (path) => {
      const text = base[path];
      return text === undefined ? Effect.fail({ _tag: "could_not_run" as const }) : Effect.succeed(text);
    },
    currentFile: (path) => Effect.succeed(current[path] ?? base[path] ?? ""),
    prepare: (issue) =>
      prepareQueue === undefined ? Effect.succeed(allFailing(issue)) : next(prepareQueue, "prepare"),
    check: () => next(checkQueue, "workspace"),
    freshCheck: () =>
      freshQueue === undefined ? Effect.succeed({ passed: true, output: "passed" }) : next(freshQueue, "fresh check"),
  });
}

/** A scripted enricher: each call hands back the next rewrite, or fails. */
export function scriptedEnricher(script: readonly (Issue | "fail")[]) {
  const queue = [...script];
  const requests: EnrichRequest[] = [];
  const layer = Layer.succeed(Enricher, {
    enrich: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        const step = yield* next(queue, "enricher");
        if (step === "fail") {
          return yield* Effect.fail({ _tag: "agent_failed" as const });
        }
        return { issue: step, session: SCRIPTED_SESSION };
      }),
  });
  return { layer, requests };
}

/**
 * One scripted Jev answer: the choice, how sure it is, and optionally how the
 * rest of the weight is split. Left out, the rest is spread evenly.
 */
export type Scripted<Choice extends string> =
  | readonly [Choice, number]
  | readonly [Choice, number, Readonly<Partial<Record<Choice, number>>>];
/** One scripted sort: an answer for each of triage's three questions. */
export interface ScriptedSort {
  readonly type: Scripted<IssueType>;
  readonly priority: Scripted<Priority>;
  readonly value: Scripted<Value>;
}

/** A choice answer as Jev sends it: the probabilities cover every option. */
function choiceAnswer(
  question: JevQuestion,
  [choice, confidence, split]: Scripted<string>,
) {
  const options = question.type === "choice" ? Object.keys(question.criteria) : [];
  const rest = (1 - confidence) / Math.max(options.length - 1, 1);
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: {
      ...Object.fromEntries(options.map((option) => [option, split === undefined ? rest : 0])),
      ...split,
      [choice]: confidence,
    },
  };
}

/**
 * A reviewer that follows a script, and remembers every request. Left out, it
 * finds nothing and calls every open finding fixed: a clean review.
 */
export function scriptedReviewer(script?: readonly (ReviewReport | "fail")[]) {
  const queue = script === undefined ? undefined : [...script];
  const requests: ReviewRequest[] = [];
  const layer = Layer.succeed(Reviewer, {
    review: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        if (queue === undefined) {
          return { findings: [], rechecks: request.open.map((f) => ({ id: f.id, fixed: true })) };
        }
        const step = yield* next(queue, "reviewer");
        return step === "fail" ? yield* Effect.fail({ _tag: "agent_failed" as const }) : step;
      }),
  });
  return { layer, requests };
}

/**
 * A tracker holding the tickets a test files, whose comments come as the test
 * says. Each comment fetch hands back the next list in `reads`; once they run
 * out, the last one again, the way a real ticket keeps its comments. Left
 * out, there are none. A ticket it does not hold is a failure.
 */
export function scriptedTracker(
  reads: readonly (readonly Comment[] | "fail")[] = [[]],
  tickets: readonly RawIssue[] = [],
) {
  const queue = [...reads];
  let fetches = 0;
  const layer = Layer.succeed(Tracker, {
    ticket: (issue) =>
      Effect.suspend(() => {
        const ticket = tickets.find((t) => t.id === issue);
        return ticket === undefined ? Effect.fail({ _tag: "tracker_failed" as const }) : Effect.succeed(ticket);
      }),
    comments: () =>
      Effect.suspend(() => {
        fetches += 1;
        const read = queue.length > 1 ? queue.shift() : queue[0];
        return read === "fail" ? Effect.fail({ _tag: "tracker_failed" as const }) : Effect.succeed(read ?? []);
      }),
  });
  return { layer, fetches: () => fetches };
}

/**
 * A repo whose base moves as the test says. `land` answers come off a queue;
 * left out, everything lands on the first try. Merges and retests answer from
 * their own queues the same way. `sealed` counts the seals, for restart tests.
 */
export function scriptedRepo(script: {
  readonly lands?: readonly ("landed" | "behind" | "fail")[];
  readonly merges?: readonly ("merged" | readonly string[])[];
  readonly retests?: readonly boolean[];
} = {}) {
  const lands = [...(script.lands ?? [])];
  const merges = [...(script.merges ?? [])];
  const retests = [...(script.retests ?? [])];
  const seals: string[] = [];
  const failed = { _tag: "repo_failed" as const };
  const layer = Layer.succeed(Repo, {
    seal: (message) =>
      Effect.sync(() => {
        seals.push(message);
        return { head: "sealed-1", stat: " slugify.js | 3 ++-" };
      }),
    land: (head) =>
      Effect.suspend(() => {
        const step = lands.shift() ?? "landed";
        if (step === "fail") return Effect.fail(failed);
        return Effect.succeed(step === "landed" ? { kind: "landed" as const, sha: head } : { kind: "behind" as const });
      }),
    catchUp: (head) =>
      Effect.sync(() => {
        const step = merges.shift() ?? "merged";
        return step === "merged"
          ? { kind: "merged" as const, head: `merge-of-${head}` }
          : { kind: "conflicted" as const, files: step };
      }),
    retest: () => Effect.sync(() => ({ passed: retests.shift() ?? true, output: "retest output" })),
  });
  return { layer, seals };
}

/** A comment reader that answers from a table keyed by the comment's text. A text it does not hold is `unsure`. */
export function scriptedCommentReader(answers: Readonly<Record<string, Reading | "fail">> = {}) {
  const asked: string[] = [];
  const layer = Layer.succeed(CommentReader, {
    weigh: ({ text }) =>
      Effect.suspend(() => {
        asked.push(text);
        const answer = answers[text] ?? { kind: "unsure" };
        return answer === "fail"
          ? Effect.fail({ _tag: "reader_failed" as const })
          : Effect.succeed({ reading: answer, confidence: answer.kind === "unsure" ? 0.5 : 0.95 });
      }),
  });
  return { layer, asked };
}

/**
 * A failure reader that follows a script, one cause per failed run, and
 * remembers every run it read. Left out, every failure is the builder's
 * change, surely: the send-back a lane had before it read failures.
 */
export function scriptedFailureReader(script?: readonly (FailureCause | "fail")[]) {
  const queue = script === undefined ? undefined : [...script];
  const read: { readonly command: string; readonly diff: string; readonly output: string }[] = [];
  const layer = Layer.succeed(FailureReader, {
    read: (run) =>
      Effect.gen(function* () {
        read.push(run);
        const step = queue === undefined ? "change" : yield* next(queue, "failure reader");
        if (step === "fail") return yield* Effect.fail({ _tag: "reader_failed" as const });
        return { cause: step, confidence: step === "unsure" ? 0.5 : 0.95 };
      }),
  });
  return { layer, read };
}

/** A missing-file check that found nothing. */
export const NOTHING_MISSING: MissingAnswer = { kind: "checked", asked: 0, flagged: [] };

/**
 * A missing-file reader: each check hands back the next answer, or fails. Left
 * without a script, every check asks nothing and flags nothing.
 */
export function scriptedMissingReader(script?: readonly (MissingAnswer | "fail")[]) {
  const queue = script === undefined ? undefined : [...script];
  const asked: { readonly diff: string; readonly changed: readonly string[] }[] = [];
  const layer = Layer.succeed(MissingReader, {
    find: ({ diff, changed }) =>
      Effect.gen(function* () {
        asked.push({ diff, changed });
        const step = queue === undefined ? NOTHING_MISSING : yield* next(queue, "missing reader");
        if (step === "fail") return yield* Effect.fail({ _tag: "reader_failed" as const });
        return step;
      }),
  });
  return { layer, asked };
}

/**
 * A matcher that answers from a table keyed by the new finding's text: the
 * decided id it makes the same point as. A text the table does not hold, or
 * an id that is not among the candidates, is no match.
 */
export function scriptedMatcher(answers: Readonly<Record<string, string>> = {}) {
  const asked: string[] = [];
  const layer = Layer.succeed(Matcher, {
    match: ({ text, candidates }) =>
      Effect.sync(() => {
        asked.push(text);
        const to = answers[text];
        return to !== undefined && candidates.some((c) => c.id === to)
          ? { to, confidence: 0.95 }
          : { to: null, confidence: 0.5 };
      }),
  });
  return { layer, asked };
}

/**
 * A router that answers from a table keyed by the text it is asked about, and
 * remembers every question. A text the table does not hold is `unsure`.
 */
export function scriptedRouter(answers: Readonly<Record<string, Relation>> = {}) {
  const asked: string[] = [];
  const layer = Layer.succeed(Router, {
    route: ({ text }) =>
      Effect.sync(() => {
        asked.push(text);
        return { relation: answers[text] ?? "unsure", confidence: answers[text] === undefined ? 0.5 : 0.95 };
      }),
  });
  return { layer, asked };
}

/** Jev, scripted: the sorter's answers, one entry per sort. */
export function scriptedJev(sorts: readonly ScriptedSort[] = []) {
  const sortQueue = [...sorts];
  return Layer.succeed(Jev, {
    call: (request: JevRequest) =>
      Effect.gen(function* () {
        const scripted = { ...(yield* next(sortQueue, "jev sort")) } as Record<string, Scripted<string>>;
        return {
          status: 200,
          body: {
            model: request.model,
            answers: Object.fromEntries(
              Object.entries(request.questions).flatMap(([id, question]) => {
                const answer = scripted[id];
                return answer === undefined ? [] : [[id, choiceAnswer(question, answer)]];
              }),
            ),
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        };
      }),
  });
}
