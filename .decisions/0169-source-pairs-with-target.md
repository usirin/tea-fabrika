---
id: 0169
title: A struct that names one end source names the other end target, never to
status: accepted
date: 2026-11-13
tags: [names, keys, source, target, grant, mail, start, next]
---

# 0169: A struct that names one end source names the other end target, never to

```ts
// before: two words from two different pairs
export const StartGrant = Schema.Struct({ source: Text, to: Text });

// after: one pair
export const StartGrant = Schema.Struct({ source: Text, target: Text });

// unchanged: `to` standing alone, as a sentence reads
{ _tag: "send", to: "builder", reason: "checks_red" }
```

**What this decides:** the name of the other end when a struct already says `source`.

## Context

- `next/` writes a start grant as `{ source, to }`
  (`next/packages/libfabrika/src/processes/Children.ts:17`), and a mail grant and a delivery the
  same way (`processes/ProgramMailLedger.ts:32`, `processes/ProgramMail.ts:24`).
- `source` and `target` are the industry's pair (a graph edge, a drag, a build). `from` and `to`
  are the other pair. `source` with `to` takes one word from each.
- `AGENTS.md` keeps `to` for a value that reads as a sentence, such as `{ _tag: "send", to }`, and
  [0081](0081-no-question-word-names.md) lists `to` as a fine noun. Neither is about a struct that
  also says `source`.

## Decision

**A struct that names one end `source` names the other end `target`, never `to` (owner,
2026-11-13).**

- It holds for every key, field, option and setting in `next/`: grants, deliveries, bindings and
  the `starts` setting.
- `to` stays where it stands alone, with no `source` beside it.
- A struct does not mix the pairs: `source` with `target`, or `from` with `to`.

## Consequences

- One sweep renames today's `{ source, to }` shapes in `next/`. The `starts` setting's key changes
  with it, so the setting's reference and the generated schema change in the same pull request.
- The glossary gets the pair in the pull request that does the sweep.
- **The cost:** a saved value written as `to` no longer decodes. `next/` has no saved instance a
  person relies on yet, so nothing is migrated.
- Not decided here: whether a lint rule holds it. A plan for the sweep asks "lint, type or test?".
