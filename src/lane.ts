import { applyCell, Cmd, defineMachine } from "@demlik/tea";
import { z } from "zod";
import { fetchComments } from "./tracker.ts";
import {
  afterReading,
  type OwnerComment,
  unseen,
  weigh,
  weighFor,
  withState,
} from "./comments.ts";
import { addRule, type Criterion, type ExampleCriterion, Issue, setExample, testNames } from "./issue.ts";
import {
  type Decided,
  Deviation,
  type Finding,
  inspect,
  isOver,
  type Matched,
  match,
  type Review,
  type ReviewCmd,
  type ReviewMsg,
  type ReviewPark,
  type ReviewParkAnswer,
  review,
  route,
  Snapshot,
} from "./review.ts";
import type { FailureCause } from "./services.ts";

/** How many builds one issue gets before a person is asked. */
export const MAX_ATTEMPTS = 3;

/**
 * The review round from which the list of findings is frozen: the last one the
 * budget allows. It does not move when a person grants more attempts, so the
 * rounds past it stay frozen too. Fabrika freezes at the same round.
 */
export const FREEZE_ROUND = MAX_ATTEMPTS;

/**
 * Write the issue's tests from its examples, lock them, and run them once on
 * the code before anyone changed it. Code writes them, so a test asserts
 * exactly its example and no model decides whether a criterion is met.
 */
export const prepare = Cmd.define("prepare", {
  input: z.object({ issue: Issue }),
  ok: z.object({
    passing: z.array(z.string()).readonly(),
    failing: z.array(z.string()).readonly(),
    output: z.string(),
  }),
  err: ["could_not_run"],
});

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
  ok: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("done"), summary: z.string(), deviations: z.array(Deviation).readonly() }),
    z.object({
      kind: z.literal("contradiction"),
      criterion: z.string(),
      call: z.string(),
      why: z.string(),
    }),
    z.object({ kind: z.literal("blocked"), why: z.string() }),
    /** The builder says a review finding is wrong. */
    z.object({ kind: z.literal("dispute"), finding: z.string(), why: z.string() }),
  ]),
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
    touched: z.array(z.string()).readonly(),
    changed: z.array(z.string()).readonly(),
    snapshot: Snapshot,
  }),
  err: ["could_not_run"],
});

/**
 * Run the tests again on a fresh copy of the change as committed. The folder
 * the builder worked in can hold files git does not: what passes only there
 * would fail anywhere else.
 */
export const freshCheck = Cmd.define("fresh_check", {
  input: z.object({}),
  ok: z.object({ passed: z.boolean(), output: z.string() }),
  err: ["could_not_run"],
});

/**
 * Ask why a test run failed. A sure "test file" or "setup" stops for a person:
 * the builder cannot fix either, and sending it back would spend its tries for
 * nothing. Anything else goes back to the builder, as every failure did before
 * the lane read them: a wrong send-back costs one try and the attempt limit
 * still stops it, while a wrong stop costs a person.
 */
export const diagnose = Cmd.define("diagnose", {
  input: z.object({ diff: z.string(), output: z.string() }),
  ok: z.object({
    cause: z.enum(["change", "test_file", "environment", "unsure"]),
    confidence: z.number(),
  }),
  err: ["reader_failed"],
});

/** Which run failed: the tests in the builder's folder, or on a fresh copy of the change. */
type RunStep = "check" | "fresh";

/** A failed run waiting to be read. */
type Failure = { readonly step: RunStep; readonly diff: string; readonly output: string };

/** What the check saw of a change that passed, kept for review while the fresh copy runs. */
type Seen = { readonly diff: string; readonly changed: readonly string[]; readonly snapshot: Snapshot };

