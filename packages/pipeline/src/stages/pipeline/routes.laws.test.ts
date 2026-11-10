import { Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { make } from "../../entity.ts";
import { LaneId } from "../../ids.ts";
import { Outcome } from "../../tickets/ticket.ts";
import { BUILD_NAMES } from "../build/outcome.ts";
import type { ExamOutcome } from "../exam/machine.ts";
import { MUTATION_NAMES } from "../mutation/outcome.ts";
import { type Name, nameOf, partsOf } from "../outcome.ts";
import { PLAN_NAMES } from "../plan/outcome.ts";
import type { PushOutcome } from "../push/machine.ts";
import { REVIEW_NAMES } from "../review/outcome.ts";
import { SHIP_NAMES } from "../ship/outcome.ts";
import { SORT_NAMES } from "../sort/outcome.ts";
import type { MutantsOutcome } from "../test-writer/mutants.ts";
import { TEST_WRITER_NAMES } from "../test-writer/outcome.ts";
import {
  type Carry,
  claimLane,
  EMPTY,
  freshMain,
  type Held,
  type Lane,
  type LaneCmd,
  type LaneStep,
  lane,
  MAX_ROUNDS,
  runStep,
  STEPS,
  type StepEnd,
} from "./machine.ts";
import { FINAL, isEnd } from "./outcome.ts";
import * as routes from "./routes.ts";

// Today's version. Self-fix PR 11a, "every outcome has a route, and the law"
// (docs/plan/pipeline-self-fix.md, PR 11). Experiment 193's law, moved here from its script, on the
// real reducer: for every step, every name it can hand the lane, at round 1, at the last round and
// with `[build] send_back = false`, the lane is sent `lane_step_ok` and where it goes is read back.
//
//   a hole that is not a `wait` row     goes on at its first arrival: never a stop, never a person
//   a `once` row                        runs its step once more, and stops only on the second arrival
//   a needed row                        still reaches its person, or its stop
//
// The hole keys and the needed keys are copied in by hand, as two plain lists: the test's own exam,
// which the route table cannot write for itself (P12). Each carries its row in the jidoka table
// (docs/direction/jidoka-and-andon.md#every-place-todays-lane-stops-or-asks), or where else it was
// named. Rows 28 and 45 follow the jidoka table, as the plan says: fixable, where 193 called them
// needed. Nothing imports from `experiments/`.
//
// The table itself is read as data through the module (`"ROUTES" in routes`), so this file compiles
// before `ROUTES` exists; `routes.test.ts` holds the type-level checks. Waits and records (the
// `stopped` fact, a retry's run id, the lane's writer, the input key's heads) are PR 11b's.

const ID = make(LaneId)("L1");
const OTHER = make(LaneId)("L2");
const HEAD = "1".repeat(40);
const NEW_HEAD = "2".repeat(40);
const EXAM_HEAD = "3".repeat(40);
const GIVEN = { head: EXAM_HEAD, onto: "main", base: "9".repeat(40), diff: "d".repeat(40) };

const checkedAt = (head: string, result: "green" | "red" | "not_run") => ({
  head,
  commands: [],
  result,
  failed: result === "red" ? ["lane.test.ts > adds"] : [],
});

/**
 * A carry a lane far along holds: a base, a head with green checks, both pull requests, and the exam's
 * reviewed and said yes to at its head, so `exam_merge` and every step after build run as asked.
 */
const CARRY: Carry = {
  ...EMPTY,
  version: 1,
  base: "0".repeat(40),
  head: HEAD,
  checked: checkedAt(HEAD, "green"),
  rules: [".oxlintrc.json"],
  examPr: "local:example/lane/pull/1",
  examPull: { head: EXAM_HEAD, reviewed: { ...GIVEN, met: 1, of: 1 }, yes: GIVEN },
  pr: "local:example/lane/pull/2",
};

// ---------------------------------------------------------------------------------------------
// Every name each step can hand the lane.

/** Exam, push and the mutants job export only a schema: their names, complete by type. */
const EXAM_NAMES = Object.keys({
  done: true,
  "done:part": true,
  "ask:owner:check_change": true,
  "skip:no_rules_change": true,
  "stuck:draft_failed": true,
  "stuck:unchecked": true,
  "stuck:land_failed": true,
} satisfies Record<Name<ExamOutcome>, true>);

const PUSH_NAMES = Object.keys({
  done: true,
  "done:part": true,
  "stuck:push_failed": true,
  "stuck:open_failed": true,
  "stuck:post_failed": true,
} satisfies Record<Name<PushOutcome>, true>);

const MUTANTS_NAMES = Object.keys({
  done: true,
  "done:part": true,
  "ask:owner:disable": true,
  "stuck:not_killed": true,
  "stuck:run_failed": true,
} satisfies Record<Name<MutantsOutcome>, true>);

const STAGE_NAMES: Readonly<Record<LaneStep, readonly string[]>> = {
  triage: SORT_NAMES,
  plan: PLAN_NAMES,
  exam: EXAM_NAMES,
  exam_review: REVIEW_NAMES,
  exam_merge: SHIP_NAMES,
  test_writer: TEST_WRITER_NAMES,
  build: BUILD_NAMES,
  mutation: MUTATION_NAMES,
  mutants: MUTANTS_NAMES,
  review: REVIEW_NAMES,
  push: PUSH_NAMES,
  merge: SHIP_NAMES,
};

/** The names the lane's step bodies make in program.ts, on top of their stage's (193's `MADE`). */
const MADE: Readonly<Partial<Record<LaneStep, readonly string[]>>> = {
  plan: ["stuck:unchecked"], // program.ts:780
  exam_review: [
    "stuck:head_moved", // program.ts:872
    "send:builder:conflicts", // program.ts:877
    "stuck:checks_not_run", // program.ts:888
    "send:builder:checks_red", // program.ts:894
  ],
  build: [
    "send:builder:checks_red", // program.ts:711
    "stuck:checks_not_run", // program.ts:678, :718
    "stuck:rounds_spent", // program.ts:686
    "ask:owner:no_change", // program.ts:684
    "ask:owner:still_red", // program.ts:689
  ],
  review: ["ask:owner:unseen", "ask:owner:decision"], // program.ts:1327, :1345
  merge: ["stuck:merged_elsewhere"], // program.ts:1412
};

/** A person's call: the end the step takes if they let it through (`StepEnd.after`). */
const CALLS: Readonly<Record<string, string>> = {
  "build ask:owner:no_change": "done",
  "review ask:owner:decision": "done",
};

const namesAt = (step: LaneStep): readonly string[] => [...new Set([...STAGE_NAMES[step], ...(MADE[step] ?? [])])];

const PAIRS: readonly { readonly step: LaneStep; readonly name: string }[] = STEPS.flatMap((step) =>
  namesAt(step).map((name) => ({ step, name })),
);

// ---------------------------------------------------------------------------------------------
// The two lists, by hand: experiment 193's classes, with the kind of route the plan gives each.

/**
 * `step`: back, run or fresh, to the step that can fix it. `wait`: the service waits it out, and only
 * a refusal reaches the lane, which stops with its why. `once`: the same step again, as a new run;
 * twice, stop. `meaning`: read the ticket and the pull request fresh, then end or pause by what they
 * say (jidoka row 13). `guard`: checked when the lane starts, so it never arrives.
 */
type Kind = "step" | "wait" | "once" | "meaning" | "guard";

interface Hole {
  readonly kind: Kind;
  /** The jidoka table's row, or where else it was named. */
  readonly row: string;
}

const hole = (kind: Kind, row: string): Hole => ({ kind, row });

const HOLES_BY_HAND: Readonly<Record<string, Hole>> = {
  "triage stuck:read_failed": hole("wait", "16"),
  "triage stuck:write_failed": hole("wait", "16"),
  "triage stuck:draft_failed": hole("once", "17"),
  "triage stuck:changed": hole("once", "19"),

  "plan stuck:read_failed": hole("wait", "21"),
  "plan stuck:draft_failed": hole("once", "22"),
  "plan stuck:cut_off": hole("once", "22"),

  "exam stuck:draft_failed": hole("once", "26"),
  "exam stuck:land_failed": hole("wait", "27"),

  "exam_merge send:builder:checks_red": hole("step", "PR 10"),
  "exam_merge send:builder:conflicts": hole("step", "PR 10"),
  "exam_merge send:builder:bot_comment": hole("step", "PR 10"),
  "exam_merge send:builder:behind": hole("step", "PR 10"),
  "exam_merge send:reviewer:no_review": hole("step", "PR 10"),
  "exam_merge send:builder:ejected": hole("once", "PR 10"),
  "exam_merge skip:closed": hole("meaning", "13"),
  "exam_merge skip:draft": hole("meaning", "13"),
  "exam_merge stuck:read_failed": hole("wait", "64"),
  "exam_merge stuck:approval_unknown": hole("wait", "64"),
  "exam_merge stuck:reviews_unknown": hole("wait", "64"),
  "exam_merge stuck:proof_refused": hole("once", "66"),
  "exam_merge stuck:head_moving": hole("once", "66"),
  "exam_merge stuck:checks_stuck": hole("once", "67"),
  "exam_merge stuck:queue_silent": hole("once", "67"),
  "exam_merge stuck:enqueue_failed": hole("once", "68"),
  "exam_merge stuck:merge_failed": hole("once", "68"),
  "exam_merge stuck:merge_unknown": hole("once", "68"),

  "test_writer ask:owner:fails_on_base": hole("step", "28"),
  "test_writer ask:owner:already_passes": hole("step", "29"),
  "test_writer stuck:read_failed": hole("wait", "32"),
  "test_writer stuck:record_failed": hole("wait", "32"),
  "test_writer stuck:commit_failed": hole("once", "32"),
  "test_writer stuck:draft_failed": hole("once", "33"),
  "test_writer stuck:cut_off": hole("once", "33"),
  "test_writer stuck:run_failed": hole("once", "34"),
  "test_writer stuck:no_result": hole("step", "35"),

  "build skip:closed": hole("meaning", "13"),
  "build skip:merged": hole("meaning", "13"),
  "build stuck:read_failed": hole("wait", "37"),
  "build stuck:copy_failed": hole("once", "37"),
  "build stuck:draft_failed": hole("once", "39"),
  "build stuck:no_change": hole("step", "41"),
  "build ask:owner:no_change": hole("step", "45"),
  "build ask:owner:still_red": hole("step", "46"),

  "mutation stuck:read_failed": hole("wait", "49"),
  "mutation stuck:run_failed": hole("once", "51"),

  "mutants stuck:not_killed": hole("step", "193 new"),
  "mutants stuck:run_failed": hole("once", "193 new"),

  "review skip:merged": hole("meaning", "13"),
  "review skip:closed": hole("meaning", "13"),
  "review stuck:read_failed": hole("wait", "54"),
  "review stuck:ticket_unknown": hole("wait", "54"),
  "review stuck:diff_unknown": hole("wait", "54"),
  "review stuck:kinds_unknown": hole("wait", "54"),
  "review stuck:checks_unknown": hole("wait", "54"),
  "review stuck:rubric_unknown": hole("guard", "55"),
  "review stuck:draft_failed": hole("once", "56"),
  "review stuck:checks_stuck": hole("once", "58"),

  "push stuck:push_failed": hole("wait", "59"),
  "push stuck:open_failed": hole("wait", "59"),
  "push stuck:post_failed": hole("wait", "59"),

  "merge send:builder:review_failed": hole("step", "62"),
  "merge send:builder:checks_red": hole("step", "62"),
  "merge send:builder:conflicts": hole("step", "62"),
  "merge send:builder:bot_comment": hole("step", "62"),
  "merge send:builder:behind": hole("step", "62"),
  "merge send:builder:ejected": hole("once", "62"),
  "merge send:reviewer:no_review": hole("step", "63"),
  "merge skip:closed": hole("meaning", "13"),
  "merge skip:draft": hole("meaning", "13"),
  "merge stuck:read_failed": hole("wait", "64"),
  "merge stuck:approval_unknown": hole("wait", "64"),
  "merge stuck:reviews_unknown": hole("wait", "64"),
  "merge stuck:proof_refused": hole("once", "66"),
  "merge stuck:head_moving": hole("once", "66"),
  "merge stuck:checks_stuck": hole("once", "67"),
  "merge stuck:queue_silent": hole("once", "67"),
  "merge stuck:enqueue_failed": hole("once", "68"),
  "merge stuck:merge_failed": hole("once", "68"),
  "merge stuck:merge_unknown": hole("once", "68"),
};

/** `exam_review` runs the review stage: its rows are review's, of the same kinds (the plan's PR 11). */
const asExamReview = <A extends { readonly row: string }>(
  rows: Readonly<Record<string, A>>,
): Readonly<Record<string, A>> =>
  Object.fromEntries(
    Object.entries(rows)
      .filter(([key]) => key.startsWith("review ") && STAGE_NAMES.review.includes(key.slice(7)))
      .map(([key, row]) => [`exam_review ${key.slice(7)}`, { ...row, row: `${row.row}, as review's` }]),
  );

const HOLES: Readonly<Record<string, Hole>> = { ...HOLES_BY_HAND, ...asExamReview(HOLES_BY_HAND) };

/** Where a needed row goes: a person, by the question's kind, or its stop, or a final end. */
type Reach = { readonly go: "ask"; readonly for: string } | { readonly go: "stop" } | { readonly go: "end" };

interface Needed {
  readonly reach: Reach;
  readonly row: string;
}

const asks = (kind: string, row: string): Needed => ({ reach: { go: "ask", for: kind }, row });
const stops = (row: string): Needed => ({ reach: { go: "stop" }, row });

const NEEDED_BY_HAND: Readonly<Record<string, Needed>> = {
  "triage ask:owner:ruling": asks("step", "15"),
  "triage stuck:over_budget": asks("spend", "18"),
  "triage stuck:unchecked": stops("17"),
  "plan stuck:over_budget": asks("spend", "23"),
  "plan stuck:unchecked": stops("22"),
  "exam stuck:unchecked": stops("26"),
  "exam_merge ask:owner:approval": asks("step", "60"),
  "exam_merge ask:commenter:comment": asks("step", "61"),
  "test_writer ask:owner:cannot_test": asks("step", "30"),
  "test_writer stuck:unchecked": stops("33"),
  "build stuck:over_budget": asks("spend", "40"),
  "build stuck:exam_touched": asks("exam_touched", "42"),
  "build stuck:checks_not_run": stops("43"),
  "build stuck:rounds_spent": asks("rounds_spent", "44"),
  "mutation ask:owner:check_change": asks("step", "48"),
  "mutants ask:owner:disable": asks("step", "31"),
  "review stuck:over_budget": asks("spend", "57"),
  "review ask:owner:unseen": asks("step", "52"),
  "review ask:owner:decision": asks("step", "53"),
  "merge ask:owner:approval": asks("step", "60"),
  "merge ask:commenter:comment": asks("step", "61"),
  "merge stuck:merged_elsewhere": { reach: { go: "end" }, row: "69" },
};

const NEEDED: Readonly<Record<string, Needed>> = {
  ...NEEDED_BY_HAND,
  ...asExamReview(NEEDED_BY_HAND),
};

/** The rows that go back one time and then ask the step's own question (the plan: rows 28, 29, 35, 41). */
const BACK_ONCE: ReadonlySet<string> = new Set([
  "test_writer ask:owner:fails_on_base",
  "test_writer ask:owner:already_passes",
  "test_writer stuck:no_result",
  "build stuck:no_change",
]);

/** The step each `step` row runs at its first arrival, at round 1; `round` where the plan says it. */
const STEP_TO: Readonly<Record<string, { readonly step: LaneStep; readonly round?: number }>> = {
  "merge send:builder:review_failed": { step: "build", round: 2 },
  "merge send:builder:checks_red": { step: "build", round: 2 },
  "merge send:builder:bot_comment": { step: "build", round: 2 },
  "merge send:reviewer:no_review": { step: "review", round: 1 },
  "test_writer ask:owner:fails_on_base": { step: "test_writer" },
  "test_writer ask:owner:already_passes": { step: "test_writer" },
  "test_writer stuck:no_result": { step: "test_writer" },
  "build stuck:no_change": { step: "build" },
  "build ask:owner:no_change": { step: "review" },
  "build ask:owner:still_red": { step: "build", round: 2 },
  "mutants stuck:not_killed": { step: "mutants" },
};

/** The rows that cannot happen, each with the law that shows it (the plan: 12 get `cannot`). */
const CANNOT: readonly string[] = [
  "exam_merge skip:not_ours",
  "exam_merge stuck:criteria_unknown",
  "build skip:not_ready",
  "build stuck:no_criteria",
  "build stuck:criteria_unknown",
  "build stuck:push_failed",
  "build stuck:open_failed",
  "review skip:draft",
  "review stuck:no_criteria",
  "review stuck:unseen",
  "merge skip:not_ours",
  "merge stuck:criteria_unknown",
];

// ---------------------------------------------------------------------------------------------
// Driving the real reducer.

type Mode = "round 1" | "last round" | "send_back off";
const MODES: readonly Mode[] = ["round 1", "last round", "send_back off"];

const heldIn = (mode: Mode, carry: Carry = CARRY): Held => ({
  number: 7,
  lane: ID,
  ...(mode === "send_back off" ? { sendBack: false } : {}),
  count: 5,
  round: mode === "last round" ? MAX_ROUNDS : 1,
  carry,
  trail: [],
});

const runningAt = (step: LaneStep, mode: Mode = "round 1"): Lane => {
  const held = heldIn(mode);
  const asked = runStep({
    number: 7,
    count: held.count,
    step,
    round: held.round,
    carry: held.carry,
    intent: `lane/7/${held.count}/${step}`,
  });
  return { ...held, phase: "running", step, asked };
};

/** An outcome from its printed name, as the step's `ended` fact holds it. */
const outcomeOf = (name: string): Outcome => {
  const { verb, who, why } = partsOf(name);
  return Schema.decodeUnknownSync(Outcome)(
    verb === "done"
      ? { kind: "done", part: why === "part" }
      : verb === "send"
        ? { kind: "send", to: who, why }
        : verb === "ask"
          ? { kind: "ask", who, for: why }
          : { kind: verb, why },
  );
};

/** The lane after its running step ended with `name`, and what it sent. */
const ended = (s: Lane, name: string, carry: StepEnd["carry"] = {}): readonly [Lane, readonly LaneCmd[]] => {
  if (s.phase !== "running") {
    return [s, []];
  }

  const after = CALLS[`${s.step} ${name}`];
  return lane.update.lane_step_ok(
    s,
    runStep.ok(
      s.asked,
      { outcome: outcomeOf(name), carry, ...(after === undefined ? {} : { after: outcomeOf(after) }) },
      0,
    ),
  );
};

/** Where the lane went: a step, a person, a stop, an end, or on, through some other read it sent. */
type Dest =
  | { readonly go: "run"; readonly step: LaneStep; readonly round: number }
  | { readonly go: "ask"; readonly for: string; readonly step: LaneStep }
  | { readonly go: "stop" | "end"; readonly outcome: string }
  | { readonly go: "on"; readonly phase: string };

const destOf = (s: Lane): Dest => {
  switch (s.phase) {
    case "running":
      return { go: "run", step: s.step, round: s.round };
    case "asking":
      return { go: "ask", for: s.question.for, step: s.question.step };
    case "releasing":
    case "over":
      return { go: isEnd(s.outcome) ? "end" : "stop", outcome: nameOf(s.outcome) };
    default:
      return { go: "on", phase: s.phase };
  }
};

/** Where the lane goes when `step` ends with `name` in `mode`: on its first arrival, or the second in a row. */
type Drive = (step: LaneStep, name: string, mode: Mode, arrival: 1 | 2) => Dest;

const drive: Drive = (step, name, mode, arrival) => {
  const [first] = ended(runningAt(step, mode), name);

  if (arrival === 1 || first.phase !== "running" || first.step !== step) {
    return destOf(first);
  }

  return destOf(ended(first, name)[0]);
};

/** A drive with one row routed elsewhere: a planted break, to see a law fail on it first. */
const planted =
  (key: string, dest: Dest, arrival: 1 | 2 = 1): Drive =>
  (step, name, mode, at) =>
    `${step} ${name}` === key && at === arrival ? dest : drive(step, name, mode, at);

const stepOf = (key: string): LaneStep => {
  const step = STEPS.find((s) => key.startsWith(`${s} `));

  if (step === undefined) {
    throw new Error(`no step in ${key}`);
  }

  return step;
};

const nameIn = (key: string): string => key.slice(stepOf(key).length + 1);

// ---------------------------------------------------------------------------------------------
// The laws, each a list of what breaks it.

/** A hole that is not a `wait` row goes on at its first arrival: past the rounds, only their question. */
const goesOn = (d: Drive, keys: readonly string[] = Object.keys(HOLES)): readonly string[] =>
  keys
    .filter((key) => {
      const { kind } = HOLES[key] ?? hole("wait", "");
      return kind === "step" || kind === "once" || kind === "meaning";
    })
    .flatMap((key) =>
      MODES.flatMap((mode) => {
        const to = d(stepOf(key), nameIn(key), mode, 1);
        const bounded = mode !== "round 1" && HOLES[key]?.kind === "step";
        const wrong =
          to.go === "stop" || to.go === "end" || (to.go === "ask" && !(bounded && to.for === "rounds_spent"));
        return wrong ? [`${key} (${mode})`] : [];
      }),
    );

/** A `once` row runs its step again on its first arrival, and stops on the second in a row. */
const onceThenStop = (d: Drive, keys: readonly string[] = Object.keys(HOLES)): readonly string[] =>
  keys
    .filter((key) => HOLES[key]?.kind === "once")
    .filter((key) => {
      const step = stepOf(key);
      const first = d(step, nameIn(key), "round 1", 1);
      const second = d(step, nameIn(key), "round 1", 2);
      return !(first.go === "run" && first.step === step && second.go === "stop");
    });

/** A row bound `once` goes back to its step one time, and then asks. */
const backOnceThenAsk = (d: Drive): readonly string[] =>
  [...BACK_ONCE].filter((key) => {
    const step = stepOf(key);
    const first = d(step, nameIn(key), "round 1", 1);
    const second = d(step, nameIn(key), "round 1", 2);
    return !(first.go === "run" && first.step === step && second.go === "ask");
  });

/** A `step` row runs the step that can fix it, in the round the plan says. */
const toItsStep = (d: Drive): readonly string[] =>
  Object.entries(STEP_TO).flatMap(([key, want]) => {
    const to = d(stepOf(key), nameIn(key), "round 1", 1);
    const right = to.go === "run" && to.step === want.step && (want.round === undefined || to.round === want.round);
    return right ? [] : [key];
  });

/** A needed row still reaches a person, by its question's kind, or its stop, or its final end. */
const reachesItsPerson = (d: Drive): readonly string[] =>
  Object.entries(NEEDED).flatMap(([key, { reach }]) => {
    const to = d(stepOf(key), nameIn(key), "round 1", 1);
    const right = to.go === reach.go && (reach.go !== "ask" || (to.go === "ask" && to.for === reach.for));
    return right ? [] : [key];
  });

/** The questions every lane asks on its way: the plan's yes, the exam's merge and the merge. */
const YES: ReadonlySet<string> = new Set(["approve", "exam_merge", "merge"]);

/** P1: only the ask rows reach a person, besides the yes questions and the spent rounds' question. */
const onlyAsksReachAPerson = (d: Drive): readonly string[] =>
  PAIRS.flatMap(({ step, name }) =>
    MODES.flatMap((mode) => {
      const to = d(step, name, mode, 1);
      const key = `${step} ${name}`;
      const allowed =
        to.go !== "ask" || YES.has(to.for) || to.for === "rounds_spent" || NEEDED[key]?.reach.go === "ask";
      return allowed ? [] : [`${key} (${mode})`];
    }),
  );

/** Jidoka row 9: no step's outcome stops the lane `stuck:sent_back`, since every send has a route. */
const noSentBack = (d: Drive): readonly string[] =>
  PAIRS.flatMap(({ step, name }) =>
    MODES.flatMap((mode) => {
      const to = d(step, name, mode, 1);
      return to.go === "stop" && to.outcome === "stuck:sent_back" ? [`${step} ${name} (${mode})`] : [];
    }),
  );

/** The only ends: done, a reason in `FINAL`, and a closed ticket (PR 5). Triage's own decisions aside. */
const ENDS: ReadonlySet<string> = new Set(["done", "skip:closed", ...[...FINAL].map((why) => `stuck:${why}`)]);

const endsOnlyByDone = (d: Drive): readonly string[] =>
  PAIRS.filter(({ step }) => step !== "triage").flatMap(({ step, name }) =>
    MODES.flatMap((mode) => {
      const to = d(step, name, mode, 1);
      return to.go === "end" && !ENDS.has(to.outcome) ? [`${step} ${name} (${mode})`] : [];
    }),
  );

const inModes = (key: string): readonly string[] => MODES.map((mode) => `${key} (${mode})`);

// ---------------------------------------------------------------------------------------------

describe("experiment 193's lists, as this test holds them", () => {
  it("name only pairs the lane can meet: each a name its step can say", () => {
    const said = new Set(PAIRS.map(({ step, name }) => `${step} ${name}`));
    const keys = [...Object.keys(HOLES), ...Object.keys(NEEDED), ...CANNOT, ...Object.keys(STEP_TO)];
    expect(keys.filter((key) => !said.has(key))).toEqual([]);
  });

  it("give each hole one kind, in the plan's counts for the step rows: 18 to a step, 22 wait, 31 once, 8 by meaning, 1 guard", () => {
    const counts: Record<string, number> = {};

    for (const { kind } of Object.values(HOLES_BY_HAND)) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }

    // The plan's 20, 27 and 10 count the lane's other doors too: the two guard stops, five reads
    // and claims, and the two claims another lane holds. Those are driven by hand below.
    expect(counts).toEqual({ step: 18, wait: 22, once: 31, meaning: 8, guard: 1 });
  });
});

