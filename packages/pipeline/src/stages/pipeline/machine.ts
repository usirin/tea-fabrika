import { defineMachine, type Sub } from "@demlik/tea";
import { Schema, Struct } from "effect";
import { LaneId } from "../../ids.ts";
import { act, gather, intentOf, keptAct, keptCmd, listen } from "../../primitives.ts";
import { Checked, Outcome, titleOf } from "../../tickets/ticket.ts";
import { Item } from "../build/ticket.ts";
import { RedoOn } from "../exam/machine.ts";
import { Survived } from "../mutation/mutant.ts";
import { Post } from "../operate/machine.ts";
import { nameOf } from "../outcome.ts";
import { HeldDraft, PlanQuestion } from "../plan/plan.ts";
import { Carried, Given } from "./carry.ts";
import { openWords, ruleChangeLines, throughWords } from "./found.ts";
import { EndOutcome, isEnd, LaneOutcome, StopOutcome } from "./outcome.ts";
import type { Folded } from "./restart.ts";
import { AskFor, LaneStep, ROUTES, type Move as Route, STEPS } from "./routes.ts";

export { AskFor, LaneStep, STEPS };

// The lane: one tracker ticket through every step, in order. Plain tea. Each step is a machine of
// its own, and the lane starts each as one Act and reads its outcome, as `operate` does; it never
// reads a step's state, and no step knows the lane.
//
//   reading    read the ticket: filed by the person running this, or an agent of theirs?
//   claiming   this lane takes the ticket on the ledger: one lane works a ticket
//   running    one step, by its Act, whose intent names the lane's count of steps. The program
//              keeps the step's machine under that intent, so the same Act sent again after a kill
//              finds it where it stood, and writes each fact once
//   asking     one question on the ticket, and a Listen for the person's answer
//   releasing  the lane has its outcome, and lets the ticket go
//   over       the outcome, and the step outcome that ended it
//
// `ticket -> triage -> plan -> yes -> exam -> (exam_review -> yes -> exam_merge) -> test_writer ->
//  build -> mutation -> review -> push -> yes -> merge`.
//
// Where a step's outcome takes the lane is one row of `ROUTES` (./routes.ts, self-fix PR 11): a step,
// the same step once more, a fresh read of main or of the ticket, a person, a stop or an end.
//
// The exam's pull request (self-fix PR 10): code formats it, runs the checks and one fresh review
// (`exam_review`) before the person is asked. A failed review, and a ship refusal there, goes back to
// the step that can fix it (./routes.ts), counted in the exam's own rounds: one per `exam` row on the
// trail, never the lane's `round`. `exam_merge` starts only where the review and the person's yes
// both stand at the exam head (`examPull`), checked in `running`.
//
// `after` is the whole order, as data the laws read. A step's own `skip` moves on where the lane
// can go on without it, and the fact that says so is written by the Act all the same.
//
// After every build, code runs `[build] checks` at its head (./checks.ts), and the builder's word
// decides nothing. Red goes back to the build, a round up, with each failing test open: so does a
// head the mutation step finds red. Checks that could not run end the lane `stuck:checks_not_run`.
// No step after build runs on a head without green checks code ran at that very head: the carry's
// `checked` says which head they were at, and `running` is the one place a step starts. At the
// mutants job's commit, the one head no builder made, red goes back to the build as a red build
// does (experiment 193); none, or not run, and the guard runs them, as a restart does, by a fresh
// read of main. Still none after that, or at a head the builder said was done: the lane stops and
// says why.
//
// A review's finding goes to the test writer, a round up. Both count in the same rounds, and once
// `MAX_ROUNDS` are spent a person is asked `rounds_spent`: `again` runs one more round, `stop` ends
// the lane `stuck:rounds_spent`. With `[build] send_back = false` the first red asks at once.
//
// A lane ends or stops (self-fix PR 5, ./outcome.ts). An end, done or a skip or a stuck reason in
// `FINAL`, keeps nothing. A stop keeps its `Held` and where it goes on (`Resume`), both required, and
// so does a person's `no` or `stop`, a pause (`ask:owner:paused`). The same line typed again sends
// `restart`: the lane claims the ticket again, reads the ticket and main fresh (`lane_fresh`), then
// goes on there. A step that could not run is run once more, on the same Act, before the lane stops.
//
//   over (stuck:step_stuck, at run mutation) --restart--> restarting --claim--> refreshing
//     --fresh--> running mutation, with the carry it held and what main changed in it

const Unknown = ["unknown"] as const;

/** The steps after build: each runs only on a head with green checks code ran there. */
const AFTER_BUILD: ReadonlySet<LaneStep> = new Set(STEPS.slice(STEPS.indexOf("build") + 1));
/** Whether `step` runs only on a head with green checks: a restart that goes on there runs them first. Pure. */
export const afterBuild = (step: LaneStep): boolean => AFTER_BUILD.has(step);

/**
 * Where a stop goes on: the step that stopped. A build whose checks could not run goes on at the
 * checks: the step after it, which a restart runs them for, and never the builder again. Pure.
 */
const stopsAt = (step: LaneStep, end: LaneOutcome): Resume =>
  step === "build" && end.kind === "stuck" && end.why === "checks_not_run"
    ? { _tag: "run", step: "mutation" }
    : { _tag: "run", step };

/**
 * The most builds a ticket gets on its own: the first, and each one a red head or a review sent it
 * back for. Past it, only a person's `again`. 3 is a guess (docs/direction/jidoka-and-andon.md#bounds).
 */
export const MAX_ROUNDS = 3;

const isAskFor = Schema.is(AskFor);

/** The kind of question a lane's ask id names: `a-approve-3` is `approve`. `null`: not a lane's. Pure. */
export const askedFor = (ask: string): AskFor | null => {
  const kind = /^a-([a-z_]+)-\d+$/.exec(ask)?.[1];
  return kind !== undefined && isAskFor(kind) ? kind : null;
};

/** The picks that give the builder one more round past the bound: a person's call, each counted once. */
const GRANTS: Readonly<Partial<Record<AskFor, readonly string[]>>> = {
  rounds_spent: ["again"],
  exam_touched: ["builder_wrong", "test_wrong"],
};

/**
 * The rounds a lane runs before it asks: `MAX_ROUNDS`, and one more for each answer in its trail that
 * grants one. Read from the trail, so the fold of the facts gives the same bound. Pure.
 */
export const boundOf = (trail: readonly { readonly step: string; readonly said: string }[]): number =>
  MAX_ROUNDS +
  trail.filter((row) => {
    const kind = askedFor(row.step);
    return kind !== null && (GRANTS[kind]?.includes(row.said) ?? false);
  }).length;

/** A Property of the plan with no test, in its own words, and why the test writer wrote none. */
export const Untested = Schema.Struct({ when: Schema.String, why: Schema.String });
export type Untested = typeof Untested.Type;

/**
 * What no test or review will hold a change to, on a person's word alone: a finding against their
 * decision, and a mutant no test can see. A row keeps the agent's words, so the pull request can say them.
 */
const ThroughRows = Schema.Struct({
  findings: Schema.Array(Schema.Struct({ id: Schema.String, fault: Schema.String })),
  mutants: Schema.Array(Schema.Struct({ mutant: Schema.String, why: Schema.String })),
});

export type Through = typeof ThroughRows.Type;

/** What a person decided: every step after the plan that judges or writes is told it. */
const Decided = Schema.Struct({
  /** The plan's open questions, under their ids. A person's yes takes the lean on each. */
  questions: Schema.Array(PlanQuestion),
  /** What the person wrote beside their answers, in their words. */
  said: Schema.Array(Schema.String),
});

/** What the review judged last, for the question of whether it lands. */
const Reviewed = Schema.Struct({ title: Schema.String, met: Schema.Finite, of: Schema.Finite });

/** One test the test writer's check runs: the Property it tests, its file, and its name there. */
const WrittenTest = Schema.Struct({
  property: Schema.String,
  file: Schema.String,
  name: Schema.String,
});

/** The test writer's own commit, and the tests its check ran there. */
const Written = Schema.Struct({ commit: Schema.String, tests: Schema.Array(WrittenTest) });

/** The exam's pull request as the lane last read it (self-fix PR 10). */
export const ExamPull = Schema.Struct({
  head: Schema.String,
  /** The review that passed, and what it read: what `carry` needs (./carry.ts). */
  reviewed: Schema.optionalKey(Schema.Struct({ ...Given.fields, met: Schema.Finite, of: Schema.Finite })),
  /** A person's `merge`, and what they saw: or the review's Gather found one that still stands here. */
  yes: Schema.optionalKey(Given),
  /** What it was last sent back to the exam writer for: the findings, or the failing names. */
  why: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Where the exam writer writes it again: `main`, when main does not merge into `head`. */
  on: Schema.optionalKey(RedoOn),
});
export type ExamPull = typeof ExamPull.Type;

