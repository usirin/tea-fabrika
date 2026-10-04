import {
  createJevAsk,
  type JevOk,
  type JevRequest,
  jevQuestions,
  type ResilientState,
} from "@demlik/tea/jev";
import type { Criterion, Issue } from "./issue.ts";

/**
 * The judge's rubric, written once. It is asked once per acceptance criterion,
 * so one diff with three criteria is three Jev calls, each keyed by criterion.
 */
export const questions = jevQuestions({
  verdict: {
    type: "choice",
    instructions:
      "Does this change satisfy the acceptance criterion? `diff` is the change. `passingTests` names the tests that passed after it.",
    criteria: {
      met: "The diff does what the criterion asks, or a passing test shows that it does",
      not_met: "The diff does not do what the criterion asks, or does it wrongly",
      cannot_tell: "Neither the diff nor the passing tests are enough to decide",
    },
  },
});

export type Questions = typeof questions;
export type Verdict = keyof Questions["verdict"]["criteria"];

/** The judge's slice of the lane's state: one call per criterion id. */
export type JudgeState = ResilientState<JevRequest<Questions>, JevOk<Questions>>;

/** Below this the judge does not get to decide, and a person looks at it. */
export const CONFIDENCE_FLOOR = 0.8;

export const ask = createJevAsk({ questions });

/** What the judge is shown about a change: the diff, and the tests that passed after it. */
export interface Evidence {
  readonly diff: string;
  /**
   * The names of the passing tests. Some criteria cannot be read off a diff:
   * whether a regex refuses "30m1h" is something a test settles and a reader guesses.
   */
  readonly passingTests: readonly string[];
}

/** What Jev reads for one criterion. Plain data, so the request replays. */
export function judgeContent(issue: Issue, criterion: Criterion, evidence: Evidence) {
  return { issue: issue.title, criterion: criterion.text, ...evidence };
}

/** An answer the judge gave but the lane will not act on. */
export interface UnsureAnswer {
  readonly id: string;
  readonly choice: Verdict;
  readonly confidence: number;
}

/** How the judging of one diff ended, once every criterion has an answer. */
export type Ruling =
  | { readonly kind: "met" }
  | { readonly kind: "not_met"; readonly criteria: readonly Criterion[] }
  | { readonly kind: "unsure"; readonly answers: readonly UnsureAnswer[] }
  | { readonly kind: "failed"; readonly criteria: readonly Criterion[] };

/**
 * Read the ruling off the judge's slice, or `null` while any criterion is still
 * waiting on Jev. A call that failed outranks an unsure answer, and an unsure
 * answer outranks a clear "not met": the lane only rebuilds on a verdict it trusts.
 */
export function rulingOf(issue: Issue, judge: JudgeState): Ruling | null {
  const failed: Criterion[] = [];
  const unsure: UnsureAnswer[] = [];
  const notMet: Criterion[] = [];
  for (const criterion of issue.criteria) {
    const call = judge.calls[criterion.id];
    if (call?.phase === "failed") {
      failed.push(criterion);
    } else if (call?.phase === "succeeded") {
      const answer = call.result.answers.verdict;
      if (answer.confidence < CONFIDENCE_FLOOR || answer.choice === "cannot_tell") {
        unsure.push({ id: criterion.id, choice: answer.choice, confidence: answer.confidence });
      } else if (answer.choice === "not_met") {
        notMet.push(criterion);
      }
    } else {
      return null;
    }
  }
  if (failed.length > 0) return { kind: "failed", criteria: failed };
  if (unsure.length > 0) return { kind: "unsure", answers: unsure };
  if (notMet.length > 0) return { kind: "not_met", criteria: notMet };
  return { kind: "met" };
}
