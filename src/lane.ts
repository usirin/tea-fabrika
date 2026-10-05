import { Cmd, defineMachine } from "@demlik/tea";
import type { JevCmd, JevTimerMsg } from "@demlik/tea/jev";
import { z } from "zod";
import { Issue } from "./issue.ts";
import {
  ask,
  type Evidence,
  type JudgeState,
  judgeContent,
  type Questions,
  rulingOf,
  type UnsureAnswer,
} from "./judge.ts";

/** How many builds one issue gets before a person is asked. */
export const MAX_ATTEMPTS = 3;

/**
 * Ask the builder for a change. `feedback` is why the last attempt was sent
 * back. `session` is the builder's own conversation, named by the lane before
 * the first build, so a build killed halfway is picked up in the same
 * conversation and a retry remembers what it tried.
 */
export const build = Cmd.define("build", {
  input: z.object({
    issue: Issue,
    feedback: z.string().nullable(),
    session: z.object({
      id: z.string(),
      /** Whether the conversation may already exist: any build but a lane's very first. */
      continues: z.boolean(),
    }),
  }),
  ok: z.object({ summary: z.string() }),
  err: ["agent_failed"],
});

/** Run the tests and read the diff. No model is involved in this one. */
export const check = Cmd.define("check", {
  input: z.object({}),
  ok: z.object({
    passed: z.boolean(),
    output: z.string(),
    diff: z.string(),
    passingTests: z.array(z.string()).readonly(),
  }),
  err: ["could_not_run"],
});

/** Why a lane stopped and is waiting on a person. The list is closed. */
export type ParkCause =
  | { readonly kind: "builder_failed" }
  | { readonly kind: "could_not_run" }
  | { readonly kind: "out_of_attempts"; readonly feedback: string }
  | { readonly kind: "judge_unsure"; readonly answers: readonly UnsureAnswer[] }
  | {
      readonly kind: "judge_failed";
      readonly criteria: readonly string[];
      readonly evidence: Evidence;
    };

/**
 * What a person may answer to each park, and nothing else. An answer that
 * does not fit the park the lane is in leaves it parked.
 */
export interface ParkAnswers {
  readonly builder_failed: { readonly kind: "retry" } | { readonly kind: "drop" };
  readonly could_not_run: { readonly kind: "retry" } | { readonly kind: "drop" };
  readonly out_of_attempts:
    | { readonly kind: "more"; readonly attempts: number }
    | { readonly kind: "drop" };
  readonly judge_unsure:
    | { readonly kind: "accept" }
    | { readonly kind: "rebuild"; readonly feedback: string }
    | { readonly kind: "drop" };
  readonly judge_failed: { readonly kind: "retry" } | { readonly kind: "drop" };
}

/** An answer to one kind of park, tagged with the park it answers. */
export type ParkAnswer = {
  [K in keyof ParkAnswers]: { readonly park: K; readonly answer: ParkAnswers[K] };
}[keyof ParkAnswers];

type Working = {
  readonly issue: Issue;
  readonly attempt: number;
  /** How many builds this lane may have; a person can raise it. */
  readonly limit: number;
  /** The builder's conversation. Never the judge's. */
  readonly session: string;
};

const working = (s: Working): Working => ({
  issue: s.issue,
  attempt: s.attempt,
  limit: s.limit,
  session: s.session,
});

export type Lane =
  | { readonly phase: "idle" }
  | (Working & { readonly phase: "building"; readonly feedback: string | null })
  | (Working & { readonly phase: "checking" })
  | (Working & {
      readonly phase: "judging";
      readonly evidence: Evidence;
      readonly judge: JudgeState;
    })
  | (Working & { readonly phase: "done" })
  | (Working & { readonly phase: "parked"; readonly why: ParkCause })
  | (Working & { readonly phase: "dropped"; readonly why: ParkCause });

export type LaneMsg =
  /** `session` names the builder's conversation; the host makes it, so the reducer stays pure. */
  | { readonly type: "start"; readonly issue: Issue; readonly session: string }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  | { readonly type: "answer"; readonly answer: ParkAnswer; readonly at: number }
  | JevTimerMsg;

export type LaneCmd =
  | ReturnType<typeof build>
  | ReturnType<typeof check>
  | JevCmd<Questions>;

type Step = readonly [Lane, readonly LaneCmd[]];
type Judging = Extract<Lane, { phase: "judging" }>;

const stay = (s: Lane): Step => [s, []];

