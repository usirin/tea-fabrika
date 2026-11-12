---
id: 0257
title: In next/, a program's API has one meaning per word and one way per job, links its parts by reference or tsc, leaves out what it does not use, and is built with Program.make only
status: accepted
date: 2026-11-08
tags: [programs, program-shape, api, one-way, tsc, next]
---

# 0257: In next/, a program's API has one meaning per word and one way per job, links its parts by reference or tsc, leaves out what it does not use, and is built with Program.make only

**What this decides:** the rule every part of a program's shape is judged by, and the parts of
`Program.make` that follow straight from it.

## Context

Decided by the owner after a walk of each part, in
[a program's shape](../docs/direction/program-shape.md), from experiment 235. It walks back by name
P11's required `inputs`, `outputs` and `writes`, and elm-first's required `refuse`, for `next/`.
Today's version is not changed. Ticket 302 builds it; main's `Program.make` still has the older
shape.

## Decision

**In a program's API one word means one thing, and there is one way to do each job.**

- A shape that offers two ways (a string or an object for an input, `make` or `makeEffect`, init's
  Cmds or a setup hook), or a word with two meanings, is wrong until it says why it cannot be
  otherwise.
- Every part a program links to another is linked by reference or checked by tsc, never by two
  strings that happen to match.
- A part a program does not use is left out, never written empty. An optional list holds at least
  one item.
- A program needs at least one input, since its Msg is built from them
  ([0258](0258-inputs-are-plain-data.md)).
- `refuse` is optional; a program that leaves it out refuses nothing.
- The saved version is one more than the number of upgrades, never written by hand.
- A program is built with `Program.make` only, never `makeEffect`: it is built once, at load, where
  the loader already runs as an Effect. Data keeps the `make` and `makeEffect` pair.

## Consequences

- Fewer places a program can drift: no empty `state`, `refuse`, `outputs`, `writes` or `wake`.
- Not known yet: how the shape reads over many programs, or with Subs, read ports or `wake`.
