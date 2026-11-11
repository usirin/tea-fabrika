---
id: 0081
title: A question word is never a name, so where, why and what give way to the noun for the value stored
status: accepted
date: 2026-11-10
tags: [names, keys, settings, scope, location, reason, lint, next, agents]
---

# 0081: A question word is never a name, so where, why and what give way to the noun for the value stored

**What this decides:** `where`, `why` and `what` are never a key, a field, an option or a settings
key; each becomes the noun for the value it holds.

```ts
// No: the key names the question, so the reader guesses what kind of value sits there.
{ where: "person" }            // a setting's declaration
{ label: "Mac A", where: "Istanbul" }
new Failed({ what: "could not write a temp file" })

// Yes: the key names the answer.
{ scope: "person" }
{ label: "Mac A", location: "Istanbul" }
new Failed({ message: "could not write a temp file" })
```

## Context

The owner decided this on 2026-11-10, tracker ticket 682.

- **Where it came up.** The proposed settings note
  ([PR 831](https://github.com/usirin/tea-fabrika/pull/831), `docs/direction/settings.md`) declares
  each setting with a `where` key, as in `where: "person"` or `where: "both"`, for which files may
  set it. `where` names the question. The value is the setting's scope.
- **The industry's word there is `scope`.** Each page was read on 2026-11-10:
  - VS Code: a setting in `contributes.configuration` declares a `scope`, one of `application`,
    `machine`, `machine-overridable`, `window`, `resource` or `language-overridable`, with
    `window` as the default
    ([contribution points](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)).
  - git: `git config --show-scope` prints each value with "the scope of that value (worktree,
    local, global, system, command)" ([git-config](https://git-scm.com/docs/git-config)).
- **This generalizes a rule we already have.** On 2026-11-09 the owner picked `reason` over `why`
  for `next/`'s data keys (ticket 337), written in AGENTS.md's "Data keys are short everyday words"
  and in the glossary's `reason` row; `fabrika/no-why-key` holds it. That ruling has no decision
  file, so nothing is superseded or amended. This record covers `why` and adds `where` and `what`
  for the same reason. It builds on [use the industry's names](../docs/direction/use-the-industrys-names.md),
  [0029](0029-format-and-names-follow-effect.md) on names, and [0033](0033-agents-code-follows-next-rules.md),
  which holds `.agents/` to `next/`'s rules.

## Decision

**A question word names the question, not the answer, so `where`, `why` and `what` are never a key,
a field name, an option name or a settings key: each is replaced by the noun for the thing
stored.**

- **The noun comes from the value.** A place is a `location` (AGENTS.md already reserves the word),
  a cause is a `reason`, the files or layers a setting may come from are its `scope`, and an error's
  words are its `message`. Where the noun is not obvious, the rename's plan picks it after reading
  what the value holds.
- **Where it holds:** `next/` and `.agents/` code, product and tests alike, and every note, plan
  and decision written from now on.
- **Today's version keeps its words** until that code goes, as with `kind` and `why` already.
  Older notes and decisions are records and keep theirs.
- **An outside shape keeps its own keys** at the edge where it is read, as Schema's `encodeKeys`
  already does for `exam-paths.json`'s `why` in `next/apps/fabrika/src/exam/commits.ts:160`.
- **It is held by a lint rule, never a test** (AGENTS.md). The rule exists in part:
  `fabrika/no-why-key` (`oxlint-plugins/no-why-key.ts`) blocks a statically named `why` key in an
  object, class or type in `next/` and `.agents/`, tests included. The sweep widens it to `where`
  and `what`, under a name that says question words. Per [0040](0040-existing-tools-before-hand-written.md),
  its plan first tries oxlint's own [`eslint/id-denylist`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/id-denylist)
  (oxlint 1.90.0 is installed; the rule came in 1.76.0). Its page says it flags object keys and
  class members, and does not say whether it reads type members such as a `TSPropertySignature`,
  which ours does. The plan settles that with a test, and keeps ours only for a case the oxlint
  rule cannot see.
- **The lint rule and the rename are code,** their own change under ticket 682, with the steps.
  This pull request is docs only.

What the rename covers, read from main on 2026-11-10 with
`rg '\b(readonly )?(where|why|what)\??:'` over `next/` and `.agents/` TypeScript. The pattern also
catches parameters, locals and a few comment lines, which the rule covers too, since they are
names.

| Group | Today | Becomes |
|---|---|---|
| `where` in what a person saw (6 product lines, 46 test lines) | `Saw`, `Took` and `AddSaw` in `next/packages/libfabrika/src/access/Access.ts:14,37,72`; the waiting `Row` in `next/packages/libfabrika/src/gateway/internal/waiting.ts:7`, fed `where: options.location` at `next/packages/libfabrika/src/gateway/Gateway.ts:580`; `next/apps/fabrika/grant.ts:77`; tests in `access/` and `next/apps/fabrika/src/door*.test.ts` | `location` |
| `what` on the exam's error (17 lines) | `Failed`'s field in `next/apps/fabrika/src/exam/commits.ts:379` and its 16 uses | `message`, Effect's and JavaScript's word for an error's words; `commits.ts` is an exam file, so it goes through the test writer |
| `what` as a parameter (4 product lines, 3 test lines) | `fail(what)` in `next/packages/libfabrika/src/Testing.ts:33,100`; `failed(what, r)` in `.agents/skills/lead/scripts/drive.ts:1166`; `until(what, ...)` in `worker-supervision.test.ts` and `runtime-recovery.laws.test.ts`, `product(file, what)` in `css.test.ts` | picked in the sweep's plan |
| `why` in `.agents/` (9 product lines, 5 test lines) | `drive.ts:371-671`, today's outcome shape from `@kampus/pipeline/stages/outcome` (`kind` and `why`); `drive.ts:1315`, a field row's `why`; `gc.ts:459`, a local; exam rows and a parameter in `box.test.ts`, an outcome in `drive.test.ts`. Twelve rows in `agents-ledger.json` already name them under `no-why-key` | `reason` where `.agents/` owns the shape; today's outcome and the field schema keep `why` until they change |

**Not keys, but counted so the numbers add up:** `next/packages/libfabrika/src/processes/Process.ts:63`
and `.agents/skills/lead/scripts/mutbox.ts:532` match only in comment prose. `next/` has no `why`
key left after ticket 337.

**What is stored under these keys today, and what the rename must do:**

- Signed grants and removals (`Saw`, `Took`, `AddSaw`) put `where` inside the signed text, so the
  rename changes the bytes a person signs. Today only test ledgers hold them: `next/` is not in
  daily use, as [0080](0080-a-running-copy-is-an-instance.md) found the same day. The rename reads
  no old key. If a real ledger exists by then, it comes with a migration and its own plan, because
  a signed event cannot be rewritten.
- The waiting rows sit in the brain's store under `waiting`, and expire. Nothing to move.
- `exam-paths.json` writes `why` and is read through `encodeKeys`. It is a trusted root file, so a
  rename of its key is an exam change and is not in the sweep unless its plan says so.
- `field/runs.jsonl` has 6,075 `"why"` keys and `field/notes.jsonl` has 560 `"what"` keys. They
  are lab records with a schema in `field/README.md`. This record does not change them.

**Binding constraints:**

- No new code in `next/` or `.agents/`, and no new note, plan or decision, uses `where`, `why` or
  `what` as a key, field, option or settings key.
- The settings note uses `scope` before it is decided.
- The rename changes no law: same behavior, new names.

## Consequences

- One sweep is owed, under ticket 682: the widened lint rule and the renames in the table. Until it
  lands, `where` and `what` stay in the code, and the lint rule's ledger shrinks as they go.
- The settings note in PR 831 changes `where` to `scope` in its declaration sketch and its `Where`
  type.
- `scope` may become a glossary word when the settings note is decided. It is not added here: the
  glossary has no `scope` row, and the note is still proposed.
- **Not decided here:** whether `who` and `how` are covered too. AGENTS.md's own example writes
  `{ _tag: "ask", who: "owner", for: "approval" }`. The same search finds `who` on 25 product
  lines and 22 test lines (the transport's `who: Who` in `next/packages/libfabrika/src/transport/Wire.ts:23`,
  an ask's `who: "owner"` in `next/apps/fabrika/src/exam/commits.ts:71`, layer parameters such as
  `who: Who` in `next/packages/libfabrika/src/ledger/Ledger.ts:60`), and `how` on 4 product lines
  and 63 test lines (`how` in `Access.ts:15,38,70`, and the notes exam's `how` in
  `next/apps/fabrika/src/exam/notes-contract.test.ts`). Those numbers are facts, not a ruling.
- Not decided here: the exact noun for each `what` parameter and for `field/`'s keys.
