# Built for projects

Decided 2026-10-11.

## What was decided

fabrika was never only about building code. It is good at that, but it is
built for projects, and project management is a core part of it: taking in
reports, sorting them, planning larger work into smaller tickets, recording
decisions, and knowing who must approve what.

This repo should be read the same way. It is not "a build pipeline with some
steps in front". It is project machinery, with agents as workers attached to it.

## Why

When each agent is pulled apart into its steps, what is left once the fixed
steps move to code is the project machinery: tickets, their order, their
state, the plans, the decisions, the approvals. That is the core. The agents
are the part that can be swapped.

## What it means for the work

- When designing a stage machine, keep the project side in view: where the
  ticket came from, how it was sorted and planned, where decisions about it are
  recorded, and who is waiting on it.
- Report, triage and planning are first-class stages, not a preamble to build.
- What the pipeline knows about a project lives in a ledger, and that ledger is
  a service of its own. See
  [The ledger sits behind a service](./ledger-behind-a-service.md).
