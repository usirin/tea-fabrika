---
id: 0150
title: The email recovery notice is a toast with a plain close, until notification guidelines exist
status: accepted
date: 2026-11-12
tags: [recovery, notice, toast, notifications, next]
---

# 0150: The email recovery notice is a toast with a plain close, until notification guidelines exist

**What this decides:** the notice every live device shows when a device comes back by email is
drawn as a toast, a person closes it with a plain close, and closing it records nothing.

## Context

[0138](0138-email-recovery-lets-in-at-once.md) says every live device shows a plain notice that a
device came back by email, and that the notice carries no action. It did not say how the notice is
drawn or whether a person may close it. A plan asked. The owner's answer (2026-11-12): this is a
notification question, there are no notification guidelines yet, so use a toast until there are.

## Decision

**Until a notification guidelines page exists, the email recovery notice is a toast, in `next/`.**

- A person closes it with the toast's own close. The close is local to that device.
- Closing writes nothing to the ledger and sends nothing. 0138's "the notice sends nothing" holds.
- The notice still carries no action: no Cancel and no "not me". The recovered device stays in the
  list of let-in devices, and the list's Remove is how a person acts on it.
- No special piece is designed for this notice now. When notification guidelines are written
  ([0136](0136-guidelines-live-in-their-own-pages.md)), they decide its final shape, and this
  file is superseded or amended then.

## Consequences

- Plans that show this notice use the design system's toast and add no new part.
- A closed notice leaves no record that this device's person saw it. The `added` fact in the
  ledger still says when the device came back and that the email key signed it.
- Not decided here: whether the toast stays on screen until it is closed or may hide on a timer.
  That question is open with the owner.
