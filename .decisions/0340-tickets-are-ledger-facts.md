---
id: 0340
title: A ticket is facts on the ledger and the tracker is a program, and only people on the ledger file or edit one
status: accepted
date: 2026-10-24
tags: [tracker, ticket, ledger, program, people, security]
---

# 0340: A ticket is facts on the ledger and the tracker is a program, and only people on the ledger file or edit one

**What this decides:** tickets live as facts on fabrika's own ledger, filed and edited through a
program's window, and nobody outside the ledger can write one.

## Context

The owner decided this on 2026-10-24, when the tracker moved into the pipeline's first version
([tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md#what-was-decided)).
Today's tracker is `programs/tracker`; in `next/` a fact is an event (the glossary's `event` row).

## Decision

**A ticket is a stream of facts on the ledger, and the tracker is a program that reads and writes
them.**

- A ticket's `filed`, `edited`, `commented` and every later step's answer are facts on that ticket's
  stream. In `next/` they are events.
- The form to file a ticket is the tracker program's window. Every window is some program's view,
  so no form exists outside a program.
- Only people on the ledger file or edit a ticket. A stranger has no way in, unlike a public
  GitHub repo, where anyone can open an issue.

## Consequences

- Who can write what an agent reads is the guard that holds against prompt injection: triage reads
  a ticket a member wrote, never text from a stranger.
- Tickets are not public. A pull request on a public repo says why it exists in its own text.
