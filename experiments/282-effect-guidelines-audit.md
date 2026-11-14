---
date: "2026-11-13"
summary: "`next/`; $0. E1 to E8 of 0120, with 0095 and 0252, on `origin/main` at `14f96d9a3`. No rule has a whole check: six have part of one (E1, E2, E3, E4, E7, 0252) and four have none (E5, E6, E8, 0095). Every one is broken somewhere: 13 hand guards and 14 raw crypto lines (E1), 33 `instanceof` and 10 `Cause.squash` (E2), 3 inferred service types (E3), 19 static layers (E5, 0095), about 394 exports with no doc block and about 119 plan codes (E6), 321 named-import lines in `next/packages` (E7), 13 exported `fnUntraced` (0252). E1, E2, E6, E7 and 0252 still leak in files added by the newest 15 commits; E5 does not. The note's fix order stopped after step 2: no rule from step 3 or step 5 has landed. `effectFnOpportunity` is on while 0252's text says it stays off. The counts are grep heuristics, wider than the note's, with no false alarm rate measured."
---

# 282. Which of the Effect guidelines have a check, and where does `next/` break them today?

Read on 2026-11-13, on `origin/main` at `14f96d9a3`. It is about `next/`, the new version. Nothing
ran but `git grep`: no model, no key, no network, **$0**. No script is kept, because each count is
one grep, and each pattern is written beside its number below. This page was written on its branch
from its first line ([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)).

The guidelines are E1 to E8 in [0120](../.decisions/0120-effect-code-guidelines.md), told at length
in [Effect code guidelines](../docs/direction/effect-code-guidelines.md). Two neighbors they lean on
are read too: [0095](../.decisions/0095-a-service-file-holds-only-its-contract.md) (a service file
holds only its contract) and [0252](../.decisions/0252-effect-fn-for-exported-effects.md)
(`Effect.fn` for exported effects).

**The answer: the guidelines are written, and most of them are not held by code.**

- **No rule has a whole check.** Six have part of one (E1, E2, E3, E4, E7, 0252). Four have none
  (E5, E6, E8, 0095).
- **Every one is broken somewhere today.** The counts are in the table below.
- **Five still leak:** E1, E2, E6, E7 and 0252 were broken again by files added in the newest 15
  commits that touch `next/`. E5 and 0095 did not leak: the six new service files are clean.
- **The note's fix order stopped after step 2.** Step 1 (turning on the zero-hit checks, pull
  request 958) and step 2 (the pattern docs, pull request 961) landed. Not one rule from step 3 or
  step 5 has landed.

```sh
# How every count here was made: one grep on origin/main, tests left out.
nice -n 19 git grep -n -E '<pattern>' origin/main -- next
# "Product" leaves out *.test.ts(x), *Test.ts and *.test-support.ts.
# git grep -E has no \b and no \s here, so the patterns use [[:space:]].
```

