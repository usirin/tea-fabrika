import { Schema } from "effect";
import type { BuildName } from "../build/outcome.ts";
import type { ExamOutcome } from "../exam/machine.ts";
import type { MutationName } from "../mutation/outcome.ts";
import type { Name } from "../outcome.ts";
import type { PlanName } from "../plan/outcome.ts";
import type { PushOutcome } from "../push/machine.ts";
import type { ReviewName } from "../review/outcome.ts";
import type { ShipName } from "../ship/outcome.ts";
import type { SortName } from "../sort/outcome.ts";
import type { MutantsOutcome } from "../test-writer/mutants.ts";
import type { TestWriterName } from "../test-writer/outcome.ts";
import { EndOutcome } from "./outcome.ts";

// Where the lane goes when a step ends with an outcome (self-fix PR 10 and PR 11). Today's version.
//
//   ROUTES[step][name]   one row per name `step` can hand the lane: its stage's names, and the ones
//                        the lane's own step bodies make in program.ts (`MADE`). A step with no row
//                        for a name, or a row for a name it cannot say, does not compile.
//
//   ROUTES.merge["send:reviewer:no_review"]   // {_tag: "run", step: "review"}: the review again, same round
//   ROUTES.mutation["stuck:run_failed"]       // {_tag: "once"}: mutation again; twice in a row, stop
//
// A row a step's own run can fix goes to a step, a service's wait, or once: never to a stop. Only the
// rows a person decides ask, and only `done`, a reason in `FINAL` or a closed ticket ends a lane
// (docs/direction/jidoka-and-andon.md, experiment 193). The lane reads a row in `after` (./machine.ts).

/** Every step that runs a machine, in the order a ticket meets them. */
export const STEPS = [
  "triage",
  "plan",
  "exam",
  "exam_review",
  "exam_merge",
  "test_writer",
  "build",
  "mutation",
  "mutants",
  "review",
  "push",
  "merge",
] as const;

export const LaneStep = Schema.Literals(STEPS);
export type LaneStep = typeof LaneStep.Type;

/**
 * What the questions are about. `step`: a step that ended on `ask`, and may be run again.
 * `rounds_spent`: the work went back as often as it may, and a person says whether once more.
 * `exam_touched`: a build changed the test writer's files, and a person says which was wrong.
 * `exam_conflict`: main changed the test writer's files while the lane was stopped, and a person says
 * whether the test writer writes them again. `spend`: a step spent its limit, and a person says
 * whether it runs again (jidoka rows 18, 23, 40, 57).
 */
export const AskFor = Schema.Literals([
  "approve",
  "exam_merge",
  "merge",
  "step",
  "rounds_spent",
  "exam_touched",
  "exam_conflict",
  "spend",
]);
export type AskFor = typeof AskFor.Type;

/**
 * What a step sent back is handed, besides its plan: the reason it runs again. `names`: the failing
 * tests. `findings`: a review's. `comment`: one left on the pull request. `files`: the ones that
 * conflict. `mutant`: the one left alive. `nothing_changed`: the run before changed nothing.
 * `disputed`: what the builder disputes, for a fresh review (jidoka row 45).
 */
export const With = Schema.Literals(["names", "findings", "comment", "files", "mutant", "nothing_changed", "disputed"]);
export type With = typeof With.Type;

/**
 * The services that wait out a read or a keyed write that broke (the jidoka table's `wait`): the
 * tickets, the ledger's claim, the work service, the code host and the review pack. Self-fix PR 11b
 * makes each wait; until then a `wait` row stops the lane, as it did.
 */
export const Service = Schema.Literals(["tickets", "ledger", "work", "code_host", "review_pack"]);
export type Service = typeof Service.Type;

/**
 * Where the lane goes after an outcome.
 *
 *   next     the step after this one, as `NEXT` in ./machine.ts says
 *   run      that step, now, in the same round
 *   back     that step again, with what it must fix: `rounds` counts a round; `once` goes back one
 *            time, and the second time in a row asks the step's own question
 *   fresh    take main in, as a restart does, then run `step`; red at the new head goes to build
 *   once     the same step again, as a new run; the second time in a row, stop
 *   wait     the service waits it out; only a refusal reaches the lane, and stops it
 *   host     read the ticket fresh: a closed one ends `skip:closed`, an open one pauses at the step
 *   ask      a person decides
 *   stop     an andon stop, saved at this step
 *   end      the lane ends
 *   cannot   the named law shows it never arrives; if it does, the lane stops
 *
 * (The plan's sketch named `fresh`'s step `then`; a `then` key makes any value a thenable, so it is
 * `step`, as in `run` and `back`.)
 */
