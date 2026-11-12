---
id: 0384
title: A plan's approval records the plan version and a sha256 of the JSON pair of the ticket's title and body, never a plain join
status: accepted
date: 2026-10-24
tags: [pipeline, plan, approval, hash]
---

# 0384: A plan's approval records the plan version and a sha256 of the JSON pair of the ticket's title and body, never a plain join

```ts
// A sketch, from the note.
{ fact: "approved", ticket: "demlik-1", plan: "demlik-1", version: 2, text: "sha256:9c1f…" }
const covers = (approval: Approved, now: Ticket) =>
  approval.text === sha256(JSON.stringify([now.title, now.body]));
```

**What this decides:** what an approval of a plan binds to.

## Context

From [the plan stage, decision 9](../docs/direction/the-plan-stage.md#9-plan-writes-only-its-planned-fact),
decided 2026-10-24. Experiment 138 showed a plain join lets "ab" + "c" and "a" + "bc" share a hash.

## Decision

**An approval names the plan version and hashes the ticket's text as a JSON pair.**

- A version alone misses an edit to the ticket after the approval; the hash catches it.
- The hash is over `JSON.stringify([title, body])`, never a plain join of the two.

## Consequences

- This is the product's plan approval. The lead's approval line on a hand-run plan file
  (`body <sha256-12>`, AGENTS.md) hashes the plan's own body; it is a different record.