/** What one step leaves for the steps after it. */
const carried = {
  /** The plan as data, once it is written. Every later step reads it. */
  plan: Schema.NullOr(HeldDraft),
  /** What a person decided. Optional: a lane saved before this key still reads, by its plan's leans. */
  decided: Schema.optionalKey(Decided),
  /** Optional, as `decided` is: the question falls back on the pull request's name. */
  reviewed: Schema.optionalKey(Reviewed),
  /** The plan's version, once it is written. */
  version: Schema.NullOr(Schema.Finite),
  /** The rule files the exam step changes. */
  rules: Schema.Array(Schema.String),
  /** The exam's own pull request. `null`: none. */
  examPr: Schema.NullOr(Schema.String),
  /** Its head, the review there and a person's yes. Optional: a lane saved before this key still reads. */
  examPull: Schema.optionalKey(ExamPull),
  /** The exact files the test writer's commits touched: the builder may not change them. */
  exam: Schema.Array(Schema.String),
  /** The commit the lane started from: what the mutation step and the review diff against. */
  base: Schema.NullOr(Schema.String),
  /** The commit the build stands on: the test writer's, then each build's. */
  head: Schema.NullOr(Schema.String),
  /**
   * Code's own checks at the last head a build or the mutants job left: a step after build runs only
   * when they are green at `head`. Optional: a lane saved before this key still reads.
   */
  checked: Schema.optionalKey(Checked),
  /** What the last review left open. */
  open: Schema.Array(Item),
  /** What the builder declared it did other than asked. */
  deviations: Schema.Array(Schema.String),
  /** What the builder says it could not do. Optional: a lane saved before this key still reads. */
  left: Schema.optionalKey(Schema.Array(Schema.String)),
  /** What the test writer's last run says no test can check. Optional, as `left` is. */
  cannot: Schema.optionalKey(Schema.Array(Untested)),
  /** What a person let through with no test: the ticket and the pull request say so. Optional, as `left` is. */
  untested: Schema.optionalKey(Schema.Array(Untested)),
  /** What the question on the ticket would let through on a `go_on`. Optional, as `left` is. */
  waiting: Schema.optionalKey(ThroughRows),
  /** What a person let through: the merge's question and the pull request say so. Optional, as `left` is. */
  through: Schema.optionalKey(ThroughRows),
  /** The mutants the mutation step saw live: the test writer's second job. */
  survived: Schema.Array(Survived),
  /** The review's verdicts: the push step posts them on the pull request. */
  posts: Schema.Array(Post),
  /** The lane's pull request. `null`: none yet. */
  pr: Schema.NullOr(Schema.String),
  /**
   * The test writer's own commit under the build, and the tests its check ran there (self-fix PR 5): a
   * restart runs that check again with the commit put on main, and a redo writes on it. Optional: a
   * lane saved before this key still reads, and has no check to run again. `null`: the branch started
   * over from main, so no commit of the test writer's is under the build (tracker 194).
   */
  written: Schema.optionalKey(Schema.NullOr(Written)),
  /**
   * The last test writer's commit, and `base`, the head it started on. A test writer sent back while
   * that commit is still the head writes on that base again, so its own files are never ones that
   * exist already (jidoka row 28). Optional, as `left` is.
   */
  wrote: Schema.optionalKey(Schema.Struct({ base: Schema.String, commit: Schema.String })),
  /**
   * The test writer's files a build or main changed, waiting on a person's pick: the next build puts
   * them back as `written` has them, and the next test writer writes them again. Optional, as `left` is.
   */
  touched: Schema.optionalKey(Schema.Array(Schema.String)),
};

export const Carry = Schema.Struct(carried);
export type Carry = typeof Carry.Type;

export const EMPTY: Carry = {
  plan: null,
  version: null,
  rules: [],
  examPr: null,
  exam: [],
  base: null,
  head: null,
  open: [],
  deviations: [],
  survived: [],
  posts: [],
  pr: null,
};

/**
 * One step's end: its outcome, and what it leaves. `after`, on an `ask`: how the step ends if the
 * person lets it through. Having one makes the question a call on what is there, with nothing to run
 * again. (Not `then`: an object with `then` reads as a Promise.)
 */
export const StepEnd = Schema.Struct({
  outcome: Outcome,
  carry: Schema.Struct(Struct.map(carried, Schema.optionalKey)),
  after: Schema.optionalKey(Outcome),
});
export type StepEnd = typeof StepEnd.Type;

const LaneIn = Schema.Struct({ number: Schema.Finite, lane: LaneId });

const StepIn = Schema.Struct({
  number: Schema.Finite,
  /** The lane's count of steps run: run ids and intents are named by it, so none is used twice. */
  count: Schema.Finite,
  step: LaneStep,
  round: Schema.Finite,
  carry: Carry,
});

const AskIn = Schema.Struct({
  number: Schema.Finite,
  ask: Schema.String,
  what: Schema.String,
  picks: Schema.Array(Schema.String),
  /** What each pick does, a line for each. Left out: a lane saved before this key still reads. */
  does: Schema.optionalKey(Schema.Array(Schema.String)),
  /** What a person reads before they answer, a line for each. Left out: nothing more to read. */
  also: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The rounds' question: what the runs on the ticket cost is added from its facts, which the lane does not hold. */
  spent: Schema.optionalKey(Schema.Literal(true)),
  /** The head a merge's question is about, as the person sees it: the `asked` fact keeps it (self-fix PR 10). */
  head: Schema.optionalKey(Schema.String),
});

/** How the lane ended, for what it takes with it. Left out: a lane saved before this key still reads. */
const ReleaseIn = Schema.Struct({ ...LaneIn.fields, outcome: Schema.optionalKey(LaneOutcome) });

/** Who filed it, as the lane reads it. */
export const Filed = Schema.Struct({
  state: Schema.Literals(["open", "closed"]),
  /** Filed by the person running this, or by an agent of theirs. */
  mine: Schema.Boolean,
});
export type Filed = typeof Filed.Type;

const ReadIn = Schema.Struct({ number: Schema.Finite });

export const readFiled = gather("lane_read", { input: ReadIn, ok: Filed, err: Unknown });
export const claimLane = act("lane_claim", { input: LaneIn, ok: LaneId, err: Unknown });

export const releaseLane = act("lane_release", {
  input: ReleaseIn,
  ok: Schema.Literal("released"),
  err: Unknown,
});

export const runStep = act("lane_step", { input: StepIn, ok: StepEnd, err: Unknown });
export const askPerson = act("lane_ask", { input: AskIn, ok: Schema.Null, err: Unknown });

export type LaneCmd =
  | ReturnType<typeof readFiled>
  | ReturnType<typeof claimLane>
  | ReturnType<typeof releaseLane>
  | ReturnType<typeof runStep>
  | ReturnType<typeof askPerson>
  | ReturnType<typeof freshMain>;

/** A person's call on a step's end: what the step asked about, and how it ends if they let it through. */
const Call = Schema.Struct({ about: Schema.String, after: Outcome });
type Call = typeof Call.Type;

/** A question on the ticket. `step`: the step it comes back to. Left out, `call`: any other question. */
export const Question = Schema.Struct({
  ask: Schema.String,
  what: Schema.String,
  picks: Schema.Array(Schema.String),
  for: AskFor,
  step: LaneStep,
  call: Schema.optionalKey(Call),
});
export type Question = typeof Question.Type;

/** One step as it ended, or one person's answer: what a lane leaves behind it, in order. */
const Row = Schema.Struct({ step: Schema.String, said: Schema.String });

/** Whether a red head goes back to the builder on its own: `[build] send_back`. Left out: it does. */
const SendBack = { sendBack: Schema.optionalKey(Schema.Boolean) };

export const Held = Schema.Struct({
  number: Schema.Finite,
  lane: LaneId,
  ...SendBack,
  /** The steps run and the restarts made: each names its intents by it, so none is used twice. */
  count: Schema.Finite,
  round: Schema.Finite,
  carry: Carry,
  trail: Schema.Array(Row),
});
export type Held = typeof Held.Type;

/**
 * Where a stopped lane goes on when the same line is typed again (self-fix PR 5, P6 and P10): a step
 * it runs, or a question it asks again. `round: "next"`: the step runs as the round after the one
 * the lane held, as a person's `again` would run it. Left out: the round it held. `step`, on an ask:
 * the step the question is about.
 *
 *   {_tag: "run", step: "mutation"}                  // a stuck mutation step runs again
 *   {_tag: "run", step: "build", round: "next"}      // a `stop` on the spent rounds
 *   {_tag: "ask", for: "merge", step: "push"}        // a `no` on the merge asks it again
 */
export const Resume = Schema.Union([
  Schema.TaggedStruct("run", { step: LaneStep, round: Schema.optionalKey(Schema.Literal("next")) }),
  Schema.TaggedStruct("ask", { for: AskFor, step: LaneStep }),
]);
export type Resume = typeof Resume.Type;

/**
 * A fresh read of main: where the lane goes on, and what it held then. `routed`: a route's `fresh`
 * sent it (./routes.ts), so a clean read runs `from` itself, and a merged head with green checks is
 * pushed first. Left out: a restart's read, or the guard's. `round`: the round the lane held, so a
 * first test writer starts over from main (tracker 194). Left out: a read sent before this key.
 */
