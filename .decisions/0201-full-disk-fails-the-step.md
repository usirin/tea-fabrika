---
id: 0201
title: In next/, a write that meets a full disk fails its step loudly and is counted, never dropped silently
status: accepted
date: 2026-11-07
tags: [durable-objects, storage, sqlite-full, failure, let-it-crash, next]
---

# 0201: In next/, a write that meets a full disk fails its step loudly and is counted, never dropped silently

**What this decides:** when a Durable Object in `next/` is full, the write that hit the wall fails
in the open.

## Context

At its 10 GB limit a Durable Object refuses writes with `SQLITE_FULL`, while reads and `DELETE`
still work. The owner decided how fabrika answers that on 2026-11-07, from P37's questions. See
[design for bounded objects](../docs/direction/design-for-bounded-objects.md).

## Decision

**In `next/`, the write that meets `SQLITE_FULL` fails its step, the failure is counted and shown,
and nothing is dropped silently.**

- This is "let it crash", as in OTP.
- It is the second net, for a bug. The daily path never meets it, because a record rolls to a new
  part with room left before its disk fills ([0204](0204-process-record-rolls-in-parts.md)).
- So OpenTelemetry's rule that a span processor should not block still holds: a span write never
  meets a full disk on the daily path.

## Consequences

- A bug that fills a part stops work loudly instead of losing data quietly. It is still a stop.
- The same rule covers saved state from a newer fabrika: stop, never drop
  ([0227](0227-saved-state-carries-shape-number.md)).