export const Move = Schema.Union([
  Schema.TaggedStruct("next", {}),
  Schema.TaggedStruct("run", { step: LaneStep }),
  Schema.TaggedStruct("back", {
    step: LaneStep,
    with: With,
    bound: Schema.Literals(["rounds", "once"]),
  }),
  Schema.TaggedStruct("fresh", { step: LaneStep }),
  Schema.TaggedStruct("once", {}),
  Schema.TaggedStruct("wait", { in: Service }),
  Schema.TaggedStruct("host", {}),
  Schema.TaggedStruct("ask", { for: AskFor }),
  Schema.TaggedStruct("stop", {}),
  Schema.TaggedStruct("end", { outcome: EndOutcome }),
  Schema.TaggedStruct("cannot", { law: Schema.String }),
]);
export type Move = typeof Move.Type;

const next: Move = { _tag: "next" };
export const run = (step: LaneStep): Move => ({ _tag: "run", step });

/** Back to `step` with what it must fix. `rounds`, the default, counts a round, as a build round does. */
export const back = (step: LaneStep, why: With, bound: "rounds" | "once" = "rounds"): Move => ({
  _tag: "back",
  step,
  with: why,
  bound,
});

export const fresh = (step: LaneStep): Move => ({ _tag: "fresh", step });
export const once: Move = { _tag: "once" };
const wait = (service: Service): Move => ({ _tag: "wait", in: service });
const host: Move = { _tag: "host" };
const ask = (kind: AskFor): Move => ({ _tag: "ask", for: kind });
const stop: Move = { _tag: "stop" };
const end = (outcome: EndOutcome): Move => ({ _tag: "end", outcome });
const cannot = (law: string): Move => ({ _tag: "cannot", law });

/** The names the lane's step bodies make in program.ts, on top of their stage's (experiment 193's `MADE`). */
const MADE = {
  plan: ["stuck:unchecked"],
  exam_review: ["stuck:head_moved", "send:builder:conflicts", "stuck:checks_not_run", "send:builder:checks_red"],
  build: [
    "send:builder:checks_red",
    "stuck:checks_not_run",
    "stuck:rounds_spent",
    "ask:owner:no_change",
    "ask:owner:still_red",
  ],
  review: ["ask:owner:unseen", "ask:owner:decision"],
  merge: ["stuck:merged_elsewhere"],
} as const;

type MadeAt<S extends keyof typeof MADE> = (typeof MADE)[S][number];

/** Every outcome name each step can hand the lane. */
type NamesAt = {
  readonly triage: SortName;
  readonly plan: PlanName | MadeAt<"plan">;
  readonly exam: Name<ExamOutcome>;
  readonly exam_review: ReviewName | MadeAt<"exam_review">;
  readonly exam_merge: ShipName;
  readonly test_writer: TestWriterName;
  readonly build: BuildName | MadeAt<"build">;
  readonly mutation: MutationName;
  readonly mutants: Name<MutantsOutcome>;
  readonly review: ReviewName | MadeAt<"review">;
  readonly push: Name<PushOutcome>;
  readonly merge: ShipName | MadeAt<"merge">;
};

/** One row per name each step can say, and no other. */
export type Routes = { readonly [S in LaneStep]: { readonly [N in NamesAt[S]]: Move } };

/** Every `send` ship can end with, by its printed name. */
type ShipSend = Extract<ShipName, `send:${string}`>;

/** A ship send at `exam_merge`, and where it goes (self-fix PR 10). Each `back` counts an exam round. */
export const EXAM_MERGE_SENDS = {
  /** Code first: format and checks, then a fresh review. */
  "send:reviewer:no_review": run("exam_review"),
  /** Format and checks by code; still red goes to the exam writer from there. */
  "send:builder:checks_red": run("exam_review"),
  /** Main merged into the exam branch, then the same: `exam_review` takes main in itself. */
  "send:builder:behind": fresh("exam_review"),
  "send:builder:review_failed": back("exam", "findings"),
  /** The exam writer redoes those files on main. */
  "send:builder:conflicts": back("exam", "files"),
  "send:builder:bot_comment": back("exam", "comment"),
  /** Ship again, as a new run; twice: stop, with ship's why. */
  "send:builder:ejected": once,
} as const satisfies Record<ShipSend, Move>;

