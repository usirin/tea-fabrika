---
source: [experiments/54-why-reviews-fail.md, experiments/57-repeat-findings-read-by-hand.md]
state: draft
out: []
---

# When an agent's review fails a second time, about a third of what it finds was already there the first time. Our first count said most.

![Two bars. A rule of thumb placed 58% of the findings in a second failed review as already there and not raised. Read by hand, that 58% is 31% already there and missed, 17% new since the earlier review, 7% not a problem and 3% raised before.](./01-repeat-review-findings.svg)

An agent builds a change, an agent reviews it, the review fails, the builder
fixes it, the review fails again. How much of that second list could the
first review have written? Our quick count said 58%. Reading the cases said
about 31%.

## How we know

- We took 312 findings from 210 second and later failed reviews that agents
  wrote on a public repo. A rule of thumb sorted them by the text they quote.
  It put 181 (58%) down as already there and never raised.
- We drew 60 of the 181 at random and read each against the code before and
  after the fix. 32 were there and missed. 18 were new since the earlier
  review, 7 were not problems and 3 had been raised before.
- 32 of 60 is 53%. Of the 312 that is about 31%, somewhere from 24% to 38%.

## The catch

One reader read the 60, once. Only the 58% group was read. The 25% and the
17% beside it are still the rule of thumb's, and may be wrong too. It is one
repo, and 17 of the 32 missed findings sit in its documentation.

## So what

For half of the 181, the rule never found the quoted text in any file. It
filed them as already there because nothing said otherwise. The design note
that leaned on the 58% now says a third, and keeps the old number, marked as
wrong: [A review list can only shrink](../docs/direction/a-review-list-can-only-shrink.md).

The full take: [experiment 57](../experiments/57-repeat-findings-read-by-hand.md),
which read by hand what [experiment 54](../experiments/54-why-reviews-fail.md)
counted in its section 6.
