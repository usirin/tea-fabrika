---
id: 0327
title: Each person's model login lives in their own locker and is lent to one job's box at a time, and one login is never shared between people
status: accepted
date: 2026-10-26
tags: [security, agents, login, box, cloudflare]
---

# 0327: Each person's model login lives in their own locker and is lent to one job's box at a time, and one login is never shared between people

```ts
// A sketch. One job of one person, on the shared account.
const login = yield* Locker.of(job.person).lend(job.box); // one job per person at a time
yield* Box.start(job.box, { env: { CLAUDE_CODE_OAUTH_TOKEN: login.claude } });
yield* Locker.of(job.person).back(job.box, yield* Box.read(job.box, "~/.codex/auth.json"));
```

**What this decides:** where a person's model login is kept and how a job gets it.

## Context

The owner ruled after experiment 157. From
[agents sit behind one service](../docs/direction/agents-behind-one-service.md#where-a-persons-login-lives),
and its "Still open" section, settled the same day.
[0026](0026-fabrika-never-owns-the-agent-loop.md) and [0028](0028-the-parent-holds-every-right.md)
put the login in the box as its only right; this file says where it waits between jobs.

## Decision

**A person's login waits in their own locker and goes to one box at a time.**

- Each person's locker sits on one shared Cloudflare account, chosen over one account per person.
- The locker lends the login to one job's box, one job per person at a time, and the box holds it
  itself, the way GitHub Actions and OpenAI's CI page do it.
- For Codex, the locker takes back the `auth.json` copy the box leaves.
- A job that puts a person's login in a box runs on private repositories only, as OpenAI's CI page
  asks.
- One plan login is never shared between people. Each person signs in with their own plan.
- An API key is only for a shared service or a public repository's own CI.
- A job a person runs on their own laptop uses the login on that laptop, as a self-hosted runner
  does.

## Consequences

- A box that dies right after a Codex refresh leaves a dead login, and that person signs in again.
- Not decided here: the loan's end time, built before the live run.
