---
id: 0263
title: The program test kit has a law that every write an input from sender S causes is signed S, across random inputs, both senders and queued writes
status: accepted
date: 2026-11-08
tags: [inputs, signing, laws, test-kit, properties, next]
---

# 0263: The program test kit has a law that every write an input from sender S causes is signed S, across random inputs, both senders and queued writes

**What this decides:** the law that catches a program that forgets to carry a write's cause.

## Context

Approved by the owner on 2026-11-08 as Tier 1's question 17, in
[inputs carry their sender](../docs/direction/inputs-carry-their-sender.md#the-case-nobody-listed).
The case nobody listed: a program that drops the cause signs a person's comment as the agent, and
nothing errors. It holds [0261](0261-inputs-carry-their-sender.md).

## Decision

**A property law in the program test kit: for any input told by sender S, every write it causes is
signed S.**

- Random inputs, both senders (a person and an agent for a person), interleaved.
- Queued writes included: a write sent from a later update, such as after an earlier write's
  `save_ok`, still carries its own cause.

## Consequences

- An honest program pays one field per Msg it queues.
- Every program that writes runs the law, so a wrong signer fails a test, not a review.