/** Why a lane stopped and is waiting on a person. Review's own parks live in review. */
export type ParkCause =
  /** Rules no call can show yet: a check for their kind does not exist. */
  | { readonly kind: "unchecked"; readonly criteria: readonly string[] }
  /** Examples whose tests did not run at all on the untouched code: a call that does not parse, say. */
  | { readonly kind: "tests_broken"; readonly missing: readonly string[]; readonly output: string }
  /** Every example already holds on the untouched code. */
  | { readonly kind: "nothing_to_build"; readonly passing: readonly string[] }
  | { readonly kind: "could_not_run"; readonly step: "prepare" }
  /** `fresh` is the fresh copy's run; a retry runs the check again first, then the copy. */
  | { readonly kind: "could_not_run"; readonly step: RunStep; readonly deviations: readonly Deviation[] }
  /**
   * The tests ran and failed, and the reader is sure the builder cannot fix
   * it: the test file or the setup is broken. The run's output is shown.
   */
  | {
      readonly kind: "run_failed";
      readonly step: RunStep;
      readonly cause: "test_file" | "environment";
      readonly output: string;
      readonly deviations: readonly Deviation[];
    }
  | { readonly kind: "builder_failed" }
  | { readonly kind: "builder_blocked"; readonly why: string }
  /** The builder says an example breaks its own rule. Both are shown, side by side. */
  | {
      readonly kind: "contradiction";
      readonly criterion: string;
      readonly rule: string;
      readonly call: string;
      readonly result: string;
      readonly why: string;
    }
  /** The builder says a review finding is wrong. Both are shown, side by side. */
  | { readonly kind: "finding_disputed"; readonly finding: Finding; readonly why: string }
  /**
   * The owner left a comment that may change what "done" means. The comment
   * and the rule it may change are shown side by side; `criterion` is `null`
   * when it asks for something no rule covers, or the reader could not say.
   */
  | {
      readonly kind: "comment_changes_rule";
      readonly comment: OwnerComment;
      readonly criterion: Criterion | null;
      readonly deviations: readonly Deviation[];
    }
  /** The comments could not be fetched, so the lane cannot know it is done. */
  | { readonly kind: "tracker_failed"; readonly deviations: readonly Deviation[] }
  | { readonly kind: "out_of_attempts"; readonly feedback: string };

type Drop = { readonly kind: "drop" };

/**
 * What a person may answer to each park, and nothing else. An answer that
 * does not fit the park the lane is in leaves it parked.
 */
export interface ParkAnswers {
  /** `skip`: build against the example criteria alone. */
  readonly unchecked: { readonly kind: "skip" } | Drop;
  readonly tests_broken: { readonly kind: "retry" } | Drop;
  /** `accept`: the work is already done. */
  readonly nothing_to_build: { readonly kind: "accept" } | Drop;
  readonly could_not_run: { readonly kind: "retry" } | Drop;
  /**
   * `retry`: a person fixed what broke; run the tests again, on the same
   * attempt. `rebuild`: it was the builder's change after all; it goes back
   * with the run and `feedback`, and spends an attempt.
   */
  readonly run_failed: { readonly kind: "retry" } | { readonly kind: "rebuild"; readonly feedback: string } | Drop;
  readonly builder_failed: { readonly kind: "retry" } | Drop;
  readonly builder_blocked: { readonly kind: "rebuild"; readonly feedback: string } | Drop;
  /**
   * `keep`: the example stands, and the builder is told so. `fix`: the builder
   * was right, and `result` is what the call should return; the test is
   * rewritten before the builder goes on.
   */
  readonly contradiction:
    | { readonly kind: "keep"; readonly note: string }
    | { readonly kind: "fix"; readonly result: string }
    | Drop;
  /** `stands`: the builder must fix it. `withdraw`: the finding was wrong, and is closed. */
  readonly finding_disputed:
    | { readonly kind: "stands"; readonly note: string }
    | { readonly kind: "withdraw" }
    | Drop;
  /**
   * `note`: it changes nothing after all. `example`: it changes an example of
   * a rule, or adds one to it. `rule`: it asks for behaviour no rule covers, so
   * the ticket gets a new rule with its examples. Either way the tests are
   * rewritten and the builder goes on. `rebuild`: it changes something no
   * example can show; tell the builder what. None of these is the builder's
   * fault, so none spends an attempt.
   */
  readonly comment_changes_rule:
    | { readonly kind: "note" }
    | { readonly kind: "example"; readonly criterion: string; readonly call: string; readonly result: string }
    | { readonly kind: "rule"; readonly criterion: ExampleCriterion }
    | { readonly kind: "rebuild"; readonly feedback: string }
    | Drop;
  readonly tracker_failed: { readonly kind: "retry" } | Drop;
  readonly out_of_attempts: { readonly kind: "more"; readonly attempts: number } | Drop;
}

