# Experiment log

What we tried, what came back, and what we took from it. Newest last. Every
number here came from a real run against Jev and, where it says so, Claude Code.
The samples are small and the two toys are tiny, so read these as hints, not
proof.

Guesses that turned out wrong are left in on purpose.

## The setup

Two toys under `fixtures/`: `slugify` (three rules) and `duration`
(`parseDuration`, six rules). `toys.ts` holds, for each toy, one correct
implementation and several broken on purpose, each breaking one criterion. That
is what gives a case a known answer: run the real tests and see.

Jev is a small classifier. It answers a multiple-choice question about some
JSON and returns a confidence between 0 and 1. The lane acts on an answer only
when the confidence is at or above a floor.

## 1. Is Jev's low confidence just noise?

`criterion-clarity.mjs`

Asking the same question four times gave 0.69, 0.79, 0.64, 0.77. That looked
like noise. It was not. Low confidence followed bad input every time we looked:

- a criterion that contradicted the code or another criterion
- a criterion about what stayed the same (the judge only sees changed lines)
- a thin ticket

**Took from it:** when the judge is unsure, fix what it was asked, do not ask
again. So an unsure verdict should go back to triage, which owns the wording.

## 2. Tell the enricher how the judge reads

`src/claude.ts`, `JUDGE_BRIEF`

The enricher (the agent that rewrites a raw ticket) was told how its criteria
get judged: one claim each, about what the change makes true, never about what
is left untouched.

**Result:** slugify went from 0 of 3 runs finishing to 5 of 5.

## 3. Show the judge the passing tests

The judge was first shown only the diff. Adding the names of the tests that
passed took `duration-open` from 0 of 5 runs finishing to 8 of 10.

`judge-rubber-stamp.mjs` checked the worry that it would now say "met" to
anything with green tests. It did not: for a criterion that was not done and
had no test, it said "not met" at 0.99.

## 4. How often is the judge right at each confidence?

`judge-calibration.ts`, 87 cases, 261 answers. Question: "does this change
satisfy this criterion?"

| Confidence | Right |
|---|---|
| 0.8 and up | 218 of 221 |
| 0.7 to 0.8 | 11 of 12 |
| under 0.7 | about half |

Split by what the judge was shown:

| Shown | Right |
|---|---|
| A passing test for the criterion | 117 of 117 |
| No test, code is correct | 95% |
| No test, code is broken | about half |

The broken-and-untested group includes one case answered "met" at 0.93 to 0.95
three times in a row.

**Took from it:** the 0.8 floor is fine for this question. The weak spot is a
criterion with no test. So the rule became: every criterion needs a test.

## 5. Can Jev stand in for running the test?

The idea: write the test in prose and let Jev judge the code against it, with
nothing run. Experiment 4 had already covered most of this, because the
duration criteria carry an example each (`"1.5h"` returns `5400`), which makes
them prose tests in all but name.

Broken code, no test shown:

| Criteria | Answers | Sure and right | Sure and wrong | Unsure |
|---|---|---|---|---|
| With an example (duration) | 18 | 8 | 0 | 10 |
| Abstract (slugify) | 9 | 3 | 3 | 3 |

**Took from it:** with a concrete example Jev never confidently passed broken
code, but it confidently caught the bug less than half the time. A real test
run catches it every time. Small sample.

## 6. Can Jev tell whether a test checks a criterion?

`test-check-calibration.ts`, 54 hand-built tests, 324 answers. New question:
"would this test passing show the criterion is met?"

Each criterion got two honest tests and four bad ones: named after the
criterion but checking something else, the wrong expected value, related but
passing either way, and asserting nothing. A test counts as good only if it
passes on the correct code and fails on the code that breaks its criterion. The
script stops if a label disagrees with the run.

- At 0.9 and up: right 200 of 200.
- All 4 confident misses sat at 0.80 to 0.81. It accepted a bad test each time.
- It never confidently refused a good test, but at a 0.8 floor 41% of good
  tests came back unsure.
- Showing the same checks as sentences instead of code made no difference.
  (This only shows Jev reads both forms equally well. It is not experiment 5.)
- 4 of 18 good tests already pass on the starting code, because it returns
  `null` and the criterion expects `null`. So "a new test must fail first"
  cannot be a hard rule.

**Took from it:** this question works, and wants a higher floor than 0.8.

## 7. Can an agent write the tests first?

`test-writer.ts`. Claude got the starting code and the criteria, and wrote
tests. It never saw an implementation or the toy's own tests. Graded the same
hard way as experiment 6.

First run, six turns: 27 of 27 criteria got a good test. At a 0.9 floor the
judge let 17 through and was unsure on 10, all of them good.

**Took from it:** the writer is not the weak part. The judge's caution is.

## 8. Does an example in the criterion fix the caution?

Guess: the judge is unsure when the criterion is abstract, so add a worked
example to each.

**Wrong.** 3 of 9 slugify tests passed the judge with the old wording, 3 of 9
with the new. The writer picked its own inputs and ignored the example, and it
split the two-claim criterion ("punctuation and accented letters") into two
tests.

`fit-probe.ts` asked Jev about that one criterion several ways:

| What Jev was shown | Confidence |
|---|---|
| Two claims, two tests together | 0.44 to 0.54 |
| Two claims, one test covering both | 0.76 to 0.83 |
| One claim, its test | 0.82 to 0.87 |
| One claim with an example, test asserts that example | 0.90 to 0.92 |

**Took from it:** it is the whole chain that matters. One claim per criterion,
one test per criterion, and the test asserts the criterion's own example.

## 9. The three rules, given to the writer

The writer was told: exactly one test per criterion; when the criterion gives
an example, assert exactly that; add a second assertion only when the first
would pass on code that does nothing. Twelve turns.

All 48 criteria got a good test, and none passed on the starting code: for
"returns null" criteria the writer added a check that a valid input parses.

Tests the judge let through:

| Criteria | Floor 0.9 | Floor 0.85 |
|---|---|---|
| slugify, as first written | 3 of 9 | 4 of 9 |
| slugify, example added | 3 of 9 | 9 of 9 |
| slugify, one claim each with an example | 6 of 12 | 12 of 12 |
| duration | 10 of 18 | 14 of 18 |

Confidence went up across the board, but it bunches at 0.86 to 0.89, just under
the 0.9 floor.

On the hand-built tests of experiment 6, a 0.85 floor would have accepted 0 bad
tests out of 216 answers, the same as 0.9. That floor was picked after seeing
the data, so it needs a fresh set of bad tests before anyone trusts it.

## Open

- Is 0.85 a safe floor for "does this test check this criterion"? Needs new bad
  tests it has not been tuned on.
- No agent has written a bad test yet in these runs, so we have not seen the
  judge catch one written by an agent.
- The criteria in 7 to 9 were written by hand. The enricher has not been asked
  to write one claim with an example yet.
- None of this has run end to end: write tests, judge them, build, run.

## Running them

Each script needs `TYPESAFE_API_KEY`. `test-writer.ts` also needs the `claude`
CLI. Results land in `results/`; a rerun overwrites them, so earlier numbers
are in the git history.

```
node experiments/judge-calibration.ts
node experiments/test-check-calibration.ts
node experiments/fit-probe.ts
node experiments/test-writer.ts
```