const FreshIn = Schema.Struct({
  number: Schema.Finite,
  from: Resume,
  carry: Carry,
  round: Schema.optionalKey(Schema.Finite),
  routed: Schema.optionalKey(Schema.Literal(true)),
});

/** What a fresh read of main changed in the carry: the branch's base and head, the checks there. */
const Changed = StepEnd.fields.carry;

/**
 * What the fresh read found, with the lane's branch rebased onto main (never pushed) or merged with it
 * (pushed). `fresh`: it went on, and `carry` is what changed, such as the base, the head and the
 * checks code ran at that head. `exam_conflict`: the test writer's files conflict with main.
 * `conflicts`: the builder's files do. On both, main's side was taken, and `carry`, when there, is
 * the branch on main with each such file open: the test writer, or the builder, redoes it.
 * `merged`: the branch was pushed, so main was merged into it. A routed read pushes that head once
 * its checks are green; else the pull request does not show it yet. `review` is what `carry` says of
 * the review's diff at that head: kept, the review stands there and the push shows the head; a
 * glance or stale, a review reads it first
 * (docs/direction/a-yes-binds-to-the-diff.md). `closed`: the ticket was closed while the lane was stopped.
 * `not_yours`: it was not filed by the person running this, or an agent of theirs.
 */
export const Fresh = Schema.Union([
  Schema.TaggedStruct("fresh", { carry: Changed }),
  Schema.TaggedStruct("merged", { carry: Changed, review: Carried }),
  Schema.TaggedStruct("exam_conflict", {
    files: Schema.Array(Schema.String),
    carry: Schema.optionalKey(Changed),
  }),
  Schema.TaggedStruct("conflicts", {
    files: Schema.Array(Schema.String),
    carry: Schema.optionalKey(Changed),
  }),
  Schema.TaggedStruct("closed", {}),
  Schema.TaggedStruct("not_yours", {}),
]);
export type Fresh = typeof Fresh.Type;

export const freshMain = act("lane_fresh", { input: FreshIn, ok: Fresh, err: Unknown });

/** How a lane ends: nobody goes on from it. */
const End = Schema.Struct({ outcome: EndOutcome, said: Schema.String });
type End = typeof End.Type;
/** How a lane stops, and where the same line goes on. */
const Stop = Schema.Struct({ outcome: StopOutcome, said: Schema.String, at: Resume });
type Stop = typeof Stop.Type;

const Over = { phase: Schema.Literal("over"), number: Schema.Finite, trail: Schema.Array(Row) };

const Releasing = {
  ...Held.fields,
  phase: Schema.Literal("releasing"),
  asked: keptAct(releaseLane, ReleaseIn),
};

/** A stop the same line goes on from: the lane's `Held`, as it was, and where it goes on. Both required (P6). */
export const Stopped = Schema.Struct({ ...Over, ...Stop.fields, held: Held });
export type Stopped = typeof Stopped.Type;

export const Lane = Schema.Union([
  Schema.Struct({ phase: Schema.Literal("idle") }),
  // A step said the ticket or its pull request is closed, merged or a draft (jidoka row 13): the
  // ticket is read fresh, and the lane ends or pauses by what it says. First, so a saved one never
  // reads as the start's read below with its `Held` dropped.
  Schema.Struct({
    ...Held.fields,
    phase: Schema.Literal("reading"),
    step: LaneStep,
    /** The step's outcome, by its name: what the lane says if it pauses. */
    said: Schema.String,
    asked: keptCmd(readFiled, ReadIn),
  }),
  Schema.Struct({
    phase: Schema.Literal("reading"),
    number: Schema.Finite,
    lane: LaneId,
    ...SendBack,
    asked: keptCmd(readFiled, ReadIn),
  }),
  Schema.Struct({
    ...Held.fields,
    phase: Schema.Literal("claiming"),
    asked: keptAct(claimLane, LaneIn),
  }),
  Schema.Struct({
    ...Held.fields,
    phase: Schema.Literal("running"),
    step: LaneStep,
    /** The Act runs a second time, after it could not run (P8). Left out: its first. */
    again: Schema.optionalKey(Schema.Literal(true)),
    asked: keptAct(runStep, StepIn),
  }),
  Schema.Struct({
    ...Held.fields,
    phase: Schema.Literal("asking"),
    question: Question,
    asked: keptAct(askPerson, AskIn),
  }),
  // The same line typed again on a stop: the ticket is claimed again, where the stop goes on in hand.
  Schema.Struct({
    ...Held.fields,
    at: Resume,
    phase: Schema.Literal("restarting"),
    asked: keptAct(claimLane, LaneIn),
  }),
  // Claimed: main and the ticket are read fresh, and the lane's branch stands on main. Also a route's
  // `fresh` (./routes.ts), and the guard on the step after the mutants job, when its head has no checks.
  Schema.Struct({
    ...Held.fields,
    at: Resume,
    phase: Schema.Literal("refreshing"),
    asked: keptAct(freshMain, FreshIn),
  }),
  Schema.Struct({ ...Releasing, ...Stop.fields }),
  // An end. Also a release saved before a stop kept where it goes on: it ends as a stop saved before.
  Schema.Struct({ ...Releasing, outcome: LaneOutcome, said: Schema.String }),
  // First, so a saved one never reads as a shape below with its `held` dropped.
  Stopped,
  Schema.Struct({ ...Over, ...End.fields }),
  // A stop saved before a stop kept its `Held` (self-fix PR 5). No code here builds one: it is only ever
  // read back from a save, and `restart` goes on from it with what the ticket's facts prove
  // (./restart.ts). Its shape is the end's above, with any outcome, so a save from before still reads.
  Schema.Struct({ ...Over, outcome: LaneOutcome, said: Schema.String }),
]);
export type Lane = typeof Lane.Type;

export type LaneMsg =
  /** `sendBack`: `[build] send_back`, read once as the lane starts. Left out: true. */
  | {
      readonly type: "start";
      readonly number: number;
      readonly lane: LaneId;
      readonly sendBack?: boolean;
    }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  /**
   * The same line typed again on a lane that stopped (self-fix PR 5): it claims the ticket again,
   * reads main fresh, and goes on where it stopped. For a lane saved before its stop kept a `Held`,
   * `folded` is what the ticket's facts prove (./restart.ts), and `lane` the lane the program named
   * for this line, since that save keeps none. Both, or such a lane does nothing.
   */
  | { readonly type: "restart"; readonly folded?: Folded; readonly lane?: LaneId }
  /** A person answered `ask` on the ticket: the Listen below heard it. */
  | {
      readonly type: "lane_answered";
      readonly ask: string;
      readonly pick: string;
      /** What they wrote beside it. */
      readonly note?: string;
      /** Who answered, as the ticket's entry names them. Left out: a Msg from before the key. */
      readonly by?: string;
    };

type Step_ = readonly [Lane, readonly LaneCmd[]];

/**
 * What a state moves to, after a step's outcome. `fresh`: main is taken in first, then that step runs.
 * `host`: the ticket is read fresh, and the lane ends or pauses by what it says.
 */
export type Move =
  | { readonly to: LaneStep; readonly round?: number }
  | { readonly ask: AskFor }
  | { readonly end: LaneOutcome }
  | { readonly fresh: LaneStep }
  | { readonly host: true };

const stuck = (why: Extract<LaneOutcome, { kind: "stuck" }>["why"]): Move => ({
  end: { kind: "stuck", why },
});

const merged: Move = { end: { kind: "done", part: false } };

/** The step after each step, when it ended well or on its own `skip`. */
const NEXT: Readonly<Record<LaneStep, Move>> = {
  triage: { to: "plan" },
  plan: { ask: "approve" },
  exam: { to: "test_writer" },
  exam_review: { to: "exam_merge" },
  exam_merge: { to: "test_writer" },
  test_writer: { to: "build" },
  build: { to: "mutation" },
  mutation: { to: "review" },
  mutants: { to: "review" },
  review: { to: "push" },
  push: { ask: "merge" },
  merge: merged,
};

/** Another round, if the rounds allow it: else a person is asked. */
const back = (to: LaneStep, round: number, bound: number): Move =>
  round >= bound ? { ask: "rounds_spent" } : { to, round: round + 1 };

/** The steps of the exam's pull request: their rounds are the exam's own, never the lane's `round`. */
const EXAM_STEPS: ReadonlySet<LaneStep> = new Set(["exam", "exam_review", "exam_merge"]);

/** The exam's rounds so far: one per `exam` row on the trail, the first writing included. Pure. */
export const examRounds = (trail: Held["trail"]): number => trail.filter((row) => row.step === "exam").length;

/** The exam writer once more, if the exam's rounds allow it: else a person is asked. Pure. */
const examBack = (trail: Held["trail"]): Move =>
  examRounds(trail) >= boundOf(trail) ? { ask: "rounds_spent" } : { to: "exam" };

