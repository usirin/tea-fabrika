---
id: 0337
title: In next/, before a sheet recovery the new device makes one read-only call signed by the recovery key over a fresh challenge, and the `added` carries what it saw as `seen`
status: accepted
date: 2026-11-09
tags: [security, recovery, gateway, next, p28]
---

# 0337: In next/, before a sheet recovery the new device makes one read-only call signed by the recovery key over a fresh challenge, and the `added` carries what it saw as `seen`

```mermaid
sequenceDiagram
  participant device as new device
  participant gateway
  gateway->>device: fresh one-time challenge
  device->>gateway: read, signed by the recovery key
  gateway-->>device: name, seen, what would drop
  device->>gateway: added, with seen in its signed text
  gateway->>gateway: membership again; refuse if the keys changed since seen
```

```ts
// A sketch. The call's and fields' names are P28's to pick.
// read -> { name: "home", seen: 4182, drops: ["mbp-2024", "tab-7f3a"] }
```

**What this decides:** how a new device learns what a recovery will drop before it commits.

## Context

From [account recovery, call 13](../docs/direction/recovery-key.md#13-a-new-device-sees-what-it-will-drop-first-decided-2026-11-09-built-by-p28),
decided by the owner 2026-11-09 and built by P28, whose exam the owner approved the same day.

## Decision

**One read-only call shows what will drop, and it spends nothing and lets nothing in.**

- It is signed by the recovery key over a fresh challenge that is one-time and short-lived.
- It answers the ledger's name, the ledger position it saw, and which devices would drop.
- Every refusal of a sheet answers the same, whether the sheet is wrong, spent or replaced. The
  screen still shows one plain line for each case.
- The `added` carries the read's ledger position back as `seen`, inside its signed text, and the
  gateway refuses it if the person's keys changed since `seen`.
- The `added` checks membership again, whatever the read said.

## Consequences

- The check on `seen` rests on the signature, not on the connection alone.
