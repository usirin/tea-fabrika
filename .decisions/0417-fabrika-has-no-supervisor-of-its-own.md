---
id: 0417
title: fabrika has no supervisor of its own for steps, a run is started by start_child and restarted by an OTP supervisor, and supervisor means only OTP's
status: accepted
date: 2026-10-20
tags: [pipeline, supervision, otp, names]
---

# 0417: fabrika has no supervisor of its own for steps, a run is started by start_child and restarted by an OTP supervisor, and supervisor means only OTP's

**What this decides:** who starts and restarts a run, and what the word supervisor means.

## Context

From [helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md#what-was-decided),
whose one-supervisor part was replaced 2026-10-20. [0016](0016-tier-1-supervision-is-otps-top-level-supervisor.md)
holds `next/`'s root supervisor.

## Decision

**The jobs of the old one supervisor are split by layer, each to its OTP owner.**

- Starting a run is a `DynamicSupervisor`'s `start_child`. An agent's ask for a helper is a request
  to it.
- Restarting a crashed run is an OTP supervisor's job.
- The harness and the model are the child spec, filled from `fabrika.toml`. The record is the
  ledger.
- "Supervisor" means OTP's only.

## Consequences

- In today's version this is tea-host's supervisor; in `next/`, 0016's root supervisor, and the
  merge queue starts its mergers the same way ([0110](0110-merge-queue-is-fabrika-programs.md)).