/** An answer to one kind of park, tagged with the park it answers. */
export type ParkAnswer = {
  [K in keyof ParkAnswers]: { readonly park: K; readonly answer: ParkAnswers[K] };
}[keyof ParkAnswers];

type Working = {
  readonly issue: Issue;
  /** Builds charged to the budget. One a person says was not the builder's fault is given back. */
  readonly attempt: number;
  /** Every build the builder finished, given back or not: what the lane really cost. */
  readonly builds: number;
  /** How many attempts this lane may have; a person can raise it. */
  readonly limit: number;
  /** The builder's conversation. */
  readonly session: string;
  /** Review findings the builder was asked to fix, and not yet seen fixed. */
  readonly open: readonly Finding[];
  /** Review findings filed along the way: real, but not this ticket's. */
  readonly notes: readonly Finding[];
  /** Review findings a person withdrew after the builder disputed them. */
  readonly withdrawn: readonly Finding[];
  /** New findings review tied to one already decided, kept for the person who reads the result. */
  readonly matched: readonly Matched[];
  /** The owner's comments the lane has seen, and where each one stands. */
  readonly comments: readonly OwnerComment[];
};

const working = (s: Working): Working => ({
  issue: s.issue,
  attempt: s.attempt,
  builds: s.builds,
  limit: s.limit,
  session: s.session,
  open: s.open,
  notes: s.notes,
  withdrawn: s.withdrawn,
  matched: s.matched,
  comments: s.comments,
});

/** Everything a person settled so far, as review is told it. */
const decidedOf = (s: Working): readonly Decided[] => [
  ...s.notes.map((f) => ({ ...f, decision: "filed" as const })),
  ...s.withdrawn.map((f) => ({ ...f, decision: "withdrawn" as const })),
];

export type Lane =
  | { readonly phase: "idle" }
  /** `feedback` is for the build that follows: set when the tests are rewritten after a build. */
  | (Working & { readonly phase: "preparing"; readonly feedback: string | null })
  | (Working & { readonly phase: "building"; readonly feedback: string | null })
  /** `deviations` is what the builder said it changed beyond the ticket. */
  | (Working & { readonly phase: "checking"; readonly deviations: readonly Deviation[] })
  /** The tests passed in the builder's folder; now on a fresh copy. `seen` waits for review. */
  | (Working & { readonly phase: "checking_fresh"; readonly deviations: readonly Deviation[]; readonly seen: Seen })
  /** A run failed; the failure reader says whose it is before anyone acts on it. */
  | (Working & { readonly phase: "diagnosing"; readonly deviations: readonly Deviation[]; readonly failure: Failure })
  /** The review machine, held as a child until it ends. */
  | (Working & { readonly phase: "reviewing"; readonly review: Review })
  /**
   * The work passed; the owner's comments are read before it counts as done.
   * `fetched` says the tracker has answered, so a restart asks only for what is still out.
   */
  | (Working & { readonly phase: "finishing"; readonly deviations: readonly Deviation[]; readonly fetched: boolean })
  /** `deviations` are the extra changes that stayed, for the person who reads the result. */
  | (Working & { readonly phase: "done"; readonly deviations: readonly Deviation[] })
  | (Working & { readonly phase: "parked"; readonly why: ParkCause })
  | (Working & { readonly phase: "dropped"; readonly why: ParkCause | ReviewPark });

export type LaneMsg =
  /** `session` names the builder's conversation; the host makes it, so the reducer stays pure. */
  | { readonly type: "start"; readonly issue: Issue; readonly session: string }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  /** A person's answer to a park: the lane's own, or review's while it reviews. */
  | { readonly type: "answer"; readonly answer: ParkAnswer | ReviewParkAnswer; readonly at: number };

