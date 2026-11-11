---
id: 0336
title: In next/, a recovery's end screen counts what was removed and offers a new sheet, and the old device is told at once if online, else at its next open
status: accepted
date: 2026-11-06
tags: [security, recovery, ux, gateway, next]
---

# 0336: In next/, a recovery's end screen counts what was removed and offers a new sheet, and the old device is told at once if online, else at its next open

```text
Done. This Mac is in.
Your old Mac, its 2 windows and 1 agent are removed.
Sheet r1-7f3a is used up.  [Make a new sheet]
```

**What this decides:** what a person sees when a recovery ends, on the new device and the old one.

## Context

From [account recovery, call 10](../docs/direction/recovery-key.md#10-the-end-of-a-recovery-decided),
decided by the owner 2026-11-06. The counts on the sample are made up.

## Decision

**The new device says what stopped; the old device learns it was removed.**

- The end screen counts what was removed, from the fold.
- "Make a new sheet" sits right on that screen, not only in the menu bar.
- The old device, if online, is told at once: its connections close with 4003, as for any removed
  key, and it says it was removed by a backup sheet.
- If the old device is offline, it says the same at its next open, with the date.

## Consequences

- After a recovery that dropped the old device, each tab and agent it let in asks again, one Approve
  each.
