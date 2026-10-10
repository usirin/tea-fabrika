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
import { createRefine, type RefineMsg, type RefineState } from "./refine.ts";
import {
  type Decided,
  Deviation,
  type Finding,
  findMissing,
  inspect,
  isOver,
  type Matched,
  match,
  type MissingOnRecord,
  type Review,
  type ReviewCmd,
  type ReviewMsg,
  type ReviewPark,
  type ReviewParkAnswer,
  review,
  route,
  Snapshot,
} from "./review.ts";
import { type ApiChange, ApiDiff, NewExports, namedIn, ruleOnApi } from "./surface.ts";

/**
 * What a lane takes from `fabrika.toml`, copied in when it starts and kept in
 * its state, so a restart replays by the numbers the lane started with.
 */
export const LaneKnobs = z.object({
  /**
   * How many builds one issue gets before a person is asked. It is also the
   * review round from which the list of findings is frozen: the last one the
   * budget allows. That round does not move when a person grants more
   * attempts, so the rounds past it stay frozen too. Fabrika freezes at the same round.
   */
  attempts: z.number(),
  /** What an unsure reading of a failed run, or a reader that failed, does: back to the builder, or a person. */
  onUnsure: z.enum(["rebuild", "park"]),
  /** Whether a published name the ticket does not name, added by the change, goes back to the builder. */
  newExports: NewExports,
});
export type LaneKnobs = z.infer<typeof LaneKnobs>;

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
 * What the builder works from. `session` is its conversation, named by the
 * lane before the first build, so a build killed halfway is picked up in the
 * same conversation and a retry remembers what it tried. `named` is what the
 * ticket itself names, beside its criteria: published names it may change.
 */
export const BuildBrief = z.object({
  issue: Issue,
  session: z.string(),
  knobs: LaneKnobs,
  named: z.array(z.string()).readonly(),
});
export type BuildBrief = z.infer<typeof BuildBrief>;

/**
 * How a build ended, in the builder's own words. `done` lists the files it
 * changed beyond the ticket; the others end the run before anything is checked.
 */
export const BuildAnswer = z.discriminatedUnion("kind", [
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
]);
export type BuildAnswer = z.infer<typeof BuildAnswer>;

/** Which run failed: the tests in the builder's folder, or on a fresh copy of the change. */
const RunStep = z.enum(["check", "fresh"]);

/**
 * What the checks saw of one build, as data. Code runs the tests and reads
 * the diff; a failed run is read by the failure reader (a Judge the check
 * calls) for whose fault it is; the published API is compared where there is
 * a package to compare. Whether any of it goes back to the builder is
 * {@link buildProblems} and {@link buildStop}, pure, in the reducer.
 */
export const BuildVerdict = z.discriminatedUnion("kind", [
  /** Locked files the builder changed. They were put back; nothing else was looked at. */
  z.object({ kind: z.literal("touched"), files: z.array(z.string()).readonly() }),
  /**
   * The tests failed, in the builder's folder or on a fresh copy of the change
   * as committed: the folder can hold files git does not, and what passes only
   * there fails anywhere else. `cause` is the reader's; `unread` when it gave none.
   */
  z.object({
    kind: z.literal("failed"),
    step: RunStep,
    output: z.string(),
    diff: z.string(),
    cause: z.enum(["change", "test_file", "environment", "unsure", "unread"]),
    api: ApiDiff,
  }),
  z.object({
    kind: z.literal("passed"),
    diff: z.string(),
    changed: z.array(z.string()).readonly(),
    snapshot: Snapshot,
    api: ApiDiff,
  }),
]);
export type BuildVerdict = z.infer<typeof BuildVerdict>;

type Failed = Extract<BuildVerdict, { kind: "failed" }>;

/**
 * Why a build run stops for the lane: the builder answered something other
 * than a change, or the tests failed and the reader is sure the builder
 * cannot fix it (the test file or the setup is broken); or, in a lane whose
 * `onUnsure` is `park`, the reader was unsure or gave no reading.
 */