export type LaneCmd =
  | ReturnType<typeof prepare>
  | ReturnType<typeof build>
  | ReturnType<typeof check>
  | ReturnType<typeof freshCheck>
  | ReturnType<typeof diagnose>
  | ReturnType<typeof fetchComments>
  | ReturnType<typeof weigh>
  | ReviewCmd;

type Step = readonly [Lane, readonly LaneCmd[]];
type Parked = Extract<Lane, { phase: "parked" }>;
type Preparing = Extract<Lane, { phase: "preparing" }>;
type Building = Extract<Lane, { phase: "building" }>;
type Reviewing = Extract<Lane, { phase: "reviewing" }>;
type Finishing = Extract<Lane, { phase: "finishing" }>;
type AnyMsg = { readonly type: string };

const stay = (s: Lane): Step => [s, []];

const park = (s: Working, why: ParkCause): Step => [
  { phase: "parked", ...working(s), why },
  [],
];

const startPreparing = (s: Working, feedback: string | null = null): Step => [
  { phase: "preparing", ...working(s), feedback },
  [prepare({ issue: s.issue })],
];

/** The build Cmd for a lane in `s`. Only a lane's very first build starts a new conversation. */
const buildFor = (s: Working, feedback: string | null, continues: boolean) =>
  build({ issue: s.issue, feedback, session: { id: s.session, continues } });

/** Build again, one attempt further on. */
function rebuild(s: Working, feedback: string): Step {
  const next = { ...working(s), attempt: s.attempt + 1 };
  return [{ phase: "building", ...next, feedback }, [buildFor(next, feedback, true)]];
}

/** Build again on the same attempt: the last build was not the builder's fault. */
const buildAgain = (s: Working, feedback: string | null): Step => [
  { phase: "building", ...working(s), feedback },
  [buildFor(s, feedback, true)],
];

/**
 * Send the work back to the builder, or park once the attempts are spent. A
 * person's answer that sends it back goes through here too, so no answer can
 * take a lane past its limit unseen.
 */
function rebuildOrPark(s: Working, feedback: string): Step {
  return s.attempt >= s.limit
    ? park(s, { kind: "out_of_attempts", feedback })
    : rebuild(s, feedback);
}

/**
 * The tests ran on the untouched code. Every example must have run, and at
 * least one must fail: an issue whose examples all hold already has nothing
 * for a builder to do. An example that holds already is kept, as a guard.
 * Tests rewritten after a build go back to the builder's conversation with
 * the reason; the first ones start it.
 */
function prepared(
  s: Preparing,
  { passing, failing, output }: { readonly passing: readonly string[]; readonly failing: readonly string[]; readonly output: string },
): Step {
  const ran = new Set([...passing, ...failing]);
  const missing = testNames(s.issue).filter((name) => !ran.has(name));
  if (missing.length > 0) return park(s, { kind: "tests_broken", missing, output });
  // After a build, tests rewritten by a person may hold already: the builder still hears why.
  if (failing.length === 0 && s.builds === 0) return park(s, { kind: "nothing_to_build", passing });
  return [
    { phase: "building", ...working(s), feedback: s.feedback },
    [buildFor(s, s.feedback, s.feedback !== null)],
  ];
}

/** The builder says an example breaks its rule. Park on it if the example is real. */
function contradicted(s: Building, answer: { readonly criterion: string; readonly call: string; readonly why: string }): Step {
  const criterion = s.issue.criteria.find((c) => c.id === answer.criterion);
  const example =
    criterion?.kind === "example" ? criterion.examples.find((e) => e.call === answer.call) : undefined;
  if (criterion === undefined || example === undefined) {
    return rebuildOrPark(
      s,
      `You named ${answer.call} under "${answer.criterion}", and the issue has no such example. Name one exactly as the tests have it, or finish the work.`,
    );
  }
  return park(s, {
    kind: "contradiction",
    criterion: criterion.id,
    rule: criterion.rule,
    call: example.call,
    result: example.result,
    why: answer.why,
  });
}

