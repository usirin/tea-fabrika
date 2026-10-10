import {
  createJevAsk,
  type JevCmd,
  type JevOk,
  type JevRequest,
  type JevTimerMsg,
  jevQuestions,
  type ResilientState,
} from "@demlik/tea/jev";
import type { Issue } from "./issue.ts";

/**
 * What triage asks Jev about an enriched issue, in one call. The wording is
 * fabrika's triage skill, cut down to what a toy with no board can answer.
 *
 * Jev is not asked whether the issue rests on a call nobody has made: it sees
 * only the rewrite, and on the real tickets that needed it, it was never sure
 * (0.52 on kamp-us/demlik#558, 0.04 to 0.46 on the duration toy). The
 * enricher, which has read the code, answers that as the issue's
 * `openDecision`, and triage routes on it before Jev is asked anything.
 */
export const sortQuestions = jevQuestions({
  type: {
    type: "choice",
    instructions: "Which one type is this issue?",
    criteria: {
      bug: "Behavior diverges from intent: something built does the wrong thing",
      feature: "A new capability that does not exist yet, with a clear path, fitting one change",
      chore: "No behavior change: a refactor, rename, dependency bump or doc edit",
      decision: "One open question, and the output is a recorded choice, not code",
      investigation: "An unknown: nobody can say what to build yet",
      epic: "Too big for one change, it needs to be split into children",
    },
  },
  priority: {
    type: "choice",
    instructions: "How urgent is this issue?",
    criteria: {
      p0: "A fire: users are blocked or data is wrong right now",
      p1: "Worth pulling next: a visible defect or the next thing users need",
      p2: "The default: worth doing, nothing is burning",
    },
  },
  value: {
    type: "choice",
    instructions: "Is this issue worth doing?",
    criteria: {
      keep: "Doing it changes something a user or developer would notice",
      process_ceremony: "The deliverable is a record nobody then acts on",
      self_generated_churn: "Tidying of our own output with no behavior change",
      hardening_with_no_incident: "Protection against a failure that has never happened",
    },
  },
});

export type SortQuestions = typeof sortQuestions;
type Choice<K extends keyof SortQuestions> = keyof SortQuestions[K]["criteria"];
export type IssueType = Choice<"type">;
export type Priority = Choice<"priority">;
export type Value = Choice<"value">;
export type KillClause = Exclude<Value, "keep">;

/** The sorter's slice of triage's state: one call, under {@link SORT_KEY}. */
export type SortState = ResilientState<JevRequest<SortQuestions>, JevOk<SortQuestions>>;

export const SORT_KEY = "sort";

/** Named, so its Cmd is `sort_run` and its Msgs say which question they answer. */
export const sortAsk = createJevAsk({ questions: sortQuestions, name: "sort" });

export type SortCmd = JevCmd<SortQuestions, "sort">;
export type SortTimerMsg = JevTimerMsg<"sort">;

/** What Jev reads to sort an issue. Plain data, so the request replays. */
export function sortContent(issue: Issue) {
  return {
    title: issue.title,
    body: issue.body,
    criteria: issue.criteria.map((c) => c.rule),
  };
}

/** The types a lane can build. An epic, a decision and an investigation need other machines. */
export const BUILDABLE: readonly IssueType[] = ["bug", "feature", "chore"];
export const isBuildable = (type: IssueType): boolean => BUILDABLE.includes(type);

/** One answer triage will not act on, and how sure Jev was. */
export interface UnsureSort {
  readonly question: keyof SortQuestions;
  readonly choice: string;
  readonly confidence: number;
}

export interface Sorted {
  readonly type: IssueType;
  readonly priority: Priority;
  readonly value: Value;
}

export type SortRuling =
  | ({ readonly kind: "sorted" } & Sorted)
  | { readonly kind: "unsure"; readonly answers: readonly UnsureSort[] }
  | { readonly kind: "failed" };

/**
 * Read the sort off the slice, or `null` while Jev has not answered. Below
 * `floor`, triage does not take Jev's word.
 *
 * Each question is held only to what the next step needs from it, because a
 * blanket "be sure of everything" parks almost every real issue:
 *
 * - **type**: what gets routed on is "can a lane build this", so bug against
 *   feature may be a coin flip. Only the weight on the chosen side must clear the floor.
 * - **priority**: `p2` is the default. An unsure answer is `p2`, never a park.
 * - **value**: in doubt, keep. Only a confident "not worth doing" counts.
 *
 * A sort made from a request saved before the audience question was dropped
 * may carry an answer to it too. It is not read.
 */
export function sortRulingOf(sort: SortState, floor: number): SortRuling | null {
  const call = sort.calls[SORT_KEY];
  if (call?.phase === "failed") return { kind: "failed" };
  if (call?.phase !== "succeeded") return null;
  const { type, priority, value } = call.result.answers;

  const sameSide = (Object.keys(type.probabilities) as IssueType[])
    .filter((option) => isBuildable(option) === isBuildable(type.choice))
    .reduce((sum, option) => sum + type.probabilities[option], 0);

  if (sameSide < floor) {
    return { kind: "unsure", answers: [{ question: "type", choice: type.choice, confidence: type.confidence }] };
  }

  return {
    kind: "sorted",
    type: type.choice,
    priority: priority.confidence < floor ? "p2" : priority.choice,
    value: value.confidence < floor ? "keep" : value.choice,
  };
}
