---
id: 0413
title: A Jev question is one narrow yes or no question combined with others in code, below its own measured floor its answer is set aside, and Jev never does what code can
status: accepted
date: 2026-10-05
tags: [jev, judge, checks, cost]
---

# 0413: A Jev question is one narrow yes or no question combined with others in code, below its own measured floor its answer is set aside, and Jev never does what code can

**What this decides:** how a Jev question is built, checked and kept in budget.

## Context

From [Jev, how a question is built](../docs/direction/jev-same-answer-cheaper.md#how-a-jev-question-is-built),
decided 2026-10-04 and 2026-10-05, the first two nights of the rebuild.

## Decision

**Jev reads; code works out the facts.**

- Never Jev for sums, for running a rule on an input, for judging whether code is correct, or for a
  house rule not in its text. If code can answer, code answers.
- One broad question is split into many narrow yes or no questions, combined in code, each given
  only the context it needs.
- A floor belongs to one question, measured on held-out cases with known answers, and again when
  the wording changes. The answer that does more harm gets the higher floor. Below it, the answer
  is set aside, never acted on.
- An unsure answer is fixed upstream, where the question or input is written, never asked again.
- A Jev check is probed on real cases with known answers, and on a clean control, before it is
  built.
- Spend limits live in code, in the one Jev helper: a cap on calls, a cap on dollars, and a receipt.

## Consequences

- Where an unsure answer goes is decided in code, by what a wrong answer costs.