/** The builder says a finding is wrong. Park on it if the finding is open. */
function disputed(s: Building, answer: { readonly finding: string; readonly why: string }): Step {
  const finding = s.open.find((f) => f.id === answer.finding);
  return finding === undefined
    ? rebuildOrPark(s, `There is no open finding ${answer.finding}. Name one exactly as the review did, or finish the work.`)
    : park(s, { kind: "finding_disputed", finding, why: answer.why });
}

/**
 * Step the review child with `msg`, and read how it ended once it has: passed
 * is done, failed goes back to the builder with the findings, dropped is the
 * person's call.
 */
function toReview(s: Reviewing, msg: AnyMsg): Step {
  const [child, cmds] = applyCell<Review, AnyMsg, ReviewCmd>(review, s.review, msg);
  if (!isOver(child)) return [{ ...s, review: child }, cmds];
  switch (child.phase) {
    case "passed":
      return finishing(
        { ...working(s), open: [], notes: [...s.notes, ...child.notes], matched: [...s.matched, ...child.matched] },
        child.deviations,
      );
    case "failed":
      return rebuildOrPark(
        {
          ...working(s),
          open: child.open,
          notes: [...s.notes, ...child.notes],
          matched: [...s.matched, ...child.matched],
        },
        child.feedback,
      );
    case "dropped":
      return [{ phase: "dropped", ...working(s), why: child.why }, []];
  }
}

/** The work passed: ask the tracker for the owner's comments before calling it done. */
const finishing = (s: Working, deviations: readonly Deviation[]): Step => [
  { phase: "finishing", ...working(s), deviations, fetched: false },
  [fetchComments({ issue: s.issue.id })],
];

/**
 * Done once every comment is read and none is left for a person. The first
 * open one parks, with the rule it may change beside it.
 */
function settleFinish(s: Finishing): Step {
  if (s.comments.some((c) => c.state.kind === "reading")) return stay(s);
  const open = s.comments.find((c) => c.state.kind === "open");
  if (open === undefined) return [{ phase: "done", ...working(s), deviations: s.deviations }, []];
  const reading = open.state.kind === "open" ? open.state.reading : undefined;
  const criterion =
    reading?.kind === "changes" ? (s.issue.criteria.find((c) => c.id === reading.criterion) ?? null) : null;
  return park(s, { kind: "comment_changes_rule", comment: open, criterion, deviations: s.deviations });
}

/** The tracker answered: read each comment not seen before, or settle if there is none. */
function fetched(s: Finishing, comments: readonly { readonly id: string; readonly text: string }[]): Step {
  const fresh = unseen(s.comments, comments);
  const next = { ...s, fetched: true, comments: [...s.comments, ...fresh] };
  return fresh.length === 0 ? settleFinish(next) : [next, fresh.map((c) => weighFor(s.issue, c))];
}

/** A run failed: ask whose failure it is before acting on it. */
const startDiagnosing = (s: Working, deviations: readonly Deviation[], failure: Failure): Step => [
  { phase: "diagnosing", ...working(s), deviations, failure },
  [diagnose({ diff: failure.diff, output: failure.output })],
];

/** What the builder is told about a failed run that goes back to it. */
const sentBack = ({ step, output }: Failure): string =>
  step === "check"
    ? `Tests failed:\n${output}`
    : `The tests pass in your folder but fail on a fresh copy of your change, so it needs something git does not hold: a file that is ignored or was never added. Add it, or stop depending on it. The fresh run:\n${output}`;

/** The reader's answer, or `null` when there is none: a sure test-file or setup failure parks, the rest goes back. */
function diagnosed(s: Extract<Lane, { phase: "diagnosing" }>, cause: FailureCause | null): Step {
  const { failure } = s;
  return cause === "test_file" || cause === "environment"
    ? park(s, { kind: "run_failed", step: failure.step, cause, output: failure.output, deviations: s.deviations })
    : rebuildOrPark(s, sentBack(failure));
}

