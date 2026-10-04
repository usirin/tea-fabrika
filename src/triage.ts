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

/** Why triage stopped and is waiting on a person. */
export type TriagePark =
  | { readonly kind: "enricher_failed" }
  | { readonly kind: "sort_failed" }
  | { readonly kind: "sort_unsure"; readonly answers: readonly UnsureSort[] }
  /** A person filed it and it fails the value bar. A person's filing is never thrown away. */
  | { readonly kind: "not_worth_doing"; readonly clause: KillClause };

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
  | (Held & { readonly phase: "killed"; readonly clause: KillClause });

export type TriageMsg =
  | { readonly type: "file"; readonly raw: RawIssue }
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
      return park(s, { kind: "sort_failed" });
    case "unsure":
      return park(s, { kind: "sort_unsure", answers: ruling.answers });
    case "sorted": {
      if (ruling.value !== "keep") {
        return s.raw.filedBy === "agent"
          ? [{ phase: "killed", ...held(s), clause: ruling.value }, []]
          : park(s, { kind: "not_worth_doing", clause: ruling.value });
      }
      return [
        {
          phase: "triaged",
          ...held(s),
          issue: s.issue,
          type: ruling.type,
          priority: ruling.priority,
          audience: ruling.audience,
        },
        [],
      ];
    }
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
    enrich_ok: (s, m): Step => {
      if (s.phase !== "enriching") return stay(s);
      const [sort, cmds] = sortAsk.attempt(
        sortAsk.init(),
        SORT_KEY,
        sortContent(m.value.issue),
        m.at,
      );
      return [
        {
          phase: "sorting",
          raw: s.raw,
          session: m.value.session,
          issue: m.value.issue,
          sort,
        },
        cmds,
      ];
    },
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