describe("experiment 193's law, on the real reducer (self-fix PR 11a)", () => {
  it("a hole that is not a wait row goes on at its first arrival: never a stop, never a person", () => {
    expect(goesOn(drive)).toEqual([]);
  });

  it("a once row runs its step once more, and stops only on the second arrival in a row", () => {
    expect(onceThenStop(drive)).toEqual([]);
  });

  it("a row bound once (jidoka rows 28, 29, 35, 41) goes back one time, then asks", () => {
    expect(backOnceThenAsk(drive)).toEqual([]);
  });

  it("a step row runs the step that can fix it, a round up where the builder takes it again", () => {
    expect(toItsStep(drive)).toEqual([]);
  });

  it("a needed row still reaches its person, or its stop; the four spend asks are new", () => {
    expect(reachesItsPerson(drive)).toEqual([]);
  });

  it("P1: no fixable row reaches a person; only the ask rows, the yes questions and the spent rounds do", () => {
    expect(onlyAsksReachAPerson(drive)).toEqual([]);
  });

  it("jidoka row 9: no step's outcome stops the lane stuck:sent_back, at any round", () => {
    expect(noSentBack(drive)).toEqual([]);
  });

  it("no lane ends after triage but by done, a FINAL reason or a closed ticket (a guard: green today)", () => {
    expect(endsOnlyByDone(drive)).toEqual([]);
  });
});

