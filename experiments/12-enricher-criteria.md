# 12. The enricher's own criteria

`12-enricher-criteria.ts`. Every run so far used criteria written by hand. Here
the front of the lane runs on the raw ticket ("slugs look wrong"): the enricher
writes the criteria, the test-writer writes the tests, the judge reads them.
The enricher is now told to write one claim per criterion with a worked
example. Three runs per toy, 43 criteria.

- Every criterion came back as one claim with an example, bar one.
- All 43 tests were sound: none wrong on correct code, none already passing on
  the starting code, none missing.
- The judge at 0.85 let through 31 of 43: duration 26 of 27, slugify 5 of 16.
- The tests caught 27 of 33 broken versions: slugify 15 of 15, duration 12 of 18.

Two things went wrong, and both trace back to what we told the agents.

**The enricher dropped two real rules.** Every duration run left out "units out
of order return null" and "an unknown unit returns null". Those are the 6
broken versions nobody caught. The likely cause is our own instruction: never
write a criterion whose test would pass before any code is written. The
starting code returns `null` for everything, so the enricher left the `null`
rules out. A rule made to keep empty tests out pushed real requirements out.

**The ticket title moves the judge.** The same slugify criterion and test that
scored 0.94 to 0.98 with hand-written input scored 0.55 to 0.80 here.
`12-title-probe.ts` isolates it, four answers each:

| Title shown with the criterion and test | Confidence |
|---|---|
| States the goal: "slugify turns a title into a URL slug" | 0.93 to 0.97 |
| States the bug: "slugify returns the title unchanged instead of a URL-safe slug" | 0.58 to 0.84 |
| No title | 0.65 to 0.79 |

The enricher writes bug-shaped titles, because that is what a ticket title
usually is. The judge needs to know what the thing is for.

**Took from it:** show the judge a one-line goal, not the ticket title. And the
"must fail first" rule belongs to the test, not the criterion: a rule that is
already true of the starting code still gets a criterion, and its test fails
first by also asserting a case that works.
