import { Cmd, defineMachine } from "@demlik/tea";
import type { JevCmd, JevTimerMsg } from "@demlik/tea/jev";
import { z } from "zod";
import { Issue, RawIssue } from "./issue.ts";
import {
  type KillClause,
  SORT_KEY,
  type Sorted,
  type SortQuestions,
  type SortState,
  sortAsk,
  sortContent,
  sortRulingOf,
  type UnsureSort,
} from "./sort.ts";

/**
 * Ask the enricher to turn a raw issue into one a builder can pick up cold: a
 * plain-words body and acceptance criteria. It reads the code and writes none.
 * `note` is why an earlier rewrite was sent back; `session` is its conversation.
 */
export const enrich = Cmd.define("enrich", {
  input: z.object({
    raw: RawIssue,
    note: z.string().nullable(),
    session: z.string().nullable(),
  }),
  ok: z.object({ issue: Issue, session: z.string() }),
  err: ["agent_failed"],
});

/** Why triage stopped and is waiting on a person. Each carries what its answer needs. */
export type TriagePark =
  | { readonly kind: "enricher_failed" }
  | { readonly kind: "sort_failed"; readonly issue: Issue }
  | { readonly kind: "sort_unsure"; readonly issue: Issue; readonly answers: readonly UnsureSort[] }
  /** A person filed it and it fails the value bar. A person's filing is never thrown away. */
  | {
      readonly kind: "not_worth_doing";
      readonly issue: Issue;
      readonly clause: KillClause;
      readonly sorted: Omit<Sorted, "value">;
    };

type Drop = { readonly kind: "drop" };

/** What a person may answer to each of triage's parks. Any other answer leaves it parked. */
export interface TriageParkAnswers {
  readonly enricher_failed: { readonly kind: "retry" } | Drop;
  readonly sort_failed: { readonly kind: "retry" } | Drop;
  /** `sort`: the person sorts it. Answering at all means it is worth doing. */
  readonly sort_unsure: ({ readonly kind: "sort" } & Omit<Sorted, "value">) | Drop;
  /** `keep`: worth doing after all, sorted as Jev sorted it. */
  readonly not_worth_doing: { readonly kind: "keep" } | Drop;
}

/** An answer to one kind of triage park, tagged with the park it answers. */
export type TriageParkAnswer = {
  [K in keyof TriageParkAnswers]: { readonly park: K; readonly answer: TriageParkAnswers[K] };
}[keyof TriageParkAnswers];

type Held = {
  readonly raw: RawIssue;
  /** The enricher's conversation, once it has had one. */
  readonly session: string | null;
};

export type Triage =
  | { readonly phase: "idle" }
  | (Held & { readonly phase: "enriching" })
  | (Held & {
      readonly phase: "sorting";
      readonly issue: Issue;
      readonly sort: SortState;
    })
  | (Held & { readonly phase: "triaged"; readonly issue: Issue } & Omit<Sorted, "value">)
  | (Held & { readonly phase: "parked"; readonly why: TriagePark })
  | (Held & { readonly phase: "dropped"; readonly why: TriagePark })
  | (Held & { readonly phase: "killed"; readonly clause: KillClause });

export type TriageMsg =
  | { readonly type: "file"; readonly raw: RawIssue }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  | { readonly type: "answer"; readonly answer: TriageParkAnswer; readonly at: number }
  | JevTimerMsg;

export type TriageCmd = ReturnType<typeof enrich> | JevCmd<SortQuestions>;

type Step = readonly [Triage, readonly TriageCmd[]];
type Sorting = Extract<Triage, { phase: "sorting" }>;

const stay = (s: Triage): Step => [s, []];
const held = (s: Held): Held => ({ raw: s.raw, session: s.session });
const park = (s: Held, why: TriagePark): Step => [
  { phase: "parked", ...held(s), why },
  [],
];

