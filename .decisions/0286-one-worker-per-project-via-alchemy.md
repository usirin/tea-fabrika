---
id: 0286
title: In today's version, each project's ledger server is its own Worker named in its fabrika.toml, kept safe on a rename by Alchemy's retain and the default-branch read, and Alchemy deploys only long-lived things, never per-run boxes or jobs
status: accepted
date: 2026-10-25
tags: [ledger, worker, alchemy, deploy, fabrika-toml, cloudflare, todays-version]
---

# 0286: In today's version, each project's ledger server is its own Worker named in its fabrika.toml, kept safe on a rename by Alchemy's retain and the default-branch read, and Alchemy deploys only long-lived things, never per-run boxes or jobs

**What this decides:** how a project's ledger server is deployed and named.

```toml
[ledger]
name = "acme-ledger"   # the project's Worker. A new name is a new, empty server.
```

## Context

Decided by the owner in
[the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md), from
experiments 146 and 147. Built in `packages/ledger-server`. In `next/`, every platform piece goes
through Alchemy ([0042](0042-platform-pieces-go-through-alchemy.md)).

## Decision

**One Worker per project, declared and deployed with Alchemy.**

- Each project's server is its own Worker with its own deploy, named by `[ledger] name` in the
  project's `fabrika.toml`. Never one Worker in front of every project.
- A rename is kept safe by Alchemy's `RemovalPolicy.retain()` and by reading `fabrika.toml` only
  from the default branch, never by a check of our own.
- The account's own part of the Worker's address stays out of the file.
- Alchemy is for long-lived things a person deploys, never for per-run boxes or jobs.

## Consequences

- A bad deploy or a careless rename hits one project. A new project needs a deploy, and a person
  logs in to each project's server.