/** The stops ship has at both its steps: what it could not read, what a new run reads fresh, its guard. */
const SHIP_STUCK = {
  "stuck:read_failed": wait("code_host"),
  "stuck:approval_unknown": wait("code_host"),
  "stuck:reviews_unknown": wait("code_host"),
  "stuck:proof_refused": once,
  "stuck:head_moving": once,
  "stuck:checks_stuck": once,
  "stuck:queue_silent": once,
  "stuck:enqueue_failed": once,
  "stuck:merge_failed": once,
  "stuck:merge_unknown": once,
  "stuck:criteria_unknown": cannot("each pull request the lane opens names its ticket's criteria"),
} as const satisfies Record<Extract<ShipName, `stuck:${string}`>, Move>;

/** What ship asks and skips at both its steps. A close or a draft reads the ticket fresh (row 13). */
const SHIP_ASKS = {
  "ask:owner:approval": ask("step"),
  "ask:commenter:comment": ask("step"),
  "skip:closed": host,
  "skip:draft": host,
  "skip:not_ours": cannot("the lane opened it on the person's login"),
} as const satisfies Record<Extract<ShipName, `ask:${string}` | `skip:${string}`>, Move>;

/** The rows the review stage has at both its steps, `exam_review` and `review`. */
const REVIEWED = {
  done: next,
  "done:part": next,
  "skip:merged": host,
  "skip:closed": host,
  "skip:draft": cannot("the lane's review target is its own book, never a draft"),
  "stuck:read_failed": wait("review_pack"),
  "stuck:ticket_unknown": wait("review_pack"),
  "stuck:diff_unknown": wait("review_pack"),
  "stuck:kinds_unknown": wait("review_pack"),
  "stuck:checks_unknown": wait("review_pack"),
  "stuck:no_criteria": cannot("the plan's Check needs a Property, and each one is a criterion"),
  // Row 55's guard, the rubrics folder checked as the lane starts, is not built yet: a stop till then.
  "stuck:rubric_unknown": stop,
  "stuck:draft_failed": once,
  "stuck:over_budget": ask("spend"),
  "stuck:checks_stuck": once,
} as const satisfies Partial<Record<ReviewName, Move>>;

