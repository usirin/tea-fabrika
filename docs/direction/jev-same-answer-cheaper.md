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

Measured in [experiment 51](../../experiments/51-jev-vs-opus.md): at 0.8 and
above Jev matched the big model on every real case seen, at roughly 1/220 of
the cost per answer. That is agreement on a small sample, not proof of
correctness.