export type BuildStop =
  | { readonly kind: "answered"; readonly answer: Exclude<BuildAnswer, { kind: "done" }> }
  | { readonly kind: "run_failed"; readonly step: Failed["step"]; readonly cause: Exclude<Failed["cause"], "change">; readonly output: string };

/** Pure: whether a build or its verdict stops the run for the lane. */
export function buildStop(draft: BuildAnswer, verdict: BuildVerdict | null, brief: BuildBrief): BuildStop | null {
  if (verdict === null) return draft.kind === "done" ? null : { kind: "answered", answer: draft };
  if (verdict.kind !== "failed" || verdict.cause === "change") return null;
  const sure = verdict.cause === "test_file" || verdict.cause === "environment";
  return sure || brief.knobs.onUnsure === "park"
    ? { kind: "run_failed", step: verdict.step, cause: verdict.cause, output: verdict.output }
    : null;
}

/** What the builder is told about a failed run that goes back to it. */
const failedRun = ({ step, output }: Failed): string =>
  step === "check"
    ? `Tests failed:\n${output}`
    : `The tests pass in your folder but fail on a fresh copy of your change, so it needs something git does not hold: a file that is ignored or was never added. Add it, or stop depending on it. The fresh run:\n${output}`;

/** How the published-API policy reads a verdict, for this brief. */
const apiRuling = (api: ApiDiff, brief: BuildBrief) => ruleOnApi(api, namedIn(brief.issue, brief.named), brief.knobs.newExports);

/** Pure: what goes back to the builder. None, and the change goes on to review. */
export function buildProblems(_draft: BuildAnswer, verdict: BuildVerdict, brief: BuildBrief): readonly string[] {
  switch (verdict.kind) {
    case "touched":
      return [`You changed ${verdict.files.join(", ")}, which you may not change. It was put back. Change the code instead.`];
    case "failed":
      return [failedRun(verdict), ...apiRuling(verdict.api, brief).problems];
    case "passed":
      return apiRuling(verdict.api, brief).problems;
  }
}

/**
 * The build loop: the builder drafts a change (or answers why it will not),
 * the checks judge it, and what they find goes back to the builder in its own
 * conversation, one attempt each, until it passes or the attempts are spent.
 * Cmds `build_write` and `build_check`.
 */
export const building = createRefine({
  name: "build",
  brief: BuildBrief,
  draft: BuildAnswer,
  verdict: BuildVerdict,
  problemsOf: buildProblems,
  stopOf: buildStop,
  feedback: (problems) => problems.join("\n\n"),
});

/** The build loop's state, as the lane holds it. */
export type Build = RefineState<BuildBrief, BuildAnswer, BuildVerdict, BuildStop>;
type BuildCmd = ReturnType<typeof building.write> | ReturnType<typeof building.check>;

/** Why a lane stopped and is waiting on a person. Review's own parks live in review. */
export type ParkCause =
  /** Rules no call can show yet: a check for their kind does not exist. */
  | { readonly kind: "unchecked"; readonly criteria: readonly string[] }
  /** Examples whose tests did not run at all on the untouched code: a call that does not parse, say. */
  | { readonly kind: "tests_broken"; readonly missing: readonly string[]; readonly output: string }
  /** Every example already holds on the untouched code. */
  | { readonly kind: "nothing_to_build"; readonly passing: readonly string[] }
  | { readonly kind: "could_not_run"; readonly step: "prepare" }
  /** The checks could not run. `build` is the run, stopped there: a retry checks the same change again. */
  | { readonly kind: "could_not_run"; readonly step: "check"; readonly build: Build }
  /** The build run stopped on a failed run (see {@link BuildStop}); its output is shown, and `build` checks again on retry. */
  | {
      readonly kind: "run_failed";
      readonly step: Failed["step"];
      readonly cause: Exclude<Failed["cause"], "change">;
      readonly output: string;
      readonly build: Build;
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
      readonly missing: MissingOnRecord;
    }
  /** The comments could not be fetched, so the lane cannot know it is done. */
  | { readonly kind: "tracker_failed"; readonly deviations: readonly Deviation[]; readonly missing: MissingOnRecord }
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
   * `retry`: a person fixed what broke; run the checks again, on the same
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
  readonly knobs: LaneKnobs;
  /** What the ticket itself names, beside its criteria: published names a change may alter. */
  readonly named: readonly string[];
  /** Builds charged to the budget. One a person says was not the builder's fault is given back. */
  readonly attempt: number;
  /** Every build the builder finished, given back or not: what the lane really cost. */
  readonly builds: number;
  /** How many attempts this lane may have: `knobs.attempts` at the start; a person can raise it. */
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
  /** Published names the last change that passed its checks altered, all named by the ticket: listed for the person who approves. */
  readonly published: readonly ApiChange[];
};

