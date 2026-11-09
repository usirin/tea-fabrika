---
id: 0006
title: An export no other file imports fails lint, with code-graph's strict unused-export check
status: accepted
date: 2026-11-09
tags: [lint, exports, code-graph, cleanup]
---

# 0006: An export no other file imports fails lint, with code-graph's strict unused-export check

**What this decides:** `pnpm lint` blocks any `export` that no other file imports, everywhere in the
repo, so a name is public only while something uses it.

## Context

code-graph 0.13.0 added the `unused-export` finding: an exported function, constant, type, interface
or class that no other loaded file uses. It is part of `--unreachable --ci` by default. When we moved
from 0.12.0 to 0.15.0, it found 617 such exports across 223 files, 476 of them in `experiments/`.
A hand check found two kinds of false alarm, and none of the other findings was wrong:

- 11 were a code-graph bug: a `const X` with no `export`, beside an `export type X` of the same name
  (the Effect Schema pattern). Filed as
  [kamp-us/demlik#905](https://github.com/kamp-us/demlik/issues/905) and patched locally until a
  release has the fix ([patch upstream locally](../docs/direction/patch-upstream-locally.md)).
- 14 are exports that a runtime reads by name, which no import shows: Durable Object and container
  classes that Miniflare or Alchemy bind by class name, an entrypoint Miniflare loads with
  `getEntrypoint`, a name that bundler-generated code imports, a `main` that a runner reaches
  through ``import(`./${part}.ts`)``, and a bundle entry kept whole so its size is measured. Two
  more sit in `experiments/results/`, saved agent output that stays as it is.

This builds on decision 0003, still open in
[PR 567](https://github.com/usirin/tea-fabrika/pull/567): a clean repo is held by checks, not
discipline.

## Decision

**The strict check stays on: drop an `export` nobody imports, and delete what that leaves unused
(owner, 2026-11-09).**

- It keeps the public surface honest: an export says another file depends on this name.
- It helps tree-shaking, since a bundler keeps what a module exports.
- `--dead-only`, which would switch the check off, is not used.

**Binding constraints**

- A finding is fixed in code: drop the `export`, or delete the symbol. A ledger entry is the owner's
  call, in a change of its own ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)).
- An export that a runtime reads by name keeps its `export`. Never drop one to pass the check.
- In `experiments/`, a value kept only so `tsc` checks it (a type probe, a spike, a shape sketch)
  stays, renamed with a leading `_`, and is not deleted.
- Files under `experiments/results/` are never edited to pass a check.

## Consequences

- The cleanup landed in one pull request: 590 exports dropped, 12 of those symbols deleted outright, and
  13 type probes and spikes renamed with `_`.
- The 14 exports read by name and the 2 saved results still fail `--unreachable --ci` until the
  owner records them in `unreachable-ledger.json` or a code-graph setting covers them
  ([kamp-us/demlik#906](https://github.com/kamp-us/demlik/issues/906)).
- When a code-graph release fixes demlik#905, the bump deletes
  `patches/@demlik__code-graph@0.15.0.patch`.