describe("each law fails on its planted break first, and on nothing else", () => {
  const stop: Dest = { go: "stop", outcome: "stuck:step_stuck" };

  it("goes-on catches merge send:reviewer:no_review routed to a stop", () => {
    const plant = planted("merge send:reviewer:no_review", stop);
    expect(goesOn(plant)).toEqual(inModes("merge send:reviewer:no_review"));
  });

  it("once-then-stop catches mutation stuck:run_failed routed to a stop with no once", () => {
    const plant = planted("mutation stuck:run_failed", stop);
    expect(onceThenStop(plant)).toEqual(["mutation stuck:run_failed"]);
  });

  it("reaches-its-person catches triage ask:owner:ruling routed to the next step", () => {
    const plant = planted("triage ask:owner:ruling", { go: "run", step: "plan", round: 1 });
    expect(reachesItsPerson(plant)).toEqual(["triage ask:owner:ruling"]);
  });

  it("P1 catches exam_merge send:builder:bot_comment routed back to ask the step", () => {
    const plant = planted("exam_merge send:builder:bot_comment", {
      go: "ask",
      for: "step",
      step: "exam_merge",
    });
    expect(onlyAsksReachAPerson(plant)).toEqual(inModes("exam_merge send:builder:bot_comment"));
  });

  it("row 9's law catches merge send:builder:behind routed to stuck:sent_back", () => {
    const plant = planted("merge send:builder:behind", { go: "stop", outcome: "stuck:sent_back" });
    expect(noSentBack(plant)).toEqual(inModes("merge send:builder:behind"));
  });

  it("the ends law catches merge skip:draft as an end", () => {
    const plant = planted("merge skip:draft", { go: "end", outcome: "skip:draft" });
    expect(endsOnlyByDone(plant)).toEqual(inModes("merge skip:draft"));
  });
});

