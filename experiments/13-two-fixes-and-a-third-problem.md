# 13. Both fixes, and a third problem they uncovered

Fix one: the enricher is told that a rule the finished code must follow gets a
criterion even when the starting code follows it by accident. Fix two: the
enricher writes a one-line goal, and the judge sees that instead of the title.

Fix one worked outright. The enricher wrote 63 criteria instead of 43, the
`null` rules came back, all 63 tests were sound, and the tests caught 33 of 33
broken versions (up from 27).

Fix two made things worse at first: the judge let through 15 of 63. The
enricher's goal line is long and lists the rules ("a lower-case, dash-separated
slug made only of a-z, 0-9 and dashes"), and the judge held each test to all of
it. A test of one rule looked too small. Same criterion and test, four answers
each:

| Shown beside the criterion and test | Confidence |
|---|---|
| Short line, under the key `issue` | 0.92 to 0.94 |
| Long line, under the key `issue` | 0.67 to 0.84 |
| Long line, under the key `goal` | 0.30 to 0.36 |
| Long line, under the key `about`, and the question says it is background only | 0.85 to 0.90 |

So the question now says: "`about` only says what the code is for. Judge the
test against `criterion` alone." (`questionsWithAbout` in `lib/fit.ts`.)

`13-refit-bad-tests.ts` put the reworded question to the saved bad tests of
experiment 10: still 0 of 168 accepted at 0.80, 0.85 and 0.90, worst 0.79.

Rerun with the reworded question:

- The judge let through 39 of 63: duration 31 of 42, slugify 8 of 21.
- Every one of the other 24 was a sound test the judge answered "checks" to,
  just under the floor, bar one "does not check" at 0.26.
- The tests for `null` rules score lowest. They carry a second assertion, so
  that they fail on the starting code, and the judge reads a two-assertion test
  with less confidence.

**Took from it:** the judge is safe (it has not accepted a bad test at 0.85 in
any run) and touchy (wording of the question, the key a field sits under, and
the length of a background line each move it by 0.1 to 0.6). On criteria and
tests written by agents it passes about six good tests in ten. The other four
need somewhere to go that is not a person.
