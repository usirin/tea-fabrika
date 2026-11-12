---
id: 0205
title: In next/, an entry above a size keeps a hash and its bytes go to the Blobs service, never a big body inside the entry
status: accepted
date: 2026-11-07
tags: [ledger, blobs, entry-size, bounded-objects, tier-2, next]
---

# 0205: In next/, an entry above a size keeps a hash and its bytes go to the Blobs service, never a big body inside the entry

**What this decides:** where a large body goes when something in `next/` writes one.

## Context

The owner approved this lean on 2026-11-07, at 80%, after the bounded-objects walk and experiment
225. See [design for bounded objects](../docs/direction/design-for-bounded-objects.md).

## Decision

**In `next/`, an entry above a size keeps only a hash of its body, and the bytes go to the `Blobs`
service.**

- It is built in Tier 2.
- The size line is the plan's to set.

## Consequences

- About 100 to 200 lines in Tier 2, a guess from reading.
- A reader that needs the body fetches it from `Blobs` by its hash.