// One case per row PR 11a closes, the row in its title. PR 10's own rows and the `wait` rows are in
// the laws above; a `wait` row stops the lane as it does today, and PR 11b makes the service wait.
/** The holes PR 11a closes, as `[row, key]`, of one kind. */
const rowsOf = (kind: Kind): readonly (readonly [string, string])[] =>
  Object.entries(HOLES)
    .filter(([, h]) => h.kind === kind && h.row !== "PR 10")
    .map(([key, { row }]) => [row, key] as const);

describe("each hole PR 11a closes, by its row", () => {
  it.each(rowsOf("step"))(
    "jidoka row %s: %s goes to the step that can fix it, never to a stop or a person",
    (_row, key) => {
      expect([...goesOn(drive, [key]), ...toItsStep(drive).filter((k) => k === key)]).toEqual([]);
    },
  );

  it.each(rowsOf("once"))("jidoka row %s: %s runs its step once more, and stops only the second time", (_row, key) => {
    expect([...goesOn(drive, [key]), ...onceThenStop(drive, [key])]).toEqual([]);
  });

  it.each(rowsOf("meaning"))(
    "jidoka row %s: %s reads the ticket and the pull request fresh, never stuck:step_stuck",
    (_row, key) => {
      expect(goesOn(drive, [key])).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// The table, read as data: each row's move is of its kind.

const Table = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Struct({ _tag: Schema.String })));

const tableNow = (): Readonly<Record<string, Readonly<Record<string, { readonly _tag: string }>>>> =>
  "ROUTES" in routes ? Schema.decodeUnknownSync(Table)(routes.ROUTES) : {};

const TAGS: Readonly<Record<Exclude<Kind, "guard">, readonly string[]>> = {
  step: ["back", "run", "fresh"],
  wait: ["wait"],
  once: ["once"],
  meaning: ["host"],
};

describe("ROUTES, by kind (self-fix PR 11a)", () => {
  const tagOf = (key: string): string | undefined => tableNow()[stepOf(key)]?.[nameIn(key)]?._tag;
  const notOf = (kind: Exclude<Kind, "guard">) =>
    Object.entries(HOLES)
      .filter(([, h]) => h.kind === kind)
      .map(([key]) => key)
      .filter((key) => !TAGS[kind].includes(tagOf(key) ?? "none"));

  it("a fixable row goes to a step, a service's wait, or once; never to a stop", () => {
    expect({
      step: notOf("step"),
      wait: notOf("wait"),
      once: notOf("once"),
      meaning: notOf("meaning"),
    }).toEqual({ step: [], wait: [], once: [], meaning: [] });
  });

  it("only a needed row is an ask, a stop or an end in the table", () => {
    const reach = Object.entries(NEEDED)
      .filter(([key, { reach: r }]) => tagOf(key) !== r.go)
      .map(([key]) => key);
    expect(reach).toEqual([]);
  });

  it("rows 14, 38, 65 and the other rows that cannot happen get `cannot`, with the law that shows it", () => {
    expect(CANNOT.filter((key) => tagOf(key) !== "cannot")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The rows traced, on the real reducer.

const asking = (s: Lane) => {
  if (s.phase !== "asking") {
    throw new Error(`not asking: ${s.phase}`);
  }

  return s;
};

describe("the rows traced (self-fix PR 11a)", () => {
  it("jidoka row 63, 193's worst hole: ship's send:reviewer:no_review at merge runs review, same round, then push, then the merge", () => {
    const [reviewing] = ended(runningAt("merge"), "send:reviewer:no_review");
    expect(destOf(reviewing)).toEqual({ go: "run", step: "review", round: 1 });
    const [pushing] = ended(reviewing, "done");
    expect(destOf(pushing)).toEqual({ go: "run", step: "push", round: 1 });
    const [asked] = ended(pushing, "done");
    expect(destOf(asked)).toMatchObject({ go: "ask", for: "merge" });
  });

  describe("jidoka row 62: ship's send:builder:behind at merge", () => {
    const behind = () => {
      const [s, cmds] = ended(runningAt("merge"), "send:builder:behind");
      const read = cmds.find((cmd) => cmd.type === "lane_fresh");

      if (read?.type !== "lane_fresh") {
        throw new Error(`main was not read: the lane went ${JSON.stringify(destOf(s))}`);
      }

      return { s, read };
    };

    it("takes main in, and green checks at the new head run merge again, with no build round", () => {
      const { s, read } = behind();
      const [next] = lane.update.lane_fresh_ok(
        s,
        freshMain.ok(
          read,
          {
            _tag: "merged",
            carry: { head: NEW_HEAD, checked: checkedAt(NEW_HEAD, "green") },
            review: { _tag: "kept", why: "replayed" },
          },
          0,
        ),
      );
      expect(destOf(next)).toEqual({ go: "run", step: "merge", round: 1 });
    });

    it("red checks at the new head go to build, the next round, with the failing names", () => {
      const { s, read } = behind();
      const [next] = lane.update.lane_fresh_ok(
        s,
        freshMain.ok(
          read,
          {
            _tag: "merged",
            carry: { head: NEW_HEAD, checked: checkedAt(NEW_HEAD, "red") },
            review: { _tag: "kept", why: "replayed" },
          },
          0,
        ),
      );
      expect(destOf(next)).toEqual({ go: "run", step: "build", round: 2 });
      expect(next.phase === "running" ? next.carry.checked?.failed : null).toEqual(["lane.test.ts > adds"]);
    });
  });

  describe("193's new hole: the mutants job's commit, and the guard on the step after it", () => {
    it("red checks at its head: build runs, the next round, never stuck:checks_red at review", () => {
      const [next] = ended(runningAt("mutants"), "done", {
        head: NEW_HEAD,
        checked: checkedAt(NEW_HEAD, "red"),
      });
      expect(destOf(next)).toEqual({ go: "run", step: "build", round: 2 });
    });

    it("checks not run at its head: the guard runs them, never stuck:checks_not_run", () => {
      const [next] = ended(runningAt("mutants"), "done", {
        head: NEW_HEAD,
        checked: checkedAt(NEW_HEAD, "not_run"),
      });
      expect(destOf(next).go).not.toMatch(/^(stop|end|ask)$/);
    });

    it("no checks at its head: the guard runs them, never stuck:checks_not_run", () => {
      const [next] = ended(runningAt("mutants"), "done", { head: NEW_HEAD });
      expect(destOf(next).go).not.toMatch(/^(stop|end|ask)$/);
    });
  });

  describe.each([
    ["18", "triage"],
    ["23", "plan"],
    ["40", "build"],
    ["57", "review"],
  ] as const)("jidoka row %s: %s's stuck:over_budget asks spend (P10)", (row, step) => {
    it(`row ${row}: the ask is spend, with more and stop`, () => {
      const [s] = ended(runningAt(step), "stuck:over_budget");
      expect(destOf(s)).toEqual({ go: "ask", for: "spend", step });
      expect(asking(s).question.picks).toEqual(expect.arrayContaining(["more", "stop"]));
    });

    it(`row ${row}: more runs ${step} again; stop is a saved pause at ${step}`, () => {
      const [s] = ended(runningAt(step), "stuck:over_budget");
      const { question } = asking(s);
      const [more] = lane.update.lane_answered(s, {
        type: "lane_answered",
        ask: question.ask,
        pick: "more",
      });
      expect(destOf(more)).toMatchObject({ go: "run", step });
      const [paused] = lane.update.lane_answered(s, {
        type: "lane_answered",
        ask: question.ask,
        pick: "stop",
      });
      expect(paused).toMatchObject({
        phase: "releasing",
        outcome: { kind: "ask", who: "owner", for: "paused" },
        at: { _tag: "run", step },
      });
    });
  });

  describe("jidoka row 3: a claim another lane holds", () => {
    const CLAIM = claimLane({ number: 7, lane: ID, intent: "lane/7/claim" });
    const endsClaimed = (s: Lane) => ({
      end: destOf(s),
      names: s.phase === "over" || s.phase === "releasing" ? s.said.includes(OTHER) : false,
    });

    it("on the first claim: ends skip:claimed, naming that lane, never stuck:claim_held", () => {
      const claiming: Lane = { ...heldIn("round 1", EMPTY), phase: "claiming", asked: CLAIM };
      const [next] = lane.update.lane_claim_ok(claiming, claimLane.ok(CLAIM, OTHER, 0));
      expect(endsClaimed(next)).toEqual({ end: { go: "end", outcome: "skip:claimed" }, names: true });
    });

    it("on a restart's claim: the same", () => {
      const restarting: Lane = {
        ...heldIn("round 1"),
        at: { _tag: "run", step: "build" },
        phase: "restarting",
        asked: CLAIM,
      };
      const [next] = lane.update.lane_claim_ok(restarting, claimLane.ok(CLAIM, OTHER, 0));
      expect(endsClaimed(next)).toEqual({ end: { go: "end", outcome: "skip:claimed" }, names: true });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The same claims on any run of fixable rows in a row, on tea's engine with fast-check: a step that
// says one hole after another never reaches a person but by the rounds or a row bound once, and stops
// only on a `once` row's second arrival in a row. A count of tries per step, not per run, breaks it.

const FIXABLE_AT: Readonly<Partial<Record<LaneStep, readonly string[]>>> = Object.fromEntries(
  STEPS.map((step) => [
    step,
    Object.entries(HOLES)
      .filter(([key, { kind }]) => stepOf(key) === step && kind !== "wait" && kind !== "guard")
      .map(([key]) => nameIn(key)),
  ]),
);

/** What is wrong with the lane's move after `key`, or nothing. `again`: its step said a once row just before. */
const wrongAfter = (key: string, again: boolean, to: Dest): string | null => {
  if (to.go === "end") {
    return `${key} ended the lane`;
  }

  if (to.go === "stop" && !(again && HOLES[key]?.kind === "once")) {
    return `${key} stopped on its first arrival`;
  }

  if (to.go === "ask" && to.for !== "rounds_spent" && !(again && BACK_ONCE.has(key))) {
    return `${key} asked ${to.for}`;
  }

  return null;
};

describe("a run of fixable rows, on any step (self-fix PR 11a)", () => {
  it("never reaches a person but by the rounds, and stops only on a once row's second arrival", () => {
    const starts = STEPS.filter((step) => (FIXABLE_AT[step] ?? []).length > 0);
    fc.assert(
      fc.property(
        fc.constantFrom(...starts),
        fc.constantFrom(...MODES),
        fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
        (start, mode, picks) => {
          let s = runningAt(start, mode);

          for (const pick of picks) {
            if (s.phase !== "running") {
              return;
            }

            const names = FIXABLE_AT[s.step] ?? [];
            const name = names[pick % names.length];

            if (name === undefined) {
              return;
            }

            const key = `${s.step} ${name}`;
            const last = s.trail.at(-1);
            const again =
              last !== undefined &&
              last.step === s.step &&
              (HOLES[`${s.step} ${last.said}`]?.kind === "once" || BACK_ONCE.has(`${s.step} ${last.said}`));
            const [next] = ended(s, name);
            expect(wrongAfter(key, again, destOf(next))).toBeNull();
            s = next;
          }
        },
      ),
      { seed: 119120, numRuns: 300 },
    );
  });
});