/** Run the tests again from the check, which hands the fresh copy what it needs. */
const recheck = (s: Working, deviations: readonly Deviation[]): Step => [
  { phase: "checking", ...working(s), deviations },
  [check({})],
];

/** The tests passed on a fresh copy too: hand the change to review. */
function startReview(s: Working & { readonly deviations: readonly Deviation[] }, seen: Seen): Step {
  const msg: ReviewMsg = {
    type: "start",
    input: {
      issue: s.issue,
      // Each review follows a build of its own, so the build count never repeats a round.
      round: s.builds,
      diff: seen.diff,
      changed: seen.changed,
      snapshot: seen.snapshot,
      deviations: s.deviations,
      open: s.open,
      decided: decidedOf(s),
      frozen: s.attempt >= FREEZE_ROUND,
    },
  };
  return toReview({ phase: "reviewing", ...working(s), review: { phase: "idle" } }, msg);
}

/**
 * Re-issue what a lane booted from saved state was waiting on. A Cmd that was
 * in flight when the process died may run a second time: that is the window
 * tea names, and the builder resumes its own conversation to make it cheap.
 */
function resume(s: Lane): Step {
  switch (s.phase) {
    case "preparing":
      return [s, [prepare({ issue: s.issue })]];
    case "building":
      return [s, [buildFor(s, s.feedback, true)]];
    case "checking":
      return [s, [check({})]];
    case "checking_fresh":
      return [s, [freshCheck({})]];
    case "diagnosing":
      return [s, [diagnose({ diff: s.failure.diff, output: s.failure.output })]];
    case "reviewing":
      return toReview(s, { type: "resume" });
    case "finishing":
      return [
        s,
        s.fetched
          ? s.comments.filter((c) => c.state.kind === "reading").map((c) => weighFor(s.issue, c))
          : [fetchComments({ issue: s.issue.id })],
      ];
    default:
      return stay(s);
  }
}

/**
 * A person's answer to the park the lane is in. Any other answer changes
 * nothing. An answer that says the builder was right (an example fixed, a
 * finding withdrawn) builds again on the same attempt; one that says it was
 * wrong spends an attempt, like any other send-back.
 */
function answerPark(s: Parked, { park: kind, answer }: ParkAnswer | ReviewParkAnswer): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ ...s, phase: "dropped" }, []];
  // The review's parks live in the review child; an answer to one never reaches here.
  switch (s.why.kind) {
    case "unchecked":
    case "tests_broken":
      return startPreparing(s);
    case "nothing_to_build":
      return finishing(s, []);
    case "could_not_run":
      // A fresh run that could not run starts again from the check, which hands it what it needs.
      return s.why.step === "prepare" ? startPreparing(s) : recheck(s, s.why.deviations);
    case "run_failed":
      return answer.kind === "retry"
        ? recheck(s, s.why.deviations)
        : answer.kind === "rebuild"
          ? rebuildOrPark(s, `${answer.feedback}\n\nThe run:\n${s.why.output}`)
          : stay(s);
    case "builder_failed":
      return buildAgain(s, null);
    case "builder_blocked":
      return answer.kind === "rebuild" ? rebuildOrPark(s, answer.feedback) : stay(s);
    case "contradiction": {
      const { criterion, rule, call, result } = s.why;
      if (answer.kind === "keep") {
        return rebuildOrPark(
          s,
          `A person checked ${call} -> ${result} against "${rule}": the example stands.${answer.note === "" ? "" : ` ${answer.note}`}`,
        );
      }
      return answer.kind === "fix"
        ? startPreparing(
            { ...working(s), issue: setExample(s.issue, criterion, call, answer.result) },
            `You were right: ${call} -> ${result} broke "${rule}". A person fixed it to ${call} -> ${answer.result}, and the test now says so.`,
          )
        : stay(s);
    }
    case "finding_disputed": {
      const { finding } = s.why;
      if (answer.kind === "stands") {
        return rebuildOrPark(s, `A person checked finding ${finding.id}: it stands, fix it.${answer.note === "" ? "" : ` ${answer.note}`}`);
      }
      return answer.kind === "withdraw"
        ? buildAgain(
            { ...working(s), open: s.open.filter((f) => f.id !== finding.id), withdrawn: [...s.withdrawn, finding] },
            `A person agreed finding ${finding.id} was wrong, and withdrew it.`,
          )
        : stay(s);
    }
    case "out_of_attempts":
      return answer.kind === "more"
        ? rebuild({ ...working(s), limit: s.limit + answer.attempts }, s.why.feedback)
        : stay(s);
    case "tracker_failed":
      return finishing(s, s.why.deviations);
    case "comment_changes_rule":
      return ruleOnComment(s, s.why, answer);
  }
}

