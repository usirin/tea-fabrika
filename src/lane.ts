import { Cmd, defineMachine } from "@demlik/tea";
import type { JevCmd, JevTimerMsg } from "@demlik/tea/jev";
import { z } from "zod";
import { Issue } from "./issue.ts";
import {
  ask,
  type JudgeState,
  judgeContent,
  type Questions,
  rulingOf,
  type UnsureAnswer,
} from "./judge.ts";

/** How many builds one issue gets before a person is asked. */
export const MAX_ATTEMPTS = 3;

/** Ask the builder for a change. `feedback` is why the last attempt was sent back. */
export const build = Cmd.define("build", {
  input: z.object({ issue: Issue, feedback: z.string().nullable() }),
  ok: z.object({ summary: z.string() }),
  err: ["agent_failed"],
});

/** Run the tests and read the diff. No model is involved in this one. */
export const check = Cmd.define("check", {
  input: z.object({}),
  ok: z.object({ passed: z.boolean(), output: z.string(), diff: z.string() }),
  err: ["could_not_run"],
});

/** Why a lane stopped and is waiting on a person. */
export type ParkCause =
  | { readonly kind: "builder_failed" }
  | { readonly kind: "could_not_run" }
  | { readonly kind: "out_of_attempts"; readonly feedback: string }
  | { readonly kind: "judge_unsure"; readonly answers: readonly UnsureAnswer[] }
  | { readonly kind: "judge_failed"; readonly criteria: readonly string[] };

type Working = { readonly issue: Issue; readonly attempt: number };

export type Lane =
  | { readonly phase: "idle" }
  | (Working & { readonly phase: "building"; readonly feedback: string | null })
  | (Working & { readonly phase: "checking" })
  | (Working & {
      readonly phase: "judging";
      readonly diff: string;
      readonly judge: JudgeState;
    })
  | (Working & { readonly phase: "done" })
  | (Working & { readonly phase: "parked"; readonly why: ParkCause });

export type LaneMsg =
  | { readonly type: "start"; readonly issue: Issue }
  | JevTimerMsg;

type LaneCmd =
  | ReturnType<typeof build>
  | ReturnType<typeof check>
  | JevCmd<Questions>;

type Step = readonly [Lane, readonly LaneCmd[]];
type Judging = Extract<Lane, { phase: "judging" }>;

const stay = (s: Lane): Step => [s, []];

const park = (s: Working, why: ParkCause): Step => [
  { phase: "parked", issue: s.issue, attempt: s.attempt, why },
  [],
];

/** Send the work back to the builder, or park once the attempts are spent. */
function rebuildOrPark(s: Working, feedback: string): Step {
  if (s.attempt >= MAX_ATTEMPTS) {
    return park(s, { kind: "out_of_attempts", feedback });
  }
  return [
    { phase: "building", issue: s.issue, attempt: s.attempt + 1, feedback },
    [build({ issue: s.issue, feedback })],
  ];
}

/** Ask the judge about every criterion of a diff that passed its tests. */
function startJudging(s: Working, diff: string, at: number): Step {
  let judge = ask.init();
  const cmds: LaneCmd[] = [];
  for (const criterion of s.issue.criteria) {
    const [next, asked] = ask.attempt(
      judge,
      criterion.id,
      judgeContent(s.issue, criterion, diff),
      at,
    );
    judge = next;
    cmds.push(...asked);
  }
  return [
    { phase: "judging", issue: s.issue, attempt: s.attempt, diff, judge },
    cmds,
  ];
}

/** Put the judge's slice back, and move on once every criterion has an answer. */
function settleJudge(
  s: Judging,
  [judge, cmds]: readonly [JudgeState, readonly JevCmd<Questions>[]],
): Step {
  const ruling = rulingOf(s.issue, judge);
  if (ruling === null) return [{ ...s, judge }, cmds];
  switch (ruling.kind) {
    case "met":
      return [{ phase: "done", issue: s.issue, attempt: s.attempt }, []];
    case "not_met":
      return rebuildOrPark(
        s,
        `Not met: ${ruling.criteria.map((c) => c.text).join("; ")}`,
      );
    case "unsure":
      return park(s, { kind: "judge_unsure", answers: ruling.answers });
    case "failed":
      return park(s, {
        kind: "judge_failed",
        criteria: ruling.criteria.map((c) => c.id),
      });
  }
}

/**
 * One issue, from "start" to done or parked. Every cell ignores a Msg that
 * arrives in a phase it does not belong to, so a late answer changes nothing.
 */
export const lane = defineMachine({
  types: { model: {} as Lane, msg: {} as LaneMsg, ctx: undefined },
  cmds: [build, check, ask.run],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step =>
      s.phase === "idle"
        ? [
            { phase: "building", issue: m.issue, attempt: 1, feedback: null },
            [build({ issue: m.issue, feedback: null })],
          ]
        : stay(s),
    build_ok: (s): Step =>
      s.phase === "building"
        ? [
            { phase: "checking", issue: s.issue, attempt: s.attempt },
            [check({})],
          ]
        : stay(s),
    build_err: (s): Step =>
      s.phase === "building" ? park(s, { kind: "builder_failed" }) : stay(s),
    check_ok: (s, m): Step => {
      if (s.phase !== "checking") return stay(s);
      return m.value.passed
        ? startJudging(s, m.value.diff, m.at)
        : rebuildOrPark(s, `Tests failed:\n${m.value.output}`);
    },
    check_err: (s): Step =>
      s.phase === "checking" ? park(s, { kind: "could_not_run" }) : stay(s),
    resilient_run_ok: (s, m): Step =>
      s.phase === "judging" ? settleJudge(s, ask.succeed(s.judge, m)) : stay(s),
    resilient_run_err: (s, m): Step =>
      s.phase === "judging" ? settleJudge(s, ask.fail(s.judge, m)) : stay(s),
    deadline_exceeded: (s, m): Step =>
      s.phase === "judging" ? settleJudge(s, ask.onTimer(s.judge, m)) : stay(s),
  },
  // The judge's retry timer. It has nothing to wait on outside of judging.
  subs: [
    {
      type: "timer",
      deps: (s: Lane) => (s.phase === "judging" ? ask.timer(s.judge) : null),
    },
  ],
});