const park = (s: Working, why: ParkCause): Step => [
  { phase: "parked", ...working(s), why },
  [],
];

/** The build Cmd for a lane in `s`. Only a lane's very first build starts a new conversation. */
const buildFor = (s: Working, feedback: string | null, continues: boolean) =>
  build({ issue: s.issue, feedback, session: { id: s.session, continues } });

/** Build again, one attempt further on. */
function rebuild(s: Working, feedback: string): Step {
  const next = { ...working(s), attempt: s.attempt + 1 };
  return [{ phase: "building", ...next, feedback }, [buildFor(next, feedback, true)]];
}

/** Send the work back to the builder, or park once the attempts are spent. */
function rebuildOrPark(s: Working, feedback: string): Step {
  return s.attempt >= s.limit
    ? park(s, { kind: "out_of_attempts", feedback })
    : rebuild(s, feedback);
}

/** The criteria the judge asked about and has not heard back on. */
const unanswered = (s: Judging) =>
  s.issue.criteria.filter((c) => s.judge.calls[c.id]?.phase === "running");

/**
 * Re-issue what a lane booted from saved state was waiting on. A Cmd that was
 * in flight when the process died may run a second time: that is the window
 * tea names, and the builder resumes its own conversation to make it cheap.
 */
function resume(s: Lane, at: number): Step {
  switch (s.phase) {
    case "building":
      return [s, [buildFor(s, s.feedback, true)]];
    case "checking":
      return [s, [check({})]];
    case "judging": {
      let judge = s.judge;
      const cmds: LaneCmd[] = [];
      for (const criterion of unanswered(s)) {
        const [next, asked] = ask.attempt(
          judge,
          criterion.id,
          judgeContent(s.issue, criterion, s.evidence),
          at,
        );
        judge = next;
        cmds.push(...asked);
      }
      return [{ ...s, judge }, cmds];
    }
    default:
      return stay(s);
  }
}

type Parked = Extract<Lane, { phase: "parked" }>;

/** A person's answer to the park the lane is in. Any other answer changes nothing. */
function answerPark(s: Parked, { park: kind, answer }: ParkAnswer, at: number): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ ...s, phase: "dropped" }, []];
  switch (s.why.kind) {
    case "builder_failed":
      return [{ phase: "building", ...working(s), feedback: null }, [buildFor(s, null, true)]];
    case "could_not_run":
      return [{ phase: "checking", ...working(s) }, [check({})]];
    case "out_of_attempts":
      return answer.kind === "more"
        ? rebuild({ ...working(s), limit: s.limit + answer.attempts }, s.why.feedback)
        : stay(s);
    case "judge_unsure":
      return answer.kind === "accept"
        ? [{ phase: "done", ...working(s) }, []]
        : answer.kind === "rebuild"
          ? rebuild(s, answer.feedback)
          : stay(s);
    case "judge_failed":
      return startJudging(s, s.why.evidence, at);
  }
}

/** Ask the judge about every criterion of a diff that passed its tests. */
function startJudging(s: Working, evidence: Evidence, at: number): Step {
  let judge = ask.init();
  const cmds: LaneCmd[] = [];
  for (const criterion of s.issue.criteria) {
    const [next, asked] = ask.attempt(
      judge,
      criterion.id,
      judgeContent(s.issue, criterion, evidence),
      at,
    );
    judge = next;
    cmds.push(...asked);
  }
  return [
    { phase: "judging", ...working(s), evidence, judge },
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
      return [{ phase: "done", ...working(s) }, []];
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
        evidence: s.evidence,
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
    start: (s, m): Step => {
      if (s.phase !== "idle") return stay(s);
      const first: Working = { issue: m.issue, attempt: 1, limit: MAX_ATTEMPTS, session: m.session };
      return [{ phase: "building", ...first, feedback: null }, [buildFor(first, null, false)]];
    },
    resume: (s, m): Step => resume(s, m.at),
    answer: (s, m): Step =>
      s.phase === "parked" ? answerPark(s, m.answer, m.at) : stay(s),
    build_ok: (s): Step =>
      s.phase === "building"
        ? [{ phase: "checking", ...working(s) }, [check({})]]
        : stay(s),
    build_err: (s): Step =>
      s.phase === "building" ? park(s, { kind: "builder_failed" }) : stay(s),
    check_ok: (s, m): Step => {
      if (s.phase !== "checking") return stay(s);
      return m.value.passed
        ? startJudging(
            s,
            { diff: m.value.diff, passingTests: m.value.passingTests },
            m.at,
          )
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
