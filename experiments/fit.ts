// The question the judge is asked about a test: does it really check this criterion?
import { jevQuestions } from "@demlik/tea/jev";

export const questions = jevQuestions({
  fit: {
    type: "choice",
    instructions:
      "Would this test passing show that the acceptance criterion is met? `test` is one test, as code or as a plain description of what it asserts. Go by what the test asserts, not by its name.",
    criteria: {
      checks: "The test can only pass if the code does what the criterion asks",
      does_not_check:
        "The test could pass while the criterion is unmet, or it expects a result the criterion does not ask for",
      cannot_tell: "The test and the criterion are not enough to decide",
    },
  },
});