const working = (s: Working): Working => ({
  issue: s.issue,
  knobs: s.knobs,
  named: s.named,
  attempt: s.attempt,
  builds: s.builds,
  limit: s.limit,
  session: s.session,
  open: s.open,
  notes: s.notes,
  withdrawn: s.withdrawn,
  matched: s.matched,
  comments: s.comments,
  published: s.published,
});

/** What the build loop works from, for a lane in `s`. */
const briefOf = (s: Working): BuildBrief => ({ issue: s.issue, session: s.session, knobs: s.knobs, named: s.named });

/** Everything a person settled so far, as review is told it. */
const decidedOf = (s: Working): readonly Decided[] => [
  ...s.notes.map((f) => ({ ...f, decision: "filed" as const })),
  ...s.withdrawn.map((f) => ({ ...f, decision: "withdrawn" as const })),
];

export type Lane =
  | { readonly phase: "idle" }
  /** `feedback` is for the build that follows: set when the tests are rewritten after a build. */
  | (Working & { readonly phase: "preparing"; readonly feedback: string | null })
  /** The build loop, held as a child: build, check, back to the builder, until it passes or stops. */
  | (Working & { readonly phase: "building"; readonly build: Build })
  /** The review machine, held as a child until it ends. */
  | (Working & { readonly phase: "reviewing"; readonly review: Review })
  /**
   * The work passed; the owner's comments are read before it counts as done.
   * `fetched` says the tracker has answered, so a restart asks only for what is still out.
   * `missing` is how the passing round's missing-file check went.
   */
  | (Working & {
      readonly phase: "finishing";
      readonly deviations: readonly Deviation[];
      readonly missing: MissingOnRecord;
      readonly fetched: boolean;
    })
  /**
   * `deviations` are the extra changes that stayed, and `missing` how the
   * missing-file check went, for the person who reads the result.
   */
  | (Working & { readonly phase: "done"; readonly deviations: readonly Deviation[]; readonly missing: MissingOnRecord })
  | (Working & { readonly phase: "parked"; readonly why: ParkCause })
  | (Working & { readonly phase: "dropped"; readonly why: ParkCause | ReviewPark });

export type LaneMsg =
  /**
   * `session` names the builder's conversation, `knobs` come from the
   * settings, and `named` is what the ticket itself names; the host makes
   * them, so the reducer stays pure.
   */
  | {
      readonly type: "start";
      readonly issue: Issue;
      readonly session: string;
      readonly knobs: LaneKnobs;
      readonly named: readonly string[];
    }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  /** A person's answer to a park: the lane's own, or review's while it reviews. */
  | { readonly type: "answer"; readonly answer: ParkAnswer | ReviewParkAnswer; readonly at: number };

export type LaneCmd =
  | ReturnType<typeof prepare>
  | BuildCmd
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

/**
 * Step the build loop with `msg`, and read it after: a change that passed
 * goes to review; a run that stopped parks, or goes back to the builder; one
 * still going stays. The lane's count of attempts is the loop's count of tries.
 */