/** The route `step` has for the outcome named `name` (./routes.ts). `undefined`: none. Pure. */
const routeOf = (step: LaneStep, name: string): Route | undefined => {
  const rows: Readonly<Record<string, Route>> = ROUTES[step];
  return Object.hasOwn(rows, name) ? rows[name] : undefined;
};

/**
 * Whether the row the trail ends with is `step`'s own, by a route `same` holds: the step's second
 * arrival in a row, which a `once` stops on and a `back` bound once asks on. Pure.
 */
const inARow = (step: LaneStep, trail: Held["trail"], same: (route: Route) => boolean): boolean => {
  const last = trail.at(-1);

  if (last === undefined || last.step !== step) {
    return false;
  }

  const route = routeOf(step, last.said);
  return route !== undefined && same(route);
};

/**
 * Where a `back` goes: the step that can fix it, with what it must. Bound `once`: one time in the same
 * round, and the second time in a row the step's own question. The exam's: counted in its own rounds.
 * A red head to the builder: as `[build] send_back` says. Else: a round up, or a person past the bound.
 * Pure.
 */
const backTo = (
  step: LaneStep,
  route: Extract<Route, { readonly _tag: "back" }>,
  round: number,
  lane: { readonly sendBack?: boolean; readonly trail: Held["trail"] },
): Move => {
  if (route.bound === "once") {
    return inARow(step, lane.trail, (r) => r._tag === "back" && r.bound === "once")
      ? { ask: "step" }
      : { to: route.step };
  }

  if (route.step === "exam") {
    return examBack(lane.trail);
  }

  if (route.step === "build" && route.with === "names" && lane.sendBack === false) {
    return { ask: "rounds_spent" };
  }

  return back(route.step, round, boundOf(lane.trail));
};

/**
 * The whole order, as one pure function: where a lane goes when `step` ends with `outcome` in
 * `round`, by its row in `ROUTES` (./routes.ts). `lane.sendBack`: `[build] send_back`; left out, a
 * red head goes back. `lane.trail`: the answers that grant rounds past the bound (`boundOf`), and
 * the step's last end, for a second arrival in a row; left out, none.
 *
 *   after("merge", {kind: "send", to: "reviewer", why: "no_review"}, 1)   // {to: "review"}
 *   after("mutation", {kind: "stuck", why: "run_failed"}, 1)              // {to: "mutation"}
 *   // ...and with the trail ending on mutation's `stuck:run_failed`:  {end: stuck:step_stuck}
 */
export const after = (
  step: LaneStep,
  outcome: Outcome,
  round: number,
  lane: { readonly sendBack?: boolean; readonly trail?: Held["trail"] } = {},
): Move => {
  const trail = lane.trail ?? [];
  const name = nameOf(outcome);
  const route = routeOf(step, name);

  switch (route?._tag) {
    // A name no step can say, read back from somewhere: the lane has no way to go. An ask the step
    // has no row for is still its own question, as before the table.
    case undefined:
      if (outcome.kind === "ask") {
        return { ask: "step" };
      }

      return stuck(outcome.kind === "send" ? "sent_back" : "step_stuck");
    case "next":
      return NEXT[step];
    case "run":
      return { to: route.step };
    case "back":
      return backTo(step, route, round, { ...lane, trail });
    case "fresh":
      // `exam_review` takes main in itself, before its checks (./exam-pull.ts `examReady`).
      if (EXAM_STEPS.has(route.step)) {
        return { to: route.step };
      }

      // A clean read of main that the step still refuses the same way: once is enough.
      return trail.at(-1)?.step === step && trail.at(-1)?.said === name ? stuck("step_stuck") : { fresh: route.step };
    case "once":
      return inARow(step, trail, (r) => r._tag === "once") ? stuck("step_stuck") : { to: step };
    case "host":
      return { host: true };
    case "ask":
      return { ask: route.for };
    case "end":
      return { end: route.outcome };
    case "stop":
      // Code's checks could not run, after one more try: the lane's own word for it.
      return stuck(outcome.kind === "stuck" && outcome.why === "checks_not_run" ? "checks_not_run" : "step_stuck");
    // Self-fix PR 11b makes the service wait: until then, the lane stops as it did.
    case "wait":
    // The law says it never arrives. If it does, the law is wrong: stop, never guess.
    case "cannot":
      return stuck("step_stuck");
  }
};

/** The picks of a question: the first is the one that goes on. */
export const PICKS = {
  approve: ["approve", "no"],
  exam_merge: ["merge", "no"],
  merge: ["merge", "no"],
  step: ["again", "stop"],
  rounds_spent: ["again", "stop"],
  exam_touched: ["builder_wrong", "test_wrong"],
  exam_conflict: ["again", "stop"],
  spend: ["more", "stop"],
} as const;

/**
 * The picks that pause the lane, by the kind of question (self-fix PR 5): it is saved where the pick
 * goes on, and the same line goes on there. Every other pick goes on at once. No pick ends a lane.
 */
const PAUSES: Readonly<Record<AskFor, readonly string[]>> = {
  approve: ["no"],
  exam_merge: ["no"],
  merge: ["no"],
  step: ["stop"],
  rounds_spent: ["stop"],
  exam_touched: [],
  exam_conflict: ["stop"],
  spend: ["stop"],
};

/**
 * Where the lane goes on when `m` is where it moves. No question's `go_on` ends a lane. A fresh read,
 * of main or of the ticket, goes on at the step it reads for. Pure.
 */
const resumeOfMove = (m: Move, step: LaneStep): Resume => {
  if ("to" in m) {
    return { _tag: "run", step: m.to, ...(m.round === undefined ? {} : { round: "next" }) };
  }

  if ("ask" in m) {
    return { _tag: "ask", for: m.ask, step };
  }

  if ("fresh" in m) {
    return { _tag: "run", step: m.fresh };
  }

  if ("host" in m) {
    return { _tag: "run", step };
  }

  return stopsAt(step, m.end);
};

/**
 * Where a pick of `question` goes on (P10): every ask kind names it here, and the lane routes by it.
 *
 *   approve        approve: the exam step     no: the plan, written again with the person's note
 *   exam_merge     merge: its merge           no: the same question again
 *   merge          merge: the merge           no: the same question again
 *   step           again, stop: the step again, the build as the next round
 *   rounds_spent   again: the step again, as the next round   stop: the step again (a restart runs
 *                  it as the next round, by the stop's own outcome: `goesOnFrom`)
 *   exam_touched   builder_wrong: the build, next round   test_wrong: the test writer, then the build
 *   exam_conflict  again: the test writer, then the build, next round   stop: the same question
 *   spend          more: the step again, in its round   stop: the step again
 *
 * A `go_on` goes where the step's end goes: a call's end, as in a round with rounds left (the lane
 * asks the rounds' question itself when none are).
 */
export const resumeOf = (question: Question, pick: string): Resume => {
  const { step } = question;
  const run = (to: LaneStep, next = false): Resume => ({
    _tag: "run",
    step: to,
    ...(next ? { round: "next" as const } : {}),
  });
  const again: Resume = { _tag: "ask", for: question.for, step };

  if (pick === "go_on") {
    return resumeOfMove(question.call === undefined ? NEXT[step] : after(step, question.call.after, 1), step);
  }

  switch (question.for) {
    case "approve":
      return pick === "approve" ? run("exam") : run("plan");
    case "exam_merge":
      return pick === "merge" ? run("exam_merge") : again;
    case "merge":
      return pick === "merge" ? run("merge") : again;
    case "step":
      // A build run again is a round: the builder gets another try, and the tries are counted.
      return run(step, step === "build");
    case "rounds_spent":
      // The exam's rounds are its rows on the trail, never the lane's `round`.
      return run(step, pick === "again" && !EXAM_STEPS.has(step));
    case "exam_touched":
      return pick === "test_wrong" ? run("test_writer", true) : run("build", true);
    case "exam_conflict":
      return pick === "again" ? run("test_writer", true) : again;
    case "spend":
      return run(step);
  }
};

/**
 * Where a stop goes on when the same line is typed again: where it saved, and a stop on the spent
 * rounds as the round after them, as the person's `again` would have. Pure.
 */
const goesOnFrom = (at: Resume, outcome: LaneOutcome): Resume =>
  at._tag === "run" && !EXAM_STEPS.has(at.step) && outcome.kind === "stuck" && outcome.why === "rounds_spent"
    ? { ...at, round: "next" }
    : at;

/**
 * How a person's pause on `question` stops the lane: a stop on the rounds is stuck on them, and any
 * other is a person's no to the change. Pure.
 */
const pausedBy = (question: Question): StopOutcome =>
  question.for === "rounds_spent"
    ? { kind: "stuck", why: "rounds_spent" }
    : { kind: "ask", who: "owner", for: "paused" };

/** Where the same line typed again goes on after a pause on `pick`: where the restart takes it. Pure. */
const pausedAt = (question: Question, pick: string): Resume => goesOnFrom(resumeOf(question, pick), pausedBy(question));

