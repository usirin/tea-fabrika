REPORT: lane t911 (B1.0, no-static-layer) is pushed as you said under 0176, at 367af835f.

- Branch: fabrikalfa/cloud-t911 at 367af835fb143822d432960ee25b5d1bf5c6e45d.
- Commits, not squashed:
  - b1d913626 tests: the rule, its laws, its block on the 13 folders at zero
  - 69c16d55c build: 0095 amended, the services pattern and E5
  - 3e94bec55 tests: law 2's look-alikes, README count wording
  - e1710a5a1 build: Watchers line number
  - 367af835f tests: the rule type-checks under exactOptionalPropertyTypes
- Commit author: all five are authored "Claude". They were made before your bot-identity message, and the git config for the bot identity was blocked here, so none of this lane's commits carry it.
- Lint: exit 0 in 114 s.
- Type check: the first run failed in 9 s with two TS2379 errors in oxlint-plugins/no-static-layer.ts (lines 85 and 112, exactOptionalPropertyTypes). That was not a review round. The tests agent widened the `resolve` helper's parameter type in 367af835f: no cast, no law changed, 3 of 3 tests green. The next run passed in 53 s.
- Measured against the plan: 26 fires, not 27, all real, 0 false alarms. SessionManager.ts:63 `static sign` is on a Schema.Opaque class. The list holds 13 folders, not 12: coordination/ is at zero too. Many of the plan's line numbers had moved.
- Plants: see the description below. Every one went red.
- Review: send back 1 (no non-Effect `.Service` look-alikes, and one wrong line number), fixed. Send back 2 (no foreign namespace look-alike), landed under 0176. "Known, and left" in the description says this, as you asked. False alarms: 0.
- Pull request: not opened. See 004.
- Findings: next/AGENTS.md:74 still says "no service class has a static layer", against the amended 0095.

## Description

The no-static-layer rule, on for the next/ folders already at zero (Effect rules B1.0)

## What this does

All of it is in `next/`'s lint config and the repo's lint tooling. Today's version is not touched, and no product code changed.

- A new lint rule, `fabrika/no-static-layer`, refuses every static member on a class that extends `Context.Service`: a static field, method, getter, setter, accessor or `static {}` block. A `declare static` field and instance members pass.
- It is on at `error` for the 13 folders at zero today: `next/apps/**`, `next/programs/**`, and libfabrika's `ci`, `codehost`, `coordination`, `jobs`, `ledger`, `node`, `packs`, `repositories`, `schedules`, `settings` and `transport`. Tests, test support and shared suites are left out.
- Decision 0095's rule line now says "any static member", by the owner's answer of 2026-11-13, with a dated note under a new "Amendments" section.
- No folder needs a fix: the rule fires nowhere in the listed folders, so `pnpm lint` is green.

## Why this change

Ticket 911, slice B1.0 of `docs/plan/effect-rules-big.md` (section "B1: `no-static-layer`"). It builds decision 0095, which says a service file holds only its contract and each layer is a sibling file, with 0168 and `docs/direction/effect-code-guidelines.md` (E5).

The rule refuses every static member, not only one that returns a Layer. The owner answered this on 2026-11-13: a syntax rule cannot read a member's type, so "returns a Layer" would be a guess that misses.

## How it works

- `oxlint-plugins/no-static-layer.ts`, new: for each class declaration or class expression, it resolves the superclass. It accepts `Context.Service` through a named, renamed or namespace import of `effect/Context`, through the `effect` barrel, or `Service` imported from `effect/Context`. It then reports each static member. A local or foreign `Context` or `Service` is not Effect's.
- `.oxlintrc.json`: one block with the 13 folders in `files` and the tests in `excludeFiles` (`next/**/*.test.ts`, `*.test.tsx`, `*Test.ts`, `*.test-support.ts`). This is the first use of oxlint 1.90.0's `excludeFiles` in this config, and law 3 proves it works.
- `oxlint-plugins/index.ts`: the rule's row.
- `oxlint-plugins/README.md`: a new section with the rule, the tools looked at, the count by module, the folder list and how it closes.
- `.decisions/0095-...`, `.patterns/effect-services-and-layers.md` (re-grounded) and `docs/direction/effect-code-guidelines.md` E5: they name the rule and put the measured count beside the guess.

Read these files first, in this order:

1. `oxlint-plugins/no-static-layer.ts`
2. `.oxlintrc.json`, the new block
3. `oxlint-plugins/no-static-layer.test.ts`

## The count, measured against the plan

The rule was replayed over all of `next/` at `c0aaf4a24`, with the list widened to `next/**` in a scratch config. Oxlint read all 470 `.ts` and `.tsx` files in `next/`, and the rule ran on the 195 that are not tests. It fired 26 times. Every fire was read, and there were 0 false alarms. The reviewer's own replay found the same 26.

| Module | Fires | Where, under `next/packages/libfabrika/src/` |
|---|---|---|
| top | 1 | `Id.ts:153` |
| `access` | 1 | `SessionManager.ts:102` |
| `gateway` | 1 | `Gateway.ts:1696` |
| `presence` | 1 | `Connections.ts:40` |
| `processes` | 3 | `Mailbox.ts:168`, `ProcessIdGenerator.ts:28`, `ProcessManager.ts:132` |
| `runtime` | 7 | `Entry.ts:115`, `:210`, `ProcessStore.ts:136`, `RecoveryStore.ts:220`, `Runner.ts:335`, `:345`, `Execution.ts:270` |
| `telemetry` | 6 | `Archive.ts:40`, `:53`, `Records.ts:420`, `:424`, `:429`, `Sink.ts:246` |
| `cloudflare` | 6 | `platform.ts:67`, `:188`, `:237`, `:258`, `:274`, `:305` |

