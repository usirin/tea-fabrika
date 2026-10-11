# 17. One broad question, or several narrow ones

`17-atomic-questions.ts`. Jev's guide says to split a broad judgment into atomic
questions, ask them in one call, and combine the answers in code. Under the
lane's rule (a test asserts its criterion's own example) the broad question
"would this test passing show the criterion is met?" is three small facts,
each asked as a yes/no (`noul`) and shown only the criterion and the test:

- `same_input`: the test calls the function with the example's input
- `same_result`: the test expects the example's result
- `exact_check`: the test compares against one exact value

A test is accepted when all three are at or above a cut. 233 saved tests, each
with a known answer from running it.

| Rule | Writer's good tests accepted | Bad tests accepted |
|---|---|---|
| Broad question, confidence 0.85 | 53 of 88 | 0 of 93 |
| Three narrow questions, all at 0.9 | 87 of 88 | 4 of 93 |
| Three narrow questions, all at 0.5 | 88 of 88 | 12 of 93 |

The narrow questions fix the caution: good tests from the test-writer score
0.98 on each, and nearly all get through, against six in ten before.

The 4 bad tests accepted at 0.9, by kind:

- 2 are not the judge's mistake. The enricher guessed that a title which is
  already a slug comes back unchanged; the reference code drops the dash. The
  test asserts the criterion's example faithfully. The criterion is what
  disagrees with the reference, and no question about the test can see that.
- 2 are real: `parseDuration("90")` expected to equal the string `"90"`. The
  criterion says only "is returned as that many seconds", with no result
  written out, so there was nothing exact to compare with.

Then the part the guide also says: keep in code what code can do. Where the
criterion carries a written example, plain string matching answers the first
two questions, and Jev agrees with it on 152 of 156 tests. "The test source
contains the example's literals, and `exact_check` is at least 0.5" accepts 88
of 88 of the writer's good tests and 2 of 93 bad ones, the two slug cases above.

**Took from it:** asked the way it was built to be asked, Jev stops sending
good tests back. And two of the three questions are not judgment at all once
the example is written down exactly, so they belong in code. What is left for a
judge is the part code cannot do: does this example really show this claim?
