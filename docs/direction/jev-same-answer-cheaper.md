# Jev: the same answer, cheaper

Decided 2026-10-10.

## What was decided

Jev (the small classifier behind the Judge move) is not there to give better
answers than an agent. It is there to give the same answer, faster and for far
less money.

So a Jev use is measured by **agreement with what the big model decides on the
same narrow question**, plus the time and money saved. It is not measured by
accuracy against an ideal answer.

## Why

- The win is biggest where one Jev call replaces a whole agent turn: the
  machine asks a narrow question itself instead of starting an agent to think
  about it.
- Where an agent already holds the context and would answer in a few words,
  Jev adds little.

## What it means for the work

- Size a Jev question by how often it agrees with the big model at or above the
  confidence floor, and how many cases clear the floor at all.
- Below the floor (0.8 today) the answer is set aside, not acted on.
- **Jev never removes a person from a decision by itself.** In every
  measurement so far, its wrong answers lean toward skipping a person. A
  question whose wrong answer skips a person needs more text, a second check,
  or a person.
- Send the least text that answers the question, and record the text size.

## How a Jev question is built

Decided 2026-10-04 and 2026-10-05, in the first two nights. The story is in
blog posts [02](../../blog/02-meeting-jev.md), [03](../../blog/03-a-judge-that-cannot-add.md)
and [07](../../blog/07-cheap-enough-to-read-everything.md).

- **Jev reads; code works out the facts.** Never use Jev for sums, for running
  a rule on an input, for judging whether code is correct, or for a house rule
  that is not in the text it gets. If code can answer, code answers.
- **Many narrow yes/no questions, combined in code.** One broad question is
  split. Each question gets only the context it needs. Even a key name moves
  the answer, so measure the wording before shipping it.
- **A floor belongs to one question.** Measure it on that question, on cases
  with known answers that it was not chosen from. Measure again when the
  wording changes. 0.8 is the usual floor, not one floor for all.
- **The answer that does more harm gets the higher floor.** For example "this
  comment changes nothing" needs 0.9 where an ordinary reading needs 0.8.
- **An unsure answer is fixed upstream, not asked again.** If unsure keeps
  coming back on one kind of input, fix the question or the input where it is
  written (since 2026-10-18 that is the plan, not triage). Where an unsure
  answer goes is decided in code, by what a wrong answer costs: a wrong
  send-back costs one round, a wrong stop costs a person.
- **A narrow question can read a wide input.** Jev may read a whole file or
  every open ticket; code ranks, takes the top and applies the floor. Still,
  send the least text that answers.
- **Tracing is a typechecker's job.** Jev finds the file a ticket is about. A
  typechecker or a reference search finds what must change with it.
- **Probe before building a check.** Try it on real cases where the answer is
  known, then run a control with nothing wrong in it, to count false alarms.
- **Spend limits live in code**, in the one Jev helper: a cap on calls, a cap
  on dollars, a receipt at the end. Write down what a run answers, and its
  cost, before running it.

Measured in [experiment 51](../../experiments/51-jev-vs-opus.md): at 0.8 and
above Jev matched the big model on every real case seen, at roughly 1/220 of
the cost per answer. That is agreement on a small sample, not proof of
correctness.