/**
 * A person ruled on an owner's comment. Either way it is settled: `note` goes
 * on finishing, and fetches again in case more came in. `example` sets the
 * example and rewrites the tests; `rebuild` tells the builder. The owner
 * changing their mind is not the builder's fault, so neither spends an attempt.
 */
function ruleOnComment(
  s: Parked,
  why: Extract<ParkCause, { kind: "comment_changes_rule" }>,
  answer: (ParkAnswer | ReviewParkAnswer)["answer"],
): Step {
  const settled = { ...working(s), comments: withState(s.comments, why.comment.id, { kind: "settled", by: "person" }) };
  const said = `The ticket's owner commented: "${why.comment.text}"`;
  if (answer.kind === "note") return finishing(settled, why.deviations);
  if (answer.kind === "rebuild") return buildAgain(settled, `${said} ${answer.feedback}`);
  if (answer.kind === "rule") {
    const rule = answer.criterion;
    // A rule's id names its tests, so it must be new.
    if (s.issue.criteria.some((c) => c.id === rule.id)) return stay(s);
    const examples = rule.examples.map((e) => `${e.call} -> ${e.result}`).join(", ");
    return startPreparing(
      { ...settled, issue: addRule(s.issue, rule) },
      `${said} A person made it a new rule, "${rule.rule}": ${examples}. The tests now say so.`,
    );
  }
  if (answer.kind !== "example") return stay(s);
  const target = s.issue.criteria.find((c) => c.id === answer.criterion);
  if (target?.kind !== "example") return stay(s);
  return startPreparing(
    { ...settled, issue: setExample(s.issue, answer.criterion, answer.call, answer.result) },
    `${said} A person made it an example: ${answer.call} -> ${answer.result}, under "${target.rule}". The tests now say so.`,
  );
}

/** A review Msg goes to the child while it reviews; anywhere else it is late, and changes nothing. */
const reviewCell = (s: Lane, m: AnyMsg): Step => (s.phase === "reviewing" ? toReview(s, m) : stay(s));

/**
 * One issue, from "start" to done or parked: write its tests, build, run the
 * tests, review. Every cell ignores a Msg that arrives in a phase it does not
 * belong to, so a late answer changes nothing.
 */
