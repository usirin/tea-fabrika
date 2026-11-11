---
id: 0329
title: In next/, the 12 words are a key, never a password, and they are never written anywhere, while each sheet check is recorded without them
status: accepted
date: 2026-11-06
tags: [security, recovery, sheet, data-shape, next]
---

# 0329: In next/, the 12 words are a key, never a password, and they are never written anywhere, while each sheet check is recorded without them

```ts
// Making a sheet: only the public half joins, through an `added` event signed by a person key.
{ _tag: "added", add: { adds: { _tag: "recovery", key: "ssh-ed25519 AAAA...r1", v: 1 }, drops: [] } }
// Each "Check my sheet": by is the device's window key; sentAt is when; never the words.
{ _tag: "checked", matched: true }
```

**What this decides:** what the recovery sheet is, and what is and is not written about it.

## Context

From [account recovery, the data shape first](../docs/direction/recovery-key.md#the-data-shape-first),
decided by the owner 2026-11-06. `added`, `Adds` and `AddSaw` are built in
`next/packages/libfabrika/src/access/Access.ts`.

## Decision

**The words rebuild an Ed25519 recovery key, and only its public half is ever kept.**

- The recovery key's public half joins `founded.keys` through an `added` event. The gateway never
  sees the words.
- The words, the seed and the private half are never written: not in the ledger, not on the wire,
  not in a log, not sealed on the device. The app holds them in memory while the sheet is on screen
  and drops them after.
- Each "Check my sheet" is recorded as one `checked` event: when, which device, matched or not,
  never the words. The device writes it when next online, signed with its window key.
- The sheet carries a version, `v: 1`, so a later sheet can change its form and an old one is still
  read the old way.

## Consequences

- P28's exam searches every frame, ledger row and log line of a full recovery for the words, the
  entropy and the seed.
