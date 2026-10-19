# Rethink, do not port

Decided 2026-10-04, restated 2026-10-11 for the stage machines.

## What was decided

This experiment is not a one-for-one copy of today's fabrika, and the new stage
machines are not one-for-one copies of anything: not of fabrika's skills, and
not of this repo's own older machines.

- **Today's fabrika is a map of which jobs exist.** Triage, build, review,
  ship, the stops, the approvals.
- **It does not decide how each job is built.** Each one is thought through
  again with the six moves (Gather, Act, Listen, Draft, Check, Judge).
- **Older code here is a list of lessons**, each one paid for by an
  experiment. A rethink keeps the lesson and is free to drop the shape.

## Why

- Today's fabrika was largely written by agents, as prose. Copying its shape
  would carry its accidents forward.
- This experiment may become what fabrika is. Best practice matters more than
  matching what exists.

## What it means for the work

- "fabrika does not do this" is not a reason against something, and "fabrika
  does this" is not a reason for it.
- Before rebuilding a stage, list the steps inside it today in plain words, so
  the people deciding look at the same list. Then design.
- When a choice differs from today's fabrika, say so and say why, in the
  write-up.
- For each older machine, separate the lesson worth keeping (for example: an
  approval names one exact commit; a review finding must quote a real line)
  from the shape it happens to have.
- **Write the reason next to every choice** (2026-10-04), also the ones copied
  from today's fabrika. A copied choice with no reason is a guess.

## The bar

Decided 2026-10-12.

- This repo stays an experiment until it is shown to do everything today's
  fabrika does, better, faster and cheaper. Today's fabrika works; it is only
  costly.
- A strict pipeline assumes we know what an agent will do. Those guesses are
  not 100% right, so every move from agent to code says where it helps and
  where it does not.

## Older issues and other hosts

Decided 2026-10-18.

- **This repo's experiment decisions win over older issues.** An older issue
  (for example [kamp-us/demlik#657](https://github.com/kamp-us/demlik/issues/657))
  is a source of cases, not a spec. Take what is useful from it; never test the
  experiments against it or try to make the two agree.
- **Tuval is evidence of what a host needs, not a target to stay compatible
  with.** The same as today's fabrika: it shows needs, it does not set shapes.
