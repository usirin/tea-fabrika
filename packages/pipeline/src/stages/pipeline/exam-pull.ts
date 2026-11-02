import {type CriterionId, criterionId} from "../../ids.ts";
import type {ExamChange} from "../exam/machine.ts";

// The exam's pull request, reviewed before a person is asked to merge it (self-fix PR 10, Part 2).
// Today's version.
//
//   exam  ->  exam_review  ->  ask: exam_merge  ->  exam_merge  ->  test_writer
//
//   The exam writer's rule changes go on a pull request of their own. Its criteria are made here, by
//   code, from the plan's `exam` list: one per change, in the plan's order, never by an agent.
//
//   examCriteria([{path: ".oxlintrc.json", change: "turn on no-floating-promises", why: "..."}])
//   // [{id: "e1", version: 1, text: "When a reviewer reads `.oxlintrc.json` on this pull request, ..."}]

/** One of the exam pull request's criteria: the plan's words for one rule change. */
export interface ExamCriterion {
	readonly id: CriterionId;
	readonly version: number;
	readonly text: string;
}

/** The exam pull request's criteria, `e1` first, one per change the plan lists, each version 1. */
export const examCriteria = (changes: readonly ExamChange[]): readonly ExamCriterion[] =>
	changes.map((change, i) => ({
		id: criterionId(`e${i + 1}`),
		version: 1,
		text: `When a reviewer reads \`${change.path}\` on this pull request, it does this: ${change.change}, because ${change.why}`,
	}));