export const lane = defineMachine({
  types: { model: {} as Lane, msg: {} as LaneMsg, ctx: undefined },
  cmds: [prepare, build, check, freshCheck, diagnose, route, inspect, match, fetchComments, weigh],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => {
      if (s.phase !== "idle") return stay(s);
      const first: Working = {
        issue: m.issue,
        attempt: 1,
        builds: 0,
        limit: MAX_ATTEMPTS,
        session: m.session,
        open: [],
        notes: [],
        withdrawn: [],
        matched: [],
        comments: [],
      };
      const unchecked = m.issue.criteria.flatMap((c) => (c.kind === "unchecked" ? [c.id] : []));
      return unchecked.length > 0
        ? park(first, { kind: "unchecked", criteria: unchecked })
        : startPreparing(first);
    },
    resume: (s): Step => resume(s),
    answer: (s, m): Step =>
      s.phase === "parked"
        ? answerPark(s, m.answer)
        : s.phase === "reviewing"
          ? toReview(s, m)
          : stay(s),
    prepare_ok: (s, m): Step => (s.phase === "preparing" ? prepared(s, m.value) : stay(s)),
    prepare_err: (s): Step =>
      s.phase === "preparing" ? park(s, { kind: "could_not_run", step: "prepare" }) : stay(s),
    build_ok: (from, m): Step => {
      if (from.phase !== "building") return stay(from);
      // Counted where the answer lands, so a build re-sent after a restart counts once.
      const s = { ...from, builds: from.builds + 1 };
      switch (m.value.kind) {
        case "done":
          return [{ phase: "checking", ...working(s), deviations: m.value.deviations }, [check({})]];
        case "contradiction":
          return contradicted(s, m.value);
        case "blocked":
          return park(s, { kind: "builder_blocked", why: m.value.why });
        case "dispute":
          return disputed(s, m.value);
      }
    },
    build_err: (s): Step =>
      s.phase === "building" ? park(s, { kind: "builder_failed" }) : stay(s),
    check_ok: (s, m): Step => {
      if (s.phase !== "checking") return stay(s);
      if (m.value.touched.length > 0) {
        return rebuildOrPark(
          s,
          `You changed ${m.value.touched.join(", ")}, which you may not change. It was put back. Change the code instead.`,
        );
      }
      const { diff, changed, snapshot } = m.value;
      if (!m.value.passed) return startDiagnosing(s, s.deviations, { step: "check", diff, output: m.value.output });
      return [
        { phase: "checking_fresh", ...working(s), deviations: s.deviations, seen: { diff, changed, snapshot } },
        [freshCheck({})],
      ];
    },
    check_err: (s): Step =>
      s.phase === "checking"
        ? park(s, { kind: "could_not_run", step: "check", deviations: s.deviations })
        : stay(s),
    fresh_check_ok: (s, m): Step => {
      if (s.phase !== "checking_fresh") return stay(s);
      return m.value.passed
        ? startReview(s, s.seen)
        : startDiagnosing(s, s.deviations, { step: "fresh", diff: s.seen.diff, output: m.value.output });
    },
    diagnose_ok: (s, m): Step => (s.phase === "diagnosing" ? diagnosed(s, m.value.cause) : stay(s)),
    // A reader that failed cannot say the builder is blameless: the work goes back, as before reading.
    diagnose_err: (s): Step => (s.phase === "diagnosing" ? diagnosed(s, null) : stay(s)),
    fresh_check_err: (s): Step =>
      s.phase === "checking_fresh"
        ? park(s, { kind: "could_not_run", step: "fresh", deviations: s.deviations })
        : stay(s),
    route_ok: reviewCell,
    route_err: reviewCell,
    inspect_ok: reviewCell,
    inspect_err: reviewCell,
    match_ok: reviewCell,
    match_err: reviewCell,
    fetch_comments_ok: (s, m): Step =>
      s.phase === "finishing" && !s.fetched ? fetched(s, m.value.comments) : stay(s),
    fetch_comments_err: (s): Step =>
      s.phase === "finishing" && !s.fetched ? park(s, { kind: "tracker_failed", deviations: s.deviations }) : stay(s),
    weigh_ok: (s, m): Step => {
      const { key, reading } = m.value;
      if (s.phase !== "finishing" || !s.comments.some((c) => c.id === key && c.state.kind === "reading")) return stay(s);
      return settleFinish({ ...s, comments: withState(s.comments, key, afterReading(reading)) });
    },
    // A reader that failed cannot clear a comment: a person reads it instead. The
    // error names its comment; one that does not hands every unread one to a person.
    weigh_err: (s, m): Step => {
      if (s.phase !== "finishing") return stay(s);
      const key = "key" in m.error && typeof m.error.key === "string" ? m.error.key : null;
      const comments = s.comments.map((c) =>
        c.state.kind === "reading" && (key === null || c.id === key)
          ? { ...c, state: { kind: "open" as const, reading: { kind: "unread" as const } } }
          : c,
      );
      return settleFinish({ ...s, comments });
    },
  },
});
