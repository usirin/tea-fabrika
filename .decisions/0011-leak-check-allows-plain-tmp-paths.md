---
id: 0011
title: The leak check allows a plain path under /tmp, never one whose first part ends in a dash and a number
status: accepted
date: 2026-11-09
tags: [leak-check, leakgrep, machine-path, test-homes]
---

# 0011: The leak check allows a plain path under /tmp, never one whose first part ends in a dash and a number

**What this decides:** the leak check's `machine_path` rule lets a short path under `/tmp`, such as
`fh.abc`, through, and still stops every path that can carry an account name or a user id.

## Context

AGENTS.md asks each test window to set its own `FABRIKA_HOME` with a short path, since a socket
path has a 103-byte limit, so a test home is a short folder such as `fh.XXXX` right under
`/tmp`. The leak check (`.agents/skills/lead/scripts/leakgrep.sh`) flagged every path under
`/tmp`. The project window lane (ticket 276) committed 19 such paths in its laws and was stopped
at the bot push. Tracker ticket 396 carries the change.

## Decision

**A plain path under `/tmp` passes the leak check; every other machine path still fails it.**

- Still flagged: any path under `/Users`, `/home`, `/private/tmp`, `/private/var/folders`,
  `/var/folders` or a Windows `C:\Users`.
- Still flagged: a path under `/tmp` whose first part ends in a dash and a number, such as
  `claude-501` or `x-<uid>`, since that number can be a user id.
- Allowed: any other path under `/tmp`, such as `fh.abc`.
- Account names are still caught by the private word list, wherever they appear.
- The leak check still fails closed: any hit stops the push or merge for the lead's hand check.

## Consequences

- Short test homes can be written into laws and docs without a hand check.
- A path under `/tmp` that holds an account name with no number is caught only by the private word
  list. A name missing from that list gets through.
- `leakgrep.test.ts` carries laws for both sides of the line, in the same pull request as the
  script change.