/** Where a spent round's `again` goes: the writer first after a review, as a review's send-back does. */
const againTo = (step: LaneStep): LaneStep =>
  EXAM_STEPS.has(step) ? "exam" : step === "review" ? "test_writer" : "build";

/**
 * The step a question of `kind` comes back to, asked after `step` ended. The rounds' question comes
 * back to where its `again` goes; main's change to the test writer's files, to the test writer. Pure.
 */
export const askedStep = (kind: AskFor, step: LaneStep): LaneStep =>
  kind === "rounds_spent" ? againTo(step) : kind === "exam_conflict" ? "test_writer" : step;

/**
 * Where a lane goes on after `step` ended with `outcome` in `round`, with `trail` behind it, had it
 * stopped right there. Pure.
 */
export const resumeAfter = (step: LaneStep, outcome: Outcome, round: number, trail: Held["trail"]): Resume =>
  resumeOfMove(after(step, outcome, round, { trail }), step);

/** The step that sent the work back, for the rounds' question asked again: the inverse of `againTo`. */
const sentFrom = (to: LaneStep): LaneStep =>
  to === "exam" ? "exam_review" : to === "test_writer" ? "review" : "build";

/** A person's call: what is there stands or stops. Nothing would change by running the step again. */
const CALL_PICKS = ["go_on", "stop"] as const;

/** What a person may answer: a step that ended on `ask` may also be let through, unless it can't be. */
const picksFor = (kind: AskFor, step: LaneStep): readonly string[] =>
  kind === "step" && !NO_GO_ON.has(step) ? ["again", "go_on", "stop"] : PICKS[kind];

/**
 * The steps whose plain question offers no `go_on`, since it could only lead to nothing landing:
 * one that merges or pushes has to have run, a review no one could judge is what ship's guard refuses,
 * and a build asks plainly only of a head whose tests fail, which the mutation step sends back.
 * A person's call on what is there (`Call`) is its own question, with its own picks.
 */
const NO_GO_ON: ReadonlySet<LaneStep> = new Set(["push", "merge", "exam_merge", "exam_review", "review", "build"]);

/** A step, as a person says it. */
const STEP_WORDS: Readonly<Record<LaneStep, string>> = {
  triage: "triage",
  plan: "plan",
  exam: "rule change",
  exam_review: "rule change's review",
  exam_merge: "rule change's merge",
  test_writer: "test writer",
  build: "build",
  mutation: "mutation test",
  mutants: "test writer",
  review: "review",
  push: "push",
  merge: "merge",
};

/** Why a step asks, by the word its outcome holds. Each is a sentence for a person. */
const ASK_WORDS: Readonly<Record<string, string>> = {
  cannot_test: "The test writer says no test can check a property of the plan.",
  already_passes: "A new test already passes before the build, so it shows nothing yet.",
  fails_on_base: "A test of what works today fails on the code as it is.",
  disable: "A mutant lived, and the test writer says no test can see the change.",
  unseen: "The review could not see all it needed.",
  check_change: "This step's change touches the checks, and those are a person's call.",
  ruling: "Triage needs a ruling on this ticket.",
  approval: "This pull request needs a person's yes.",
  comment: "This pull request has a comment that needs an answer.",
  decision: "The review says a decision you made on the plan is wrong. Does your decision stand?",
  no_change:
    "The builder changed nothing this round, and the checks pass at this head. Should the lane go on with the work as it is?",
  still_red:
    "The builder changed nothing this round, and the new test is still failing at this head. Should the builder try once more?",
};

/** What a `go_on` means, by what the step asked about. Each is a sentence for a person. */
const CALL_WORDS: Readonly<Record<string, string>> = {
  decision: "Your decision stands, which lets that finding through, and no test comes of it.",
  no_change: "The work stays as it is, and code's own checks still have to pass before it lands.",
};

/** The question of a step that ended on `ask`, in words: the outcome's own name is code. Pure. */
const askWords = (step: LaneStep, outcome: Outcome): string =>
  (outcome.kind === "ask" ? ASK_WORDS[outcome.for] : undefined) ??
  `The ${STEP_WORDS[step]} step stopped and needs your call.`;

/** How many findings a person let through, for the merge's question. None: nothing is said. Pure. */
const throughCount = ({ through }: Carry): string => {
  const count = through?.findings.length ?? 0;

  if (count === 0) {
    return "";
  }

  return `, ${count} ${count === 1 ? "finding" : "findings"} let through`;
};

/** The merge's question: the review's count and the checks first, so a long title cuts only itself. A review reaches a reviewer only with the checks green. Pure. */
const mergeWords = (carry: Carry): string => {
  const { reviewed, pr } = carry;
  return reviewed === undefined
    ? `Do you want to merge ${pr ?? "the change"}?`
    : `The review met ${reviewed.met} of ${reviewed.of}${throughCount(carry)}, and the repository's checks passed at its head. Do you want to merge "${reviewed.title}"?`;
};

/**
 * The exam merge's question: what the review met and the head the checks passed at first, as the
 * merge's question does, then the rule files. Pure.
 */
const examMergeWords = ({ rules, examPull }: Carry): string => {
  const asks = `Do you want to merge these rule changes: ${rules.join(", ")}?`;
  const reviewed = examPull?.reviewed;
  return reviewed === undefined || reviewed.head !== examPull?.head
    ? asks
    : `The review met ${reviewed.met} of ${reviewed.of}, and the checks passed at ${reviewed.head.slice(0, 7)}. ${asks}`;
};

/** What the rule changes' merge question has beside it: each change, and why. Pure. */
const examMergeAlso = ({ plan }: Carry): readonly string[] => {
  const changes = plan?.exam ?? [];
  return changes.length === 0
    ? []
    : ["These rule changes are in a pull request of their own:", ...ruleChangeLines(changes)];
};

/** The rounds' question, by the step that sent the work back and whether the rounds ran out. Pure. */
const spentQuestion = (s: Held, step: LaneStep): string => {
  if (EXAM_STEPS.has(step)) {
    return `The rule changes went to the exam writer ${examRounds(s.trail)} of ${boundOf(s.trail)} times, and ${step === "exam_merge" ? "the merge" : "the review or the checks"} still send them back. Should the exam writer go once more?`;
  }

  const still =
    step === "review" ? "the review still sends the work back" : "the repository's own tests still fail at this head";
  const bound = boundOf(s.trail);
  return s.round >= bound
    ? `Round ${s.round} of ${bound} is spent, and ${still}. Should the work go round once more?`
    : `[build] send_back is false in this repository, and ${still}. Should the work go round once more?`;
};

const questionFor = (s: Held, kind: AskFor, step: LaneStep, asks: string, call?: Call): Question => {
  const what = {
    approve: `Do you approve plan version ${s.carry.version ?? 1}?`,
    exam_merge: titleOf(examMergeWords(s.carry)),
    merge: titleOf(mergeWords(s.carry)),
    step: titleOf(asks),
    rounds_spent: titleOf(spentQuestion(s, step)),
    exam_touched: titleOf(
      `The build changed the test writer's files${(s.carry.touched ?? []).length === 0 ? "" : `: ${(s.carry.touched ?? []).join(", ")}`}. Which was wrong: the builder, or the test?`,
    ),
    exam_conflict: titleOf(asks),
    spend: titleOf(
      `The ${STEP_WORDS[step]} step spent the limit it was given and stopped. Should it run again, with more?`,
    ),
  }[kind];
  // The trail gains a row with every answer, so no two questions share a number. A lane saved under
  // the old count is safe too: that count was never more than the trail, and its answer added a row.
  const ask = `a-${kind}-${s.trail.length}`;
  const to = askedStep(kind, step);
  return call === undefined
    ? { ask, what, picks: picksFor(kind, to), for: kind, step: to }
    : { ask, what, picks: CALL_PICKS, for: kind, step: to, call };
};

/** The question when main changed the test writer's files: which, and what `again` does. Pure. */
const conflictWords = (files: readonly string[]): string =>
  `Main changed the test writer's files: ${files.join(", ")}. Should the test writer write those tests again on main's version?`;

/** Where the lane goes on a `go_on`, in words. Pure. */
const goOnWords = (next: Move): string => {
  if ("to" in next) {
    return `The lane moves on to the ${STEP_WORDS[next.to]} step.`;
  }

  if ("fresh" in next) {
    return `The lane takes main in, then moves on to the ${STEP_WORDS[next.fresh]} step.`;
  }

  if ("host" in next) {
    return "The lane reads the ticket again, and ends or pauses by what it says.";
  }

  return "ask" in next ? "The lane moves on, and asks you what comes next." : "The lane ends here.";
};

/** What typing the same line again does after a pause at `to`, in words. Pure. */
const goesOnWords = (s: Held, to: Resume): string =>
  to._tag === "ask"
    ? "Type the same line again and it asks you again."
    : `Type the same line again and the ${STEP_WORDS[to.step]} step runs${to.round === "next" ? `, as round ${s.round + 1}` : ""}.`;

