# Singles

One small finished thing at a time, cut for someone who knows nothing about
this project. An experiment is the full recorded take; a single is its best
part, short enough to take in within three minutes.

```text
experiments/57-repeat-findings-read-by-hand.md    the full take: every number, every doubt
singles/01-repeat-review-findings.md              one claim, one picture, the catch, so what
```

| # | Single | From | State | Out |
|---|---|---|---|---|
| 01 | [When an agent's review fails a second time, about a third of what it finds was already there the first time. Our first count said most.](./01-repeat-review-findings.md) | [experiment 57](../experiments/57-repeat-findings-read-by-hand.md), which read by hand a count from [experiment 54](../experiments/54-why-reviews-fail.md) | draft | |

## What makes a single

- **It stands alone.** No backstory, no project words.
- **It is small.** Made in a day or less.
- **It is out.** A single that was never released is still a draft.

## The shape of a written one

The same six parts, every time, in about 200 words:

```md
---
source: experiments/NN-name.md    # the full take it was cut from, or a list when there are two
state: draft                      # draft | out
out: []                           # where it went: [{ where, url, date }]
---

# The claim, in one line

![one picture](./NN-name.svg)

## How we know      three short bullets: what was measured, on how much
## The catch        one honest paragraph on what is soft
## So what          what changed because of it
The full take: a link to the experiment
```

The claim has to work alone as one line. **The catch is not optional**: if a
number is soft, the single says how soft, in the reader's words.

Not every single is writing. A finding is a short piece like the one above. A
moment (a pull request landing with no agent driving) is a short clip. A tool
is a link someone can run. Whatever it is, it gets a row in the table and a
file here that says where it came from and where it went out.

## Before one goes out

- Every number in it is in its source, and the source says the same.
- The catch is still true. If the number was hardened since, say so.
- Nothing in it names a person or quotes a private conversation.
- Set `state: out` and add where it went to `out`, the same day.
