---
id: 0424
title: In next/, a job that reads code runs where its config says, laptop, box or laptop first, with laptop the default, and box jobs share a daily box cap of 1 box hour to start
status: accepted
date: 2026-11-02
tags: [next, scheduled-jobs, settings, boxes, cloudflare]
---

# 0424: In next/, a job that reads code runs where its config says, laptop, box or laptop first, with laptop the default, and box jobs share a daily box cap of 1 box hour to start

**What this decides:** where a scheduled job that needs the code runs for a team.

## Context

From [scheduled jobs run on the host's alarms](../docs/direction/scheduled-jobs-on-the-host.md#still-open),
answered by the owner 2026-11-02 from [experiment 197](../experiments/197-daily-checks-on-cloudflare.md).
On Cloudflare there is no copy of the code, but a box can clone the public repo.

## Decision

**Each job's config picks where it runs.**

- The choices are `laptop`, `box` or `laptop first`. The default is `laptop`.
- On Cloudflare a job's hands can be a box that clones the public repo, one box object per batch.
- Box jobs run under a daily box cap, 1 box hour to start.
- Nothing balances jobs across machines on its own.

## Consequences

- The choice and the cap are settings, declared once ([0069](0069-choices-are-settings.md)).
