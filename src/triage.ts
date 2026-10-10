import { Cmd, defineMachine } from "@demlik/tea";
import { z } from "zod";
import { Issue, RawIssue } from "./issue.ts";
import { fetchTicket } from "./tracker.ts";
import {
  type KillClause,
  SORT_KEY,
  type SortCmd,
  type Sorted,
  type SortState,
  type SortTimerMsg,
  sortAsk,
  sortContent,
  sortRulingOf,
  type UnsureSort,
} from "./sort.ts";

/**
 * Ask the enricher to turn a raw issue into one a builder can pick up cold: a
 * plain-words body, acceptance criteria, and the call it rests on that nobody
 * has made, if any. It reads the code and writes none. `note` is what changed
 * since its last rewrite, such as the owner's ruling; `session` is its conversation.
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
  /** The ticket could not be read from the tracker. Nothing else is known yet. */
  | { readonly kind: "tracker_failed" }
  /** `note` is what the failed turn was told, so a retry tells it again. */
  | { readonly kind: "enricher_failed"; readonly note: string | null }
  /**
   * The enricher says the issue rests on a call nobody has made yet. Jev is
   * not asked: nothing is sorted, let alone built, until the owner makes it.
   */
  | { readonly kind: "needs_decision"; readonly issue: Issue; readonly question: string }
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
  readonly tracker_failed: { readonly kind: "retry" } | Drop;
  readonly enricher_failed: { readonly kind: "retry" } | Drop;
  /** `decide`: the owner's ruling goes back to the enricher, in the same conversation, and triage carries on from its rewrite. */
  readonly needs_decision: { readonly kind: "decide"; readonly ruling: string } | Drop;
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

/**
 * What triage takes from `fabrika.toml`, copied in when a ticket is filed and
 * kept in the state, so a restart sorts by the floor the run started with.
 */
export interface TriageKnobs {
  /** Below this, triage does not take Jev's word on a sort. */
  readonly sortFloor: number;
}

type Knobbed = { readonly knobs: TriageKnobs };

type Held = Knobbed & {
  readonly raw: RawIssue;
  /** The enricher's conversation, once it has had one. */
  readonly session: string | null;
};

/** A ticket known only by its id: before the tracker has handed it over. */
type Unread = Knobbed & { readonly id: string };

export type Triage =
  | { readonly phase: "idle" }
  | (Unread & { readonly phase: "fetching" })
  | (Unread & { readonly phase: "parked"; readonly why: { readonly kind: "tracker_failed" } })
  | (Unread & { readonly phase: "dropped"; readonly why: { readonly kind: "tracker_failed" } })
  /** `note` is what the enricher is told beyond the ticket, kept so a restart tells it again. */
  | (Held & { readonly phase: "enriching"; readonly note: string | null })
  | (Held & {
      readonly phase: "sorting";
      readonly issue: Issue;
      readonly sort: SortState;
    })
  /** Ready for an agent: no call left open, and sorted. Whether a lane can build its type is the factory's to check. */
  | (Held & { readonly phase: "triaged"; readonly issue: Issue } & Omit<Sorted, "value">)
  | (Held & { readonly phase: "parked"; readonly why: Exclude<TriagePark, { kind: "tracker_failed" }> })
  | (Held & { readonly phase: "dropped"; readonly why: Exclude<TriagePark, { kind: "tracker_failed" }> })
  | (Held & { readonly phase: "killed"; readonly clause: KillClause });

export type TriageMsg =
  /**
   * A ticket was filed. Only its id comes in: the ticket itself is read from
   * the tracker. `knobs` come from the settings; the host reads them, so the reducer stays pure.
   */
  | { readonly type: "file"; readonly issue: string; readonly knobs: TriageKnobs }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  | { readonly type: "answer"; readonly answer: TriageParkAnswer; readonly at: number }
  | SortTimerMsg;

export type TriageCmd = ReturnType<typeof fetchTicket> | ReturnType<typeof enrich> | SortCmd;

type Step = readonly [Triage, readonly TriageCmd[]];
type Sorting = Extract<Triage, { phase: "sorting" }>;

const stay = (s: Triage): Step => [s, []];
const held = (s: Held): Held => ({ raw: s.raw, session: s.session, knobs: s.knobs });
const park = (s: Held, why: Exclude<TriagePark, { kind: "tracker_failed" }>): Step => [
  { phase: "parked", ...held(s), why },
  [],
];

