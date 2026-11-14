---
id: 0529
title: A code.loaded written when a home saved before the code store opens says from open, a fifth value beside 0293's four
status: accepted
date: 2026-11-14
tags: [hot-reload, build, events, ledger, record-wide, next]
---

# 0529: A code.loaded written when a home saved before the code store opens says from open, a fifth value beside 0293's four

**What this decides:** in `next/`, the move of an old home's programs to the running build is
recorded as `code.loaded` with `from: "open"`.

```ts
// 0293's sketch, with the fifth value.
const From = Schema.Literals(["watch", "deploy", "boot", "restart", "open"]);
// An old home opened on this build: one per live process whose build has no code.
{ _tag: "code.loaded", program: "counter", hash: "<this build>", was: "<the saved build>", from: "open" }
```

## Context

[PR 1012](https://github.com/kamp-us/tea-fabrika/pull/1012), P15 slice 1 (hot reload). A home
saved before 1012 never stored its code, so 1012 moves each of its live processes to the running
build when the Project opens, before any step runs, and records the move as one `code.loaded`.
Overnight, the lead recorded it as `from: "boot"`, since adding a value would amend
[0293](0293-every-record-names-its-build.md), an owner decision. With `boot`, a reader of the log
had to work out the case from two other facts: it is the home's first code fact, and `was` is set.

## Decision

**The open-time move of an old home is `code.loaded` with `from: "open"`.**

- The repo's data-shape rule: a fact that exists when the record is written goes in now. Why the
  program moved is one of those facts, so it is a value of `from`, not something derived later.
- `"open"` is used only for this move. A normal boot accept keeps `from: "boot"`.
- 0293's other rules hold.

## Consequences

- `next/packages/libfabrika/src/runtime/Code.ts`'s `From` gains `"open"`, and the type law that pins
  the four values pins five (`Code.laws.test.ts`, `watch.laws.test.ts`).
- PR 1012's two port-home laws expect `from: "open"` with `was` set, and its build writes it.
- 0293's status names this decision.

## Records

No new glossary word.
