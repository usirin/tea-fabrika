---
id: 0081
title: A question word is never a name, so where, why, what, who and how give way to the noun for the value stored
status: accepted
date: 2026-11-10
tags: [names, keys, settings, scope, location, reason, lint, next, agents]
---

# 0081: A question word is never a name, so where, why, what, who and how give way to the noun for the value stored

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
- `who` and `how` were left open here on the first day; the amendment below covers them.
- Not decided here: the exact noun for each `what` parameter and for `field/`'s keys, and the nouns
  the amendment leaves to the sweep's plan.
| `apps/fabrika/src/asks.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/asks.page.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/asks.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/asks.ts` | `apps/fabrika/src/asks.ts:187` | Build |
| `apps/fabrika/src/desk/keymap.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/desk/keymap.ts` | `apps/fabrika/src/desk/{desk.ts:147,keys.ts,keymap.ts:260,words.ts}` | Build |
| `apps/fabrika/src/host/host.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/host/serve.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/link.ts` | `apps/fabrika/src/{messages.ts:262,tsh.ts:254,tiles.ts}`: the host link carries the kept notice (What this piece records) | Build |
| `apps/fabrika/src/main.notices.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/main.ts` | `apps/fabrika/src/asks.ts:187`: retain marks and badge behavior; the shown notice is recorded (What this piece records) | Build |
| `apps/fabrika/src/messages.ts` | `apps/fabrika/src/{messages.ts:262,tsh.ts:254,tiles.ts}` | Build |
| `apps/fabrika/src/tiles.ts` | `apps/fabrika/src/{messages.ts:262,tsh.ts:254,tiles.ts}` | Build |
| `apps/fabrika/src/window/ask-menu.review4.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/window/desk.tsx` | `apps/fabrika/src/window/{frame.ts:428,frame.tsx:438,desk.tsx:390,windows.tsx:52}` | Build |
| `apps/fabrika/src/window/frame.laws.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/window/frame.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `apps/fabrika/src/window/frame.ts` | `apps/fabrika/src/window/{frame.ts:428,frame.tsx:438,desk.tsx:390,windows.tsx:52}` | Build |
| `apps/fabrika/src/window/frame.tsx` | `apps/fabrika/src/window/{frame.ts:428,frame.tsx:438,desk.tsx:390,windows.tsx:52}` | Build |
| `apps/fabrika/src/window/pop.tsx` | `apps/fabrika/src/window/{frame.ts:428,...}` (the asks menu draws with its footer) | Build |
| `fixtures/ask-desk/` | `fixtures`; new inbox test fixtures | Tests |
| `layer-rules.json` | lint rules belong to Tests (the line under the files table) | Tests |
| `next/apps/fabrika/src/exam/commits.test.ts` | Tests beside each changed module: its law pins the bytes of `exam-paths.json` | Tests |
| `packages/fabrika-design/README.md` | Program READMEs | Build |
| `packages/fabrika-design/src/build/schema.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/fabrika-design/src/theme-colors.ts` | generated by `pnpm tokens` from the token files, beside `tokens.css` and `themes.ts` | Build |
| `packages/fabrika-design/src/themes.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/fabrika-design/src/token-names.json` | generated by `pnpm tokens` from the token files, beside `tokens.css` and `themes.ts` | Build |
| `packages/fabrika-design/tokens/` | main's `exam-paths.json` lists `packages/fabrika-design/tokens/**`, so Build may not change it; the slate-3 card role of the `tokens.css:23` row is written here | Tests |
| `packages/fabrika/src/hash.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/fabrika/src/host/door.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/fabrika/src/host/sqlite.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/fabrika/src/host/sqlite.ts` | `apps/fabrika/src/{messages.ts:262,tsh.ts:254,tiles.ts}`; `host/serve.ts`: the host lock retry so a failed save says so in time (amendment 2026-11-09, small-window row) | Build |
| `packages/fabrika/src/index.ts` | `packages/fabrika/src/hash.ts`, new; `src/index.ts` | Build |
| `packages/fabrika/src/program/view.ts` | `packages/fabrika/src/program/program.ts:478`, `view.ts` | Build |
| `packages/pipeline/src/ask-desk.test-support.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/ask.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/hosts.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/hosts.ts` | `stages/pipeline/hosts.ts:185`, `restart.ts:237`, `pulls.ts` | Build |
| `packages/pipeline/src/stages/pipeline/lane.asked.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.decided.let-through.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.exam-pull.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.might-answer.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.test-writer.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.typed-again.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/lane.whole.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/machine.ts` | `stages/pipeline/machine.ts:274`, `:1045` | Build |
| `packages/pipeline/src/stages/pipeline/program.format.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/program.ts` | `stages/pipeline/program.ts:1628` | Build |
| `packages/pipeline/src/stages/pipeline/pulls.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/pulls.ts` | `stages/pipeline/hosts.ts:185`, `restart.ts:237`, `pulls.ts` | Build |
| `packages/pipeline/src/stages/pipeline/rec.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/restart.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/stages/pipeline/restart.ts` | `stages/pipeline/hosts.ts:185`, `restart.ts:237`, `pulls.ts` | Build |
| `packages/pipeline/src/stages/pipeline/routes.ts` | `programs/tracker/src/head.ts:56`, `rows.ts:124`, `steps.ts:57`: the step words move to `tickets/steps.ts`, routes re-exports them | Build |
| `packages/pipeline/src/stages/pipeline/stop.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/tickets/approval.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/tickets/approval.ts` | `packages/pipeline/src/tickets/approval.ts:32` | Build |
| `packages/pipeline/src/tickets/ask.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `packages/pipeline/src/tickets/steps.ts` | `programs/tracker/src/head.ts:56`, `rows.ts:124`, `steps.ts:57`: the lane steps and ask kinds the tracker reads, out of the stage code | Build |
| `packages/pipeline/src/tickets/ticket.ts` | `packages/pipeline/src/tickets/ticket.ts:393` | Build |
| `programs/ticket/docs/ask-desk/` | the tracker and ticket `docs/` row | Build |
| `programs/trace/src/ticket.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/trace/src/ticket.ts` | `programs/trace/src/{ticket.ts:116,view.ts:732,window.tsx}` | Build |
| `programs/tracker/package.json` | tracker manifest in the manifests row | Tests |
| `programs/tracker/src/answer.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/tracker/src/head.laws.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/tracker/src/head.ts` | `programs/tracker/src/head.ts:56`, `rows.ts:124`, `steps.ts:57` | Build |
| `programs/tracker/src/index.ts` | `programs/tracker/src/ticket.ts:61`, `ledger.ts:177`, `index.ts:225` | Build |
| `programs/tracker/src/ledger.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/tracker/src/ledger.ts` | `programs/tracker/src/ticket.ts:61`, `ledger.ts:177`, `index.ts:225` | Build |
| `programs/tracker/src/legacy.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/tracker/src/machine.ts` | `programs/tracker/src/head.ts:56`, `rows.ts:124`, `steps.ts:57`: the page carries sealed asks for Activity rows (property 22) | Build |
| `programs/tracker/src/seal-order.ask-desk.test.ts` | Tests beside each changed module; e2e checks | Tests |
| `programs/tracker/src/steps.ts` | `programs/tracker/src/head.ts:56`, `rows.ts:124`, `steps.ts:57` | Build |
| `programs/tracker/src/ticket.ts` | `programs/tracker/src/ticket.ts:61`, `ledger.ts:177`, `index.ts:225` | Build |

## Amendments

- **2026-11-10, owner, ticket 682: the rule also covers `who` and `how`.** No key, field, option,
  parameter or setting is named `who` or `how`; each becomes the noun for its value, as with the
  other three. This moves both out of "not decided here". `for` stays: it is a preposition, not a
  question word. AGENTS.md's example now reads `{ _tag: "ask", to: "owner", for: "approval" }`.

  What the rename covers, read from main on 2026-11-10 with `rg '\b(readonly )?(who|how)\??:'` over
  `next/` and `.agents/` TypeScript: `who` on 19 product lines and 28 test lines, `how` on 4 and
  63. A `*.test-support.ts` file counts as a test here, which is why `who` differs from the first
  count above (25 and 22).

  | Group | Today | Becomes |
  |---|---|---|
  | `who` on an ask: the one being asked (2 product lines, 4 test lines) | `Answer`'s `ask` in `next/apps/fabrika/src/exam/commits.ts:71,311`; `commits.test.ts:109`, `commits-git.test-support.ts:203`, `.agents/skills/lead/scripts/box.test.ts:1216`, `lane.test.ts:126` | `to`, as `send` already says. `commits.ts` is an exam file, so it goes through the test writer |
  | `who` on today's outcome (2 product lines, 2 test lines) | `.agents/skills/lead/scripts/drive.ts:420,480`, `drive.test.ts:645,664`, today's shape with `kind` | keeps `who` until today's outcome changes, as its `why` does |
  | `who` as the admitted caller, `Who` = `{ key, person, as }` (9 product lines, 9 test lines) | `next/packages/libfabrika/src/transport/Wire.ts:23,44`, `Hello.ts:44,132`, `Answer.ts:23`, `gateway/Gateway.ts:473,547`, `cloudflare/connection.ts:90,99`; tests in `transport/`, `runtime/Gateway.laws.test.ts`, `cloudflare/readers.laws.test.ts`, `node/dev/dev-secrets.laws.test.ts`, `next/apps/fabrika/src/runtime.laws.test.ts`, `exam/agent-may.test.ts` | picked in the sweep's plan. Not `client`: `Attached.online` already holds the client's id under `client` beside it (`Wire.ts:43`) |
  | `who` as a layer's own object (6 product lines, 2 test lines) | `ledger/Ledger.ts:60,75` (`{ reader }`, the glossary's `reader`), `telemetry/Sink.ts:220,229` (`{ object }`), `runtime/RecoveryStore.ts:39` (`{ name, capacity }`), `runtime/ProcessStore.ts:90` (`{ process, storage }`); `RecoveryStore.test.ts:20`, `RunnerSupervision.test.ts:1547` | picked in the sweep's plan |
  | `who` in other test helpers (11 test lines) | a signer's name in `commits-git.test-support.ts:53-148` and `commits-git-steps.test.ts:205`; `drafted(who)` in `drive.test.ts:907`; `record(..., who: From)` in `runtime/Runner.test.ts:553`; `door.test.ts:643`; `exam/agents.test.ts:140,182` | `from` in `Runner.test.ts`, as `ProcessStore.ts:84` names it; the rest picked in the sweep's plan |
  | `how` in what a person saw (4 product lines, 39 test lines) | `Saw`, `Took` and `AddSaw` in `next/packages/libfabrika/src/access/Access.ts:15,38,70`; `next/apps/fabrika/grant.ts:78`; tests in `access/`, `gateway/`, `door*.test.ts`, `stage-*.test.ts`, `runtime*.laws.test.ts`, `grant-readers.laws.test.ts`, `exam/agent-may.test.ts`, with the `addSaw(how)` helpers | `method`, the way the person checked (RFC 8176 names these authentication methods); the glossary has no word for it |
  | `how` on a note's save (23 test lines) | `SaveDetails` in `next/apps/fabrika/src/exam/notes-contract.test.ts:931-1406`, `notes-fixture.test.ts`, `notes.laws.test.ts` (`pause`, `leave`, `done`, `kept`) | picked in the sweep's plan; exam files, so through the test writer |
  | `how` as a test parameter (1 test line) | `dying(how)` in `ledger/LedgerSpans.test.ts:581` | picked in the sweep's plan |

  What is stored under these keys today, and what the rename must do:

  - `how` sits inside the signed text of grants, removals and `added` events, next to `where`. The
    rename changes the bytes a person signs, as `where` to `location` does, and lands with it. Only
    test ledgers hold them today; if a real ledger exists by then, it needs a migration and its own
    plan.
  - `who` sits in `Attached.online`, which `cloudflare/connection.ts:87` saves as the socket's
    attachment, and in the hello answer a client reads. The rename reads no old key: an open socket
    from before it fails to decode and reconnects. The door and its clients change in one pull
    request.
  - The exam's `ask` answer is printed by the commits check and read by `.agents/` scripts as JSON
    lines, never stored. It is an exam change, so its rename goes through the test writer.
  - `field/runs.jsonl` and `field/notes.jsonl` hold no `"who"` key. This amendment changes no
    `field/` row.
  - The lint rule widens to all five words under ticket 682, with the rest of the sweep.
