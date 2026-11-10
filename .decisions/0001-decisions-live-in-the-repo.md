---
id: 0001
title: Every owner decision lands in `.decisions/` the turn it is made, one file per decision
status: accepted
date: 2026-11-09
tags: [decisions, governance, docs, lead]
---

# 0001: Every owner decision lands in `.decisions/` the turn it is made, one file per decision

**What this decides:** when the owner settles something, it is written to `.decisions/NNNN-slug.md`
in the same turn, and a pull request carries it to main.

## Context

Decisions were spread across long notes in `docs/direction/`, lines in AGENTS.md and skills, and
chat. An agent had to search all of them before it asked or planned, and still asked the owner
things he had already settled. kamp-us/phoenix keeps one short file per decision in `.decisions/`,
and agents there find a ruling by its file name and title.

## Decision

**Decisions live in `.decisions/`, one short file per decision, written the turn the owner decides.**

- The file is `NNNN-slug.md`, numbered in order, in the shape [the adr skill](../.agents/skills/adr/SKILL.md) gives.
- `docs/direction/` keeps the long design notes. A decision file links its note when one exists.
- Before an agent asks the owner or writes a plan, it searches `.decisions/`, `.glossary/` and
  `docs/direction/`.
- A governance check lists the decision files a pull request's words touch, so the review step and
  the lead read them. A pull request that walks a decision back fails that check once it blocks.

## Consequences

- One place to search, and one file to cite.
- The governance check only lists files for now. Blocking comes later, once its false alarms are
  measured (AGENTS.md, "Checks").
- Old decisions are not copied in yet. Until they are, `docs/direction/` and AGENTS.md still hold
  them, and an agent searches both.