/** The line for one pick of a question: what picking it does, in words. Pure. */
const pickLine = (s: Held, question: Question, pick: string): string => {
  const words = STEP_WORDS[question.step];
  const lean = (s.carry.plan?.questions ?? []).length === 0 ? "" : ", and a yes takes the lean on each open question";
  const next = NEXT[question.step];
  const { call } = question;
  const spent = question.for === "rounds_spent";
  const then = goesOnWords(s, pausedAt(question, pick));
  const pauses: Readonly<Record<string, string>> = {
    no:
      question.for === "approve"
        ? `Nothing is built, and the lane pauses, saved. ${then} A note you write beside this answer goes to the planner.`
        : `This change does not land now, and the lane pauses, saved. ${then}`,
    stop: spent
      ? `The lane stops here, stuck on its rounds, and this change does not land now. Its working copy stays. ${then}`
      : `The lane pauses here, saved, and this change does not land now. ${then}`,
  };
  const says: Readonly<Record<string, string>> = {
    approve: `The plan stands as written${lean}. The lane goes on with it.`,
    merge: "The change lands on main.",
    again:
      question.for === "exam_conflict"
        ? `The test writer writes those tests again on main's version, then the build runs, as round ${s.round + 1}.`
        : spent && EXAM_STEPS.has(question.step)
          ? `The exam writer redoes the rule changes once more, past the ${MAX_ROUNDS} rounds they get on their own. A note you write beside this answer goes to the exam writer.`
          : spent
            ? `The ${words} step runs once more${question.step === "build" ? "" : ", then the build"}, as round ${s.round + 1}, past the ${MAX_ROUNDS} rounds a ticket gets on its own. A note you write beside this answer goes to the builder.`
            : question.step === "build"
              ? `The build step runs once more, and a note you write beside this answer goes to the builder. It counts as round ${s.round + 1} of ${boundOf(s.trail)}.`
              : `The ${words} step runs once more, from the start.`,
    go_on:
      call === undefined
        ? [
            `The lane moves on${"to" in next ? ` to the ${STEP_WORDS[next.to]} step` : ""} as things stand.`,
            ...((s.carry.cannot ?? []).length === 0
              ? []
              : ["The ticket and the pull request say which property has no test."]),
          ].join(" ")
        : [
            ...(CALL_WORDS[call.about] === undefined ? [] : [CALL_WORDS[call.about]]),
            goOnWords(after(question.step, call.after, s.round, s)),
          ].join(" "),
    builder_wrong: `The test writer's files go back as it wrote them, on top of the builder's work, and the build runs again there, as round ${s.round + 1}. A note you write beside this answer goes to the builder.`,
    test_wrong: `The test writer writes those files again, and only those, with the note you write beside this answer. Then the build goes on from the builder's work, as round ${s.round + 1}.`,
    more: `The ${words} step runs again, with one more of the limit it was given.`,
    ...(PAUSES[question.for].includes(pick) ? pauses : {}),
  };
  return `\`${pick}\`: ${says[pick] ?? "The lane takes this answer as it stands."}`;
};

/** The head a merge's question is about, for the `asked` fact: what the person saw. Pure. */
const headAsked = (kind: AskFor, carry: Carry): { readonly head?: string } => {
  const head = kind === "exam_merge" ? carry.examPull?.head : kind === "merge" ? carry.head : undefined;
  return head === undefined || head === null ? {} : { head };
};

const asking = (s: Held, question: Question): Step_ => {
  const cmd = askPerson({
    number: s.number,
    ask: question.ask,
    what: question.what,
    picks: question.picks,
    does: question.picks.map((pick) => pickLine(s, question, pick)),
    ...(question.for === "merge" ? { also: throughWords(s.carry.through) } : {}),
    ...(question.for === "rounds_spent" ? { also: openWords(s.carry.open), spent: true } : {}),
    // What the runs on the ticket cost so far, beside the spend question (jidoka row 18).
    ...(question.for === "spend" ? { spent: true } : {}),
    // What changes and why, beside the question: the exam step's own words came before its review.
    ...(question.for === "exam_merge" ? { also: examMergeAlso(s.carry) } : {}),
    ...headAsked(question.for, s.carry),
    intent: intentOf("lane", s.number, question.ask),
  });
  return [{ ...s, phase: "asking", question, asked: cmd }, [cmd]];
};

/**
 * Why a step after build may not run on the carry's head. `null`: code's checks there are green, what
 * every step after build needs. Red ones there are red; any other, or none, did not run. Pure.
 */
const uncheckedAt = ({ head, checked }: Carry): "checks_red" | "checks_not_run" | null => {
  if (checked === undefined || checked.head !== head) {
    return "checks_not_run";
  }

  if (checked.result === "green") {
    return null;
  }

  return checked.result === "red" ? "checks_red" : "checks_not_run";
};

/** Why a step after build does not run, in words. Pure. */
const uncheckedWords = (step: LaneStep, { head, checked }: Carry): string => {
  const at = head ?? "no head";
  const why =
    checked === undefined || checked.head !== head
      ? `no checks code ran at ${at}`
      : `the checks code ran at ${at} are ${checked.result === "red" ? "red" : "not run"}`;
  return `${why}, so the ${STEP_WORDS[step]} step does not run`;
};

/** Where a step that stops goes on: itself, in the round it was to run in. Pure. */
const runAt = (s: Held, step: LaneStep, round: number): Resume => ({
  _tag: "run",
  step,
  ...(round > s.round ? { round: "next" as const } : {}),
});

/**
 * Where the exam's merge goes instead, at the head its pull request has now: `null`, nowhere, since
 * the review and a person's yes both stand there. A review at another head, or none: the review
 * again. A yes at another head, or none: the person is asked. Pure.
 */
const examMergeFrom = (s: Held, round: number): Step_ | null => {
  const pull = s.carry.examPull;

  if (pull === undefined || pull.reviewed?.head !== pull.head) {
    return running(s, "exam_review", round);
  }

  if (pull.yes?.head !== pull.head) {
    return asking(s, questionFor(s, "exam_merge", "exam_review", ""));
  }

  return null;
};

/**
 * The one place a step starts: one after build only on a head with green checks there, and the
 * exam's merge only where its review and a person's yes stand at its head. `restarted`: a restart
 * goes on in the merge it stopped in, as it held it. Ship's own gate reads the review and the yes at
 * the head the host has now, and its `no_review` comes back to the review (./routes.ts).
 */
const running = (s: Held, step: LaneStep, round = s.round, restarted = false): Step_ => {
  const instead = step === "exam_merge" && !restarted ? examMergeFrom(s, round) : null;

  if (instead !== null) {
    return instead;
  }

  const unchecked = AFTER_BUILD.has(step) ? uncheckedAt(s.carry) : null;
  const last = s.trail.at(-1)?.step;

  // A head after build no builder made: the mutants job's commit (experiment 193), or a person's
  // head the merge took in (jidoka rows 62 and 63). Red: the builder gets the failing names, a round
  // up, as after a build's own red (./routes.ts `back("build", "names")`). The mutants job's, not
  // run or none: main is read fresh, which runs them, as a restart does; still not run after that
  // read, the lane stops and says why.
  if ((last === "mutants" || last === "merge") && unchecked === "checks_red") {
    const red: Outcome = { kind: "send", to: "builder", why: "checks_red" };
    return move(s, "build", after("build", red, s.round, s), nameOf(red), askWords("build", red));
  }

  if (last === "mutants" && unchecked === "checks_not_run" && !restarted) {
    return refreshing(s, runAt(s, step, round));
  }

  if (unchecked !== null) {
    return releasing(s, {
      outcome: { kind: "stuck", why: unchecked },
      said: uncheckedWords(step, s.carry),
      at: runAt(s, step, round),
    });
  }

  const at: Held = { ...s, count: s.count + 1, round };
  const cmd = runStep({
    number: s.number,
    count: at.count,
    step,
    round,
    carry: at.carry,
    intent: intentOf("lane", s.number, at.count, step),
  });
  return [{ ...heldOf(at), phase: "running", step, asked: cmd }, [cmd]];
};

/**
 * Main is read fresh, and the lane's branch stands on it, before the lane goes on at `at`. `routed`:
 * a route's `fresh` sent it, as `FreshIn` says. Left out: a restart's, or the guard's.
 */
const refreshing = (s: Held, at: Resume, routed = false): Step_ => {
  const asked = freshMain({
    number: s.number,
    from: at,
    carry: s.carry,
    round: s.round,
    ...(routed ? { routed: true } : {}),
    intent: intentOf("lane", s.number, "fresh", s.count, s.trail.length),
  });
  return [{ ...heldOf(s), at, phase: "refreshing", asked }, [asked]];
};

/**
 * Where a clean fresh read of main goes on. A new head on a pushed branch: the push step shows it
 * before a merge, and a review reads it first unless what it judged stands there. A route's read has
 * pushed it already, so it runs its own step, with no agent turn and no round (jidoka row 62),
 * unless the review does not stand there. Pure.
 */
