---
id: 0321
title: A saved state holds a secret's name, never the secret, and saved state is not encrypted with a project key
status: accepted
date: 2026-10-28
tags: [security, secrets, saved-state, storage, redacted]
---

# 0321: A saved state holds a secret's name, never the secret, and saved state is not encrypted with a project key

```ts
// A sketch. The state keeps a name; a Cmd asks for the key when it needs it.
type State = { model: "opus"; key: { secret: "anthropic" } };
const key = yield* (yield* Secrets).get("anthropic"); // Redacted<string>
```

**What this decides:** where a secret may sit when a program's state is saved, and that saved
state gets no encryption layer.

## Context

No Effect encoding both hides a `Redacted` and reads it back, and the shared project record is
read by every member, later ones included, and nothing in it is deleted. From
[secrets are Redacted, changed 2026-10-28](../docs/direction/secrets-are-redacted.md#changed-2026-10-28-a-state-holds-a-secrets-name-never-the-secret).
It builds on [0320](0320-every-secret-is-an-effect-redacted.md).

## Decision

**A saved state names a secret; a Cmd fetches the secret from `Secrets` when it needs it.**

- Every storage refuses to save a state that holds a `Redacted`. Today's version does it with
  `holdsSecret` in `packages/fabrika/src/program/`.
- A person's keys never go in the shared project record. Only that person reads them.
- Saved state is not encrypted with a project key (Temporal's payload codec): no need we have pays
  for a keyring every host needs and a lost key that loses every record.
- Keys in the owner's own Cloudflare account are fine, as a key given to a hosted service the owner
  trusts.

## Consequences

- A program that needs a key carries one more Cmd, the `Secrets` read.
- Not decided here: lending one person's key to another member.
