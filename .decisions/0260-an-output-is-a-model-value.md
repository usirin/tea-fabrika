---
id: 0260
title: In next/, a program's output is a value picked from its model and sent when it changes, never a Cmd, and null means nothing to send
status: accepted
date: 2026-11-08
tags: [programs, program-shape, outputs, pipes, next]
---

# 0260: In next/, a program's output is a value picked from its model and sent when it changes, never a Cmd, and null means nothing to send

**What this decides:** what a program's output is, so "output" and "Cmd" keep one meaning each.

## Context

Decided by the owner in [a program's shape](../docs/direction/program-shape.md). It walks back
tea-program's "outputs are events" for `next/`; [tea-program](../docs/direction/tea-program.md)
keeps that rule for today's version only.

## Decision

**An output is a selector of the model, sent each time its value changes.**

- tsc checks the picked value against the output's schema.
- `null` means nothing to send.
- An output is never a Cmd: it has no answer. It is not an event either: it is kept nowhere.

## Consequences

- A source sends after each change (C8 in the five layers), with no output Cmd to keep in step.
- Not known yet: whether every output can be a model selector.
