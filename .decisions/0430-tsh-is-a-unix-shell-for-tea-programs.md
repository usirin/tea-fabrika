---
id: 0430
title: In today's version, tsh is used like any Unix shell and runs only tea programs, with typed pipes, and a command is a short program, never a new concept
status: accepted
date: 2026-10-17
tags: [tsh, shell, programs, pipes, todays-version]
---

# 0430: In today's version, tsh is used like any Unix shell and runs only tea programs, with typed pipes, and a command is a short program, never a new concept

```sh
tsh -c 'review --pr 712 | ship'       # typed values down a typed pipe
n=$(count --to 3)                     # call() is $(…)
jobs                                  # a built-in, like ps
```

**What this decides:** what tsh, today's shell, is and how a person uses it.

## Context

Unix already has the ideas, and a new word for each is one more thing to learn. From
[tsh: a shell for tea programs](../docs/direction/tsh-a-shell-for-tea-programs.md#what-was-decided).
This is today's version (`packages/fabrika/src/shell`); `next/`'s shell is `fabsh`
([0432](0432-next-has-fabsh-rethought-from-tsh.md)).

## Decision

**tsh is a Unix shell whose commands are tea programs.**

- It is used like any Unix shell: a prompt, `-c`, scripts, exit status and jobs.
- It runs only tea programs, with typed values and typed pipes. tsh is itself a tea program.
- A command is a short program, never a new concept. `call()` is `$(…)`, and `ps` and `jobs` are
  built-ins.
- tsh is fabrika's first client (added 2026-10-18).

## Consequences

- Anything a person knows from bash carries over; what is new is the types on values and pipes.
- Nothing here binds `next/`.
