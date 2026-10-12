---
source: experiments/54-why-reviews-fail.md
state: draft
out: []
---

# When an agent's review fails a second time, most of what it finds was already there the first time

![Where the findings of a second failed review came from: 58% already there and not raised, 25% raised before, 17% written by the fix](./01-repeat-review-findings.svg)

An agent builds a change, an agent reviews it, the review fails, the builder
fixes it, the review fails again. The easy story is that the builder did not
fix it properly. That was the smaller part. More than half of the time, the
second review was pointing at something that had been sitting there all along.

## How we know

- We read 707 failed reviews that agents wrote on the pull requests of a
  public repo. 218 of them were a second or later failed review on the same
  pull request.
- For 210 of those we took the exact change between the two rounds, then
  looked at what each finding quotes: a line the fix wrote, a line an earlier
  review had already quoted, or neither.
- 312 findings could be placed that way. 181 (58%) quote text that was already
  in the pull request a round earlier and that no earlier review had raised.
  79 (25%) had been raised before. 52 (17%) were about lines the fix wrote.

## The catch

The 58% comes from a rule of thumb, and only six of those findings were read
by hand: two clearly fit, one clearly did not, three could not be told. A
sentence nobody touched can also become false because of the fix, and that
is nobody's miss. Our honest read: about 60% sure the true share is over 40%.

## So what

A limit on review rounds hides this. It stops the loop without asking why it
runs. We are trying the opposite: the first review writes the whole list, and
every later round may only check that list. See
[A review list can only shrink](../docs/direction/a-review-list-can-only-shrink.md).

The full take: [experiment 54](../experiments/54-why-reviews-fail.md), section 6.
