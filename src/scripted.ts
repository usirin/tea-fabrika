import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import type { JevQuestion, JevRequest } from "@demlik/tea/jev";
import type { Issue } from "./issue.ts";
import type { Verdict } from "./judge.ts";
import {
  type BuildRequest,
  Builder,
  type CheckResult,
  type EnrichRequest,
  Enricher,
  Jev,
  Workspace,
} from "./services.ts";
import type { Audience, IssueType, Priority, Value } from "./sort.ts";

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

/** A builder that follows a script, and remembers every request it was sent. */
export function scriptedBuilder(script: readonly ("ok" | "fail")[]) {
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
        return { summary: `attempt ${requests.length}`, session: SCRIPTED_SESSION };
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
        return {
          summary: `wrote ${Object.keys(files).join(", ")}`,
          session: SCRIPTED_SESSION,
        };
      }),
  });
  return { layer };
}

/** A workspace whose test runs follow a script. */
export function scriptedWorkspace(script: readonly CheckResult[]) {
  const queue = [...script];
  return Layer.succeed(Workspace, { check: () => next(queue, "workspace") });
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
export type ScriptedVerdict = Scripted<Verdict>;

/** One scripted sort: an answer for each of triage's four questions. */
export interface ScriptedSort {
  readonly type: Scripted<IssueType>;
  readonly priority: Scripted<Priority>;
  readonly audience: Scripted<Audience>;
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
 * Jev, scripted. The judge's answers are queued per criterion text, because the
 * lane asks about all of them at once and the order is not the test's to pin.
 * The sorter's answers are one queue, one entry per sort.
 */
export function scriptedJev(
  verdicts: Readonly<Record<string, readonly ScriptedVerdict[]>>,
  sorts: readonly ScriptedSort[] = [],
) {
  const verdictQueues = new Map(
    Object.entries(verdicts).map(([text, steps]) => [text, [...steps]]),
  );
  const sortQueue = [...sorts];
  const answersFor = (request: JevRequest) =>
    Effect.gen(function* () {
      if ("verdict" in request.questions) {
        const { criterion } = request.state as { readonly criterion: string };
        const verdict = yield* next(
          verdictQueues.get(criterion) ?? [],
          `jev verdict for "${criterion}"`,
        );
        return { verdict } as Record<string, Scripted<string>>;
      }
      return { ...(yield* next(sortQueue, "jev sort")) } as Record<string, Scripted<string>>;
    });
  return Layer.succeed(Jev, {
    call: (request) =>
      Effect.gen(function* () {
        const scripted = yield* answersFor(request);
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