How sure: about 85% that each "check built" answer is right, since those are read from config
files. About 70% for the counts: they are grep heuristics, and several are wider than the patterns
the note used. See [what this cannot tell us](#what-this-cannot-tell-us).

## The table

| Rule | Kind | Check built | Broken today | Still leaking | Smallest next step |
|---|---|---|---|---|---|
| E1 | lint, taste | partly | 13 hand guards, 14 raw crypto lines in 6 files, 7 bare `fetch(`, `Patch.ts` | yes | Write `no-hand-guard` with its sweep; turn on `globalFetchInEffect` and `globalDateInEffect` after counting |
| E2 | lint, pattern | partly | 33 `instanceof`, 22 dropped causes, 10 `Cause.squash`, 61 `throw` | yes | A `Cause.squash` ban and `instanceOfSchema` at error, with their sweeps |
| E3 | pattern, lint, taste | partly (the doc only) | 3 inferred service types; three files of 2,022, 1,733 and 1,119 lines | no for types; the files still grow | The `written-service-type` rule (3 sites) |
| E4 | law, review | partly (one machine per file) | 10 `let`s in the runner's closure; the hand spreads were not found again | probably no | Count the spreads again; a holder machine after the split |
| E5 | lint, pattern | no | 19 static layers on 15 classes | no | Write `no-static-layer`, blocking, with a ledger of the 19 or a sweep |
| E6 | lint, taste | no | about 394 exports with no doc block (334 in libfabrika), about 119 plan codes | yes | The plan-code rule, then the docs rule with a ledger |
| E7 | lint | partly (`service-id` only advises) | 321 named-import lines in `next/packages` (432 in `next/`); 1 service id | yes, for imports | Turn on `preferNamespaceImport` for `next/packages/**` with a ledger; make `service-id` block |
| E8 | taste | no | about 4 of 6 sites lack a reason or a record | not measured | Add the 4 one-line reasons; one line in the review step |
| 0095 | decision | no | the same 19 static layers, plus about 10 static code members | no | The same as E5 |
| 0252 | decision | partly | 13 exported `Effect.fnUntraced` | yes | Extend `effect-functions` to an exported `fnUntraced`; settle `effectFnOpportunity` against 0252's text |

## How a check can block here

- **Effect's own checks** are set in `tsconfig.base.json:18-107`. They run inside `pnpm typecheck`,
  which patches in `@effect/tsgo` (`scripts/typecheck.sh`). A rule set to `"error"` there blocks.
- **Every Effect rule the note names is off by default** in `@effect/tsgo` 0.63.0
  (`node_modules/@effect/tsgo/schema.json`): `globalFetchInEffect` (`:2604`), `globalDateInEffect`
  (`:2584`), `instanceOfSchema` (`:2629`), `strictEffectProvide` (`:2954`), `preferNamespaceImport`
  (`:2804`) and `deterministicKeys` (`:2444`). None is set in `tsconfig.base.json`, so none runs.
- **Our own lint rules** are set in `.oxlintrc.json` and run by `pnpm lint` (`package.json:11`, then
  `oxlint-plugins/lint.ts`). A rule blocks unless it is on the advice list at
  `oxlint-plugins/lint.ts:17-19`.
- **No ledger holds an entry for any of these rules.** `next-ledger.json` has only
  `no-restricted-imports` (71), `vitest(no-hooks)` (43) and `no-wall-clock` (1).
  `compiler-ledger.json` is `[]`.
- **Nothing else checks them.** The repo has no `*.grit` file, and `layer-rules.json` only orders
  folders.
- **No pull request adds any new rule the note names.** A search of `git log --grep` and of the
  pull requests for `no-hand-guard`, `no-raw-crypto`, `keep-cause`, `written-service-type`,
  `no-static-layer`, `deterministicKeys` and `instanceOfSchema` found only the decision and note
  pull requests (872 and 967) and pull request 665, which turned on zero-hit checks.
- `next/packages/tuval` does not exist on `origin/main`. `layer-rules.json` names its paths ahead
  of time, so its count is 0 everywhere below.

## E1: use what Effect and Alchemy ship before writing your own

Kind: lint, then taste. **Check: partly built.**

- **Blocking:** `globalRandom` (`tsconfig.base.json:82`) and `cryptoRandomUUID` (`:78`), from pull
  request 958. Our `fabrika/no-wall-clock` (`.oxlintrc.json:833`) blocks clock reads.
- **Off:** `globalFetchInEffect` and `globalDateInEffect`.
- **Not written:** `fabrika/no-hand-guard` and `fabrika/no-raw-crypto`.
- **The pattern docs exist:** `.patterns/effect-reach-for-what-ships.md` and
  `.patterns/effect-crypto-through-services.md`.

Broken today:

- **Hand guards: 13** (runtime 7, cloudflare 4, processes 1, gateway 1). Pattern:
  `typeof X === "object" && X !== null`.
- **Raw crypto: 14 lines in 6 files** (gateway 9, cloudflare 2, transport 1, telemetry 1, top 1).
  Pattern: `crypto\.subtle|crypto\.getRandomValues|globalThis\.crypto|node:crypto`.
- **Bare `fetch(` calls: 7** (`next/apps/fabrika` 6, node 1).
- **`runtime/Patch.ts` is still there.**
- **The Alchemy port (ticket 502) is not finished:** `cloudflare/bindings.ts` and
  `cloudflare/platform.ts` (315 lines) are both still there.
- Examples: `next/packages/libfabrika/src/runtime/Runner.ts:2003`,
  `next/packages/libfabrika/src/runtime/Patch.ts:16`,
  `next/packages/libfabrika/src/gateway/Gateway.ts:1721`.

**Still leaking: yes.** `next/packages/libfabrika/src/runtime/StartChild.ts:29` is a hand guard,
added by `ab6953395` (pull request 1011).

## E2: a failure is a typed value

It keeps its cause, it is caught by tag and never by `instanceof`, and pure code returns it. Kind:
lint plus pattern. **Check: partly built.**

- **Blocking:** `preferSchemaTaggedError` (`tsconfig.base.json:55`), `tryCatchInEffectGen` (`:63`),
  `globalErrorInEffectCatch` and `globalErrorInEffectFailure` (`:100-101`), and
  `fabrika/no-throw-in-effect-gen` (`.oxlintrc.json:32`).
- **Off:** `instanceOfSchema`.
- **Not written:** `fabrika/keep-cause` and the `Cause.squash` ban.

Broken today, in product code:

- **`instanceof <Class>`: 33** (runtime 14, cloudflare 7, settings 3, processes 3, telemetry 2,
  ledger 2, node 1, top 1). About 8 are `instanceof Error` on an unknown value, which may be a
  legal edge.
- **Callbacks that drop the cause: 22** (`next/apps/fabrika` 12, cloudflare 7, runtime 3). Pattern:
  `catch: () =>` and `mapError(() =>`, plus 3 uses of a no-argument `unreachable` in `grant.ts`.
- **`Cause.squash`: 10** (cloudflare 4, runtime 2, transport 2, ledger 1, telemetry 1). The note
  said 2.
- **Product `throw` statements: 61** (runtime 28, apps 9, settings 8, ledger 5, top 5, gateway 4,
  processes 1, node 1).
- Examples: `next/packages/libfabrika/src/runtime/Runner.ts:1299`,
  `next/packages/libfabrika/src/cloudflare/mail.ts:13`,
  `next/packages/libfabrika/src/runtime/Runner.ts:1768`.

The note is out of date in one place. The `unreachable` at `cloudflare/platform.ts:44-49` now keeps
its cause (ticket 695), so the note's "92 of 113 cause drops" no longer holds.

**Still leaking: yes.**

- `next/packages/libfabrika/src/processes/ChildrenLedger.ts:156,195`: `instanceof`.
- `next/packages/libfabrika/src/cloudflare/tail.ts:57,82`: `Cause.squash`.
- `next/packages/libfabrika/src/runtime/WatchersSql.ts:30,34`: `throw`.

## E3: a long body is a `make` with a shelf of named pieces

The hard parts go in `internal/`, and the `layer` is one line. Kind: pattern, plus lint for the
service type, plus taste for the cut. **Check: partly built.** The pattern doc exists
(`.patterns/effect-long-body-is-a-shelf.md`, pull request 961). `fabrika/written-service-type` is
not written.

Broken today:

- **Inferred service types: 3,** all in libfabrika. Pattern:
  `Context.Service<X, (Effect.Success|ReturnType|typeof)`.
  - `next/packages/libfabrika/src/cloudflare/runtime.ts:928`
  - `next/packages/libfabrika/src/cloudflare/runtime.ts:1114`
  - `next/packages/libfabrika/src/gateway/Gateway.ts:1693`
- **The long files have grown since the note:**

  | File | The note said | Now |
  |---|---|---|
  | `runtime/Runner.ts` | 1,766 | 2,022 |
  | `gateway/Gateway.ts` | 1,661 | 1,733 |
  | `cloudflare/runtime.ts` | 874 | 1,119 |

- `Runner.ts` has one section marker, at `:1194`.
- The cut itself is taste. This read did not judge it.

**Still leaking: no, for inferred types** in new files. The three long files keep growing. Who
added the lines was not read; `git log -p` on the three files would settle it.

## E4: control state is a saved tea machine

A plain `let` holds only data that one owner keeps. Kind: law plus review. **Check: partly built.**
`fabrika/one-machine-per-file` blocks (`.oxlintrc.json:644`, from ticket 509, pull request 1026).
It holds "one machine per file", not "control state is a machine". The rest is review.

Broken today, and it needs judgment:

- **The runner's closure still holds 10 `let`s:**
  `next/packages/libfabrika/src/runtime/Runner.ts:305-336`, with `alarmAt` at `:334`.
- **Product `let`s by module:** runtime 30, apps 14, telemetry 10, gateway 8, node 7, top 4,
  settings 3, packs 3, ledger 2, and 1 each in pipeline, transport, processes, cloudflare and
  access. Pattern: `^[[:space:]]+let `.
- **The note's "15 hand spreads" were not found again.** `saveRecovery({ ...` has 0 hits now. The
  spreads may have moved into `runtime/internal/supervisor.ts` or `RecoveryStore.ts`.
- Telling a control-state `let` from a data `let` needs a read of about 10 files, which was not
  done.
- Examples: `next/packages/libfabrika/src/runtime/Runner.ts:334`, `:310` and `:329`.

**Still leaking: unsure, probably no.** Six new files use `Machine.make`. The new `let`s that were
sampled look like local data (`next/packages/libfabrika/src/runtime/WatchersSql.ts:107-109`,
`next/packages/libfabrika/src/node/repositories/Sources.ts:53`).

## E5: a layer asks for what it needs

It never builds its own dependencies, and the service file is its contract (0095). Kind: lint plus
pattern. **Check: no.**

- `fabrika/no-static-layer` is not written. 0095 requires it, and no pull request or commit adds
  it.
- `strictEffectProvide` is off.
- Only the pattern doc exists: `.patterns/effect-services-and-layers.md`.

Broken today:

- **19 static members that return a Layer, on 15 classes.** Pattern:
  `git grep -n 'static readonly' origin/main -- next` gives 21 hits; `processes/Process.ts:204-205`
  are not layers.
- **By module:** runtime 6, telemetry 6, processes 2, access 1, gateway 1, presence 1, top
  (`Id.ts`) 1. These add to 18. `Runner.ts`'s `withLoader` is one of the 19, and the read did not
  say whether it is inside runtime's 6.
- The note counted 24. It is down to 19.
- Examples: `next/packages/libfabrika/src/runtime/Runner.ts:280`,
  `next/packages/libfabrika/src/telemetry/Records.ts:420`,
  `next/packages/libfabrika/src/gateway/Gateway.ts:1696`.
- A body that builds its own dependencies cannot be counted by grep. It was not measured past the
  note's `Runner.ts` example.

**Still leaking: no.** The six new service files have no static layer and no SQL or Layer code:
`runtime/WatcherManager.ts`, `runtime/Watchers.ts`, `processes/Children.ts`,
`packs/RepositoryTrust.ts`, `repositories/Repositories.ts` and `runtime/StepFault.ts`.

## E6: every public export has a doc block, and a comment says why

No plan codes and no history in comments. Kind: lint, then taste. **Check: no.**

- The docs lint rule is not built. The note's fix order puts it in step 5. Ticket 900 ("a lint rule
  holds E6") showed as open, at triage.
- The plan-code rule is not written.
- Only the pattern doc exists: `.patterns/doc-comments.md`.

Broken today. The heuristic: an `export` line whose line above does not end in `*/`, with
`internal/` and tests left out.

- **394 of 734 exports have no doc block,** 334 of them in libfabrika.
- **By module:** cloudflare 61, runtime 59, apps 30, settings 29, top 26, processes 25, access 24,
  programs/pipeline 23, transport 20, telemetry 18, packs 15, node 15, repositories 11, ledger 11,
  jobs 11, schedules 4, gateway 4, counter 3, checklist 3, chaos 1, presence 1.
- **Plan codes in comments: 119 lines** (runtime 38, processes 17, cloudflare 14, ledger 9, node 8,
  and more). Pattern: `P\d+`, `law p\d+`, `flag \d+`.
- Both counts are well above the note's (about 240 and about 28). The patterns here are wider.
- Examples: `next/packages/libfabrika/src/ProcessId.ts:6`,
  `next/packages/libfabrika/src/Testing.ts:3`,
  `next/packages/libfabrika/src/packs/RepositoryTrust.ts:9`.

A second count the same day, with a narrower pattern, agrees. It took only lines that start with
`export class`, `const`, `function`, `interface`, `type`, `namespace` or `enum` in
`next/packages/libfabrika/src`, and skipped `//` lines between a block and its export. It found
**333 of 645** with no doc block.

**Still leaking: yes.**

- 40 of 81 exports in the new product files have no doc block.
- New plan codes: `next/packages/libfabrika/src/processes/Children.ts:1`,
  `next/packages/libfabrika/src/runtime/StartChild.ts:1`,
  `next/packages/libfabrika/src/node/repositories/OpenRepository.ts:34`.
- The same day, a new service file reached review with no doc block at all:
  `next/packages/libfabrika/src/settings/RecordedStart.ts`, on
  [pull request 1054](https://github.com/kamp-us/tea-fabrika/pull/1054). The blocks were added on
  that pull request before it merged.

## E7: imports and service ids read like Effect's

Namespace imports in libraries, and an id with its package and folder. Kind: lint. **Check: partly
built.**

- `fabrika/service-id` exists (`.oxlintrc.json:1386`, `"warn"`) but only advises
  (`oxlint-plugins/lint.ts:17`). It came from ticket 737, pull request 936.
- `oxlint-plugins/service-id.test.ts` also replays the rule over libfabrika. That may be what
  blocked when `284ad0536` had to fix a red main. Reading that test would settle it.
- `preferNamespaceImport` and `deterministicKeys` are off.

Broken today:

- **Named imports from the `"effect"` root: 432 statements in `next/`.** 321 are in
  `next/packages`, in 299 files (157 of them product files). Only 20 files have any
  `import * as X from "effect/..."`. Pattern:
  `^import (type )?\{[^}]*\} from "effect";|^\} from "effect";`.
- **By module:** apps 80, runtime 66, node 53, processes 30, cloudflare 28, settings 25, ledger 22,
  programs/pipeline 18, telemetry 18, transport 16, access 15, packs 10, gateway 9, top 9, jobs 8.
  The smaller modules and programs make up the rest.
- **Service ids: 1 left.** `next/packages/libfabrika/src/runtime/Runner.ts:278` reads
  `"@kampus/libfabrika/ProgramRunner"`, with no folder.
- Examples: `next/packages/libfabrika/src/gateway/Gateway.ts:2`,
  `next/packages/libfabrika/src/ledger/Ledger.ts:5`,
  `next/packages/libfabrika/src/runtime/Runner.ts:278`.

**Still leaking: yes, for imports.** The 26 new product files hold 24 such import lines, for
example `next/packages/libfabrika/src/cloudflare/Publish.ts:1`. Ids get fixed after they land: pull
request 1109 fixed one id, and `284ad0536` fixed another.

## E8: where we differ from Effect, the file says why

At the code, with the record that decided it. Kind: taste. **Check: no.** It is review only. The
pattern doc exists: `.patterns/effect-differences-say-why.md`.

Broken today. This is a read of the note's 6 keep-list sites, not a count:

- `next/packages/libfabrika/src/gateway/GatewayNonce.ts:6` says why, but cites no record.
- `next/packages/libfabrika/src/telemetry/Sink.ts:5` says why, with no record.
- `next/packages/libfabrika/src/runtime/internal/supervisor.ts:1-3` cites 0037 and 0046, but never
  says "not a Schedule".
- 0050 is cited nowhere in libfabrika.
- `next/packages/libfabrika/src/runtime/Runner.ts:1-5` gives no reason against `entityManager`.
- The `Effect.fn` choice has no reason written at the code.
- Contract-only files cite 0095 in 18 places.

So about 2 of 6 sites follow it in full. **Still leaking: not measured.**

## 0095: a service file holds only its contract

No layer, no SQL, no static layer. **Check: no.**

- 0095 binds four checks: a no-static-layer rule, a ban on platform imports in domain modules, a
  tsconfig per folder, and a bundle exam. None is built.
- `layer-rules.json`, through `lint:layers`, holds folder rank only.

Broken today:

- The same 19 static layers as E5.
- About 10 `static make`, `read` or `sign` code members on service-like classes, which break "no
  code that runs". These need judgment.
- Examples: `next/packages/libfabrika/src/cloudflare/platform.ts:67`,
  `next/packages/libfabrika/src/runtime/Execution.ts:192`,
  `next/packages/libfabrika/src/access/SessionManager.ts:63`.

**Still leaking: no.** The new service files are clean.

## 0252: an exported Effect function is `Effect.fn`

Named `"<piece>.<verb>"`; smaller helpers are `fnUntraced`. **Check: partly built.**

- `fabrika/effect-functions` blocks in `next/` product code (`.oxlintrc.json:636`), but only for a
  returned `.withSpan` chain.
- `effectFnOpportunity` is `"error"` in `next/` (`tsconfig.base.json:80`, from pull request 958).
  **0252's own text says it stays off,** because of 65% false alarms (its Decision, second bullet
  from the end). One of the two needs an amendment.
- Neither check catches an exported `fnUntraced`.

Broken today:

- **13 exported `Effect.fnUntraced`** (settings 5, cloudflare 5, runtime 1, processes 1, node 1).
  Pattern: `^export const X = Effect\.fnUntraced`. 48 exports already use `Effect.fn(`.
- Examples: `next/packages/libfabrika/src/cloudflare/platform.ts:16`,
  `next/packages/libfabrika/src/cloudflare/runtime.ts:301`,
  `next/packages/libfabrika/src/runtime/IsolateUsage.ts:59`.
- An exported function with a signature on several lines, which returns an Effect without `fn`, may
  be missed by the grep. A `tsgo` run would settle that. None was run.

**Still leaking: yes.** `next/packages/libfabrika/src/cloudflare/tail.ts:32,47,75` and
`next/packages/libfabrika/src/runtime/IsolateUsage.ts:59` came from `7c6182b27` (pull request
1031). Whether `tail.ts` falls under the span-sink exception is unclear: the exception names an
unnamed `Effect.fn`, not `fnUntraced`.

## The rules that are not built, in the note's fix order

The fix order is in [Effect code guidelines](../docs/direction/effect-code-guidelines.md), "The fix
order".

Rules with no check at all:

1. **E5 and 0095:** `no-static-layer`, step 5 (24 then, 19 now).
2. **E6:** the docs rule (step 5) and the plan-code rule.
3. **E8:** review only. The note plans no check for it.

Named rules still not built, inside the rules that have part of a check:

- **Step 3:** `written-service-type` (E3), the `Cause.squash` ban (E2), `no-raw-crypto` (E1) and
  `no-hand-guard` (E1).
- **Step 5:** `keep-cause` (E2), `deterministicKeys` (E7), `preferNamespaceImport` (E7), and
  `instanceOfSchema`, `globalFetchInEffect` and `globalDateInEffect`.

## How "still leaking" was measured

The newest 15 commits that touch `next/` run from `a4301457d` to `7c6182b27`. Nine of them added
files. The read covered the 26 product files they added, as those files stand on `origin/main`.

## What this cannot tell us

- **The counts are grep heuristics.** Several patterns are wider than the note's, so a count here
  is not the note's count measured again. A hit is a place to look, not a proven break. No false
  alarm rate was measured for any pattern, and a check that blocks needs about 0%.
- **Which tickets exist for these checks.** The tracker search did not work: two different searches
  came back with the same unrelated filter. Only ticket 900 was seen.
- **E4's real size.** The hand spreads were not found again, and no one read the 10 files that
  would tell a control-state `let` from a data `let`.
- **E8's real size.** It was a read of 6 sites, not a sample of the code.
- **E3's cut,** and whether a body builds its own dependencies (E5). Both need a person or a typed
  check, not a grep.
- **Whether `effectFnOpportunity` should be on.** The config and 0252's text disagree, and this
  read did not measure its false alarms.
- **Whether a doc block that exists has the right shape.** E6's counts only ask "is there a block".
  A block with no description or the wrong tags counts as documented here.
- **Anything about today's version.** Only `next/` was read.
