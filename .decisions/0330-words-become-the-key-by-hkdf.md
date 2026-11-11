---
id: 0330
title: In next/, the 12 words become the recovery key by HKDF-SHA256 over their entropy, never BIP39's PBKDF2 seed, on @scure/bip39 and @noble/hashes pinned exact
status: accepted
date: 2026-11-09
tags: [security, recovery, crypto, dependencies, next]
---

# 0330: In next/, the 12 words become the recovery key by HKDF-SHA256 over their entropy, never BIP39's PBKDF2 seed, on @scure/bip39 and @noble/hashes pinned exact

```ts
// A sketch, pure, runs on Node in tests.
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

// 16 random bytes = 12 words with a 4-bit checksum.
// The 32-byte Ed25519 seed = HKDF-SHA256(entropy, salt: empty, info: "fabrika-recovery-v1").
```

**What this decides:** how the words on a sheet turn into the recovery key, and with which
libraries.

## Context

From [account recovery, how the words become a key](../docs/direction/recovery-key.md#how-the-words-become-a-key)
(the libraries, decided 2026-11-06) and its
[call 13](../docs/direction/recovery-key.md#13-a-new-device-sees-what-it-will-drop-first-decided-2026-11-09-built-by-p28)
(the derivation, decided 2026-11-09, built by P28).

## Decision

**HKDF-SHA256 over the 16 bytes of entropy, with an empty salt and the label
`fabrika-recovery-v1`.**

- Never BIP39's own PBKDF2 seed: that serves wallets' key trees, which we do not need.
- The words come from `@scure/bip39` 2.4.0, with `@noble/hashes` 2.4.0, both pinned exact.
- The recovery key is a plain Ed25519 key, its public half an `ssh-ed25519` line like the person
  key's, so `ssh-keygen -Y sign` gives recovery a command path too.

## Consequences

- Two new dependencies, read at their pinned version's docs before the build.
- 12 words give 128 bits, about what Ed25519 itself gives, so more words add typing and no safety.
