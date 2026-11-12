---
id: 0332
title: In next/, a recovery asks once whether the old device is lost or stolen, with yes by default, and yes drops the old device and everything it let in
status: accepted
date: 2026-11-06
tags: [security, recovery, revoke, next]
---

# 0332: In next/, a recovery asks once whether the old device is lost or stolen, with yes by default, and yes drops the old device and everything it let in

**What this decides:** whether a recovery removes the old device's keys.

## Context

From [account recovery, call 3](../docs/direction/recovery-key.md#3-does-recovery-revoke-the-old-macs-keys-decided),
decided by the owner 2026-11-06. Most people reach the screen because the old device is gone.

## Decision

**One question, "Is your old device lost or stolen?", with yes picked.**

- Yes (`old: "lost"`): `drops` names the old device's person key and window key, and every other
  live recovery key. They stop at once and forever, with everything they let in
  ([0334](0334-a-dropped-key-drops-all-below.md)).
- No (`old: "kept"`): `drops` is empty, and the person has two devices.
- The answer is in the signed `added`, in `saw.old`.

## Consequences

- A calm move rarely reaches this screen: Migration Assistant or another device lets the new one in,
  and neither spends the sheet.
