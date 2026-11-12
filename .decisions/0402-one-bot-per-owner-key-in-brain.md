---
id: 0402
title: One fabrikalfa bot serves every project its owner runs fabrika on, its one key sits in the brain's Secrets Store, and a self-hoster makes their own app
status: accepted
date: 2026-11-06
tags: [agents, github, secrets, bot]
---

# 0402: One fabrikalfa bot serves every project its owner runs fabrika on, its one key sits in the brain's Secrets Store, and a self-hoster makes their own app

**What this decides:** how many bots there are, and where the bot's key lives.

## Context

From [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md), decided by the owner
2026-11-06. This narrows the first "one shared bot for everyone".

## Decision

**One bot per owner, one key, in the brain.**

- `fabrikalfa` is one bot for every project its owner runs fabrika on, never one bot for everyone.
  It is owned by the kamp-us organization and is public. A self-hoster makes their own app.
- The app's one key sits in the brain, on Cloudflare in its Secrets Store, shared by every worker
  in one account. Nobody else holds a key.
- A person invited to a project gets a token through that project's brain, after the brain checks
  its member list.

## Consequences

- Any owner of the organization can make a key, so the repo's branch rules are what limit one
  ([0406](0406-the-bot-is-held-to-its-branches.md)).