const freshAt = (
  s: Extract<Lane, { phase: "refreshing" }>,
  found: Extract<Fresh, { _tag: "fresh" | "merged" }>,
): Resume => {
  if (found._tag === "fresh" || STEPS.indexOf(s.at.step) <= STEPS.indexOf("review")) {
    return s.at;
  }

  if (found.review._tag !== "kept") {
    return { _tag: "run", step: "review" };
  }

  return s.asked.routed === true ? s.at : { _tag: "run", step: "push" };
};

/** The lane lets the ticket go: on an end, with nothing kept; on a stop, with its `Held` and where it goes on. */
const releasing = (s: Held, close: End | Stop): Step_ => {
  const cmd = releaseLane({
    number: s.number,
    lane: s.lane,
    outcome: close.outcome,
    intent: intentOf("lane", s.number, "release"),
  });
  return [{ ...heldOf(s), ...close, phase: "releasing", asked: cmd }, [cmd]];
};

/** `said`: what the trail and the end say. `asks`: the question, if this move asks one. `call`: if that question is a call. */
const move = (s: Held, step: LaneStep, m: Move, said: string, asks = said, call?: Call): Step_ => {
  if ("to" in m) {
    return running(s, m.to, m.round);
  }

  if ("ask" in m) {
    return asking(s, questionFor(s, m.ask, step, asks, call));
  }

  if ("fresh" in m) {
    return refreshing(s, { _tag: "run", step: m.fresh }, true);
  }

  if ("host" in m) {
    const asked = readFiled({ number: s.number });
    return [{ ...heldOf(s), phase: "reading", step, said, asked }, [asked]];
  }

  // A stop goes on at the step that stopped: the same line runs it again.
  return isEnd(m.end)
    ? releasing(s, { outcome: m.end, said })
    : releasing(s, { outcome: m.end, said, at: stopsAt(step, m.end) });
};

/** The question a lane that goes on by asking asks again: the one it stopped on. Pure. */
const askedAgain = (s: Held, kind: Exclude<AskFor, "step">, step: LaneStep): Question =>
  kind === "rounds_spent"
    ? questionFor(s, kind, sentFrom(step), "")
    : questionFor(s, kind, step, kind === "exam_conflict" ? conflictWords(s.carry.exam) : "");

/** The lane goes on where `at` says: a step it runs, or a question it asks again. `restarted`: as `running`'s. */
const goOn = (s: Held, at: Resume, restarted = false): Step_ => {
  if (at._tag === "run") {
    return running(s, at.step, at.round === "next" ? s.round + 1 : s.round, restarted);
  }

  // A step's own question is asked by the step: it runs again, and asks again if it still has to.
  if (at.for === "step") {
    return running(s, at.step);
  }

  return asking(s, askedAgain(s, at.for, at.step));
};

/** A person wrote something beside their answer: every step after this one is told it. Pure. */
export const withNote = (carry: Carry, note: string): Carry =>
  note.trim() === ""
    ? carry
    : {
        ...carry,
        decided: {
          questions: carry.decided?.questions ?? [],
          said: [...(carry.decided?.said ?? []), note],
        },
      };

/** `had`, and each row of `more` it does not hold yet: a person may be asked again in a later round. Pure. */
const joined = <A>(had: readonly A[], more: readonly A[], same: (a: A, b: A) => boolean) => [
  ...had,
  ...more.filter((row, at) => ![...had, ...more.slice(0, at)].some((seen) => same(seen, row))),
];

/**
 * A person let a step through: what its writer could not test is now what nobody tested, and what
 * the question would let through now is. Pure.
 */
export const letThrough = (carry: Carry): Carry => {
  const { waiting, ...rest } = carry;
  const cannot = carry.cannot ?? [];
  return {
    ...rest,
    ...(cannot.length === 0 ? {} : { cannot: [], untested: [...(carry.untested ?? []), ...cannot] }),
    ...(waiting === undefined
      ? {}
      : {
          through: {
            findings: joined(carry.through?.findings ?? [], waiting.findings, (a, b) => a.fault === b.fault),
            mutants: joined(carry.through?.mutants ?? [], waiting.mutants, (a, b) => a.mutant === b.mutant),
          },
        }),
  };
};

/** A state's held part, and only that: a kept state holds its own phase's keys and no other's. */
const heldOf = (s: Held): Held => ({
  number: s.number,
  lane: s.lane,
  ...(s.sendBack === undefined ? {} : { sendBack: s.sendBack }),
  count: s.count,
  round: s.round,
  carry: s.carry,
  trail: s.trail,
});

/** What a fresh read of main changed, laid over the carry. Left out: nothing. Pure. */
const withFresh = (s: Held, carry: StepEnd["carry"] | undefined): Held =>
  carry === undefined ? s : { ...s, carry: { ...s.carry, ...carry } };

/**
 * A person's `merge` on the exam's pull request: a yes on what the review read, at its head. A review
 * at another head gives none, and the merge asks again. Pure.
 */
export const saidYes = (carry: Carry): Carry => {
  const pull = carry.examPull;
  const reviewed = pull?.reviewed;

  if (pull === undefined || reviewed === undefined || reviewed.head !== pull.head) {
    return carry;
  }

  const { head, onto, base, diff } = reviewed;
  return { ...carry, examPull: { ...pull, yes: { head, onto, base, diff } } };
};

const answered = (s: Extract<Lane, { phase: "asking" }>, pick: string, note: string): Step_ => {
  const { question } = s;
  const held: Held = {
    ...heldOf(s),
    carry: withNote(question.for === "exam_merge" && pick === "merge" ? saidYes(s.carry) : s.carry, note),
    trail: [...s.trail, { step: question.ask, said: pick }],
  };

  if (pick === "go_on") {
    const on: Held = { ...held, carry: letThrough(held.carry) };
    const { call } = question;
    // A call says how the step ends. Any other let-through just moves on.
    return call === undefined
      ? move(on, question.step, NEXT[question.step], pick)
      : move(
          on,
          question.step,
          after(question.step, call.after, s.round, s),
          nameOf(call.after),
          askWords(question.step, call.after),
        );
  }

  const at = resumeOf(question, pick);

  if (!PAUSES[question.for].includes(pick)) {
    return goOn(held, at);
  }

  // A person's `no` or `stop` pauses the lane where the pick goes on, saved. A stop on the rounds
  // says so: the lane is stuck on them, and no person's no to the change.
  return releasing(held, {
    outcome: pausedBy(question),
    said: `${question.ask}: ${pick}`,
    at,
  });
};

/** Where a question that could not be asked goes on: a step's own question runs the step again. Pure. */
const askAt = (question: Question): Resume =>
  question.for === "step" || question.call !== undefined
    ? { _tag: "run", step: question.step }
    : { _tag: "ask", for: question.for, step: question.step };

/** A stop the lane makes with no ticket to let go: it never claimed one, or the claim did not hold. */
const stopped = (s: Held, outcome: StopOutcome, said: string, at: Resume): Step_ => [
  { phase: "over", number: s.number, trail: s.trail, outcome, said, at, held: heldOf(s) },
  [],
];

/** An end the lane makes with no ticket to let go. */
const ended = (number: number, outcome: EndOutcome, said: string): Step_ => [
  { phase: "over", number, trail: [], outcome, said },
  [],
];

/** The trail's row for a step that could not run twice: the name its `ended` fact on the ticket has. */
const RUN_FAILED = nameOf({ kind: "stuck", why: "run_failed" });

/** The lane goes on from a release: an end keeps nothing, a stop keeps its `Held` and where it goes on. */
const released = (s: Lane): Step_ => {
  if (s.phase !== "releasing") {
    return [s, []];
  }

  const over = { phase: "over" as const, number: s.number, trail: s.trail };

  if ("at" in s) {
    return [{ ...over, outcome: s.outcome, said: s.said, at: s.at, held: heldOf(s) }, []];
  }

  return [{ ...over, outcome: s.outcome, said: s.said }, []];
};

/**
 * A step said the ticket or its pull request is closed, merged or a draft, and the ticket was read
 * fresh (jidoka row 13). Closed: the lane ends `skip:closed`. Open: what the step saw is a person's to
 * settle, so the lane pauses at that step, saved, and the same line goes on there. Not filed by the
 * person running it: it ends, as at the start. Pure.
 */
const hostRead = (s: Extract<Lane, { phase: "reading"; step: LaneStep }>, filed: Filed): Step_ => {
  const held = heldOf(s);

  if (!filed.mine) {
    return releasing(held, {
      outcome: { kind: "stuck", why: "not_yours" },
      said: `#${s.number} was not filed by you or an agent of yours`,
    });
  }

  if (filed.state === "closed") {
    return releasing(held, {
      outcome: { kind: "skip", why: "closed" },
      said: `#${s.number} is closed`,
    });
  }

  return releasing(held, {
    outcome: { kind: "ask", who: "owner", for: "paused" },
    said: `${s.step}: ${s.said}, on an open ticket`,
    at: { _tag: "run", step: s.step },
  });
};