/** Put the sorter's slice back, and leave triage once Jev has answered. */
function settleSort(
  s: Sorting,
  [sort, cmds]: readonly [SortState, readonly SortCmd[]],
): Step {
  const ruling = sortRulingOf(sort, s.knobs.sortFloor);
  if (ruling === null) return [{ ...s, sort }, cmds];
  switch (ruling.kind) {
    case "failed":
      return park(s, { kind: "sort_failed", issue: s.issue });
    case "unsure":
      return park(s, { kind: "sort_unsure", issue: s.issue, answers: ruling.answers });
    case "sorted": {
      const sorted = { type: ruling.type, priority: ruling.priority };
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

/** Ask the enricher for a rewrite, in its conversation if it has one. */
const startEnriching = (s: Held, note: string | null): Step => [
  { phase: "enriching", ...held(s), note },
  [enrich({ raw: s.raw, note, session: s.session })],
];

/**
 * The enricher's rewrite is in. A call it says nobody has made goes to the
 * owner before Jev is asked anything; otherwise Jev sorts it.
 */
const enriched = (s: Held, issue: Issue, at: number): Step =>
  issue.openDecision === null
    ? startSorting(s, issue, at)
    : park(s, { kind: "needs_decision", issue, question: issue.openDecision });

/** What the enricher is told once the owner has made the call its rewrite was waiting on. */
export const rulingNote = (question: string, ruling: string): string =>
  `The owner decided the open question.\nQuestion: ${question}\nRuling: ${ruling}\nRewrite the issue with that settled.`;

type Parked = Extract<Triage, { phase: "parked" }>;

const startFetching = (id: string, knobs: TriageKnobs): Step => [
  { phase: "fetching", id, knobs },
  [fetchTicket({ issue: id })],
];

/** A person's answer to the park triage is in. Any other answer changes nothing. */
function answerPark(s: Parked, { park: kind, answer }: TriageParkAnswer, at: number): Step {
  if (kind !== s.why.kind) return stay(s);
  // Before the ticket was read there is nothing but its id.
  if (!("raw" in s)) return answer.kind === "drop" ? [{ ...s, phase: "dropped" }, []] : startFetching(s.id, s.knobs);
  if (answer.kind === "drop") return [{ ...s, phase: "dropped" }, []];
  switch (s.why.kind) {
    case "enricher_failed":
      return startEnriching(s, s.why.note);
    case "needs_decision":
      return answer.kind === "decide" ? startEnriching(s, rulingNote(s.why.question, answer.ruling)) : stay(s);
    case "sort_failed":
      return startSorting(s, s.why.issue, at);
    case "sort_unsure":
      return answer.kind === "sort" ? triaged(s, s.why.issue, { type: answer.type, priority: answer.priority }) : stay(s);
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
    case "fetching":
      return startFetching(s.id, s.knobs);
    case "enriching":
      return [s, [enrich({ raw: s.raw, note: s.note, session: s.session })]];
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
 * it and says whether it rests on a call nobody has made; if it does, the
 * owner makes it first. Then Jev sorts the rewrite: its type, its priority,
 * and whether it is worth doing at all.
 */
export const triage = defineMachine({
  types: { model: {} as Triage, msg: {} as TriageMsg, ctx: undefined },
  cmds: [fetchTicket, enrich, sortAsk.run],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    file: (s, m): Step => (s.phase === "idle" ? startFetching(m.issue, m.knobs) : stay(s)),
    fetch_ticket_ok: (s, m): Step =>
      s.phase === "fetching"
        ? startEnriching({ raw: m.value, session: null, knobs: s.knobs }, null)
        : stay(s),
    fetch_ticket_err: (s): Step =>
      s.phase === "fetching" ? [{ phase: "parked", id: s.id, knobs: s.knobs, why: { kind: "tracker_failed" } }, []] : stay(s),
    resume: (s, m): Step => resume(s, m.at),
    answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer, m.at) : stay(s)),
    enrich_ok: (s, m): Step =>
      s.phase === "enriching"
        ? enriched({ raw: s.raw, session: m.value.session, knobs: s.knobs }, m.value.issue, m.at)
        : stay(s),
    enrich_err: (s): Step =>
      s.phase === "enriching" ? park(s, { kind: "enricher_failed", note: s.note }) : stay(s),
    sort_run_ok: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.succeed(s.sort, m)) : stay(s),
    sort_run_err: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.fail(s.sort, m)) : stay(s),
    sort_deadline: (s, m): Step =>
      s.phase === "sorting" ? settleSort(s, sortAsk.onTimer(s.sort, m)) : stay(s),
  },
  subs: [
    {
      type: "timer",
      deps: (s: Triage) => (s.phase === "sorting" ? sortAsk.timer(s.sort) : null),
    },
  ],
});
