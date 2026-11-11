import { Schema } from "effect";

// A lane's steps and the kinds of question it asks, in words alone: the tracker and the host read
// them as they start, so nothing here reaches a stage (apps/fabrika/src/bundles.test.ts). The routes
// between steps are in stages/pipeline/routes.ts. Today's version.

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

/** The kind of question a lane's ask id names. */
export const askedFor = (ask: string): AskFor | null => {
  const kind = /^a-([a-z_]+)-\d+$/.exec(ask)?.[1];
  return Schema.is(AskFor)(kind) ? kind : null;
};

/** Where a spent round's `again` goes: the writer first after a review. */
const againTo = (step: LaneStep): LaneStep =>
  step.startsWith("exam") ? "exam" : step === "review" ? "test_writer" : "build";

/** The step a question resumes after the named step ended. */
export const askedStep = (kind: AskFor, step: LaneStep): LaneStep =>
  kind === "rounds_spent" ? againTo(step) : kind === "exam_conflict" ? "test_writer" : step;