/** Put the sorter's slice back, and leave triage once Jev has answered. */
function settleSort(
  s: Sorting,
  [sort, cmds]: readonly [SortState, readonly JevCmd<SortQuestions>[]],
): Step {
  const ruling = sortRulingOf(sort);
  if (ruling === null) return [{ ...s, sort }, cmds];
  switch (ruling.kind) {
    case "failed":
      return park(s, { kind: "sort_failed", issue: s.issue });
    case "unsure":
      return park(s, { kind: "sort_unsure", issue: s.issue, answers: ruling.answers });
    case "sorted": {
      const sorted = { type: ruling.type, priority: ruling.priority, audience: ruling.audience };
      if (ruling.value !== "keep") {
        return s.raw.filedBy === "agent"
          ? [{ phase: "killed", ...held(s), clause: ruling.value }, []]
          : park(s, { kind: "not_worth_doing", issue: s.issue, clause: ruling.value, sorted });
      }
      return triaged(s, s.issue, sorted);
    }
  }
}

const triaged = (s: Held, issue: Issue, sorted: Omit<Sorted, "value">): Step => [
  { phase: "triaged", ...held(s), issue, ...sorted },
  [],
];

/** Ask Jev to sort `issue`, from a fresh slice. */
function startSorting(s: Held, issue: Issue, at: number): Step {
  const [sort, cmds] = sortAsk.attempt(sortAsk.init(), SORT_KEY, sortContent(issue), at);
  return [{ phase: "sorting", ...held(s), issue, sort }, cmds];
}

type Parked = Extract<Triage, { phase: "parked" }>;

/** A person's answer to the park triage is in. Any other answer changes nothing. */
function answerPark(s: Parked, { park: kind, answer }: TriageParkAnswer, at: number): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ ...s, phase: "dropped" }, []];
  switch (s.why.kind) {
    case "enricher_failed":
      return [
        { phase: "enriching", ...held(s) },
        [enrich({ raw: s.raw, note: null, session: s.session })],
      ];
    case "sort_failed":
      return startSorting(s, s.why.issue, at);
    case "sort_unsure":
      return answer.kind === "sort"
        ? triaged(s, s.why.issue, { type: answer.type, priority: answer.priority, audience: answer.audience })
        : stay(s);
    case "not_worth_doing":
      return triaged(s, s.why.issue, s.why.sorted);
  }
}

/**
 * Re-issue what triage booted from saved state was waiting on. An enricher
 * killed before its first answer starts a new conversation: its id is only
 * known once it answers.
 */
function resume(s: Triage, at: number): Step {
  switch (s.phase) {
    case "enriching":
      return [s, [enrich({ raw: s.raw, note: null, session: s.session })]];
    case "sorting": {
      if (s.sort.calls[SORT_KEY]?.phase !== "running") return stay(s);
      const [sort, cmds] = sortAsk.attempt(s.sort, SORT_KEY, sortContent(s.issue), at);
      return [{ ...s, sort }, cmds];
    }
    default:
      return stay(s);
  }
}

/**
 * One raw issue, from "file" to triaged, parked or killed. An agent rewrites
 * it, then Jev sorts the rewrite: its type, its priority, who can pick it up,
 * and whether it is worth doing at all.
 */
export const triage = defineMachine({
  types: { model: {} as Triage, msg: {} as TriageMsg, ctx: undefined },
  cmds: [enrich, sortAsk.run],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    file: (s, m): Step =>
      s.phase === "idle"
        ? [
            { phase: "enriching", raw: m.raw, session: null },
            [enrich({ raw: m.raw, note: null, session: null })],
          ]
        : stay(s),
    resume: (s, m): Step => resume(s, m.at),
    answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer, m.at) : stay(s)),
    enrich_ok: (s, m): Step =>
      s.phase === "enriching"
        ? startSorting({ raw: s.raw, session: m.value.session }, m.value.issue, m.at)
        : stay(s),
    enrich_err: (s): Step =>
      s.phase === "enriching" ? park(s, { kind: "enricher_failed" }) : stay(s),
    resilient_run_ok: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.succeed(s.sort, m)) : stay(s),
    resilient_run_err: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.fail(s.sort, m)) : stay(s),
    deadline_exceeded: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.onTimer(s.sort, m)) : stay(s),
  },
  subs: [
    {
      type: "timer",
      deps: (s: Triage) => (s.phase === "sorting" ? sortAsk.timer(s.sort) : null),
    },
  ],
});