/** What the lane waits on while it asks: the ticket, the ask, what it is for, and the picks that count. */
export interface AnswerWait {
  readonly number: number;
  readonly ask: string;
  readonly for: AskFor;
  readonly picks: readonly string[];
}

/** The Listen on a person's answer: on for as long as the lane is asking. */
export const answerSub = listen<Lane, "lane_answer", AnswerWait>("lane_answer", (s) =>
  s.phase === "asking" ? { number: s.number, ask: s.question.ask, for: s.question.for, picks: s.question.picks } : null,
);

export const lane = defineMachine({
  types: {
    model: {} as Lane,
    msg: {} as LaneMsg,
    sub: {} as Sub<"lane_answer", AnswerWait>,
    ctx: undefined,
  },
  cmds: [readFiled, claimLane, releaseLane, runStep, askPerson, freshMain],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step_ => {
      if (s.phase !== "idle") {
        return [s, []];
      }

      const asked = readFiled({ number: m.number });
      const sendBack = m.sendBack === undefined ? {} : { sendBack: m.sendBack };
      return [{ phase: "reading", number: m.number, lane: m.lane, ...sendBack, asked }, [asked]];
    },
    // The same line typed again: a stop claims the ticket again, then reads main fresh. An end, or a
    // stop in `FINAL`, stays as it is. A stop saved before a stop kept its `Held` goes on from its fold.
    restart: (s, m): Step_ => {
      if (s.phase !== "over" || isEnd(s.outcome)) {
        return [s, []];
      }

      const held: Held | null =
        "held" in s
          ? s.held
          : m.folded === undefined || m.lane === undefined
            ? null
            : { number: s.number, lane: m.lane, ...m.folded.held };
      const at = "at" in s ? s.at : m.folded?.at;

      if (held === null || at === undefined) {
        return [s, []];
      }

      // Each restart counts, so two that stop before any step runs never share a claim or a read.
      const count = held.count + 1;
      const asked = claimLane({
        number: s.number,
        lane: held.lane,
        intent: intentOf("lane", s.number, "claim", count, held.trail.length),
      });
      return [{ ...held, count, at: goesOnFrom(at, s.outcome), phase: "restarting", asked }, [asked]];
    },
    resume: (s): Step_ => {
      if (s.phase === "idle" || s.phase === "over") {
        return [s, []];
      }

      return [s, [s.asked as LaneCmd]];
    },
    lane_read_ok: (s, m): Step_ => {
      if (s.phase !== "reading") {
        return [s, []];
      }

      if ("step" in s) {
        return hostRead(s, m.value);
      }

      const held: Held = {
        number: s.number,
        lane: s.lane,
        ...(s.sendBack === undefined ? {} : { sendBack: s.sendBack }),
        count: 0,
        round: 1,
        carry: EMPTY,
        trail: [],
      };

      if (!m.value.mine) {
        return ended(
          s.number,
          { kind: "stuck", why: "not_yours" },
          `#${s.number} was not filed by you or an agent of yours`,
        );
      }

      if (m.value.state === "closed") {
        return ended(s.number, { kind: "skip", why: "closed" }, `#${s.number} is closed`);
      }

      const asked = claimLane({
        number: s.number,
        lane: s.lane,
        intent: intentOf("lane", s.number, "claim"),
      });
      return [{ ...held, phase: "claiming", asked }, [asked]];
    },
    lane_read_err: (s): Step_ =>
      s.phase === "reading" && "step" in s
        ? releasing(heldOf(s), {
            outcome: { kind: "stuck", why: "no_ticket" },
            said: `#${s.number} could not be read, after ${s.step}'s ${s.said}`,
            at: { _tag: "run", step: s.step },
          })
        : s.phase === "reading"
          ? stopped(
              {
                number: s.number,
                lane: s.lane,
                ...(s.sendBack === undefined ? {} : { sendBack: s.sendBack }),
                count: 0,
                round: 1,
                carry: EMPTY,
                trail: [],
              },
              { kind: "stuck", why: "no_ticket" },
              `#${s.number} could not be read`,
              { _tag: "run", step: "triage" },
            )
          : [s, []],
    lane_claim_ok: (s, m): Step_ => {
      if (s.phase !== "restarting" && s.phase !== "claiming") {
        return [s, []];
      }

      // Another lane holds the ticket: this one ends and names it, as operate does (jidoka row 3).
      if (m.value !== s.lane) {
        const outcome = { kind: "skip", why: "claimed" } as const;
        return [
          {
            phase: "over",
            number: s.number,
            trail: s.trail,
            outcome,
            said: `lane ${m.value} holds it`,
          },
          [],
        ];
      }

      return s.phase === "restarting" ? refreshing(s, s.at) : running(heldOf(s), "triage");
    },
    lane_claim_err: (s): Step_ => {
      const said = "the claim could not be made";
      const failed = { kind: "stuck", why: "step_failed" } as const;

      if (s.phase === "claiming") {
        return stopped(s, failed, said, { _tag: "run", step: "triage" });
      }

      if (s.phase === "restarting") {
        return stopped(s, failed, said, s.at);
      }

      return [s, []];
    },
    lane_fresh_ok: (s, m): Step_ => {
      if (s.phase !== "refreshing") {
        return [s, []];
      }

      const held = heldOf(s);
      const found = m.value;

      switch (found._tag) {
        case "closed":
          return releasing(held, {
            outcome: { kind: "skip", why: "closed" },
            said: `#${s.number} was closed while the lane was stopped`,
          });
        case "not_yours":
          return releasing(held, {
            outcome: { kind: "stuck", why: "not_yours" },
            said: `#${s.number} was not filed by you or an agent of yours`,
          });
        // The builder's files conflict with main: main's side stands, and the builder redoes them.
        case "conflicts":
          return running(withFresh(held, found.carry), "build", held.round + 1);
        // The test writer's files do: the person says whether the test writer writes them again.
        case "exam_conflict": {
          const on = withFresh(held, found.carry);
          return asking(on, questionFor(on, "exam_conflict", "test_writer", conflictWords(found.files)));
        }
        case "fresh":
        case "merged": {
          const on = withFresh(held, found.carry);
          const at = freshAt(s, found);

          // Code's checks at the head a step after the build goes on at are red: the builder gets
          // them, a round up, as after a build's own red, or a person is asked past the bound.
          if (!AFTER_BUILD.has(at.step) || uncheckedAt(on.carry) !== "checks_red") {
            return goOn(on, at, true);
          }

          const red: Outcome = { kind: "send", to: "builder", why: "checks_red" };
          return move(on, "build", after("build", red, on.round, on), nameOf(red), askWords("build", red));
        }
      }
    },
    // Main could not be read: the lane stops where it was to go on, and lets the ticket go.
    lane_fresh_err: (s): Step_ =>
      s.phase === "refreshing"
        ? releasing(heldOf(s), {
            outcome: { kind: "stuck", why: "step_failed" },
            said: "main could not be read fresh",
            at: s.at,
          })
        : [s, []],
    lane_step_ok: (s, m): Step_ => {
      if (s.phase !== "running") {
        return [s, []];
      }

      const said = nameOf(m.value.outcome);
      const held: Held = {
        ...heldOf(s),
        carry: { ...s.carry, ...m.value.carry },
        trail: [...s.trail, { step: s.step, said }],
      };
      const { outcome, after: past } = m.value;
      return move(
        held,
        s.step,
        after(s.step, outcome, s.round, s),
        said,
        askWords(s.step, outcome),
        outcome.kind === "ask" && past !== undefined ? { about: outcome.for, after: past } : undefined,
      );
    },
    // A step that could not run is run once more, as the same Act (P8). Twice: the lane stops there.
    lane_step_err: (s): Step_ => {
      if (s.phase !== "running") {
        return [s, []];
      }

      if (s.again !== true) {
        return [{ ...s, again: true }, [s.asked]];
      }

      return releasing(
        { ...heldOf(s), trail: [...s.trail, { step: s.step, said: RUN_FAILED }] },
        {
          outcome: { kind: "stuck", why: "step_failed" },
          said: `${s.step}: could not run`,
          at: { _tag: "run", step: s.step },
        },
      );
    },
    // The question is on the ticket. The Listen goes on hearing for the answer.
    lane_ask_ok: (s): Step_ => [s, []],
    lane_ask_err: (s): Step_ =>
      s.phase === "asking"
        ? releasing(heldOf(s), {
            outcome: { kind: "stuck", why: "step_failed" },
            said: `${s.question.ask}: could not be asked`,
            at: askAt(s.question),
          })
        : [s, []],
    lane_answered: (s, m): Step_ =>
      s.phase === "asking" && m.ask === s.question.ask && s.question.picks.includes(m.pick)
        ? answered(s, m.pick, m.note ?? "")
        : [s, []],
    lane_release_ok: (s): Step_ => released(s),
    // The ticket's lease runs out by itself: the lane has ended all the same.
    lane_release_err: (s): Step_ => released(s),
  },
  subs: [answerSub],
});