That is 19 layers on 15 classes, plus 7 `static make`. Two things differ from the plan:

- **26, not 27.** `access/SessionManager.ts:63`, `static sign`, does not fire, and the rule is right. It sits on `SavedInput extends Schema.Opaque`, which is not a service class (B1's case 3).
- **13 folders, not 12.** `coordination/` is at zero too. It holds only `index.ts`, and the plan left it out.

The top files of `src/` (`ProcessId.ts`, `Rev.ts`, `SpanTag.ts`, `Sql.ts`, `Testing.ts`, `index.ts`) are at zero but share a folder with `Id.ts`, so they join with B1.4. Many of the plan's line numbers had moved; the table above has today's.

## What a reader should know

A new static member on a service class in a listed folder fails `pnpm lint`. The layer goes to a sibling file that exports `layer`, as `ledger/LedgerSql.ts` does. The rule exports nothing new outside `oxlint-plugins/`.

## Laws and checks

- **Law 2,** `fires exactly on the static members of a class that extends Context.Service, in every import spelling`: a property through oxlint's RuleTester, 100 runs, seed 119120. It generates a superclass kind, an import spelling, a declaration or an expression, and up to 8 members of 13 forms. The look-alikes must give 0 fires: a foreign named `Context`, a foreign `Service`, `Fx.Schema.Service` through the barrel, and a local `Context`. Each of these plants was run once and went red:
  - only members named `layer` count;
  - no `ClassExpression` visitor;
  - the barrel namespace is not resolved;
  - the superclass check is skipped;
  - `declare static` counts;
  - `isContext` is always true;
  - any imported `X.Service` counts;
  - any imported `Service` counts;
  - the `Context` member check in the barrel is dropped;
  - any identifier named `Context` counts.
- **Law 3,** `scenario: the real config holds a static layer in each listed folder, and leaves tests and today's version out`: one real lint run over one planted file per listed folder, 5 test files and 1 file of today's version. These plants went red: dropping `transport/**` from the list, and removing `excludeFiles`.
- **Law 6,** `pinned: every folder listed the day the rule landed is still listed, or the list is next/**`. Dropping a folder went red.
- **Law 1** is the rule itself in `pnpm lint`. A planted `static readonly layer` in `ledger/Referee.ts` went red.
- **What ran, on Node 26.13.0, at `367af835f`:**
  - `pnpm format`, then `pnpm lint`: exit 0, 114 s.
  - `pnpm typecheck`: exit 0, 53 s. The first run failed on two `exactOptionalPropertyTypes` errors in the rule's `resolve` helper. Commit `367af835f` widened its parameter type, with no cast and no law changed.
  - `oxlint-plugins/no-static-layer.test.ts`: 3 of 3.
- **Loosening check:** not run here. `loosening.sh` is the lead's, on the laptop.

## Known, and left

- **Law 2 has no namespace import from a package that is not Effect.** It lacks two look-alikes: `foreignNamespace` (`import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin"`, then `Plugin.Service<…>()(…)`) and `foreignBarrel` (`import * as Fx from "alchemy"`, then `Fx.Context.Service<…>()(…)`). Two plants that loosen the namespace source checks leave law 2 green: in `isContext`, any namespace import counts as Effect's `Context`; in the barrel branch, any namespace counts. The real case is `next/packages/libfabrika/src/node/dev/ControlPlugin.ts:1` and `:6`, alchemy's `Plugin.Service`, in a listed folder, and the rule does not fire on it. So a change that loosened the check would also turn `pnpm lint` red on that real file. A ticket holds the two look-alikes.

## Not in this pull request

- B1.1 to B1.7, the moves, one module at a time: `presence`, `access`, `gateway`, `Id.ts`, `processes`, `telemetry`, `runtime`. Each adds its folder to the list.
- B1.8: `cloudflare/` closes when the Alchemy port (ticket 502) deletes `cloudflare/platform.ts` and its six `static make`. Then the list becomes `next/**`.
- Plan notes from the tests step:
  - The import resolution lives in `service-id.ts`, not `match.ts`. The new rule repeats its two small helpers, about 30 lines.
  - B1's case 4 is read as covering `declare static`, and law 2 pins that reading.
- Finding handed over, for the lead to file: `next/AGENTS.md:74` still says "no service class has a static layer", while the amended 0095 says no static member of any kind. `next/AGENTS.md` is not in this slice's Files table.

## Steps

Each step was a separate agent in a cloud session, not a box:

| Step | Outcome |
|---|---|
| tests | `b1d913626` |
| build | `69c16d55c` |
| review | send back to tests (no non-Effect `.Service` look-alikes) and build (one line number) |
| tests fix | `3e94bec55` |
| build fix | `e1710a5a1` |
| review recheck | send back (no foreign namespace look-alike). The lane stopped here, and the lead landed it under 0176 |
| lead's type check | failed; the tests step fixed it in `367af835f` |

fabrika close ticket 911
