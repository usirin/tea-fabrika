import { type Name, outcomesOf } from "../outcome.ts";

// What the mutation step hands back, in the shape every stage uses
// (`../outcome.ts`). Which mutants survived, and which changes the owner is
// asked about, are in the report.

const mutation = outcomesOf({
  /** Every mutant it ran was killed, or none was made. */
  done: {},
  /**
   * `mutant_survived`: at least one mutant survived. Each goes to the test writer's mutants job.
   * `tests_red`: the repo's own tests fail at the head, so no mutant can be graded. The builder
   * gets each failing test by name, in the report.
   */
  send: { test_writer: ["mutant_survived"], builder: ["tests_red"] },
  /** `check_change`: the diff adds a disable comment, or edits the ignorer. The exam is the owner's. */
  ask: { owner: ["check_change"] },
  /** `no_lines`: the build changed no source line and no kept Property covers one. */
  skip: ["no_lines"],
  /** Stop, never guess. `read_failed`: the diff could not be read. `run_failed`: the tests or Stryker could not run. */
  stuck: ["read_failed", "run_failed"],
});

export const MutationOutcome = mutation.schema;
export type MutationOutcome = typeof MutationOutcome.Type;
export type MutationName = Name<MutationOutcome>;
export const MUTATION_NAMES = mutation.names;
export const isMutationName = mutation.isName;
