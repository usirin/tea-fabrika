# Meeting Jev: when unsure means the question was bad

> Draft, still being written.

0.69, 0.79, 0.64, 0.77.

Those are four answers to one question, asked four times on day one of the
project. Same criterion, same diff, same small model. I had run it myself to see
how steady the thing was, and this is what I typed into the session:

> yeah i literally did the same test to see how stable/steady jev is. my tests: 0.69, 0.79, 0.64, 0.77

My first read was noise. A small, cheap model wobbles a bit, so you ask again
and take the best one. That read was wrong. Working out why it was wrong taught
me most of what I know about using a small model as a judge, and that is what
this post is about.

In [the first post](./01-v4.md) I said the loop moves into code, and that a
small classifier called Jev makes the narrow yes/no calls. Here I want to
introduce that classifier properly: what it is, how you ask it things, what it
was good and bad at in our runs, and the lesson that changed how I read its
answers. When a small model is unsure, the first thing to check is the question
you asked it.

## What Jev is

Jev is a small model from [TypeSafe](https://typesafe.ai). They call it System
One. It does not write. You send it some JSON, which they call the state, and a
list of questions about that state. For each question it picks an answer from a
list you wrote, and tells you how sure it is. There is no prose to parse and no
way for it to invent an answer you did not offer. It is billed by the token,
about $0.042 per million, and in our runs a call came back in a fraction of a
second.

The first question we ever asked it was the judge in the lane. A builder agent
has changed some code. Does that change meet one criterion of the ticket? Here
is the question as it sat in `src/judge.ts` on day one:

```ts
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
```

The state next to it is the ticket's title, the one criterion, the diff, and the
names of the tests that passed. The answer comes back as three things: the
option it picked (`met`), a share for every option, and one confidence number.

That confidence number confused me for a while, so here it is with real values.
Jev's docs give the formula: confidence is the top share, rescaled by how many
options there were, `(p_max - 1/n) / (1 - 1/n)`. With three options, a top share
of 0.90 gives `(0.90 - 0.33) / (1 - 0.33)`, which is 0.85. A top share of 0.33
would be a pure coin toss between three, and that comes out as 0. A top share of
1 comes out as 1. So confidence is just "how far from a blind guess", stretched
to fit between 0 and 1.

The everyday picture I use is a clerk in a post office sorting room. You build
the bins and label them. The clerk reads each envelope and drops it in one of
your bins, never on the floor and never in a bin you did not build. And for each
envelope she also tells you how sure she was. She cannot write you a letter. She
can only sort, quickly and very cheaply.

### Three shapes of question

Jev has three kinds of question, and our code ended up using two of them.

A `choice` picks one option from a list you define. The judge above is one. So
is the review's router in `src/route.ts`, which asks whether a change to a file
the ticket never named still serves the ticket's goal:

```ts
criteria: {
  serves: "The change is needed for the goal, or directly supports it",
  unrelated: "The change is about something else: the goal would be met without it",
},
```

A `noul` is a plain yes/no. It gives back one number, the chance of yes, and no
separate confidence, because with two answers that one number already says it
all. Our missing-file check asks one per file: "Does finishing the ticket mean
`file` has to change too?" Code then ranks the files by their yes.

A `score` places the state on a scale you describe, two to ten levels, like a
rubric. We never used it. I mention it so you know it is there.

You can put many questions in one call, and they are answered separately, side
by side. Triage's sort in `src/sort.ts` asks four in one go: what type of issue
this is, how urgent, whether an agent can pick it up as written, and whether it
is worth doing at all.

The cleanest short description I have found came later, from disler's
[ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev): one yes/no
question is "a smart if statement". The model reads. Your code owns the
threshold and decides what happens next.

## The floor

That threshold has a name in our code: the floor. If Jev's confidence is at or
above the floor, the lane acts on the answer. Below it, the answer is `unsure`,
which is its own outcome with its own path. Our first floor was 0.8.

Back in the sorting room, this is a tray on the clerk's desk marked "not sure".
Anything she is less than 80% sure about goes in the tray instead of a bin. The
interesting part is what you do with the tray, and that is where the four
numbers come back in.

## Unsure was not noise

Look at them again: 0.69, 0.79, 0.64, 0.77. They move around, but all four sit
under 0.8. Asking a fifth time would most likely have given a fifth number in
the same band. The spread was real, but it was not the story. The story was
that the model kept landing in the tray.

So instead of asking again, we went looking at what was in the tray. Every time
we looked, the input had something wrong with it. There were three kinds:

- a criterion that contradicted the code, or another criterion
- a criterion about what stayed the same
- a ticket too thin to say what done looks like

The second one is my favourite, because once you see it, the model is plainly
right. The judge only sees the diff, and a diff only holds the lines that
changed. Now hand it a criterion like "the existing tests still pass unchanged".
The lines that prove it are exactly the ones that are not in the diff. The only
honest answer is `cannot_tell`, or a weak lean in some direction. That is what
we got, and we were calling it noise.

The contradiction kind is the same thing with a different face. One of the
cases in `experiments/criterion-clarity.mjs` is a slug criterion that says
characters outside a-z and 0-9 are dropped, sitting next to one that says spaces
become single dashes. A dash is outside a-z and 0-9. Code that does one breaks
the other, so no answer about it can be a confident one.

TypeSafe's own page on confidence says it in one line, and I wish I had read it
first: "The model is telling you it does not have enough information or the
question is not a good fit." (From https://docs.typesafe.ai/confidence.)

Here is the picture I keep in my head now. You show a friend half a page and ask
"is this done?". They squint and say "probably?". Asking them again, louder,
does not help. Showing them the right half of the page does.

## Fix the question, do not ask again

Asking again is the natural reflex, and it is worth saying plainly why it does
not work. The four numbers above are what asking again looks like: a new number
from the same band, with the same problem still sitting in the input. The
earlier phoenix research I come back to below measured the same thing at a
larger size. In [#9486](https://github.com/kamp-us/phoenix/issues/9486), the
eight hardest cases were run three times each. All 24 answers matched the first
run, and the right count stayed at 3 of 8. Repeating a call buys you the same
answer again.

What worked was changing what we asked, and who wrote it. In this pipeline the
criteria are written by triage: an agent we call the enricher reads the raw
ticket and rewrites it with acceptance criteria. So the bad input was the
enricher's. That gave me the question that set up the next fix:

> can the enrichment also make sure that it writes in a way that jev can understand?

We told the enricher how its criteria get judged. The prompt now carries a short
brief (`JUDGE_BRIEF` in `src/claude.ts`). It says a small classifier will read
each criterion on its own, next to the changed lines, and nothing else. Then the
rules: one claim per criterion; say what the change makes true, never what stays
the same; no two criteria may fight; keep each one short. The examples are from
a different domain on purpose, so they teach the shape and not the answer:

> Good: "Prices are shown with two decimals." / "An empty cart shows a total of 0."
>
> Bad: "The existing price tests still pass unchanged." (about what did not change) / "Rounds prices and never shows a trailing zero or a negative total." (three claims) / "Only digits appear in the total", beside a criterion that adds a currency sign (they contradict).

On the slugify toy, with every part real (Claude Code writing the ticket and the
code, real tests, real Jev), the lane went from 0 of 3 runs finishing to 5 of 5.
Nothing changed in the judge. Only what it was asked.

The next fix went the other way: change what the judge is shown. At first it saw
only the diff. Adding the names of the tests that had passed took the
`duration-open` toy from 0 of 5 runs finishing to 8 of 10.

That one made me nervous. If the judge now sees "all tests passed", maybe it
just says `met` to anything with green tests, a rubber stamp. So we checked that
directly (`judge-rubber-stamp.mjs`): a criterion that was not done and had no
test. It said `not_met` at 0.99.

So the rule we wrote down that day was short. When the judge is unsure, fix
what it was asked, and do not ask again. An unsure verdict goes back to triage,
because triage owns the wording.
