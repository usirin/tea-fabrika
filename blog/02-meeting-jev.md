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