function toBuild(s: Building, msg: AnyMsg): Step {
  // Counted where the answer lands, so a build re-sent after a restart counts once.
  const built = s.build.phase === "writing" && msg.type === building.write.okType;
  const [child, cmds] = applyCell<Build, AnyMsg, BuildCmd>(building.machine, s.build, msg);
  const next: Working = { ...working(s), builds: s.builds + (built ? 1 : 0), attempt: "tries" in child ? child.tries : s.attempt };
  switch (child.phase) {
    case "done":
      return child.draft.kind === "done" && child.verdict?.kind === "passed"
        ? startReview(next, child.draft.deviations, child.verdict)
        : // Only a passing verdict ends a run done: the lane never takes a build unchecked.
          [{ phase: "building", ...next, build: child }, cmds];
    case "stopped":
      return child.reason.kind === "answered"
        ? answered(next, child.reason.answer)
        : park(next, { ...child.reason, build: child });
    case "write_failed":
      return park(next, { kind: "builder_failed" });
    case "check_failed":
      return park(next, { kind: "could_not_run", step: "check", build: child });
    case "out_of_tries":
      return park(next, { kind: "out_of_attempts", feedback: child.problems.join("\n\n") });
    default:
      return [{ phase: "building", ...next, build: child }, cmds];
  }
}

/**
 * Start a run of the build loop on attempt `tries`. Only a lane's very first
 * build starts a new conversation; every other one continues it.
 */
function startBuilding(s: Working, note: string | null, tries: number): Step {
  const start: RefineMsg<BuildBrief> = {
    type: "start",
    brief: briefOf(s),
    session: s.builds > 0 ? s.session : null,
    note,
    limit: s.limit,
    tries,
  };
  return toBuild({ phase: "building", ...working(s), build: { phase: "idle" } }, start);
}

/** Build again, one attempt further on. */
const rebuild = (s: Working, feedback: string): Step => startBuilding(s, feedback, s.attempt + 1);

/** Build again on the same attempt: the last build was not the builder's fault. */
const buildAgain = (s: Working, feedback: string | null): Step => startBuilding(s, feedback, s.attempt);

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
  return startBuilding(s, s.feedback, s.attempt);
}

/** The builder answered something other than a change: say why to a person, or send it back when the answer names nothing real. */
function answered(s: Working, answer: Extract<BuildStop, { kind: "answered" }>["answer"]): Step {
  switch (answer.kind) {
    case "contradiction":
      return contradicted(s, answer);
    case "blocked":
      return park(s, { kind: "builder_blocked", why: answer.why });
    case "dispute":
      return disputed(s, answer);
  }
}

