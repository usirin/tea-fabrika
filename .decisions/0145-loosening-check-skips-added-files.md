---
id: 0145
title: The loosening check gives no hit for a file a pull request adds
status: accepted
date: 2026-11-12
tags: [loosening, lead, merge, tests]
---

# 0145: The loosening check gives no hit for a file a pull request adds

**What this decides:** `loosening.sh` stays quiet about a brand-new test file, and its old warning for a new test file that touches shared state is gone.

## Context

On 2026-11-12 `loosening.sh` gave about 60 hits over 7 pull requests and none was real. Most were
`unrecognized change` on a file the pull request itself adds. Each hit costs a hand check by the
lead before a merge ([0014](0014-the-lead-merges-when-every-step-passed.md)), so lanes that had
passed every step waited. Tracker ticket 876.

One existing law of the tool asked for a hit when a new test file uses shared state (`vi.mock`,
`process.env`, `beforeEach` and the like). Dropping it is real loosening of a law, so it needed the
owner's yes. The owner said yes on 2026-11-12.

## Decision

**A regular file the range adds prints no hit, because a new file has no older law to loosen.**

- A renamed or copied file is not an added file. It is read as before.
- A law that moved from an old file into a new one is still found and compared from the old file.
- An added symlink, and an added path with control characters, still give a hit.
- A changed existing file is read exactly as before.

**Binding constraints**

- The review step reads every new test file. Shared state in a new test file is review's to catch.
- This changes nothing about what counts as loosening in an existing file.

## Consequences

- Fewer hand checks before a merge, so a passing lane merges sooner.
- The tool no longer flags a new test file that leaks state between tests. Review and a flaky run are what catch it now ([0036](0036-a-flaky-test-is-fixed.md)).
- Not decided here: reading full CI from the lane before it asks the lead. That is the rest of ticket 876.
