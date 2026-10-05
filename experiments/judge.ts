// The judge's rubric from when the lane asked Jev whether a diff met each
// criterion. The lane no longer does: its checks are tests now.
// judge-calibration.ts still measures this rubric.
import { jevQuestions } from "@demlik/tea/jev";

export const questions = jevQuestions({
  verdict: {
    type: "choice",
    instructions:
      "Does this change satisfy the acceptance criterion? `diff` is the change. `passingTests` names the tests that passed after it.",
    criteria: {
      met: "The diff does what the criterion asks, or a passing test shows that it does",
      not_met: "The diff does not do what the criterion asks, or does it wrongly",
      cannot_tell: "Neither the diff nor the passing tests are enough to decide",
    },
  },
});