/** The builder says an example breaks its rule. Park on it if the example is real. */
function contradicted(s: Working, answer: { readonly criterion: string; readonly call: string; readonly why: string }): Step {
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
function disputed(s: Working, answer: { readonly finding: string; readonly why: string }): Step {
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
        child.missing,
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
const finishing = (s: Working, deviations: readonly Deviation[], missing: MissingOnRecord): Step => [
  { phase: "finishing", ...working(s), deviations, missing, fetched: false },
  [fetchComments({ issue: s.issue.id })],
];

/**
 * Done once every comment is read and none is left for a person. The first
 * open one parks, with the rule it may change beside it.
 */
function settleFinish(s: Finishing): Step {
  if (s.comments.some((c) => c.state.kind === "reading")) return stay(s);
  const open = s.comments.find((c) => c.state.kind === "open");
  const { deviations, missing } = s;
  if (open === undefined) return [{ phase: "done", ...working(s), deviations, missing }, []];
  const reading = open.state.kind === "open" ? open.state.reading : undefined;
  const criterion =
    reading?.kind === "changes" ? (s.issue.criteria.find((c) => c.id === reading.criterion) ?? null) : null;
  return park(s, { kind: "comment_changes_rule", comment: open, criterion, deviations, missing });
}

/** The tracker answered: read each comment not seen before, or settle if there is none. */
function fetched(s: Finishing, comments: readonly { readonly id: string; readonly text: string }[]): Step {
  const fresh = unseen(s.comments, comments);
  const next = { ...s, fetched: true, comments: [...s.comments, ...fresh] };
  return fresh.length === 0 ? settleFinish(next) : [next, fresh.map((c) => weighFor(s.issue, c))];
}

/**
 * The change passed every check: hand it to review, with what the builder
 * said it changed beyond the ticket. The published names it altered that the
 * ticket names are kept for the person who approves.
 */
function startReview(s: Working, deviations: readonly Deviation[], seen: Extract<BuildVerdict, { kind: "passed" }>): Step {
  const next = { ...working(s), published: apiRuling(seen.api, briefOf(s)).allowed };
  const msg: ReviewMsg = {
    type: "start",
    input: {
      issue: s.issue,
      // Each review follows a build of its own, so the build count never repeats a round.
      round: s.builds,
      diff: seen.diff,
      changed: seen.changed,
      snapshot: seen.snapshot,
      deviations,
      open: s.open,
      decided: decidedOf(s),
      frozen: s.attempt >= s.knobs.attempts,
    },
  };
  return toReview({ phase: "reviewing", ...next, review: { phase: "idle" } }, msg);
}

/** A run of the build loop a park holds, checked again: a person fixed what stopped it. */
function recheck(s: Working, build: Build): Step {
  const retry: RefineMsg<BuildBrief> = { type: "answer", answer: { kind: "retry" } };
  return toBuild({ phase: "building", ...working(s), build }, retry);
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
      return toBuild(s, { type: "resume" });
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
      return finishing(s, [], { kind: "no_change" });
    case "could_not_run":
      return s.why.step === "prepare" ? startPreparing(s) : recheck(s, s.why.build);
    case "run_failed":
      return answer.kind === "retry"
        ? recheck(s, s.why.build)
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
      return finishing(s, s.why.deviations, s.why.missing);
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
  if (answer.kind === "note") return finishing(settled, why.deviations, why.missing);
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

/** A build-loop Msg goes to the child while it builds; anywhere else it is late, and changes nothing. */
const buildCell = (s: Lane, m: AnyMsg): Step => (s.phase === "building" ? toBuild(s, m) : stay(s));

/**
 * One issue, from "start" to done or parked: write its tests, build and check
 * (the build loop), review. Every cell ignores a Msg that arrives in a phase it
 * does not belong to, so a late answer changes nothing.
 */
export const lane = defineMachine({
  types: { model: {} as Lane, msg: {} as LaneMsg, ctx: undefined },
  cmds: [prepare, building.write, building.check, route, inspect, match, findMissing, fetchComments, weigh],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => {
      if (s.phase !== "idle") return stay(s);
      const first: Working = {
        issue: m.issue,
        knobs: m.knobs,
        named: m.named,
        attempt: 1,
        builds: 0,
        limit: m.knobs.attempts,
        session: m.session,
        open: [],
        notes: [],
        withdrawn: [],
        matched: [],
        comments: [],
        published: [],
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
    build_write_ok: buildCell,
    build_write_err: buildCell,
    build_check_ok: buildCell,
    build_check_err: buildCell,
    route_ok: reviewCell,
    route_err: reviewCell,
    inspect_ok: reviewCell,
    inspect_err: reviewCell,
    match_ok: reviewCell,
    match_err: reviewCell,
    find_missing_ok: reviewCell,
    find_missing_err: reviewCell,
    fetch_comments_ok: (s, m): Step =>
      s.phase === "finishing" && !s.fetched ? fetched(s, m.value.comments) : stay(s),
    fetch_comments_err: (s): Step =>
      s.phase === "finishing" && !s.fetched
        ? park(s, { kind: "tracker_failed", deviations: s.deviations, missing: s.missing })
        : stay(s),
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
