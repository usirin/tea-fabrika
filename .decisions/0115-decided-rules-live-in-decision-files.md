---
id: 0115
title: A decided rule lives in a decision file, and the plan check lists the decisions a plan touches
status: amended-in-part by [0130](0130-every-piece-of-knowledge-has-one-home.md)
date: 2026-11-11
tags: [decisions, direction, notes, plan, sweep, discovery, agents]
---

# 0115: A decided rule lives in a decision file, and the plan check lists the decisions a plan touches

**What this decides:** every rule the owner decided, and that is still true, lives in a decision
file in `.decisions/`, moved out of the long note that holds it today, and the plan check prints
the decisions a plan's words touch.

## Context

Agents kept asking the owner about things already decided, and stating things a later decision had
changed. Two causes were found on 2026-11-11. First, many decided rules sit only inside long notes
under `docs/direction/`: [an inventory](../experiments/271-direction-notes-to-decision-files.md) found 85 decided or partly decided notes whose rules no
decision file holds. A search that lists `.decisions/` never sees them. Second, "search what is
settled first" is prose in [AGENTS.md](../AGENTS.md#before-you-design-anything), and prose is
skipped. [0001](0001-decisions-live-in-the-repo.md) and
[0008](0008-decision-discovery-is-the-agents-md-contract.md) already say decisions live in
`.decisions/` and are found by file name and frontmatter. This closes the gap between that rule and
the notes. Ticket 767 tracks the work.

## Decision

**A rule the owner decided, and that still holds, lives in a decision file in `.decisions/`; a note
keeps the long reasoning and links the file.**

- Each decided rule in a `docs/direction/` note moves into a decision file, with the date it was
  decided and the version it is about (`next/` or today's). The note keeps its reasoning and one
  line that links the file ([0002](0002-moving-a-decision-removes-it-from-its-source.md)).
- Rules that came from one call share one file, as its bullets. The test is the title: a rule may
  be a bullet only if the file's title would still lead an agent to open it
  ([0008](0008-decision-discovery-is-the-agents-md-contract.md)). A rule the title would hide gets
  its own file.
- Only a rule that is still true gets written. A rule a later decision replaced is written in its
  current form or left out, never as a live rule. A note that was replaced as a whole gets no
  file. The notes stay as the history.
- The writer also drops a rule that a newer decision or the code has moved past, and lists every
  rule it dropped, with the reason, in the pull request.
- A clash that no later decision settles goes to the owner as a question, not into a file.
- The move lands as seven docs pull requests, one per subject, with each one's range of numbers
  reserved before any of them opens.
- The plan check runs a sweep over the plan's words and prints the decision files they touch, as
  advice. It blocks nothing until its false alarms are measured.

## Consequences

- Listing `.decisions/` becomes a complete answer to "what is decided".
- The move is large: the inventory counts several hundred rules, which merge into far fewer files.
  The order puts everyday `next/` design rules first and rules only today's UI work reads last.
- The cost: the inventory compared rules with decision files and other notes, not with the code.
  A rule the code has left behind is caught only by the writer's own read.
- Not decided here: whether the sweep ever blocks.
