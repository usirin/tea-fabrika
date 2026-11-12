---
id: 0262
title: A write carries parent, its direct cause, which signs, and traceId, the whole request, which is shown and checked for delivery only, and one signing service owned by the gateway answers who signs
status: accepted
date: 2026-11-07
tags: [inputs, cause, parent, traceid, signing, gateway, otp, next]
---

# 0262: A write carries parent, its direct cause, which signs, and traceId, the whole request, which is shown and checked for delivery only, and one signing service owned by the gateway answers who signs

**What this decides:** the two links every write carries, and the one place that turns a cause into
a signer.

```ts
// next/packages/libfabrika/src/access/SessionManager.ts, the contract's signing call
readonly signer: (
  parent: string,
  process: string,
  kind: string,
) => Effect.Effect<Session, SigningRefused | NotGranted | LedgerError, SignRequest>;
```

## Context

Decided by the owner on 2026-11-07 in
[inputs carry their sender](../docs/direction/inputs-carry-their-sender.md) (Tier 1's question 15).
`cause` was renamed `parent`, OpenTelemetry's name, since in Effect `cause` already means a failure.
It builds on [0261](0261-inputs-carry-their-sender.md). The note calls the door the door; in
`next/` it is the gateway ([0051](0051-gateway-connection-and-node-by-job.md)).

## Decision

**`parent` signs; `traceId` only explains.**

- A write carries `parent`, the input that directly caused it. Its sender signs the write.
- A write carries `traceId`, the whole request a person's message started. It is shown ("you asked,
  claude ran this") and checked for delivery only, and it never decides who signs. An agent's stated
  reason is the `traceId`.
- In `next/`, the ledger entry carries `parent` and `traceId` from its first version (Tier 1's P6),
  since an entry written without them never gets them back.
- One signing service, owned by the gateway, answers `signer(parent, process, kind)`, as one
  gen_server owns a table. A process asks it over one call.
- It refuses in four cases: the cause was never told to this process; the cause is spent for this
  kind; the kind is person-only and the cause is not a person-only input sent by a person; the
  process has ended.

## Consequences

- The gateway stamped every input, so it is the one authority on who sent it. The cost is one more
  round trip per write; a cache would go stale.
- The service is `SessionManager` in code today. [0029](0029-format-and-names-follow-effect.md)'s
  plural rule renames it in ticket 468.
