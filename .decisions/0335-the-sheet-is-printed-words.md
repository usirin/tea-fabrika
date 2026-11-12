---
id: 0335
title: In next/, the sheet is 12 printed words in numbered slots with its public label, a PDF allowed and no QR in Tier 1, typed back twice at setup and checked offline any time without a nag
status: accepted
date: 2026-11-06
tags: [security, recovery, sheet, ux, next]
---

# 0335: In next/, the sheet is 12 printed words in numbered slots with its public label, a PDF allowed and no QR in Tier 1, typed back twice at setup and checked offline any time without a nag

```text
fabrika backup sheet                                   sheet r1-7f3a, made 5 Nov 2026
for        <the founded name>
address    https://<the ledger's address>

 1 ......     2 ......     3 ......     4 ......
 ...
These 12 words open your fabrika. We cannot get them back for you.
Keep this with your passport. fabrika will never ask for these words.
Only type them on a new device's first screen. It works once.
```

**What this decides:** what the sheet holds, in what form, and how a person makes and checks it.

## Context

From [account recovery, calls 1 and 11](../docs/direction/recovery-key.md#1-what-is-on-the-sheet-and-in-what-form-decided),
decided by the owner 2026-11-06 as one call: the sheet's form and its checks. The words on the
sample are made up, as the note says.

## Decision

**Printed first, PDF allowed, words in numbered slots, never a QR in Tier 1.**

- The words sit in a numbered grid, as wallet cards do, since words out of order are a top failure.
- The sheet carries its public label, its number and the start of its key's fingerprint, and the
  menu bar shows the live sheet's label, so a person can tell the live paper without typing.
- The sheet says "fabrika will never ask for these words" and carries the address.
- The screen offers Print, then Save as PDF, then "I'll write them down", and says where not to keep
  the sheet: not only on this device, and not in a folder that syncs everywhere.
- Making a sheet asks the person to type two of the words back.
- "Check my sheet" is there any time, offline: it rebuilds the public key and compares it with the
  folded keys, so it never dials and never saves the words. It never nags.
- With no sheet yet, the menu bar shows one quiet row, never a prompt on open.

## Consequences

- The person meets the sheet twice in a device's life: once to make it, once to use it.
- A later sheet may carry a QR, through its version (`v`).