export const ROUTES = {
  triage: {
    // Triage closed it, as a no or a duplicate: done, and nobody is next.
    done: end({ kind: "done", part: false }),
    "done:part": end({ kind: "done", part: false }),
    "send:plan:yes": next,
    "send:plan:fold": next,
    "send:research:yes": end({ kind: "skip", why: "research" }),
    "ask:owner:ruling": ask("step"),
    "skip:closed": end({ kind: "skip", why: "closed" }),
    "stuck:read_failed": wait("tickets"),
    "stuck:write_failed": wait("tickets"),
    "stuck:draft_failed": once,
    // The words changed while it sorted: sort again on the new words.
    "stuck:changed": once,
    "stuck:over_budget": ask("spend"),
    "stuck:unchecked": stop,
  },
  plan: {
    done: next,
    "done:part": next,
    // A plan with open questions goes to the same yes: the person reads them there.
    "ask:owner:questions": ask("approve"),
    "skip:closed": end({ kind: "skip", why: "closed" }),
    "stuck:read_failed": wait("tickets"),
    "stuck:draft_failed": once,
    "stuck:cut_off": once,
    "stuck:over_budget": ask("spend"),
    "stuck:unchecked": stop,
  },
  exam: {
    done: next,
    "done:part": next,
    // Its pull request is open: the lane's own review reads it first, the person after (PR 10).
    "ask:owner:check_change": run("exam_review"),
    "skip:no_rules_change": next,
    "stuck:draft_failed": once,
    "stuck:land_failed": wait("code_host"),
    "stuck:unchecked": stop,
  },
  exam_review: {
    ...REVIEWED,
    // The exam's review, its checks or its merge with main failed: the exam writer, in its rounds.
    "send:builder:review_failed": back("exam", "findings"),
    "send:builder:checks_red": back("exam", "names"),
    "send:builder:no_ticket": back("exam", "findings"),
    "send:builder:conflicts": back("exam", "files"),
    // The lane asks no question on the exam's review: a stop, with its why.
    "stuck:unseen": stop,
    // Someone rewrote the rule changes' branch: the lane does not guess which stands.
    "stuck:head_moved": stop,
    "stuck:checks_not_run": once,
  },
  exam_merge: {
    ...EXAM_MERGE_SENDS,
    ...SHIP_STUCK,
    ...SHIP_ASKS,
    done: next,
    "done:part": next,
  },
  test_writer: {
    done: next,
    "done:part": next,
    // Rows 28, 29 and 35: back to the writer one time with what failed, then its own question.
    "ask:owner:fails_on_base": back("test_writer", "names", "once"),
    "ask:owner:already_passes": back("test_writer", "names", "once"),
    "stuck:no_result": back("test_writer", "names", "once"),
    "ask:owner:cannot_test": ask("step"),
    "skip:no_properties": next,
    "stuck:read_failed": wait("work"),
    "stuck:record_failed": wait("tickets"),
    "stuck:commit_failed": once,
    "stuck:draft_failed": once,
    "stuck:cut_off": once,
    "stuck:run_failed": once,
    "stuck:unchecked": stop,
  },
  build: {
    done: next,
    "done:part": next,
    "skip:closed": host,
    "skip:merged": host,
    "skip:not_ready": cannot("the lane's yes writes the approval before build starts"),
    "stuck:read_failed": wait("tickets"),
    "stuck:no_criteria": cannot("in the lane, the plan's Properties are the criteria"),
    "stuck:criteria_unknown": cannot("in the lane, the plan's Properties are the criteria"),
    "stuck:copy_failed": once,
    "stuck:draft_failed": once,
    "stuck:over_budget": ask("spend"),
    // Row 41: once more, told it changed nothing, then its own question.
    "stuck:no_change": back("build", "nothing_changed", "once"),
    "stuck:push_failed": cannot("the lane's build never pushes: push is its own step"),
    "stuck:open_failed": cannot("the lane's build opens nothing: push is its own step"),
    // A builder never changes its exam: a person says which was wrong.
    "stuck:exam_touched": ask("exam_touched"),
    // Code's checks at its head are red: back a round up, with each failing test.
    "send:builder:checks_red": back("build", "names"),
    // They could not run, after one more try: never guessed green.
    "stuck:checks_not_run": stop,
    "stuck:rounds_spent": ask("rounds_spent"),
    // Row 45: green, and the builder changed nothing: a fresh review reads what it disputes.
    "ask:owner:no_change": back("review", "disputed", "once"),
    // Row 46: another round with the failing names, until the rounds are spent.
    "ask:owner:still_red": back("build", "names"),
  },
  mutation: {
    done: next,
    "done:part": next,
    "send:test_writer:mutant_survived": run("mutants"),
    // The head's own tests fail by the mutation step's run: the builder gets them by name.
    "send:builder:tests_red": back("build", "names"),
    "ask:owner:check_change": ask("step"),
    "skip:no_lines": next,
    "stuck:read_failed": wait("work"),
    "stuck:run_failed": once,
  },
  mutants: {
    done: next,
    "done:part": next,
    "ask:owner:disable": ask("step"),
    // A new test missed its mutant: the writer again, with that mutant, as a round.
    "stuck:not_killed": back("mutants", "mutant"),
    "stuck:run_failed": once,
  },
  review: {
    ...REVIEWED,
    // A finding needs a test, and the builder cannot add one: the writer goes first.
    "send:builder:review_failed": back("test_writer", "findings"),
    "send:builder:checks_red": back("test_writer", "names"),
    "send:builder:no_ticket": back("test_writer", "findings"),
    "stuck:unseen": cannot("the lane turns review's unseen into ask:owner:unseen"),
    "ask:owner:unseen": ask("step"),
    "ask:owner:decision": ask("step"),
  },
  push: {
    done: next,
    "done:part": next,
    "stuck:push_failed": wait("work"),
    "stuck:open_failed": wait("code_host"),
    "stuck:post_failed": wait("code_host"),
  },
  merge: {
    ...SHIP_STUCK,
    ...SHIP_ASKS,
    // Row 62: to build, the next round, with ship's words.
    "send:builder:review_failed": back("build", "findings"),
    "send:builder:checks_red": back("build", "names"),
    "send:builder:bot_comment": back("build", "comment"),
    // Row 62: main taken in first; a clean result with green checks runs merge again, with no round.
    "send:builder:conflicts": fresh("merge"),
    "send:builder:behind": fresh("merge"),
    "send:builder:ejected": once,
    // Row 63: the review again, at the pull request's head, in the same round.
    "send:reviewer:no_review": run("review"),
    // Someone else merged it: what landed is theirs, and the lane ends on it.
    "stuck:merged_elsewhere": end({ kind: "stuck", why: "merged_elsewhere" }),
    done: next,
    "done:part": next,
  },
} as const satisfies Routes;
