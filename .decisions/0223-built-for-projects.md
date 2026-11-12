---
id: 0223
title: fabrika is project machinery with agents as swappable workers, never a build pipeline with steps in front, so report, triage and planning are first-class steps
status: accepted
date: 2026-10-11
tags: [direction, projects, triage, planning, agents]
---

# 0223: fabrika is project machinery with agents as swappable workers, never a build pipeline with steps in front, so report, triage and planning are first-class steps

**What this decides:** what fabrika is for, in both versions.

## Context

Decided 2026-10-11. Pulling each agent apart into its steps left the project machinery as the core:
tickets, their order and state, the plans, the decisions, the approvals. From the note
"built for projects", since removed: this file holds its rules.

## Decision

**fabrika is project machinery, with agents as workers attached to it; it is never only a build
pipeline with some steps in front.**

- Report, triage and planning are first-class steps, never a preamble to build.
- A step machine keeps the project side in view: where the ticket came from, how it was sorted and
  planned, where decisions about it are recorded, and who is waiting on it.
- The agents are the part that can be swapped.

## Consequences

- What the pipeline knows about a project lives in a ledger that is a service of its own
  ([0231](0231-ledger-and-codehost-are-separate.md)).
